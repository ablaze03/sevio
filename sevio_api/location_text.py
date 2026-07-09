from __future__ import annotations

import re
from typing import Optional


LOCATION_DESCRIPTOR_PHRASES = (
    "городской округ",
    "муниципальный округ",
    "муниципальный район",
    "административный округ",
    "городское поселение",
    "сельское поселение",
    "рабочий поселок",
    "рабочий посёлок",
    "пр т",
    "б р",
    "р н",
    "г о",
    "м о",
)

LOCATION_DESCRIPTOR_WORDS = (
    "район",
    "округ",
    "город",
    "улица",
    "ул",
    "проспект",
    "пр",
    "пр-т",
    "пр-т.",
    "переулок",
    "пер",
    "шоссе",
    "бульвар",
    "б-р",
    "площадь",
    "пл",
    "проезд",
    "набережная",
    "наб",
    "аллея",
    "тупик",
    "линия",
    "микрорайон",
    "мкр",
    "территория",
    "тер",
    "поселок",
    "посёлок",
    "пос",
    "деревня",
    "д",
    "село",
    "с",
    "рп",
    "пгт",
    "снт",
    "днп",
    "кп",
    "г",
    "го",
)


def clean_text(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    value = str(value).replace("\xa0", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def normalize_key(value: Optional[str]) -> str:
    value = clean_text(value)
    if not value:
        return ""
    value = value.casefold().replace("ё", "е")
    value = re.sub(r"[\"'`«»„“”]", "", value)
    value = re.sub(r"[^0-9a-zа-я]+", " ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def location_query_key(value: Optional[str]) -> str:
    raw_key = normalize_key(value)
    if not raw_key:
        return ""

    key = raw_key
    for phrase in LOCATION_DESCRIPTOR_PHRASES:
        phrase_key = normalize_key(phrase)
        key = re.sub(rf"\b{re.escape(phrase_key)}\b", " ", key)
    for word in LOCATION_DESCRIPTOR_WORDS:
        word_key = normalize_key(word)
        key = re.sub(rf"\b{re.escape(word_key)}\b", " ", key)
    key = re.sub(r"\s+", " ", key).strip()
    return key or raw_key
