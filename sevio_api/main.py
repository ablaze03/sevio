from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import statistics
import time
from collections import defaultdict, deque
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from sevio_api.location_text import location_query_key


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "Сделки Росреестр" / "output" / "rosreestr_deals_unified_2025q3_2026q1.sqlite"
DB_PATH = Path(os.getenv("SEVIO_DB_PATH", str(DEFAULT_DB))).expanduser()
LIKES_DB_PATH = Path(os.getenv("SEVIO_LIKES_DB_PATH", str(ROOT / "data" / "likes.sqlite"))).expanduser()
STATIC_DIR = Path(__file__).resolve().parent / "static"
PROTOTYPE_DATA_PATH = STATIC_DIR / "prototype-data.json"
SITE_URL = os.getenv("SEVIO_SITE_URL", "https://sevio.ru").rstrip("/")

API_SECRET = os.getenv("SEVIO_API_SECRET", "dev-change-me")
LIKES_SALT = os.getenv("SEVIO_LIKES_SALT", API_SECRET)
LIKES_BASE = int(os.getenv("SEVIO_LIKES_BASE", "100"))
REQUIRE_SESSION = os.getenv("SEVIO_REQUIRE_SESSION", "1") != "0"
RATE_LIMIT_PER_MINUTE = int(os.getenv("SEVIO_RATE_LIMIT_PER_MINUTE", "90"))
MIN_PUBLIC_DEALS = int(os.getenv("SEVIO_MIN_PUBLIC_DEALS", "3"))
MAX_LIMIT = int(os.getenv("SEVIO_MAX_LIMIT", "20"))

TYPE_CODES = {
    "1": "002001001000",  # земельный участок
    "2": "002001002000",  # здание
    "3": "002001003000",  # помещение / квартира
    "4": "002001003000",  # коммерческие помещения ограничиваем purpose_code ниже
    "5": "002001009000",  # машиноместо
}

TYPE_NAMES = {
    "1": "Земельный участок",
    "2": "Здание",
    "3": "Квартира/помещение",
    "4": "Коммерция",
    "5": "Машиноместо",
}

REGION_NAMES = {
    1: "Адыгея",
    2: "Башкортостан",
    3: "Бурятия",
    4: "Алтай",
    5: "Дагестан",
    6: "Ингушетия",
    7: "Кабардино-Балкария",
    8: "Калмыкия",
    9: "Карачаево-Черкесия",
    10: "Карелия",
    11: "Коми",
    12: "Марий Эл",
    13: "Мордовия",
    14: "Саха (Якутия)",
    15: "Северная Осетия",
    16: "Татарстан",
    17: "Тыва",
    18: "Удмуртия",
    19: "Хакасия",
    20: "Чечня",
    21: "Чувашия",
    22: "Алтайский край",
    23: "Краснодарский край",
    24: "Красноярский край",
    25: "Приморский край",
    26: "Ставропольский край",
    27: "Хабаровский край",
    28: "Амурская обл.",
    29: "Архангельская обл.",
    30: "Астраханская обл.",
    31: "Белгородская обл.",
    32: "Брянская обл.",
    33: "Владимирская обл.",
    34: "Волгоградская обл.",
    35: "Вологодская обл.",
    36: "Воронежская обл.",
    37: "Ивановская обл.",
    38: "Иркутская обл.",
    39: "Калининградская обл.",
    40: "Калужская обл.",
    41: "Камчатский край",
    42: "Кемеровская обл.",
    43: "Кировская обл.",
    44: "Костромская обл.",
    45: "Курганская обл.",
    46: "Курская обл.",
    47: "Ленинградская обл.",
    48: "Липецкая обл.",
    49: "Магаданская обл.",
    50: "Московская обл.",
    51: "Мурманская обл.",
    52: "Нижегородская обл.",
    53: "Новгородская обл.",
    54: "Новосибирская обл.",
    55: "Омская обл.",
    56: "Оренбургская обл.",
    57: "Орловская обл.",
    58: "Пензенская обл.",
    59: "Пермский край",
    60: "Псковская обл.",
    61: "Ростовская обл.",
    62: "Рязанская обл.",
    63: "Самарская обл.",
    64: "Саратовская обл.",
    65: "Сахалинская обл.",
    66: "Свердловская обл.",
    67: "Смоленская обл.",
    68: "Тамбовская обл.",
    69: "Тверская обл.",
    70: "Томская обл.",
    71: "Тульская обл.",
    72: "Тюменская обл.",
    73: "Ульяновская обл.",
    74: "Челябинская обл.",
    75: "Забайкальский край",
    76: "Ярославская обл.",
    77: "Москва",
    78: "Санкт-Петербург",
    79: "Еврейская АО",
    83: "Ненецкий АО",
    86: "Ханты-Мансийский АО",
    87: "Чукотский АО",
    89: "Ямало-Ненецкий АО",
    91: "Крым",
    92: "Севастополь",
    93: "ДНР",
    94: "ЛНР",
    95: "Херсонская обл.",
}

