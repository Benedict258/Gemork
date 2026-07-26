# WebBrain — Building Block Analysis

**Repo:** https://github.com/webbrain-one/webbrain
**Purpose in Gemork:** Browser extension reference — Ask/Act mode split maps to our Tier 1/3 guardrails
**Seeds:** Browser Extension core interaction model, permission gating

---

## License

**MIT** — Copyright 2026, Emre Sokullu

Fully compatible with post-hackathon commercial use. No copyleft/viral obligations.

---

## What We're Reusing

### 1. Ask/Act Mode Split (HIGH VALUE — Core Pattern)
- **File:** `src/chrome/src/agent/tools.js`
- **Pattern:** `ASK_ONLY_TOOLS` list (read-only tools) vs full tool set (Act mode)
- **Extract:** The mode concept: Ask = read-only (Tier 1, autonomous), Act = state-changing (Tier 3, confirm first)
- **Rewrite:** Our extension uses this exact split. Ask tools → Tier 1. Act tools → Tier 3 with approval prompt.

### 2. getToolsForMode() (HIGH VALUE)
- **File:** `src/chrome/src/agent/tools.js:1267-1319`
- **Pattern:** Filters available tools by mode (ask/act/dev) and tier (compact/mid/full)
- **Extract:** The filtering logic
- **Rewrite:** Map to our model: `getToolsForTier(tier: 1|2|3)` where tier 1 = read-only, tier 3 = full

### 3. Permission Gate (Capability × Origin) (HIGH VALUE)
- **File:** `src/chrome/src/agent/permission-gate.js`
- **Pattern:** `Capability` enum (NAVIGATE, CLICK, TYPE, EXECUTE_JS, etc.), tool→capability mapping, per-host grants (allow/deny/prompt, once/always)
- **Extract:** The capability classification, grant storage, tab-scoped once-grants
- **Rewrite:** Our guardrail engine uses this pattern. Tool→tier mapping replaces tool→capability mapping.

### 4. ASK System Prompt (HIGH VALUE)
- **File:** `src/chrome/src/agent/tools.js:1339-1419`
- **Pattern:** Complete system prompt for read-only mode: "You can read pages, extract data, but NEVER click/type/navigate"
- **Extract:** The prompt structure and constraints
- **Rewrite:** Adapt for our Tier 1 browser instructions

### 5. ACT System Prompt (HIGH VALUE)
- **File:** `src/chrome/src/agent/tools.js:1421-1663`
- **Pattern:** Complete system prompt for action mode: "You can click/type/navigate, ask user before destructive actions"
- **Extract:** The prompt structure and safety constraints
- **Rewrite:** Adapt for our Tier 3 browser instructions with explicit approval requirement

### 6. Tool Definitions (MEDIUM VALUE)
- **File:** `src/chrome/src/agent/tools.js:15-1085`
- **Pattern:** 40+ tool schemas in OpenAI function-calling format
- **Extract:** Tool schema patterns for browser interaction (read_page, click, type, scroll, etc.)
- **Rewrite:** Keep the schemas, change the dispatch to respect our tier system

### 7. Accessibility Tree Builder (MEDIUM VALUE)
- **File:** `src/chrome/src/content/accessibility-tree.js` (1137 lines)
- **Pattern:** Stable ref_ids via WeakRef element registry, flat indented text output, filter modes (all/visible/interactive)
- **Extract:** The AX tree builder — portable, no browser API deps
- **Use as-is** or with minor modifications

### 8. Content Script DOM Interaction (MEDIUM VALUE)
- **File:** `src/chrome/src/content/content.js` (5029 lines)
- **Pattern:** Click, type, scroll, form interaction handlers
- **Extract:** The interaction handler patterns
- **Rewrite:** Gate each action through our tier system before execution

### 9. UNTRUSTED_CONTENT_TOOLS (MEDIUM VALUE)
- **File:** `src/chrome/src/agent/permission-gate.js:58-120`
- **Pattern:** Set of tools whose results carry page-derived content (prompt injection defense)
- **Extract:** The classification set
- **Use as-is** — security-relevant, should not be modified

### 10. Mode Switching in UI (LOW VALUE)
- **File:** `src/chrome/src/ui/sidepanel.js:9721-9747`
- **Pattern:** `setMode()` function toggling CSS classes, updating visual state
- **Extract:** The UI pattern for mode toggle
- **Rewrite:** Our Tauri UI handles mode display differently

---

## What We're Stripping

| Component | Reason |
|-----------|--------|
| Firefox build (`src/firefox/`) | Different manifest version, not MV3 |
| CDP client (`src/chrome/src/cdp/`) | Chrome-only debugger protocol, complex |
| Offscreen document (`src/chrome/src/offscreen/`) | Chrome-only fetch proxy |
| Provider implementations (20+ LLM providers) | Replace with our Gemma 4 interface |
| Trace/Recorder | Debug system, not needed |
| Settings UI | Full settings page, not needed |
| Skills system | Dynamic loading, overkill for Phase 1 |
| WebMCP | Experimental, Chrome 149+ only |
| Workflows | Compiled artifacts from traces |
| Scheduler | Scheduled tasks via alarms |
| LM Studio plugin | Standalone plugin |
| Web landing site | Marketing/docs |
| Site adapters (58+) | Site-specific guidance, not core |
| Run reconnect | Detached run recovery, not needed initially |

---

## Code Quality

**Production quality.** Extremely well-documented (20+ docs files). Layered security model (Mode × Tier × Capability). Exhaustive tool classification. Pure-JS permission gate (zero browser deps, testable under Node.js). Detached run model survives panel close. Weaknesses: `agent.js` is 20,018 lines (monolithic), no build step (plain ES modules), duplication between Chrome/Firefox builds.

---

## Extraction Priority

1. **ASK_ONLY_TOOLS list + getToolsForMode()** — extract directly for our tier system
2. **Permission gate (Capability enum + tool mapping)** — extract pattern, map to our tiers
3. **System prompts (ASK + ACT)** — extract and adapt for our guardrails
4. **Accessibility tree builder** — grab as-is, portable
5. **UNTRUSTED_CONTENT_TOOLS** — grab as-is, security-critical
6. **Content script interaction handlers** — extract patterns, gate through tiers
