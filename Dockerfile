# Stage 1: Build the React + Vite frontend
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Python + FastAPI + FFmpeg backend (Hugging Face Spaces compatible)
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ ./backend/
COPY --from=frontend-build /frontend/dist ./frontend/dist

# Ensure writable directories for Hugging Face Spaces non-root user (uid=1000)
RUN mkdir -p /app/backend/storage/uploads/fonts \
             /app/backend/storage/outputs/.tmp \
             /app/backend/storage/broll_cache \
             /app/backend/assets/fonts/custom \
             /app/backend/assets/fonts/_shaped \
    && chmod -R 777 /app/backend/storage /app/backend/assets

WORKDIR /app/backend

ENV HOME=/tmp
ENV PORT=7860
ENV HOST=0.0.0.0
EXPOSE 7860

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
