# Sevio: сайт и API

Sevio теперь запускается не как отдельный HTML-файл, а как FastAPI-приложение:

- браузер получает лёгкую страницу из `sevio_api/static/index.html`;
- внешний вид взят из актуального прототипа `Сделки Росреестр/Sevio — прототип.html`;
- встроенный в прототип `const DATA` удалён;
- данные подгружаются через API из SQLite-базы Росреестра;
- сырые сделки и полный датасет не отдаются в браузер.

## Быстрый локальный запуск

Подробная короткая инструкция вынесена в [LOCAL_RUN.md](LOCAL_RUN.md).

Если окружение уже создано:

```bash
cd "/Users/spiridonova/Yandex.Disk.localized/Проекты Codex/Sevio.ru"
source .venv/bin/activate
uvicorn sevio_api.main:app --host 127.0.0.1 --port 8000 --reload
```

Открыть сайт:

```text
http://127.0.0.1:8000/
```

## Где лежит база

По умолчанию API ищет SQLite здесь:

```text
Сделки Росреестр/output/rosreestr_deals_unified_2025q3_2026q1.sqlite
```

Можно переопределить путь переменной окружения:

```bash
export SEVIO_DB_PATH="/полный/путь/к/rosreestr.sqlite"
```

## Что защищено

- Полный объект `const DATA` больше не публикуется на клиент.
- Сырые строки сделок не доступны через публичные endpoints.
- API-запросы, кроме `/api/session`, требуют короткоживущий сессионный токен `X-Sevio-Token`.
- Запросы ограничиваются rate limit по IP.
- Малые выборки скрываются через `SEVIO_MIN_PUBLIC_DEALS`.
- `robots.txt` закрывает `/api/`, но не закрывает публичную страницу.

Это не делает сбор данных невозможным, но снижает риск массового копирования и делает подозрительную активность заметнее.

## Структура проекта

- `sevio_api/main.py` — FastAPI-приложение, API и выдача статической страницы.
- `sevio_api/static/index.html` — публичная страница, собранная из актуального HTML-прототипа без встроенного `DATA`.
- `sevio_api/static/prototype-api.js` — адаптер, который заполняет существующие блоки прототипа данными из API.
- `Сделки Росреестр/Sevio — прототип.html` — актуальный исходный HTML-прототип, дизайн-референс.
- `Сделки Росреестр/Q*_*/` — исходные квартальные датасеты Росреестра, не коммитить в Git.
- `Сделки Росреестр/output/` — сгенерированные CSV/SQLite-артефакты, не коммитить в Git.
- `scripts/` — скрипты сборки и анализа датасетов.
- `deploy/` — файлы для Docker/Nginx-деплоя.
- `requirements-api.txt` — зависимости Python для локального запуска и сервера.

## Основные API endpoints

Все endpoints, кроме `/api/session`, требуют заголовок:

```http
X-Sevio-Token: <token>
```

Получение токена:

```http
GET /api/session
```

Поиск локаций:

```http
GET /api/search?q=мытищи&object_type=3
```

Поиск понимает служебные слова и сокращения. Например, `Дубининская улица`,
`улица Дубининская` и `ул. Дубининская` ищутся как `Дубининская`. В ответе
могут быть уровни `district`, `city` и `street`.

Агрегаты по выбранной локации:

```http
GET /api/location?region_code=50&district=Мытищи&object_type=3
```

Оценка объекта:

```http
GET /api/calc?region_code=50&district=Мытищи&object_type=3&area=54
```

Регионы:

```http
GET /api/regions?object_type=3
```

Районы/города региона:

```http
GET /api/locations?region_code=50&object_type=3
```

Населённые пункты внутри района:

```http
GET /api/cities?region_code=50&district=Мытищи&object_type=3
```

Улицы:

```http
GET /api/streets?region_code=50&district=Мытищи&object_type=3
```

Для регионов, где район может быть пустым, улицы можно запрашивать по
населенному пункту или муниципальному округу:

```http
GET /api/streets?region_code=77&city=Муниципальный%20Округ%20Даниловский&object_type=3
```

Типы объектов:

- `1` — земельные участки;
- `2` — дома/здания;
- `3` — квартиры/помещения;
- `4` — коммерция;
- `5` — машино-места.

## Переменные окружения

- `SEVIO_DB_PATH` — путь к SQLite-базе.
- `SEVIO_API_SECRET` — секрет для подписи сессионных токенов.
- `SEVIO_REQUIRE_SESSION` — `1` по умолчанию; `0` отключает проверку токена для отладки.
- `SEVIO_RATE_LIMIT_PER_MINUTE` — лимит API-запросов в минуту на IP, по умолчанию `90`.
- `SEVIO_MIN_PUBLIC_DEALS` — минимальное число сделок для публичной выдачи агрегата, по умолчанию `3`.
- `SEVIO_MAX_LIMIT` — максимальный `limit` для списковых endpoints, по умолчанию `20`.

## Docker и сервер

База должна лежать вне Git-репозитория, например:

```bash
mkdir -p /srv/sevio/data
scp "Сделки Росреестр/output/rosreestr_deals_unified_2025q3_2026q1.sqlite" user@server:/srv/sevio/data/rosreestr.sqlite
```

Сборка и запуск контейнера вручную:

```bash
docker build -t sevio-api .
docker run -d \
  --name sevio-api \
  -p 8000:8000 \
  -v /srv/sevio/data/rosreestr.sqlite:/data/rosreestr.sqlite:ro \
  -e SEVIO_API_SECRET="change-this-long-random-secret" \
  -e SEVIO_RATE_LIMIT_PER_MINUTE=90 \
  -e SEVIO_MIN_PUBLIC_DEALS=3 \
  sevio-api
```

Для публикации на `sevio.ru` см. [deploy/SEVIO_RU.md](deploy/SEVIO_RU.md):

- код хранится в GitHub;
- SQLite копируется на сервер отдельно;
- Docker Compose поднимает API на `127.0.0.1:8000`;
- Nginx публикует сайт наружу.

## Что не коммитить

В Git не должны попадать:

- `.venv/`;
- `.env`;
- `.DS_Store`;
- исходные CSV/XLSX/ZIP датасеты;
- SQLite и большие generated output-файлы.

Это уже отражено в `.gitignore` и `.dockerignore`.
