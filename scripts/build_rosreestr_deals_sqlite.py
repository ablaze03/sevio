#!/usr/bin/env python3
import csv
import json
import os
import sqlite3
from pathlib import Path

from location_normalization import LocationResolver, clean_text


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "Сделки Росреестр" / "output"
INPUT_CSV = OUTPUT_DIR / "rosreestr_deals_unified_2025q3_2026q1.csv"
SUMMARY_JSON = OUTPUT_DIR / "rosreestr_deals_unified_2025q3_2026q1_summary.json"
OUTPUT_DB = OUTPUT_DIR / "rosreestr_deals_unified_2025q3_2026q1.sqlite"
TMP_DB = OUTPUT_DB.with_suffix(".sqlite.tmp")

DELIMITER = "~"
BATCH_SIZE = 50_000


def none_if_blank(value):
    value = value.strip() if isinstance(value, str) else value
    return None if value == "" else value


def to_int(value):
    value = none_if_blank(value)
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def to_float(value):
    value = none_if_blank(value)
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def convert_row(row):
    loc = LOCATION_RESOLVER.resolve(
        to_int(row["region_code"]),
        row["district"],
        row["city"],
        row["street"],
    )
    return (
        to_int(row["number"]),
        none_if_blank(row["okato"]),
        to_int(row["region_code"]),
        none_if_blank(row["district"]),
        none_if_blank(row["city"]),
        none_if_blank(row["quarter_cad_number"]),
        none_if_blank(row["street"]),
        loc["district_norm"],
        loc["district_id"],
        loc["district_name"],
        loc["city_norm"],
        loc["city_id"],
        loc["city_name"],
        loc["street_norm"],
        loc["street_id"],
        loc["street_name"],
        none_if_blank(row["realestate_type_code"]),
        none_if_blank(row["wall_material_code"]),
        to_int(row["year_build"]),
        none_if_blank(row["floor"]),
        none_if_blank(row["purpose_code"]),
        to_float(row["area"]),
        none_if_blank(row["period_start_date"]),
        to_float(row["deal_price"]),
        none_if_blank(row["currency"]),
        none_if_blank(row["doc_type"]),
        none_if_blank(row["source_file"]),
        to_int(row["source_year"]),
        to_int(row["source_quarter"]),
    )


def execute_schema(conn):
    conn.executescript(
        """
        DROP TABLE IF EXISTS deals;
        DROP TABLE IF EXISTS deal_sources;
        DROP TABLE IF EXISTS location_public_summary;
        DROP VIEW IF EXISTS v_deals;
        DROP VIEW IF EXISTS v_region_period_summary;

        CREATE TABLE deals (
            id INTEGER PRIMARY KEY,
            number INTEGER,
            okato TEXT,
            region_code INTEGER,
            district TEXT,
            city TEXT,
            quarter_cad_number TEXT,
            street TEXT,
            district_norm TEXT,
            district_id TEXT,
            district_name TEXT,
            city_norm TEXT,
            city_id TEXT,
            city_name TEXT,
            street_norm TEXT,
            street_id TEXT,
            street_name TEXT,
            realestate_type_code TEXT,
            wall_material_code TEXT,
            year_build INTEGER,
            floor TEXT,
            purpose_code TEXT,
            area REAL,
            period_start_date TEXT,
            deal_price REAL,
            currency TEXT,
            doc_type TEXT,
            source_file TEXT,
            source_year INTEGER,
            source_quarter INTEGER
        );

        CREATE TABLE deal_sources (
            source_file TEXT PRIMARY KEY,
            source_path TEXT NOT NULL,
            source_year INTEGER NOT NULL,
            source_quarter INTEGER NOT NULL,
            rows INTEGER NOT NULL
        );
        """
    )


