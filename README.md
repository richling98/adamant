<div align="center">
    <h1>
        <img src="frontend/public/logo.png" width="80" style="border-radius: 10px;" />
        <br>
        Adamant
    </h1>
    <h3>The most private and secure AI meeting notetaker</h3>
    <p>
        <img src="https://img.shields.io/badge/License-MIT-blue" alt="License">
        <img src="https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-white" alt="Platform">
        <img src="https://img.shields.io/badge/Open_Source-forever_free-brightgreen" alt="Open Source">
    </p>
    <p>
        Adamant captures, transcribes, and summarizes your meetings entirely on your local machine.
        No cloud. No leaks. No subscriptions.
    </p>
</div>

---

## What is Adamant?

Adamant is a privacy-first AI meeting assistant built as a self-contained desktop app. It records your microphone and system audio, transcribes speech in real-time using on-device Whisper models, and generates AI-powered summaries using your choice of local or external LLM — all without sending a single byte of your conversation to a third-party server.

## Why Adamant?

- **Privacy-first** — All processing stays on your machine. Recordings, transcripts, and summaries never leave your device.
- **Use any model** — Run Ollama locally, or plug in Claude, Groq, OpenRouter, or any OpenAI-compatible endpoint.
- **Cost-smart** — Avoid per-minute cloud billing by running models locally.
- **Works everywhere** — Google Meet, Zoom, Teams — online or offline.
- **Open source** — Free forever, MIT licensed.

## Features

- Real-time transcription via local Whisper or Parakeet models
- AI-generated meeting summaries with customizable templates
- Sidebar folders to organize meeting notes
- Rich notes panel with autosave and BlockNote editor
- GPU acceleration — Metal (Apple Silicon), CUDA (NVIDIA), Vulkan (AMD/Intel)
- Professional audio mixing — mic + system audio with intelligent ducking
- Flexible AI provider support — Ollama, Claude, Groq, OpenRouter, or custom endpoint

## Installation

### macOS

1. Download the latest `.dmg` from [Releases](https://github.com/richling98/adamant/releases/latest)
2. Open the `.dmg` and drag **Adamant** to your Applications folder
3. Launch Adamant from Applications

### Windows

1. Download the latest `x64-setup.exe` from [Releases](https://github.com/richling98/adamant/releases/latest)
2. Right-click → **Properties** → check **Unblock** → **OK**
3. Run the installer

### Build from Source

```bash
git clone https://github.com/richling98/adamant
cd adamant/frontend
pnpm install
pnpm run tauri:dev
```

Requires Rust and Node.js. See [BUILDING.md](docs/BUILDING.md) for full instructions including GPU build flags.

## Architecture

Adamant is a single self-contained application built with [Tauri](https://tauri.app/):

- **Rust backend** — audio capture, Whisper/Parakeet transcription, SQLite persistence, LLM integration
- **Next.js frontend** — React UI, BlockNote editor, sidebar with folders and drag-and-drop
- **No backend server required** — everything runs in-process

GPU acceleration is enabled at build time automatically:

| Platform | Backend |
|----------|---------|
| macOS (Apple Silicon) | Metal + CoreML |
| Windows/Linux (NVIDIA) | CUDA |
| Windows/Linux (AMD/Intel) | Vulkan |

## Development

```bash
cd frontend

# Run development build
pnpm run tauri:dev

# macOS Metal GPU
pnpm run tauri:dev:metal

# Production build
./clean_build.sh
```

## Contributing

Contributions are welcome. Open an issue or submit a pull request. Please follow the existing project structure and conventions described in [CLAUDE.md](CLAUDE.md).

## Acknowledgments

- [Whisper.cpp](https://github.com/ggerganov/whisper.cpp) — on-device speech recognition
- [Screenpipe](https://github.com/mediar-ai/screenpipe) — audio capture patterns
- [NVIDIA Parakeet](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) — alternative transcription model

## License

MIT License — free to use, modify, and distribute.
