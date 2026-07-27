# Cloud Bridge

Relay server between the Gemork desktop orchestrator and mobile clients. It sits in the middle — mobile clients connect here, and it forwards messages to/from the local orchestrator.

## What it does

- Accepts WebSocket connections from mobile clients (with token auth)
- Connects to the local orchestrator as a WebSocket client (`ws://localhost:8081`)
- Relays messages in both directions
- Manages sessions (create, list, destroy)
- Handles orchestrator restarts via automatic reconnection (3s delay)
- Persists session data to `sessions.json`

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────────┐
│  Mobile App  │◄───────►│   Cloud Bridge   │◄───────►│ Local Orchestrator  │
│  (remote)    │  WSS    │  :8082 (WS)      │  WS     │  :8081 (WS)         │
│              │         │  :3002 (HTTP)    │         │  :3001 (HTTP)       │
└─────────────┘         └──────────────────┘         └─────────────────────┘
                              │
                         sessions.json
```

## Quick Start

```bash
cd cloud-bridge
npm install
cp .env.example .env
npm run dev
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3002 | HTTP API port |
| `WS_PORT` | 8082 | WebSocket port for mobile clients |
| `ORCHESTRATOR_WS_URL` | ws://localhost:8081 | Orchestrator WebSocket URL |
| `RELAY_TOKEN` | (auto-generated) | Auth token for mobile clients |

## How Mobile Clients Connect

1. Create a session: `POST /api/sessions`
2. Get the relay URL with token: `ws://relay:8082?token=xxx&session=yyy`
3. Connect via WebSocket
4. Send/receive messages

## HTTP API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/sessions` | Create session |
| `GET` | `/api/sessions` | List sessions |
| `GET` | `/api/sessions/:id` | Get session |
| `DELETE` | `/api/sessions/:id` | End session |
| `POST` | `/api/relay/:sessionId/message` | Send message (HTTP fallback) |

## Testing Locally

```bash
# Terminal 1: Start orchestrator (if running locally)
cd local-orchestrator && npm run dev

# Terminal 2: Start cloud bridge
cd cloud-bridge && npm run dev

# Terminal 3: Test with wscat
npx wscat -c "ws://localhost:8082?token=$(cat cloud-bridge/.relay-token)&session=test1"

# Run tests
cd cloud-bridge && npm test
```
