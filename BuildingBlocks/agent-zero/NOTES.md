# Agent Zero — Building Block Analysis

**Repo:** https://github.com/agent0ai/agent-zero
**Purpose in Gemork:** Core agent loop reference — plan generation, tool use, sub-agent delegation, self-correction
**Seeds:** Task/Plan Engine, Sub-agent Coordinator

---

## License

**MIT** — Copyright (c) 2025 Agent Zero, s.r.o.

Fully compatible with post-hackathon commercial use. No copyleft/viral obligations. Only requirement: include copyright notice and license in copies.

---

## What We're Reusing

### 1. Core Agent Loop Pattern (HIGH VALUE)
- **File:** `agent.py` — `Agent.monologue()` (lines 387-551)
- **Pattern:** While-loop with iterative LLM calls, tool dispatch, break-loop signals
- **Extract:** The loop structure, extension hook points, tool dispatch flow
- **Rewrite:** Remove LangChain dependency, use our own dataclasses for messages

### 2. Sub-Agent Delegation Chain
- **File:** `tools/call_subordinate.py`
- **Pattern:** Child agent creation, shared context, `_superior`/`_subordinate` linking, recursive `_process_chain()`
- **Extract:** Hierarchical delegation model, result propagation back to parent
- **Rewrite:** Our own SubAgentCoordinator that respects Tier 1/2/3 guardrails

### 3. Parallel Tool Execution
- **File:** `helpers/parallel_tools.py` (754 lines)
- **Pattern:** `ParallelJob` state machine (pending→running→terminal), worker contexts, max concurrency, timeout, cancel
- **Extract:** The job lifecycle, concurrency management, start/await/cancel API
- **Rewrite:** Integrated with our GuardrailEngine (Tier 3 jobs require approval before start)

### 4. Tool Abstraction
- **File:** `helpers/tool.py` (74 lines)
- **Pattern:** `Tool` base class with `execute()`, `before_execution()`, `after_execution()`, `Response(message, break_loop)`
- **Extract:** The tool lifecycle contract
- **Rewrite:** Add tier classification to each tool (maps to our Tier 1/2/3)

### 5. Self-Correction Mechanisms
- **File:** `agent.py` (lines 494-511, 1491-1508)
- **Patterns:** Repeat detection, misformat detection, tool-not-found handling, `RepairableException`
- **Extract:** The error-feedback-to-LLM pattern
- **Rewrite:** Add snapshot rollback on Tier 2 failures

### 6. DirtyJson Parser
- **File:** `helpers/dirty_json.py` (421 lines)
- **Pattern:** Tolerant JSON parser for malformed LLM output (comments, unquoted keys, trailing commas)
- **Extract:** The entire parser — utility-grade, no dependencies
- **Use as-is** in our orchestrator for parsing LLM tool calls

---

## What We're Stripping

| Component | Reason |
|-----------|--------|
| Docker/sandbox infrastructure | Our model is native app, no containers |
| WebUI (Alpine.js frontend) | We use Tauri |
| Flask/SocketIO API layer | We have our own Express + WebSocket server |
| WebSocket UI communication | Replaced by our own LivePlanServer |
| Tunnel/network helpers | Not needed for local-first |
| Plugin architecture | Too complex, A0-specific |
| Browser/vision tools | WebBrain handles browser; we don't need A0's |
| Virtual desktop | Not relevant |
| Knowledge/vector DB | We use ChromaDB + SQLite |
| Skills system | Overkill for Phase 1 |
| Chat persistence | We have our own MemoryStore |
| Settings/migration/backup | A0-specific infrastructure |

---

## Code Quality

**7.5/10.** Production-grade with good architectural patterns. Key strengths: clean extension system, robust tool abstraction, hierarchical sub-agent delegation. Weaknesses: no formal plan data structure (plan is prompt-driven, not a `Plan` class), monolithic `agent.py` (1582 lines), LangChain dependency overhead.

---

## Extraction Priority

1. **DirtyJson parser** — grab as-is
2. **Tool base class** — extract pattern, rewrite with tier classification
3. **ParallelJob state machine** — extract pattern, add guardrail gates
4. **Sub-agent delegation chain** — extract pattern, rewrite for our coordinator
5. **Self-correction patterns** — extract error-feedback loop, add snapshot rollback
