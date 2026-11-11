FROM python:3.11-slim

# System dependencies for FFmpeg, OpenCV, and font rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Ensure writable directories for Hugging Face Spaces non-root user (uid=1000)
RUN mkdir -p /app/storage/uploads/fonts \
             /app/storage/outputs/.tmp \
             /app/storage/broll_cache \
             /app/assets/fonts/custom \
             /app/assets/fonts/_shaped \
    && chmod -R 777 /app/storage /app/assets

ENV HOME=/tmp
ENV PORT=7860
ENV HOST=0.0.0.0
EXPOSE 7860

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
