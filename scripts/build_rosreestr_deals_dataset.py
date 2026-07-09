#!/usr/bin/env python3
import csv
import json
import re
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "Сделки Росреестр"
OUTPUT_DIR = SOURCE_DIR / "output"
OUTPUT_CSV = OUTPUT_DIR / "rosreestr_deals_unified_2025q3_2026q1.csv"
SUMMARY_JSON = OUTPUT_DIR / "rosreestr_deals_unified_2025q3_2026q1_summary.json"

DELIMITER = "~"
DATASET_RE = re.compile(
    r"dataset_СДЕЛКИ_r-r_(?P<region_range>\d{2}-\d{2})_y_(?P<year>\d{4})_q_(?P<quarter>\d)\.csv(?:\.zip)?$"
)


def collect_sources():
    candidates = {}
    for path in SOURCE_DIR.glob("Q*_*/*"):
        match = DATASET_RE.match(path.name)
        if not match:
            continue
        key = (match.group("year"), match.group("quarter"), match.group("region_range"))
        current = candidates.get(key)
        if current is None or (current.suffix == ".zip" and path.suffix != ".zip"):
            candidates[key] = path
    return [candidates[key] for key in sorted(candidates)]


def open_text_rows(path):
    if path.suffix == ".zip":
        archive = zipfile.ZipFile(path)
        names = [name for name in archive.namelist() if not name.endswith("/")]
        if len(names) != 1:
            raise ValueError(f"{path} contains {len(names)} files; expected exactly one")
        raw = archive.open(names[0], "r")
        return archive, raw
    return None, path.open("rb")


def normalize_blank(value):
    if value == '""':
        return ""
    return value.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    sources = collect_sources()
    if not sources:
        raise SystemExit(f"No deal CSV sources found in {SOURCE_DIR}")

    expected_header = None
    total_rows = 0
    source_summaries = []

    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as output_file:
        writer = None

        for source in sources:
            match = DATASET_RE.match(source.name)
            year = match.group("year")
            quarter = match.group("quarter")
            source_rows = 0

            archive, raw_stream = open_text_rows(source)
            try:
                text_stream = (line.decode("utf-8-sig") for line in raw_stream)
                reader = csv.reader(text_stream, delimiter=DELIMITER)
                header = next(reader)

                if expected_header is None:
                    expected_header = header
                    output_header = header + ["source_file", "source_year", "source_quarter"]
                    writer = csv.writer(output_file, delimiter=DELIMITER, lineterminator="\n")
                    writer.writerow(output_header)
                elif header != expected_header:
                    raise ValueError(
                        f"Header mismatch in {source}:\nexpected={expected_header}\nactual={header}"
                    )

                for row in reader:
                    if not row:
                        continue
                    if len(row) != len(expected_header):
                        raise ValueError(
                            f"Column count mismatch in {source} row {source_rows + 2}: "
                            f"expected {len(expected_header)}, got {len(row)}"
                        )
                    writer.writerow([normalize_blank(value) for value in row] + [source.name, year, quarter])
                    source_rows += 1
                    total_rows += 1
            finally:
                raw_stream.close()
                if archive is not None:
                    archive.close()

            source_summaries.append(
                {
                    "source_file": str(source.relative_to(ROOT)),
                    "source_year": int(year),
                    "source_quarter": int(quarter),
                    "rows": source_rows,
                }
            )

    summary = {
        "output_csv": str(OUTPUT_CSV.relative_to(ROOT)),
        "delimiter": DELIMITER,
        "columns": expected_header + ["source_file", "source_year", "source_quarter"],
        "source_count": len(sources),
        "total_rows": total_rows,
        "sources": source_summaries,
    }
    SUMMARY_JSON.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
