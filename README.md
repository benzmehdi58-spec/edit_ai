---
title: Medsub Backend
emoji: 🎬
colorFrom: indigo
colorTo: purple
sdk: gradio
sdk_version: 6.31.0
python_version: '3.12'
app_file: app.py
app_port: 7860
pinned: false
---

# HormoziSub

Automated **1080x1920 @ 60fps green-screen Arabic word-by-word caption renderer** (Hormozi style).
Backend: FastAPI + Pillow + OpenCV + FFmpeg. The Figma-generated UI drops into `frontend/`.

## Quick start (Windows PowerShell)

```powershell
cd hormozi-sub\backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

macOS / Linux: `python3 -m venv .venv && source .venv/bin/activate`, then the same `pip` / `uvicorn` commands.

* Interactive API docs: http://localhost:8000/docs
* FFmpeg: uses system `ffmpeg` if on PATH, otherwise the binary bundled with `imageio-ffmpeg` (or set `HORMOZISUB_FFMPEG`).
* Preset fonts (Cairo, Tajawal, Almarai, Changa) are downloaded automatically into `backend/assets/fonts/` on first start.

## API

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/health` | Status + resolved FFmpeg path |
| GET  | `/api/config/defaults` | Default `RenderConfig` (seed for UI controls) |
| GET  | `/api/fonts` | Preset + custom fonts |
| POST | `/api/upload-font` | multipart `font_file` (.ttf/.otf) |
| POST | `/api/preview-frame` | JSON `{config, text, active_word_index, response_format: "png"\|"base64", preview_scale}` |
| POST | `/api/render` | multipart `audio_file`, `srt_file`, `config` (JSON string); `?sync=true` to block |
| GET  | `/api/jobs/{job_id}` | Poll render progress / get `download_url` |
| GET  | `/api/download/{filename}` | Download rendered `.mp4` |

### Examples

```bash
curl -X POST http://localhost:8000/api/preview-frame -H "Content-Type: application/json" \
     -d '{"config": {"font_choice": "Tajawal-Bold"}, "active_word_index": 1}' -o preview.png

curl -X POST "http://localhost:8000/api/render?sync=true" \
     -F audio_file=@voice.wav -F srt_file=@subs.srt \
     -F 'config={"font_choice":"Cairo-Bold","box_color_hex":"#FFEB00"}'
```

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `HORMOZISUB_CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `HORMOZISUB_MAX_RENDERS` | `2` | Concurrent render workers |
| `HORMOZISUB_FFMPEG` | auto | Explicit FFmpeg path |
| `HORMOZISUB_X264_PRESET` / `HORMOZISUB_X264_CRF` | `medium` / `16` | Final encode quality |
| `HORMOZISUB_INTERMEDIATE_CODEC` | `MJPG` | `FFV1` for bit-exact (slower) intermediate |
