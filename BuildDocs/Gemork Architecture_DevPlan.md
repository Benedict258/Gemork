# Gemork — Architecture & Development Plan

Companion document to PRD.md. This defines how Gemork is built, not what it does.

---

## 1. Architecture Pattern

**Event-driven local-first orchestration**, with optional cloud extension for internet-lookup tasks and mobile relay.

Key departure from Claude Cowork's remote-sandbox model: Gemork's default execution environment is the user's own machine, running as a standard installed application (full OS-level file/system access — no sandbox or container layer). Cloud is an extension, not the default runtime.

```
┌─────────────────────────────────────────────────────────┐
│                     USER'S MACHINE                        │
│  ┌───────────────┐   ┌──────────────────┐                │
│  │ Desktop App    │   │ Browser Extension │                │
│  │ (Tauri)        │◄──┤ (core surface)     │                │
│  └───────┬────────┘   └──────────────────┘                │
│          │                                                 │
│  ┌───────▼─────────────────────────────────┐              │
│  │ Local Orchestrator                        │              │
│  │  - Task/Plan Engine                       │              │
│  │  - Sub-agent Coordinator                  │              │
│  │  - Gemma 4 (local inference)               │              │
│  │  - Connector Adapter Layer                 │              │
│  │  - Memory Store (SQLite + local Chroma)    │              │
│  │  - Snapshot/Versioning (pre-write backups) │              │
│  └───────┬─────────────────────────────────┘              │
└──────────┼──────────────────────────────────────────────┘
           │  (only when: internet needed, or user away)
           ▼
┌─────────────────────────────────────────────────────────┐
│                      CLOUD RELAY                           │
│  - Session state sync (for mobile relay)                  │
│  - Web-lookup requests                                    │
│  - Push notifications to mobile                            │
└──────────┬──────────────────────────────────────────────┘
           ▼
┌─────────────────────────────────────────────────────────┐
│                    MOBILE APP (dispatch only)              │
│  - Start / check / steer tasks                             │
│  - No local execution                                      │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Frontend Layer

| Component | Choice | Rationale |
|---|---|---|
| Desktop shell | **Tauri** | Lighter than Electron; fits local-first, low-resource-use goal ("runs on people's PCs") |
| State management | WebSocket-driven live state (plan/subtask progress) | Push-based updates match the "live plan view" requirement — polling would feel laggy and waste resources |
| Browser extension | Manifest V3 (Chrome/Edge), content + background script pair | Talks to the same Local Orchestrator over a local socket/IPC channel |
| Mobile | React Native | Thin dispatch client only — no execution logic needed on-device |

---

## 3. Backend / Local Orchestrator Components

| Component | Responsibility |
|---|---|
| **Task/Plan Engine** | Receives goal, produces plan, decomposes into steps/sub-agent assignments, tracks live status |
| **Sub-agent Coordinator** | Spins up parallel sub-agents working toward one shared goal, aggregates results back into the plan |
| **Connector Adapter Layer** | Uniform interface per connector (filesystem, Drive, Slack, etc.) — adding a connector never touches orchestration logic |
| **Memory Store** | Persistent, per-project (shared where relevant) — see Section 5 |
| **Snapshot/Versioning Service** | Takes a backup before any file write, enabling reversal (Tier 2 actions) |
| **Permission/Guardrail Engine** | Enforces the tiered confirmation system (Tier 1/2/3 from PRD §2.4); gates any access outside current task/folder/project scope |
| **Monitoring Module** | Screen-content reader + webcam fatigue detector — both opt-in, both permission-gated, both user-policy-driven (user defines the action on trigger) |
| **Voice Input Handler** | Push-to-talk capture → transcription → task input |
| **Cloud Bridge** | Only active when: (a) task needs internet lookup, or (b) user needs mobile relay while away from the machine |

---

## 4. Data Layer

| Store | Technology | Use |
|---|---|---|
| Structured data | **SQLite** (local) | Tasks, plans, sub-agent state, permissions, connector configs |
| Vector store (local) | **ChromaDB** (local) | RAG over connected knowledge sources (Drive docs, Slack history) and project memory — reuses the same tool already used in ESS |
| Build-context memory | **Build-Context-Memory.json** (per project, Buiry-methodology-inspired) | Logs what each agent did, when, and why — auditable trail across sessions and sub-agents |
| Cloud cache | **Redis** | Session state for mobile relay, cross-device sync — cloud-side only |
| Local cache | In-process LRU / lightweight embedded cache (e.g. via SQLite itself or a local key-value layer) | Fast repeat-access to recently used file/connector data without re-fetching |
| File snapshots | Hidden local history directory (e.g. `.gemork/history/`) | Copy-on-write backups before any write — enables reversal |

---

## 5. Persistent Memory Design

- **Scope:** per-project by default, with a shared cross-project layer for user preferences and continuity (per PRD §2.2).
- **Mechanism:** a `Build-Context-Memory.json`-style log per project — each entry records agent id, action, timestamp, and rationale. This is queryable by any sub-agent needing prior context, and human-readable for debugging/trust.
- **Retrieval:** combined with the local vector store — structured log for "what happened," vector search for "what's semantically relevant."

---

## 6. Async & Event Infrastructure

- **Local event bus** (in-process pub/sub) drives the live plan view — every step-status change publishes an event the desktop UI and browser extension both subscribe to.
- **Sub-agent task queue** (local, lightweight — e.g. an embedded queue rather than a full message broker, since this runs on a single machine, not a distributed cluster) coordinates parallel sub-agent work.
- **Cloud-side queue** (only relevant when cloud bridge is active) handles mobile relay messages and web-lookup requests without blocking local execution.

---

## 7. Real-Time & Efficiency

- WebSocket channel between Local Orchestrator and both the desktop UI and browser extension — bidirectional, since the user can steer mid-task (matches PRD's "ask before critical actions" and live steering needs).
- Efficiency lever: Gemma 4 local inference sized/quantized appropriately for consumer hardware — this is a core scope constraint, not an afterthought; the "runs on people's PCs" promise depends on it.
- Cloud calls kept minimal and explicit (internet-lookup tasks, mobile relay only) to preserve the local-first performance and privacy story.

---

## 8. Security & Guardrails

- **Tiered confirmation system** (Tier 1/2/3, per PRD §2.4) implemented in the Permission/Guardrail Engine — enforced centrally, not per-connector, so no connector can bypass it.
- **Scope enforcement:** any action needing access outside the current task/folder/project always triggers an explicit permission request (PRD §1.4 step 8) — never a silent broadened grant.
- **Connector access:** always asked per use (per team decision) — no persistent blanket grants.
- **Monitoring data (screen/webcam):** opt-in, local-only processing by default; not transmitted to cloud unless the user's configured action explicitly requires it.
- **Auth:** single-user model for this phase (no org/team accounts needed yet).
- **Reversal:** Tier 2 actions reversible via snapshot restore; Tier 3/external actions reversible only where the underlying platform supports it — flagged clearly when not.

---

## 9. Scalability Considerations (Local-First Context)

Unlike a typical cloud SaaS, Gemork's main "scaling" concern isn't concurrent users — it's **per-machine resource efficiency**:
- Sub-agent count should be capped based on available local compute (avoid oversubscribing a consumer laptop's CPU/RAM running local Gemma 4 inference).
- Cloud relay layer (for mobile) does need conventional scaling treatment (autoscaled relay service, Redis-backed session state) since it may serve many installed clients simultaneously.

---

## 10. Build Sequencing (Suggested)

1. Local Orchestrator core: Task/Plan Engine + live plan view (WebSocket) — the visible skeleton of the whole product
2. Permission/Guardrail Engine (Tier 1/2/3) — build this early, not last, since every other feature needs to respect it
3. Snapshot/Versioning Service — needed before any real file-writing feature is safe to demo
4. Connector Adapter Layer + first connector (filesystem, then Drive or Slack)
5. Memory Store (SQLite + Chroma + Build-Context-Memory.json)
6. Sub-agent Coordinator (parallel execution)
7. Browser Extension (core surface — build in parallel with #4 if team bandwidth allows, since it shares the orchestrator)
8. Voice input (push-to-talk)
9. Monitoring Module (screen/webcam) — later; highest complexity-to-core-value ratio, strong demo moment but not foundational
10. Mobile relay + Cloud Bridge — last, since it's additive to an already-working local product

Actual demo feature subset to be selected by the team from this list, per PRD §4.
