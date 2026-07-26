# Gemork Browser Extension

Local-first autonomous AI agent browser extension (Manifest V3).

## Install (Developer Mode)

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder inside `src/browser-extension/`
5. Ensure the Gemork orchestrator is running on `localhost:8080`

## Development

```bash
npm install
npm run dev     # watch mode — rebuilds on file changes
npm run build   # one-shot build to dist/
```

## Architecture

- **Manifest V3** (Chrome/Edge)
- **background.js** — service worker: WebSocket to orchestrator, message routing, mode management
- **content.js** — injected on all pages: DOM reading, accessibility tree, click/type handlers
- **popup.html/js** — mode toggle, connection status, chat input

## Modes

| Mode   | Tools                                      |
|--------|--------------------------------------------|
| Ask    | read_page, extract_data, get_interactive_elements, scroll |
| Act    | All Ask tools + click, type, navigate, submit_form      |
