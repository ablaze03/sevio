#!/usr/bin/env python3
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ALIASES_JSON = ROOT / "Сделки Росреестр" / "location_aliases.json"


ADMIN_DISTRICT_WORDS = (
    "городской округ",
    "муниципальный округ",
    "муниципальный район",
    "городской",
    "муниципальный",
    "округ",
    "район",
    "город",
    "г.о.",
    "го",
)

CITY_PREFIX_RE = re.compile(
    r"^(?:городское поселение|сельское поселение|г\.?|город|д\.?|деревня|с\.?|село|пос\.?|поселок|посёлок|рп|р\.п\.|"
    r"рабочий поселок|рабочий посёлок|пгт|п\.г\.т\.|снт|ст|кп)\s+",
    re.IGNORECASE,
)

STREET_PREFIX_RE = re.compile(
    r"^(?:ул\.?|улица|пр-?т|проспект|пер\.?|переулок|ш\.?|шоссе|"
    r"б-р|бульвар|пл\.?|площадь|проезд|наб\.?|набережная)\s+",
    re.IGNORECASE,
)


def clean_text(value):
    if value is None:
        return None
    value = str(value).replace("\xa0", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def normalize_key(value):
    value = clean_text(value)
    if not value:
        return ""
    value = value.casefold().replace("ё", "е")
    value = re.sub(r"[\"'`«»„“”]", "", value)
    value = re.sub(r"[^0-9a-zа-я]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def title_like(value):
    value = clean_text(value)
    if not value:
        return None
    return " ".join(part[:1].upper() + part[1:] for part in value.split(" "))


def strip_district_admin(value):
    key = normalize_key(value)
    if not key:
        return ""
    for word in ADMIN_DISTRICT_WORDS:
        key = re.sub(rf"\b{re.escape(normalize_key(word))}\b", " ", key)
    key = re.sub(r"\bг\b", " ", key)
    return re.sub(r"\s+", " ", key).strip()


def district_stem(value):
    key = strip_district_admin(value)
    parts = []
    for part in key.split():
        for suffix in (
            "инский",
            "ынский",
            "овский",
            "евский",
            "ский",
            "цкий",
            "ской",
            "ый",
            "ий",
            "ой",
            "ая",
            "ое",
            "ые",
            "а",
            "и",
            "ы",
            "о",
            "е",
        ):
            if len(part) > len(suffix) + 2 and part.endswith(suffix):
                part = part[: -len(suffix)]
                break
        parts.append(part)
    return " ".join(parts)


def canonical_city_name(value):
    value = clean_text(value)
    if not value:
        return None
    value = CITY_PREFIX_RE.sub("", value).strip()
    return title_like(value)


def canonical_street_name(value):
    value = clean_text(value)
    if not value:
        return None
    value = STREET_PREFIX_RE.sub("", value).strip()
    return title_like(value)


def location_id(*parts):
    return "|".join(normalize_key(part) for part in parts if part is not None)


def load_aliases(path=ALIASES_JSON):
    if not path.exists():
        return {"district_aliases": {}, "city_aliases": {}, "street_aliases": {}}
    return json.loads(path.read_text(encoding="utf-8"))


class LocationResolver:
    def __init__(self, aliases=None):
        self.aliases = aliases or load_aliases()
        self.district_stats = defaultdict(lambda: {"rows": 0, "cities": Counter(), "raw": Counter()})
        self.district_map = {}
        self._resolve_cache = {}

    def add_record(self, region_code, district, city):
        district = clean_text(district)
        if not region_code or not district:
            return
        key = (int(region_code), district)
        stat = self.district_stats[key]
        stat["rows"] += 1
        stat["raw"][district] += 1
        city_key = normalize_key(canonical_city_name(city))
        if city_key:
            stat["cities"][city_key] += 1

    def finalize(self):
        manual = self.aliases.get("district_aliases", {})
        groups = defaultdict(list)
        for (region_code, district), stat in self.district_stats.items():
            region_aliases = manual.get(str(region_code), {})
            target = region_aliases.get(district)
            group_key = normalize_key(target) if target else district_stem(district)
            groups[(region_code, group_key)].append((district, stat))

        for (region_code, _group_key), items in groups.items():
            clusters = self._cluster_districts(items)
            for cluster in clusters:
                canonical = self._choose_canonical_district(cluster)
                for district, _stat in cluster:
                    self.district_map[(region_code, district)] = canonical

        for region_code_text, aliases in manual.items():
            region_code = int(region_code_text)
            for source, target in aliases.items():
                self.district_map[(region_code, source)] = target

    def _cluster_districts(self, items):
        clusters = []
        for item in sorted(items, key=lambda x: x[1]["rows"], reverse=True):
            district, stat = item
            placed = False
            for cluster in clusters:
                if any(
                    self._should_merge_districts(district, stat, other_district, other_stat)
                    for other_district, other_stat in cluster
                ):
                    cluster.append(item)
                    placed = True
                    break
            if not placed:
                clusters.append([item])
        return clusters

    def _should_merge_districts(self, left_name, left, right_name, right):
        if strip_district_admin(left_name) == strip_district_admin(right_name):
            return True
        left_cities = set(left["cities"])
        right_cities = set(right["cities"])
        if not left_cities or not right_cities:
            return False
        shared = left_cities & right_cities
        return len(shared) >= 2 and len(shared) / min(len(left_cities), len(right_cities)) >= 0.5

    def _choose_canonical_district(self, cluster):
        def score(item):
            district, stat = item
            admin_penalty = 1 if normalize_key(district) != strip_district_admin(district) else 0
            adjective_penalty = 1 if re.search(r"(ский|ской|цкий)$", normalize_key(district)) else 0
            return (admin_penalty, adjective_penalty, -stat["rows"], len(district), district)

        return sorted(cluster, key=score)[0][0]

    def resolve(self, region_code, district, city, street):
        region_code = int(region_code) if region_code is not None else None
        district_raw = clean_text(district)
        cache_key = (region_code, district_raw, clean_text(city), clean_text(street))
        cached = self._resolve_cache.get(cache_key)
        if cached is not None:
            return cached
        district_name = None
        if region_code and district_raw:
            district_name = self.district_map.get((region_code, district_raw), district_raw)

        city_name = self._resolve_city(region_code, district_name, city)
        street_name = self._resolve_street(region_code, district_name, city_name, street)

        district_norm = normalize_key(district_name)
        city_norm = normalize_key(city_name)
        street_norm = normalize_key(street_name)
        resolved = {
            "district_norm": district_norm or None,
            "district_id": location_id(region_code, district_name) if district_name else None,
            "district_name": district_name,
            "city_norm": city_norm or None,
            "city_id": location_id(region_code, district_name, city_name) if city_name else None,
            "city_name": city_name,
            "street_norm": street_norm or None,
            "street_id": location_id(region_code, district_name, city_name, street_name) if street_name else None,
            "street_name": street_name,
        }
        self._resolve_cache[cache_key] = resolved
        return resolved

    def _resolve_city(self, region_code, district_name, city):
        city_name = canonical_city_name(city)
        if not region_code or not district_name or not city_name:
            return city_name
        key = f"{region_code}|{district_name}"
        aliases = self.aliases.get("city_aliases", {}).get(key, {})
        return aliases.get(city_name, city_name)

    def _resolve_street(self, region_code, district_name, city_name, street):
        street_name = canonical_street_name(street)
        if not region_code or not district_name or not street_name:
            return street_name
        city_part = city_name or ""
        key = f"{region_code}|{district_name}|{city_part}"
        aliases = self.aliases.get("street_aliases", {}).get(key, {})
        return aliases.get(street_name, street_name)
