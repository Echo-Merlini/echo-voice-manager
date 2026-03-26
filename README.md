# echo-voice-manager

Voice clone management UI running on port **7070**. Manages Edge TTS cloud voices and Chatterbox voice clone references from a single web interface.

## Features

- Browse and select from 15 Edge TTS voices (US, British, Australian accents)
- Upload custom voice reference recordings for Chatterbox TTS cloning
- Generate AI clone samples and A/B compare against the original recording
- Tag and filter voice models
- Set the active voice reference used by Chatterbox TTS

## Running with Docker

```bash
docker compose up -d
```

Volume mounts:
- `voice_data` → `/data/voices` — Chatterbox voice reference WAV files
- `voice_samples` → `/data/voice-samples` — Generated AI clone samples and Edge TTS previews

## Running locally

```bash
npm install
node server.js
```

Requires:
- `ffmpeg` in PATH (for audio format conversion on upload)
- Chatterbox TTS Python environment at `~/Claude-chatterbox-env/`
- Edge TTS Python package (`pip install edge-tts`)

## Ports

| Port | Service |
|---|---|
| 7070 | Voice Manager UI + API |