app = FastAPI(title="Sevio API", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
rate_buckets: dict[str, deque[float]] = defaultdict(deque)


def now_i() -> int:
    return int(time.time())


def sign(payload: str) -> str:
    return hmac.new(API_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_token(request: Request) -> str:
    payload = {
        "iat": now_i(),
        "nonce": secrets.token_hex(8),
        "ua": hashlib.sha256((request.headers.get("user-agent") or "").encode()).hexdigest()[:16],
    }
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
    body = base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")
    return f"{body}.{sign(body)}"


def verify_token(request: Request) -> None:
    if not REQUIRE_SESSION:
        return
    token = request.headers.get("x-sevio-token") or request.query_params.get("token")
    if not token or "." not in token:
        raise HTTPException(status_code=403, detail="session token required")
    body, got_sig = token.rsplit(".", 1)
    if not hmac.compare_digest(sign(body), got_sig):
        raise HTTPException(status_code=403, detail="bad session token")
    try:
        raw = base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)).decode()
        payload = json.loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=403, detail="bad session token") from exc
    if now_i() - int(payload.get("iat", 0)) > 60 * 60 * 8:
        raise HTTPException(status_code=403, detail="session expired")


def client_key(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "local")
    return ip


def likes_db() -> sqlite3.Connection:
    LIKES_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(LIKES_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute(
        "CREATE TABLE IF NOT EXISTS likes ("
        " visitor_hash TEXT PRIMARY KEY,"
        " ts INTEGER NOT NULL"
        ")"
    )
    return conn


def visitor_hash(request: Request) -> str:
    ip = client_key(request)
    ua = request.headers.get("user-agent", "")
    raw = f"{ip}|{ua}"
    return hmac.new(LIKES_SALT.encode(), raw.encode(), hashlib.sha256).hexdigest()


@app.middleware("http")
async def guard_middleware(request: Request, call_next):
    path = request.url.path
    key = client_key(request)
    bucket = rate_buckets[key]
    cutoff = time.time() - 60
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    public_api_paths = {"/api/session", "/api/prototype-data"}
    if path.startswith("/api/") and path not in public_api_paths:
        if len(bucket) >= RATE_LIMIT_PER_MINUTE:
            return JSONResponse({"detail": "too many requests"}, status_code=429)
        bucket.append(time.time())
        try:
            verify_token(request)
        except HTTPException as exc:
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    if path.startswith("/api/") and path != "/api/prototype-data":
        response.headers["Cache-Control"] = "no-store"
    return response


def db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise HTTPException(status_code=503, detail=f"database not found: {DB_PATH}")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def normalize_query(value: Optional[str]) -> str:
    return (value or "").strip()[:80]


def search_key(value: str) -> str:
    return location_query_key(value)


def edit_distance_within_one(left: str, right: str) -> bool:
    if left == right:
        return True
    if abs(len(left) - len(right)) > 1:
        return False
    i = j = edits = 0
    while i < len(left) and j < len(right):
        if left[i] == right[j]:
            i += 1
            j += 1
            continue
        edits += 1
        if edits > 1:
            return False
        if len(left) > len(right):
            i += 1
        elif len(right) > len(left):
            j += 1
        else:
            i += 1
            j += 1
    return edits + (1 if i < len(left) or j < len(right) else 0) <= 1


def location_key_matches(candidate_key: str, query_key: str) -> bool:
    if not query_key:
        return True
    if query_key in candidate_key:
        return True
    if len(query_key) < 5:
        return False
    candidate_tokens = candidate_key.split()
    return all(
        any(query_token in candidate_token or edit_distance_within_one(query_token, candidate_token) for candidate_token in candidate_tokens)
        for query_token in query_key.split()
    )


@lru_cache(maxsize=8)
def summary_has_street_columns() -> bool:
    if not DB_PATH.exists():
        return False
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute("PRAGMA table_info(location_public_summary)").fetchall()
    columns = {row[1] for row in rows}
    return {"street_name", "street_norm"}.issubset(columns)


def resolve_canonical_location_value(
    conn: sqlite3.Connection,
    field: str,
    norm_field: str,
    value: Optional[str],
    where_sql: str = "",
    params: Optional[list[Any]] = None,
) -> Optional[str]:
    value = normalize_query(value)
    if not value:
        return None
    key = search_key(value)
    clauses = [f"{field} IS NOT NULL"]
    if where_sql:
        clauses.append(where_sql)
    row = conn.execute(
        f"""
        SELECT {field} AS value, {norm_field} AS norm, SUM(COALESCE(number, 1)) AS n
        FROM deals
        WHERE {" AND ".join(clauses)}
          AND ({norm_field} = ? OR {norm_field} LIKE ?)
        GROUP BY {field}, {norm_field}
        ORDER BY CASE WHEN {norm_field} = ? THEN 0 ELSE 1 END, n DESC
        LIMIT 1
        """,
        [*(params or []), key, f"%{key}%", key],
    ).fetchone()
    return row["value"] if row else value


def resolve_location_inputs(
    region_code: int,
    district: Optional[str],
    city: Optional[str],
    street: Optional[str],
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    district = normalize_query(district) or None
    city = normalize_query(city) or None
    street = normalize_query(street) or None
    with db() as conn:
        district = resolve_canonical_location_value(
            conn,
            "district_name",
            "district_norm",
            district,
            "region_code = ?",
            [region_code],
        )
        city_where = "region_code = ?"
        city_params: list[Any] = [region_code]
        if district:
            city_where += " AND district_name = ?"
            city_params.append(district)
        city = resolve_canonical_location_value(conn, "city_name", "city_norm", city, city_where, city_params)
        street_where = "region_code = ?"
        street_params: list[Any] = [region_code]
        if district:
            street_where += " AND district_name = ?"
            street_params.append(district)
        if city:
            street_where += " AND city_name = ?"
            street_params.append(city)
        street = resolve_canonical_location_value(
            conn,
            "street_name",
            "street_norm",
            street,
            street_where,
            street_params,
        )
    return district, city, street


def type_where(object_type: str) -> tuple[str, list[Any]]:
    code = TYPE_CODES.get(object_type)
    if not code:
        raise HTTPException(status_code=400, detail="unknown object type")
    where = "realestate_type_code = ?"
    params: list[Any] = [code]
    if object_type == "4":
        where += " AND purpose_code IS NOT NULL AND purpose_code NOT IN ('206001000000', '204001000000')"
    return where, params


def weighted(values: list[tuple[float, int]]) -> list[float]:
    out: list[float] = []
    for value, count in values:
        if value is None:
            continue
        out.extend([float(value)] * max(int(count or 1), 1))
    return out


def percentile(values: list[float], p: float) -> Optional[float]:
    if not values:
        return None
    values = sorted(values)
    if len(values) == 1:
        return values[0]
    k = (len(values) - 1) * p
    lo = int(k)
    hi = min(lo + 1, len(values) - 1)
    frac = k - lo
    return values[lo] * (1 - frac) + values[hi] * frac


def round_money(value: Optional[float]) -> Optional[int]:
    return None if value is None else int(round(value))


def public_stats(rows: list[sqlite3.Row], object_type: str) -> dict[str, Any]:
    price_values = weighted([(r["deal_price"], r["number"] or 1) for r in rows if r["deal_price"]])
    if object_type == "1":
        unit_pairs = [
            (r["deal_price"] / r["area"] * 100, r["number"] or 1)
            for r in rows
            if r["deal_price"] and r["area"] and r["area"] > 0
        ]
        unit_name = "руб/сотка"
    else:
        unit_pairs = [
            (r["deal_price"] / r["area"], r["number"] or 1)
            for r in rows
            if r["deal_price"] and r["area"] and r["area"] > 0
        ]
        unit_name = "руб/м2"
    unit_values = weighted(unit_pairs)
    deal_count = sum(int(r["number"] or 1) for r in rows)
    if deal_count < MIN_PUBLIC_DEALS:
        return {"n": deal_count, "suppressed": True, "min_public_deals": MIN_PUBLIC_DEALS}
    return {
        "n": deal_count,
        "suppressed": False,
        "price_median": round_money(statistics.median(price_values)) if price_values else None,
        "price_p25": round_money(percentile(price_values, 0.25)),
        "price_p75": round_money(percentile(price_values, 0.75)),
        "unit_median": round_money(statistics.median(unit_values)) if unit_values else None,
        "unit_p25": round_money(percentile(unit_values, 0.25)),
        "unit_p75": round_money(percentile(unit_values, 0.75)),
        "unit_name": unit_name,
    }


def rows_to_public_stats(rows: list[dict[str, Any]], object_type: str) -> dict[str, Any]:
    price_values = weighted([(r["deal_price"], r["number"] or 1) for r in rows if r.get("deal_price")])
    if object_type == "1":
        unit_pairs = [
            (r["deal_price"] / r["area"] * 100, r["number"] or 1)
            for r in rows
            if r.get("deal_price") and r.get("area") and r["area"] > 0
        ]
        unit_name = "руб/сотка"
    else:
        unit_pairs = [
            (r["deal_price"] / r["area"], r["number"] or 1)
            for r in rows
            if r.get("deal_price") and r.get("area") and r["area"] > 0
        ]
        unit_name = "руб/м2"
    unit_values = weighted(unit_pairs)
    deal_count = sum(int(r.get("number") or 1) for r in rows)
    if deal_count < MIN_PUBLIC_DEALS:
        return {"n": deal_count, "suppressed": True, "min_public_deals": MIN_PUBLIC_DEALS}
    return {
        "n": deal_count,
        "suppressed": False,
        "price_median": round_money(statistics.median(price_values)) if price_values else None,
        "price_p25": round_money(percentile(price_values, 0.25)),
        "price_p75": round_money(percentile(price_values, 0.75)),
        "unit_median": round_money(statistics.median(unit_values)) if unit_values else None,
        "unit_p25": round_money(percentile(unit_values, 0.25)),
        "unit_p75": round_money(percentile(unit_values, 0.75)),
        "unit_name": unit_name,
    }


def latest_quarter(rows: list[dict[str, Any]], object_type: str) -> dict[str, Any]:
    by_period: dict[tuple[int, int], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("source_year") and row.get("source_quarter"):
            by_period[(int(row["source_year"]), int(row["source_quarter"]))].append(row)
    if not by_period:
        return rows_to_public_stats(rows, object_type)
    return rows_to_public_stats(by_period[max(by_period)], object_type)


def group_rows(
    object_type: str,
    group_field: str,
    where_sql: str = "",
    params: Optional[list[Any]] = None,
) -> list[dict[str, Any]]:
    type_sql, type_params = type_where(object_type)
    clauses = [type_sql, f"{group_field} IS NOT NULL", "deal_price IS NOT NULL", "area IS NOT NULL", "area > 0"]
    if where_sql:
        clauses.append(where_sql)
    with db() as conn:
        rows = conn.execute(
            f"""
            SELECT {group_field} AS group_value, region_code, district_name, city_name,
                   source_year, source_quarter, number, deal_price, area
            FROM deals
            WHERE {" AND ".join(clauses)}
            """,
            [*type_params, *(params or [])],
        ).fetchall()

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    meta: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = row["group_value"]
        grouped[key].append(
            {
                "source_year": row["source_year"],
                "source_quarter": row["source_quarter"],
                "number": row["number"],
                "deal_price": row["deal_price"],
                "area": row["area"],
            }
        )
        meta.setdefault(
            key,
            {
                "region_code": row["region_code"],
                "region_name": REGION_NAMES.get(row["region_code"], f"Регион {row['region_code']}"),
                "district": row["district_name"],
                "city": row["city_name"],
            },
        )

    items = []
    for key, group in grouped.items():
        total = rows_to_public_stats(group, object_type)
        if total.get("suppressed"):
            continue
        latest = latest_quarter(group, object_type)
        item = {**meta[key], "label": key, "total": total, "latest": latest}
        items.append(item)
    items.sort(key=lambda item: item["total"]["n"], reverse=True)
    return items


@lru_cache(maxsize=64)
def cached_groups(
    object_type: str,
    level: str,
    region_code: Optional[int] = None,
    district: str = "",
    city: str = "",
) -> list[dict[str, Any]]:
    if level == "regions":
        return group_rows(object_type, "region_code")
    if level == "districts":
        if not region_code:
            raise HTTPException(status_code=400, detail="region_code required")
        return group_rows(object_type, "district_name", "region_code = ?", [region_code])
    if level == "cities":
        if not region_code or not district:
            raise HTTPException(status_code=400, detail="region_code and district required")
        return group_rows(
            object_type,
            "city_name",
            "region_code = ? AND district_name = ?",
            [region_code, normalize_query(district)],
        )
    if level == "streets":
        if not region_code or (not district and not city):
            raise HTTPException(status_code=400, detail="region_code and district or city required")
        where = "region_code = ?"
        params: list[Any] = [region_code]
        district = normalize_query(district)
        if district:
            where += " AND district_name = ?"
            params.append(district)
        city = normalize_query(city)
        if city:
            where += " AND city_name = ?"
            params.append(city)
        return group_rows(object_type, "street_name", where, params)
    raise HTTPException(status_code=400, detail="unknown level")


def location_filters(
    region_code: int,
    district: Optional[str],
    city: Optional[str],
    street: Optional[str],
) -> tuple[str, list[Any]]:
    where = "region_code = ?"
    params: list[Any] = [region_code]
    if district:
        where += " AND district_name = ?"
        params.append(district)
    if city:
        where += " AND city_name = ?"
        params.append(city)
    if street:
        where += " AND street_name = ?"
        params.append(street)
    return where, params


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.head("/", include_in_schema=False)
def index_head():
    return Response(status_code=200)


@app.get("/methodology", include_in_schema=False)
def methodology():
    return FileResponse(STATIC_DIR / "methodology.html")


@app.head("/methodology", include_in_schema=False)
def methodology_head():
    return Response(status_code=200)


@app.get("/yandex_4c95cff7ab4af8b0.html", include_in_schema=False)
def yandex_verification():
    return FileResponse(STATIC_DIR / "yandex_4c95cff7ab4af8b0.html")


@app.head("/yandex_4c95cff7ab4af8b0.html", include_in_schema=False)
def yandex_verification_head():
    return Response(status_code=200)


@app.get("/sitemap.xml", include_in_schema=False)
def sitemap():
    urls = [
        {"loc": f"{SITE_URL}/", "lastmod": "2026-07-09", "priority": "1.0"},
        {"loc": f"{SITE_URL}/methodology", "lastmod": "2026-07-09", "priority": "0.7"},
    ]
    body = "\n".join(
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
            *[
                (
                    "  <url>"
                    f"<loc>{item['loc']}</loc>"
                    f"<lastmod>{item['lastmod']}</lastmod>"
                    "<changefreq>weekly</changefreq>"
                    f"<priority>{item['priority']}</priority>"
                    "</url>"
                )
                for item in urls
            ],
            "</urlset>",
        ]
    )
    return Response(content=body, media_type="application/xml")


@app.get("/robots.txt", include_in_schema=False)
def robots():
    return PlainTextResponse(
        "User-agent: *\n"
        "Disallow: /api/\n"
        "Disallow: /static/*.map\n"
        f"Sitemap: {SITE_URL}/sitemap.xml\n"
    )


@app.get("/api/session")
def api_session(request: Request):
    return {"token": make_token(request), "ttl_seconds": 60 * 60 * 8}


@app.get("/api/health")
def api_health():
    return {"ok": True, "db_exists": DB_PATH.exists(), "db_path": str(DB_PATH)}


@app.get("/api/prototype-data", include_in_schema=False)
def api_prototype_data():
    return FileResponse(
        PROTOTYPE_DATA_PATH,
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=86400, stale-while-revalidate=604800"},
    )


@app.get("/api/search")
def api_search(
    q: str = Query(..., min_length=2, max_length=80),
    object_type: str = Query("3", pattern="^[12345]$"),
    region_code: Optional[int] = Query(None, ge=1, le=99),
    limit: int = Query(8, ge=1, le=MAX_LIMIT),
):
    q = normalize_query(q)
    query_key = search_key(q)
    norm_like = f"%{query_key}%"
    region_sql = "AND region_code = ?" if region_code is not None else ""
    region_params: list[Any] = [region_code] if region_code is not None else []
    with db() as conn:
        district_rows = conn.execute(
            f"""
            SELECT region_code, district_name, SUM(n) AS n
            FROM location_public_summary
            WHERE object_type = ?
              {region_sql}
              AND city_name IS NULL
              AND district_norm LIKE ?
            GROUP BY region_code, district_name
            HAVING n >= ?
            ORDER BY n DESC
            LIMIT ?
            """,
            [object_type, *region_params, norm_like, MIN_PUBLIC_DEALS, limit],
        ).fetchall()
        city_rows = conn.execute(
            f"""
            SELECT region_code, district_name, city_name, SUM(n) AS n
            FROM location_public_summary
            WHERE object_type = ?
              {region_sql}
              AND city_name IS NOT NULL
              AND city_norm LIKE ?
            GROUP BY region_code, district_name, city_name
            HAVING n >= ?
            ORDER BY n DESC
            LIMIT ?
            """,
            [object_type, *region_params, norm_like, MIN_PUBLIC_DEALS, limit],
        ).fetchall()
        if summary_has_street_columns():
            street_rows = conn.execute(
                f"""
                SELECT
                  region_code,
                  CASE WHEN COUNT(DISTINCT COALESCE(district_name, '')) = 1 THEN MAX(district_name) ELSE NULL END AS district_name,
                  CASE WHEN COUNT(DISTINCT COALESCE(city_name, '')) = 1 THEN MAX(city_name) ELSE NULL END AS city_name,
                  street_name,
                  SUM(n) AS n
                FROM location_public_summary
                WHERE object_type = ?
                  {region_sql}
                  AND street_name IS NOT NULL
                  AND street_norm LIKE ?
                GROUP BY region_code, street_norm, street_name
                HAVING n >= ?
                ORDER BY n DESC
                LIMIT ?
                """,
                [object_type, *region_params, norm_like, MIN_PUBLIC_DEALS, limit],
            ).fetchall()
        else:
            type_sql, type_params = type_where(object_type)
            street_rows = conn.execute(
                f"""
                SELECT
                  region_code,
                  CASE WHEN COUNT(DISTINCT COALESCE(district_name, '')) = 1 THEN MAX(district_name) ELSE NULL END AS district_name,
                  CASE WHEN COUNT(DISTINCT COALESCE(city_name, '')) = 1 THEN MAX(city_name) ELSE NULL END AS city_name,
                  street_name,
                  SUM(COALESCE(number, 1)) AS n
                FROM deals
                WHERE {type_sql}
                  {region_sql}
                  AND street_name IS NOT NULL
                  AND street_norm LIKE ?
                GROUP BY region_code, street_norm, street_name
                HAVING n >= ?
                ORDER BY n DESC
                LIMIT ?
                """,
                [*type_params, *region_params, norm_like, MIN_PUBLIC_DEALS, limit],
            ).fetchall()
        if not street_rows and len(query_key) >= 5:
            fuzzy_like = f"%{query_key.split()[0][:5]}%"
            if summary_has_street_columns():
                fuzzy_rows = conn.execute(
                    f"""
                    SELECT
                      region_code,
                      CASE WHEN COUNT(DISTINCT COALESCE(district_name, '')) = 1 THEN MAX(district_name) ELSE NULL END AS district_name,
                      CASE WHEN COUNT(DISTINCT COALESCE(city_name, '')) = 1 THEN MAX(city_name) ELSE NULL END AS city_name,
                      street_name,
                      street_norm,
                      SUM(n) AS n
                    FROM location_public_summary
                    WHERE object_type = ?
                      {region_sql}
                      AND street_name IS NOT NULL
                      AND street_norm LIKE ?
                    GROUP BY region_code, street_norm, street_name
                    HAVING n >= ?
                    ORDER BY n DESC
                    LIMIT 100
                    """,
                    [object_type, *region_params, fuzzy_like, MIN_PUBLIC_DEALS],
                ).fetchall()
            else:
                type_sql, type_params = type_where(object_type)
                fuzzy_rows = conn.execute(
                    f"""
                    SELECT
                      region_code,
                      CASE WHEN COUNT(DISTINCT COALESCE(district_name, '')) = 1 THEN MAX(district_name) ELSE NULL END AS district_name,
                      CASE WHEN COUNT(DISTINCT COALESCE(city_name, '')) = 1 THEN MAX(city_name) ELSE NULL END AS city_name,
                      street_name,
                      street_norm,
                      SUM(COALESCE(number, 1)) AS n
                    FROM deals
                    WHERE {type_sql}
                      {region_sql}
                      AND street_name IS NOT NULL
                      AND street_norm LIKE ?
                    GROUP BY region_code, street_norm, street_name
                    HAVING n >= ?
                    ORDER BY n DESC
                    LIMIT 100
                    """,
                    [*type_params, *region_params, fuzzy_like, MIN_PUBLIC_DEALS],
                ).fetchall()
            street_rows = [row for row in fuzzy_rows if location_key_matches(row["street_norm"], query_key)][:limit]
    items = []
    for row in district_rows:
        items.append(
            {
                "level": "district",
                "region_code": row["region_code"],
                "region_name": REGION_NAMES.get(row["region_code"], f"Регион {row['region_code']}"),
                "district": row["district_name"],
                "city": None,
                "label": row["district_name"],
                "n": int(row["n"] or 0),
            }
        )
    for row in city_rows:
        items.append(
            {
                "level": "city",
                "region_code": row["region_code"],
                "region_name": REGION_NAMES.get(row["region_code"], f"Регион {row['region_code']}"),
                "district": row["district_name"],
                "city": row["city_name"],
                "label": row["city_name"],
                "n": int(row["n"] or 0),
            }
        )
    for row in street_rows:
        items.append(
            {
                "level": "street",
                "region_code": row["region_code"],
                "region_name": REGION_NAMES.get(row["region_code"], f"Регион {row['region_code']}"),
                "district": row["district_name"],
                "city": row["city_name"],
                "street": row["street_name"],
                "label": row["street_name"],
                "n": int(row["n"] or 0),
            }
        )
    items.sort(key=lambda item: item["n"], reverse=True)
    return {"items": items[:limit], "object_type": object_type}


@app.get("/api/regions")
def api_regions(
    object_type: str = Query("3", pattern="^[12345]$"),
    limit: int = Query(95, ge=1, le=120),
):
    items = cached_groups(object_type, "regions")[:limit]
    for item in items:
        item["level"] = "region"
        item["label"] = item["region_name"]
        item["district"] = None
        item["city"] = None
    return {"items": items, "object_type": object_type}


@app.get("/api/locations")
def api_locations(
    region_code: int = Query(..., ge=1, le=99),
    object_type: str = Query("3", pattern="^[12345]$"),
    limit: int = Query(80, ge=1, le=200),
):
    items = cached_groups(object_type, "districts", region_code)[:limit]
    for item in items:
        item["level"] = "district"
        item["city"] = None
    return {"items": items, "object_type": object_type}


@app.get("/api/cities")
def api_cities(
    region_code: int = Query(..., ge=1, le=99),
    district: str = Query(..., min_length=1, max_length=120),
    object_type: str = Query("3", pattern="^[12345]$"),
    limit: int = Query(80, ge=1, le=200),
):
    district, _city, _street = resolve_location_inputs(region_code, district, None, None)
    if not district:
        raise HTTPException(status_code=400, detail="district required")
    items = cached_groups(object_type, "cities", region_code, district)[:limit]
    for item in items:
        item["level"] = "city"
    return {"items": items, "object_type": object_type}


@app.get("/api/location")
def api_location(
    region_code: int = Query(..., ge=1, le=99),
    district: Optional[str] = Query(None, min_length=1, max_length=120),
    city: Optional[str] = Query(None, max_length=120),
    street: Optional[str] = Query(None, max_length=160),
    object_type: str = Query("3", pattern="^[12345]$"),
):
    district, city, street = resolve_location_inputs(region_code, district, city, street)
    type_sql, type_params = type_where(object_type)
    loc_sql, loc_params = location_filters(region_code, district, city, street)
    with db() as conn:
        rows = conn.execute(
            f"""
            SELECT source_year, source_quarter, number, deal_price, area
            FROM deals
            WHERE {type_sql} AND {loc_sql}
            """,
            [*type_params, *loc_params],
        ).fetchall()
    grouped: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in rows:
        grouped[f"{row['source_year']}:{row['source_quarter']}"].append(row)
    quarters = []
    for key, group in sorted(grouped.items(), key=lambda item: tuple(map(int, item[0].split(":")))):
        year, quarter = key.split(":")
        quarters.append({"quarter": f"Q{quarter} {year}", **public_stats(group, object_type)})
    return {
        "location": {
            "region_code": region_code,
            "region_name": REGION_NAMES.get(region_code, f"Регион {region_code}"),
            "district": district,
            "city": city,
            "street": street,
        },
        "object_type": object_type,
        "object_type_name": TYPE_NAMES[object_type],
        "total": public_stats(rows, object_type),
        "quarters": quarters,
    }


@app.get("/api/calc")
def api_calc(
    region_code: int = Query(..., ge=1, le=99),
    district: Optional[str] = Query(None, min_length=1, max_length=120),
    area: float = Query(..., gt=0, le=100000),
    city: Optional[str] = Query(None, max_length=120),
    street: Optional[str] = Query(None, max_length=160),
    object_type: str = Query("3", pattern="^[12345]$"),
):
    loc = api_location(region_code, district, city, street, object_type)
    total = loc["total"]
    if total.get("suppressed") or not total.get("unit_median"):
        return {"location": loc["location"], "suppressed": True, "reason": "not enough public deals", "stats": total}
    unit = total["unit_median"]
    return {
        "location": loc["location"],
        "suppressed": False,
        "area": area,
        "unit_median": unit,
        "unit_name": total["unit_name"],
        "estimate": round_money(unit * area),
        "low": round_money((total.get("unit_p25") or unit) * area),
        "high": round_money((total.get("unit_p75") or unit) * area),
        "stats": total,
    }


@app.get("/api/streets")
def api_streets(
    region_code: int = Query(..., ge=1, le=99),
    district: Optional[str] = Query(None, min_length=1, max_length=120),
    city: Optional[str] = Query(None, max_length=120),
    object_type: str = Query("3", pattern="^[12345]$"),
    limit: int = Query(10, ge=1, le=MAX_LIMIT),
):
    district, city, _street = resolve_location_inputs(region_code, district, city, None)
    if not district and not city:
        raise HTTPException(status_code=400, detail="district or city required")
    items = cached_groups(
        object_type,
        "streets",
        region_code,
        district or "",
        city or "",
    )[:limit]
    for item in items:
        item["level"] = "street"
        item["street"] = item["label"]
    return {"items": items, "object_type": object_type}


@app.get("/api/likes")
def api_likes(request: Request):
    vh = visitor_hash(request)
    with likes_db() as conn:
        total = conn.execute("SELECT COUNT(*) AS n FROM likes").fetchone()["n"]
        mine = conn.execute("SELECT 1 FROM likes WHERE visitor_hash = ?", [vh]).fetchone()
    return {"count": LIKES_BASE + int(total or 0), "liked": mine is not None}


@app.post("/api/like")
def api_like(request: Request):
    vh = visitor_hash(request)
    with likes_db() as conn:
        exists = conn.execute("SELECT 1 FROM likes WHERE visitor_hash = ?", [vh]).fetchone()
        if exists:
            conn.execute("DELETE FROM likes WHERE visitor_hash = ?", [vh])
            liked = False
        else:
            conn.execute(
                "INSERT INTO likes (visitor_hash, ts) VALUES (?, ?)",
                [vh, now_i()],
            )
            liked = True
        conn.commit()
        total = conn.execute("SELECT COUNT(*) AS n FROM likes").fetchone()["n"]
    return {"count": LIKES_BASE + int(total or 0), "liked": liked}


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