def create_indexes_and_views(conn):
    conn.executescript(
        """
        CREATE INDEX idx_deals_period ON deals(period_start_date);
        CREATE INDEX idx_deals_region_period ON deals(region_code, period_start_date);
        CREATE INDEX idx_deals_location ON deals(region_code, district, city);
        CREATE INDEX idx_deals_location_canon ON deals(region_code, district_name, city_name);
        CREATE INDEX idx_deals_location_ids ON deals(district_id, city_id, street_id);
        CREATE INDEX idx_deals_quarter_cad ON deals(quarter_cad_number);
        CREATE INDEX idx_deals_type ON deals(realestate_type_code);
        CREATE INDEX idx_deals_doc_type ON deals(doc_type);
        CREATE INDEX idx_deals_price ON deals(deal_price);
        CREATE INDEX idx_deals_area ON deals(area);

        CREATE VIEW v_deals AS
        SELECT
            deals.*,
            CASE realestate_type_code
                WHEN '002001001000' THEN 'Земельный участок'
                WHEN '002001002000' THEN 'Здание'
                WHEN '002001003000' THEN 'Помещение'
                WHEN '002001009000' THEN 'Машиноместо'
                ELSE realestate_type_code
            END AS realestate_type_name
        FROM deals;

        CREATE VIEW v_region_period_summary AS
        SELECT
            region_code,
            period_start_date,
            realestate_type_code,
            doc_type,
            COUNT(*) AS rows,
            SUM(number) AS source_record_count,
            AVG(deal_price) AS avg_deal_price,
            MIN(deal_price) AS min_deal_price,
            MAX(deal_price) AS max_deal_price,
            AVG(area) AS avg_area
        FROM deals
        GROUP BY region_code, period_start_date, realestate_type_code, doc_type;

        CREATE VIEW v_location_aliases AS
        SELECT
            region_code,
            district_name,
            district AS district_raw,
            city_name,
            city AS city_raw,
            street_name,
            street AS street_raw,
            COUNT(*) AS rows
        FROM deals
        GROUP BY
            region_code,
            district_name,
            district,
            city_name,
            city,
            street_name,
            street;

        CREATE TABLE location_public_summary AS
        WITH typed AS (
            SELECT '1' AS object_type, region_code, district_name, district_norm, city_name, city_norm, number
            FROM deals
            WHERE realestate_type_code = '002001001000'
            UNION ALL
            SELECT '2' AS object_type, region_code, district_name, district_norm, city_name, city_norm, number
            FROM deals
            WHERE realestate_type_code = '002001002000'
            UNION ALL
            SELECT '3' AS object_type, region_code, district_name, district_norm, city_name, city_norm, number
            FROM deals
            WHERE realestate_type_code = '002001003000'
            UNION ALL
            SELECT '4' AS object_type, region_code, district_name, district_norm, city_name, city_norm, number
            FROM deals
            WHERE realestate_type_code = '002001003000'
              AND purpose_code IS NOT NULL
              AND purpose_code NOT IN ('206001000000', '204001000000')
            UNION ALL
            SELECT '5' AS object_type, region_code, district_name, district_norm, city_name, city_norm, number
            FROM deals
            WHERE realestate_type_code = '002001009000'
        ),
        levels AS (
            SELECT object_type, region_code, district_name, district_norm, NULL AS city_name, NULL AS city_norm, number
            FROM typed
            WHERE district_name IS NOT NULL
            UNION ALL
            SELECT object_type, region_code, district_name, district_norm, city_name, city_norm, number
            FROM typed
            WHERE district_name IS NOT NULL AND city_name IS NOT NULL
        )
        SELECT
            object_type,
            region_code,
            district_name,
            district_norm,
            city_name,
            city_norm,
            SUM(COALESCE(number, 1)) AS n
        FROM levels
        GROUP BY object_type, region_code, district_name, district_norm, city_name, city_norm;

        CREATE INDEX idx_location_public_summary_district
        ON location_public_summary(object_type, district_norm, n DESC);

        CREATE INDEX idx_location_public_summary_city
        ON location_public_summary(object_type, city_norm, n DESC);
        """
    )


def import_sources(conn):
    if not SUMMARY_JSON.exists():
        return
    summary = json.loads(SUMMARY_JSON.read_text(encoding="utf-8"))
    conn.executemany(
        """
        INSERT INTO deal_sources(source_file, source_path, source_year, source_quarter, rows)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            (
                Path(source["source_file"]).name,
                source["source_file"],
                source["source_year"],
                source["source_quarter"],
                source["rows"],
            )
            for source in summary.get("sources", [])
        ],
    )


def import_deals(conn):
    insert_sql = """
        INSERT INTO deals (
            number, okato, region_code, district, city, quarter_cad_number,
            street, district_norm, district_id, district_name, city_norm, city_id,
            city_name, street_norm, street_id, street_name,
            realestate_type_code, wall_material_code, year_build, floor,
            purpose_code, area, period_start_date, deal_price, currency, doc_type,
            source_file, source_year, source_quarter
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    total = 0
    batch = []
    with INPUT_CSV.open("r", encoding="utf-8", newline="") as input_file:
        reader = csv.DictReader(input_file, delimiter=DELIMITER)
        for row in reader:
            batch.append(convert_row(row))
            if len(batch) >= BATCH_SIZE:
                conn.executemany(insert_sql, batch)
                total += len(batch)
                print(f"imported {total}")
                batch.clear()
        if batch:
            conn.executemany(insert_sql, batch)
            total += len(batch)
            print(f"imported {total}")
    return total


def build_location_resolver():
    resolver = LocationResolver()
    total = 0
    with INPUT_CSV.open("r", encoding="utf-8", newline="") as input_file:
        reader = csv.DictReader(input_file, delimiter=DELIMITER)
        for row in reader:
            region_code = to_int(row["region_code"])
            resolver.add_record(region_code, clean_text(row["district"]), clean_text(row["city"]))
            total += 1
            if total % (BATCH_SIZE * 10) == 0:
                print(f"scanned locations {total}")
    resolver.finalize()
    print(json.dumps({"location_rows_scanned": total}, ensure_ascii=False))
    return resolver


def main():
    if not INPUT_CSV.exists():
        raise SystemExit(f"Input CSV not found: {INPUT_CSV}")

    global LOCATION_RESOLVER
    LOCATION_RESOLVER = build_location_resolver()

    if TMP_DB.exists():
        TMP_DB.unlink()

    conn = sqlite3.connect(TMP_DB)
    try:
        conn.execute("PRAGMA journal_mode = OFF")
        conn.execute("PRAGMA synchronous = OFF")
        conn.execute("PRAGMA temp_store = MEMORY")
        conn.execute("PRAGMA cache_size = -200000")
        execute_schema(conn)
        import_sources(conn)
        total = import_deals(conn)
        create_indexes_and_views(conn)
        conn.execute("ANALYZE")
        conn.execute("PRAGMA optimize")
        actual = conn.execute("SELECT COUNT(*) FROM deals").fetchone()[0]
        if actual != total:
            raise RuntimeError(f"Imported row count mismatch: expected {total}, got {actual}")
        conn.commit()
    finally:
        conn.close()

    os.replace(TMP_DB, OUTPUT_DB)
    print(json.dumps({"output_db": str(OUTPUT_DB), "rows": total}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
