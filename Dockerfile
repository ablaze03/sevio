FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SEVIO_DB_PATH=/data/rosreestr.sqlite

WORKDIR /app

COPY requirements-api.txt ./
RUN pip install --no-cache-dir -r requirements-api.txt

COPY sevio_api ./sevio_api

EXPOSE 8000
CMD ["uvicorn", "sevio_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
