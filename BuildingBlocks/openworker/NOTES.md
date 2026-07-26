# OpenWorker — Building Block Analysis

**Repo:** https://github.com/andrewyng/openworker
**Purpose in Gemork:** Plan generation, task decomposition, permission engine reference
**Seeds:** Task/Plan Engine, Permission/Guardrail Engine

---

## License

**MIT** — Copyright (c) 2024 Andrew Ng

Fully compatible with post-hackathon commercial use. No copyleft/viral obligations.

---

## What We're Reusing

### 1. TurnEngine Core Loop (HIGH VALUE)
- **File:** `coworker/engine.py` (1033 lines)
- **Pattern:** `run()` → `_loop()` (model call → tool calls → repeat) → `_handle_tool_calls()` → `_authorize()`
- **Extract:** The async iteration loop, streaming, tool dispatch, interrupt handling
- **Rewrite:** Replace aisuite dependency with our own model interface; integrate with our GuardrailEngine

### 2. PermissionEngine (HIGH VALUE)
- **File:** `coworker/permissions.py` (238 lines)
- **Pattern:** Mode enum (DISCUSS/PLAN/INTERACTIVE/AUTO/CUSTOM), `Decision` dataclass, `evaluate()` per tool call
- **Extract:** The mode-based gating pattern, risk classification mapping
- **Rewrite:** Map modes to our tiers: DISCUSS→Tier 1, INTERACTIVE→Tier 2, AUTO→Tier 3 with approval

### 3. Risk Classification (HIGH VALUE)
- **File:** `coworker/risk.py`
- **Pattern:** `RiskClass` enum (READ/WRITE_LOCAL/EXEC/EXTERNAL), `classify()` function
- **Extract:** The risk taxonomy and classification logic
- **Rewrite:** Directly maps to our Tier 1/2/3 system. Add `REVERSIBLE_WRITE` as a Tier 2 category.

### 4. Tool Registry (MEDIUM VALUE)
- **File:** `coworker/tools/registry.py` (71 lines)
- **Pattern:** Simple name→callable registry with JSON schema generation
- **Extract:** The entire file — minimal, clean
- **Use as-is** or with minor modifications

### 5. Plan Proposal Workflow (HIGH VALUE)
- **File:** `coworker/tools/plan.py` + `engine.py:_handle_plan_proposal()`
- **Pattern:** Explore read-only → `propose_plan(plan=...)` → PLAN_PROPOSED event → user approve/reject → mode flip → execute
- **Extract:** The explore-then-propose-then-execute workflow
- **Rewrite:** Our plan generation should use this pattern but with Gemma 4 for local inference

### 6. Explorer Subagent (MEDIUM VALUE)
- **File:** `coworker/tools/subagent.py` (138 lines)
- **Pattern:** `build_explorer_engine()` creates child engine with read-only tools, fresh context, PLAN mode
- **Extract:** Context isolation pattern, delegation to read-only child
- **Rewrite:** Our SubAgentCoordinator spawns agents with tier-appropriate tool sets

### 7. TodoList (LOW-MEDIUM VALUE)
- **File:** `coworker/tools/todo.py` (87 lines)
- **Pattern:** `TodoList` dataclass with items (content + status), `todo_write` replaces entire list
- **Extract:** The structured task list pattern
- **Rewrite:** Our PlanStep tracking is similar but with tier classification

### 8. Inbox / Human-in-the-Loop (MEDIUM VALUE)
- **File:** `coworker/inbox.py` (368 lines)
- **Pattern:** `InboxItem` with type (approval/question/notification), state machine (pending→resolved), async `wait()`
- **Extract:** The approval queue pattern for Tier 3 actions
- **Rewrite:** Our guardrail engine's "ask first" flow uses this pattern

### 9. Event System (LOW VALUE)
- **File:** `coworker/events.py` (39 lines)
- **Pattern:** `Event(type, data)` with typed EventTypes
- **Extract:** The contract pattern
- **Use as-is** — trivially simple

---

## What We're Stripping

| Component | Reason |
|-----------|--------|
| Connectors (Slack, GitHub, Jira, Gmail) | Domain-specific, not core architecture |
| MCP (Model Context Protocol) | Specific integration, not needed |
| Providers (OpenAI/Anthropic wrappers) | Replace with our Gemma 4 interface |
| GUI (React/Tauri shell) | We build our own Tauri UI |
| TUI (terminal UI) | Not needed |
| Speech-to-text (Rust sidecar) | Our voice input is push-to-talk |
| Cloud (OAuth broker) | We have our own Cloud Bridge |
| Subscriptions/Mentions | Domain-specific |
| Personas | OpenWorker-specific UX |
| Automation/scheduling | Optional, Phase 2+ |
| Web tools (DuckDuckGo search) | Specific tools, not architecture |
| File/git/shell tools | Specific implementations, not patterns |

---

## Code Quality

**High quality production code.** Clean separation of concerns (engine, permissions, tools, agents, surfaces). Well-documented with docstrings that explain *why*. 80+ test files. Async-first design. Safety-first with permission engine, approval gates, interrupt handling, durable resume. Weaknesses: engine.py is 1033 lines, tight aisuite dependency, some mixed abstraction levels.

---

## Extraction Priority

1. **Risk classification** — extract directly, maps 1:1 to our tiers
2. **PermissionEngine mode pattern** — extract and adapt for guardrails
3. **TurnEngine loop structure** — extract the iteration pattern
4. **Plan proposal workflow** — extract for our plan generation
5. **Inbox approval queue** — extract for Tier 3 human-in-the-loop
6. **Tool registry** — grab as-is
