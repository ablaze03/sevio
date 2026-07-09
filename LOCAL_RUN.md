# Локальный запуск Sevio

Сайт теперь запускается через локальный API. Просто открыть HTML-файл в браузере уже недостаточно.

## 1. Перейти в папку проекта

```bash
cd "/Users/spiridonova/Yandex.Disk.localized/Проекты Codex/Sevio.ru"
```

## 2. Первый запуск на компьютере

Если `.venv` ещё нет:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-api.txt
```

Если `.venv` уже есть, достаточно:

```bash
source .venv/bin/activate
```

## 3. Проверить, что есть база

Файл должен существовать:

```bash
ls -lh "Сделки Росреестр/output/rosreestr_deals_unified_2025q3_2026q1.sqlite"
```

Если база лежит в другом месте, перед запуском указать путь:

```bash
export SEVIO_DB_PATH="/полный/путь/к/rosreestr_deals_unified_2025q3_2026q1.sqlite"
```

## 4. Запустить сайт

```bash
uvicorn sevio_api.main:app --host 127.0.0.1 --port 8000 --reload
```

Открыть в браузере:

```text
http://127.0.0.1:8000/
```

## 5. Остановить сайт

В терминале, где запущен `uvicorn`, нажать:

```text
Ctrl+C
```

## 6. Быстрая проверка API

В другом терминале:

```bash
TOKEN=$(curl -s http://127.0.0.1:8000/api/session | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

curl -s -H "X-Sevio-Token: $TOKEN" \
  "http://127.0.0.1:8000/api/calc?region_code=50&district=%D0%9C%D1%8B%D1%82%D0%B8%D1%89%D0%B8&object_type=3&area=54"
```

Если API работает, вернётся JSON с оценкой цены.

## Частые проблемы

### `No module named uvicorn`

Не активировано окружение или зависимости не установлены:

```bash
source .venv/bin/activate
pip install -r requirements-api.txt
```

### `database not found`

API не нашёл SQLite. Проверить файл:

```bash
ls -lh "Сделки Росреестр/output/rosreestr_deals_unified_2025q3_2026q1.sqlite"
```

Или явно указать путь:

```bash
export SEVIO_DB_PATH="/полный/путь/к/rosreestr_deals_unified_2025q3_2026q1.sqlite"
```

### Порт 8000 занят

Запустить на другом порту:

```bash
uvicorn sevio_api.main:app --host 127.0.0.1 --port 8001 --reload
```

Открыть:

```text
http://127.0.0.1:8001/
```
