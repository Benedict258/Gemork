# Gemork

**Cowork-with-Gemma** — Local-first autonomous AI agent using Gemma 4.

Gemork is a desktop application that takes a goal in natural language, plans and executes multi-step work across your files, connected apps, and browser — running primarily on-device with Gemma 4, with cloud used only when explicitly needed.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     USER'S MACHINE                      │
│  ┌───────────────┐   ┌──────────────────┐              │
│  │ Desktop App    │   │ Browser Extension │              │
│  │ (Tauri)        │◄──┤ (Manifest V3)     │              │
│  └───────┬────────┘   └──────────────────┘              │
│          │                                               │
│  ┌───────▼─────────────────────────────────┐            │
│  │ Local Orchestrator                       │            │
│  │  - Task/Plan Engine                      │            │
│  │  - Sub-agent Coordinator                 │            │
│  │  - Gemma 4 (local inference)             │            │
│  │  - Connector Adapter Layer               │            │
│  │  - Memory Store (SQLite + Chroma)        │            │
│  │  - Snapshot/Versioning                   │            │
│  └───────┬─────────────────────────────────┘            │
└──────────┼──────────────────────────────────────────────┘
           │  (only when: internet needed, or user away)
           ▼
┌─────────────────────────────────────────────────────────┐
│                      CLOUD RELAY                        │
│  - Session state sync (for mobile relay)               │
│  - Web-lookup requests                                  │
│  - Push notifications to mobile                         │
└──────────┬──────────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────┐
│                MOBILE APP (dispatch only)               │
│  - Start / check / steer tasks                          │
│  - No local execution                                   │
└─────────────────────────────────────────────────────────┘
```

## Tiered Guardrail System

| Tier | Examples | Behavior |
|---|---|---|
| Tier 1 — Read-only | Reading files, searching, reasoning | Fully autonomous |
| Tier 2 — Reversible writes | Drafting docs, editing local files | Autonomous, logged, undoable |
| Tier 3 — Critical/irreversible | Sending messages, deleting files, external actions | Always asks first |

## Monorepo Structure

- `desktop-shell/` — Tauri desktop app (UI shell)
- `local-orchestrator/` — Core agent engine (Task/Plan, Sub-agents, Memory, Guardrails)
- `connector-adapter-layer/` — Uniform connector interface + built-in connectors
- `browser-extension/` — Manifest V3 browser extension (core web surface)
- `cloud-bridge/` — Cloud relay for mobile sync + web lookup
- `mobile-app/` — React Native dispatch client

## Getting Started

```bash
npm install
npm run dev:desktop
```

## License

TBD — Build with Gemma: AI for Africa Hackathon — Minna 2026
