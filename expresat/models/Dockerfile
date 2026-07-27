FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/
COPY backend/requirements-train.txt /app/

RUN pip install --no-cache-dir -r requirements.txt -r requirements-train.txt

COPY models/ /app/

CMD ["python", "train_and_export.py"]
