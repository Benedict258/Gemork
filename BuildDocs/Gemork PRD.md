# Gemork — Product Requirements Document

**Codename:** Gemork (Cowork-with-Gemma)
**Track:** TBD — Autonomous AI Agents or Edge & Offline AI (decided post-build)
**Event:** Build with Gemma: AI for Africa Hackathon — Minna 2026

---

## 0. Build Approach Note

Gemork is not built from scratch. Three open-source projects (Agent Zero, WebBrain, IRIS GO) are cloned into a local `BuildingBlocks/` reference folder and used to seed specific subsystems — the core agent/sub-agent loop, the browser extension's Ask/Act interaction model, and the desktop↔cloud↔mobile relay pattern, respectively. See Architecture_DevPlan.md §0 for full detail and reuse ground rules. This does not change any feature or scope defined below — it changes how fast and from what starting point the team builds it.

---

## 1. Overview

### 1.1 Core Value Proposition
Gemork is a local-first autonomous work agent. It runs as an installed desktop application, takes a goal in natural language, plans and executes multi-step work across your files, connected apps, and browser — and does so primarily on-device using Gemma 4, with cloud used only when a task explicitly needs internet lookup or cross-device relay.

Where Anthropic's Claude Cowork executes remotely in a sandboxed cloud environment, Gemork's differentiator is that execution defaults to local: your files, your machine, your privacy — with the option to extend to cloud only when the task or the user's absence from the machine requires it.

### 1.2 Primary Target Users
- **Knowledge workers** — research, analysis, document/deck/spreadsheet creation, ops tasks
- **Students** — research assistance, study material handling, project work
- **Non-technical users** who want work done fast without learning tools
- **Developers** (secondary) — as a power-user segment

Demo priority order: Knowledge worker → Student → Non-technical user.

### 1.3 Essential Features by Surface

**Desktop App (primary)**
- Folder selection / scoped file access
- Natural-language task input
- Live plan view (steps, status, completion tracking)
- Parallel sub-agent execution (multiple agents working toward one shared goal)
- Persistent memory (per-project, shared across projects where relevant)
- Push-to-talk voice command input
- Background operation (installed-app permission model, not sandboxed)
- Webcam-based user monitoring (opt-in, permission-gated)
- Screen-content reading (opt-in, permission-gated)
- Task scheduling (recurring/one-off)
- Reversal of completed actions (where technically possible)
- Clarifying questions before critical/dangerous actions

**Browser Extension (core, not optional)**
- Web-based task execution (form filling, navigation, data extraction)
- Acts as Gemork's "hands" on the web, mirroring the plan/step model from desktop

**Mobile (companion/dispatch)**
- Start, check, and steer tasks remotely
- Receives agent status/reports via desktop ↔ cloud ↔ phone relay
- No local task execution on-device; control and reporting only

**Connectors**
- Priority: Local filesystem, Google Drive, Slack
- Second tier: Notion, Gmail/Calendar
- Roadmap: social apps, NotebookLM-style tools, others added as requested
- Uniform adapter interface — new connectors never touch core orchestration logic
- Access requested per-connector, always explicitly asked (no persistent blanket grants)

### 1.4 Core Workflow (Primary User Journey)
1. User installs Gemork (native desktop app, standard OS-level permissions — not sandboxed)
2. User selects a folder/project scope
3. User states a goal (typed or push-to-talk voice)
4. Gemork produces a visible plan (steps, and which apps/connectors will be used)
5. If a step is critical/dangerous or under-specified, Gemork asks a clarifying question before proceeding
6. Execution begins; sub-agents may run in parallel toward the shared goal
7. Live plan view updates as each step completes
8. If a step needs access outside the current task/folder/project scope, Gemork explicitly requests that permission before proceeding
9. Deliverable produced; user can review, and reverse specific completed actions where reversal is technically possible
10. If user is away from the machine, they can check status/steer from mobile (desktop ↔ cloud ↔ phone relay)

---

## 2. Feature Deep-Dives

### 2.1 Screen & User Monitoring
- **Screen content reading:** contextual awareness of open apps/documents to inform assistance. Opt-in, explicit permission required.
- **Webcam-based fatigue/attention detection:** e.g., detecting drowsiness while reading/working.
- **User-assigned actions on detection:** the user configures what happens on trigger (notify, lock screen, pause task, etc.) — Gemork does not decide autonomously what "helpful" intervention means; the user defines the policy.
- Persistent background setting vs. per-session: user opts in; treated as a persistent setting once granted, revocable anytime.

### 2.2 Persistent Memory
- Retains: task history, user preferences/style, and project context (all three).
- Storage approach: a structured build-context-memory log (Buiry-methodology-inspired) — records what an agent did, when, and why, creating an auditable trail future sessions and other sub-agents can reference.
- Scope: per-project by default, with a shared layer across projects for user-level preferences and cross-project continuity.

### 2.3 Parallel Sub-Agents
- Model: task decomposition where each sub-agent owns a distinct piece of work, all coordinating toward one shared goal (not independent, unrelated tasks).
- Visibility: aggregated plan view by default; user can drill into individual sub-agent progress if desired.

### 2.4 Guardrails & Intent Handling
Framed as a **tiered confirmation system** rather than a claim of perfect intent recognition (no system achieves 100% intent accuracy — this PRD commits to an honest, verifiable safety model instead):

| Tier | Examples | Behavior |
|---|---|---|
| Tier 1 — Read-only | Reading files, searching, reasoning | Fully autonomous |
| Tier 2 — Reversible writes | Drafting docs, editing local files | Autonomous, logged, undoable via versioning |
| Tier 3 — Critical/irreversible | Sending messages, deleting files, external actions, spending, anything outside current task/folder/project scope | Always asks first |

### 2.5 Reversal of Actions
- Local file operations: reversible via automatic snapshot/versioning taken before any write (stored in a hidden local history directory).
- External/connector actions (e.g., a sent Slack message): reversed only where the underlying platform allows it; otherwise flagged as non-reversible up front.

### 2.6 Voice
- Input: push-to-talk / click-to-talk (not always-listening) for this phase.
- Output: commands only for now; spoken responses are a future consideration.

### 2.7 Mobile Relay
- Desktop agent communicates with a cloud relay layer; phone communicates with the same relay — enabling status checks and steering when the user is away from the machine.
- No task execution occurs on the phone itself.

### 2.8 Execution Model
- Installed native application with standard OS-level file/system access (like any conventional desktop app) — not a sandboxed or containerized runtime.
- Safety net for this model comes from file versioning/snapshots before writes, not from execution isolation.

---

## 3. Explicit Non-Goals (For Now)
- Always-listening voice activation
- Spoken (audio) responses from the agent
- Full task execution on mobile
- NotebookLM live connector (no public API available — roadmap/manual-import only)
- Claims of guaranteed/perfect intent recognition

---

## 4. Success Criteria (Hackathon Demo)
Exact demo feature subset to be finalized by the team, but must include, at minimum:
- Visible plan generation + live step completion tracking
- At least one working connector
- Persistent memory demonstrated across at least two related tasks
- A clear moment showing local-first execution (offline or low-connectivity resilience)
