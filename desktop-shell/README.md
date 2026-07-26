# Gemork Desktop

AI-powered desktop assistant that lets you cowork with Google's Gemma model.

## Prerequisites

- **Node.js** 20+ (https://nodejs.org)
- **Rust** 1.70+ (https://rustup.rs)
- **Ollama** with Gemma model pulled (`ollama pull gemma`)
- **Gemork Orchestrator** running on localhost:3001

## Development

```bash
# Install frontend dependencies
npm install

# Run in development mode (opens Tauri window + Vite dev server)
npm run tauri:dev
```

The app connects to:
- **Orchestrator HTTP API**: `http://localhost:3001`
- **Orchestrator WebSocket**: `ws://localhost:8080`

If the orchestrator is not running, the UI will show a disconnected status.

## Production Build

```bash
# Build the frontend
npm run build

# Build the Tauri application (creates installer in src-tauri/target/release/bundle/)
npm run tauri:build
```

### Build Output

- **macOS**: `.dmg` and `.app` in `src-tauri/target/release/bundle/dmg/`
- **Windows**: `.msi` and `.exe` in `src-tauri/target/release/bundle/msi/`
- **Linux**: `.deb` and `.AppImage` in `src-tauri/target/release/bundle/deb/`

## Architecture

This is the Tauri desktop shell (§2 of Gemork architecture). It provides:

- Native desktop window management
- IPC bridge to the orchestrator via HTTP/WebSocket
- Human-in-the-loop approval UI
- Voice input support

## Icons

Placeholder icons are in `src-tauri/icons/`. Replace with real icons before release:

```bash
# Generate all icon sizes from a 1024x1024 PNG
# Use: https://github.com/nickvdyck/tauri-icon-generator
# Or manually create:
#   icons/32x32.png
#   icons/128x128.png
#   icons/128x128@2x.png
#   icons/icon.icns (macOS)
#   icons/icon.ico (Windows)
```

## Troubleshooting

**"Orchestrator not reachable"**
Ensure the orchestrator is running: `cd ../orchestrator && npm start`

**Build fails with "cargo not found"**
Install Rust: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

**Frontend build errors**
Run `npm install` to ensure all dependencies are installed.
