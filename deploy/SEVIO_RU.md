# Деплой Sevio на sevio.ru

Текущая production-схема:

- VM в Yandex Cloud: `51.250.6.245`;
- пользователь SSH: `ablaze`;
- приложение: `/srv/sevio/app`;
- SQLite-база: `/srv/sevio/data/rosreestr.sqlite`;
- Docker Compose поднимает FastAPI на `127.0.0.1:8000`;
- Nginx публикует `https://sevio.ru` и `https://www.sevio.ru`;
- TLS-сертификат выпущен через Let's Encrypt/Certbot.

## DNS

У домена должны быть записи:

```text
sevio.ru      A      51.250.6.245
www.sevio.ru  A/CNAME на sevio.ru или A 51.250.6.245
```

На 9 июля 2026 домен уже указывает на `51.250.6.245`.

## Обновление кода с локального компьютера

Из корня проекта:

```bash
cd "/Users/spiridonova/Yandex.Disk.localized/Проекты Codex/Sevio.ru"

rsync -az --delete \
  --exclude='.env' \
  --exclude='.venv' \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  -e 'ssh -i ~/.ssh/id_ed25519_sevio -o BatchMode=yes' \
  Dockerfile compose.yaml requirements-api.txt .dockerignore .env.example \
  README_API.md LOCAL_RUN.md sevio_api deploy \
  ablaze@51.250.6.245:/srv/sevio/app/
```

Затем на сервере:

```bash
ssh -i ~/.ssh/id_ed25519_sevio ablaze@51.250.6.245
cd /srv/sevio/app
sudo docker compose up -d --build
sudo cp deploy/nginx/sevio.ru.conf /etc/nginx/sites-available/sevio.ru
sudo nginx -t
sudo systemctl reload nginx
```

## Проверка после деплоя

На сервере:

```bash
cd /srv/sevio/app
sudo docker compose ps
curl -skI https://sevio.ru/
curl -sk https://sevio.ru/ | grep -E "const DATA|prototype-api|Сколько <span"
```

Ожидаем:

- `curl -skI https://sevio.ru/` возвращает `HTTP/1.1 200 OK`;
- в HTML есть `/static/prototype-api.js`;
- в HTML нет `const DATA`;
- контейнер `sevio-api` находится в состоянии `healthy`.

Проверка API:

```bash
TOKEN=$(curl -sk https://sevio.ru/api/session | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

curl -sk -H "X-Sevio-Token: $TOKEN" \
  "https://sevio.ru/api/calc?region_code=50&district=%D0%9C%D1%8B%D1%82%D0%B8%D1%89%D0%B8&object_type=3&area=54"
```

Ожидаемый ориентир для текущей базы: `estimate = 10128672`, `stats.n = 5445`.

## База данных

База не хранится в Git и не копируется обычным rsync-деплоем.

Путь на сервере:

```text
/srv/sevio/data/rosreestr.sqlite
```

Если нужно обновить базу:

```bash
scp "Сделки Росреестр/output/rosreestr_deals_unified_2025q3_2026q1.sqlite" \
  ablaze@51.250.6.245:/srv/sevio/data/rosreestr.sqlite

ssh -i ~/.ssh/id_ed25519_sevio ablaze@51.250.6.245
cd /srv/sevio/app
sudo docker compose restart sevio-api
```

## HTTPS

Сертификат Let's Encrypt уже выпущен для:

```text
sevio.ru
www.sevio.ru
```

Проверить:

```bash
sudo certbot certificates
```

Обновление сертификатов выполняется Certbot автоматически через systemd timer.

Если нужно перевыпустить/переустановить сертификат:

```bash
sudo certbot --nginx -d sevio.ru -d www.sevio.ru \
  --non-interactive --agree-tos --register-unsafely-without-email --redirect
```

После Certbot нужно забрать актуальный Nginx-конфиг обратно в проект:

```bash
ssh -i ~/.ssh/id_ed25519_sevio ablaze@51.250.6.245 \
  'sudo cat /etc/nginx/sites-available/sevio.ru' > deploy/nginx/sevio.ru.conf
```

## Полезные команды

```bash
ssh -i ~/.ssh/id_ed25519_sevio ablaze@51.250.6.245
cd /srv/sevio/app
sudo docker compose ps
sudo docker compose logs -f sevio-api
sudo systemctl status nginx
sudo nginx -t
```
