# IRIS — Building Block Analysis

**Repo:** https://github.com/kataras/iris
**Purpose in Gemork:** Desktop ↔ cloud ↔ mobile relay reference — streaming agent state to remote clients
**Seeds:** Cloud Bridge relay pattern, session management

---

## License

**BSD 3-Clause** — Copyright Gerasimos (Makis) Maropoulos, 2016-2026

Fully compatible with post-hackathon commercial use. Permissive: commercial use, modification, distribution all allowed. Requirements: retain copyright notice, no endorsement using names. No copyleft/viral risk.

---

## Critical Finding

IRIS is NOT a standalone relay system. It is a full Go web framework. The relay functionality is built through its **WebSocket module** (backed by the `neffos` library) and **session management** system. We extract patterns, not the framework.

---

## What We're Reusing

### 1. Namespace/Event WebSocket Pattern (HIGH VALUE)
- **File:** `websocket/websocket.go` (226 lines), `websocket/aliases.go` (93 lines)
- **Pattern:** Connections subscribe to namespaces (e.g., "agent-status", "steering"), events fire within namespaces
- **Extract:** The namespace-event mapping pattern
- **Rewrite:** Our relay defines namespaces like `agent:{id}` for per-agent state streaming

### 2. Room-Based Targeted Broadcasting (HIGH VALUE)
- **File:** `_examples/websocket/online-visitors/main.go`
- **Pattern:** Each agent session = a room. Mobile clients join the room. State broadcasts go to the room.
- **Extract:** `Broadcast(nil, Message{Room: agentSessionID, Event: "state", Body: ...})`
- **Rewrite:** Our relay uses rooms for multi-client agent watching

### 3. Redis StackExchange for Cross-Server Relay (HIGH VALUE)
- **File:** `websocket/websocket.go:44-51` (referenced)
- **Pattern:** Redis pub/sub as message bus between server instances. State update on one server → Redis → all servers → all WebSocket clients.
- **Extract:** The StackExchange interface pattern
- **Rewrite:** Our Cloud Bridge uses Redis for mobile relay when behind load balancer

### 4. Session Management with Redis Backend (MEDIUM VALUE)
- **File:** `sessions/sessions.go` (292 lines), `sessions/sessiondb/redis/database.go` (317 lines)
- **Pattern:** Database interface with Redis implementation, UUID session IDs, TTL expiration, key-value storage
- **Extract:** The Database interface and Redis implementation pattern
- **Rewrite:** Track which mobile clients are watching which agent sessions

### 5. JWT WebSocket Authentication (MEDIUM VALUE)
- **File:** `_examples/websocket/basic/server.go`
- **Pattern:** JWT token as query parameter, validated on HTTP upgrade handshake before WebSocket connection
- **Extract:** The JWT-on-upgrade pattern
- **Rewrite:** Secure mobile-to-relay connections

### 6. Supervisor/Server Lifecycle (LOW VALUE)
- **File:** `core/host/supervisor.go` (532 lines)
- **Pattern:** `RegisterOnServe`, `RegisterOnShutdown`, graceful shutdown, `Wait` method
- **Extract:** The lifecycle management pattern
- **Rewrite:** Simplify for our relay server

### 7. Transcoder/Serializer (LOW VALUE)
- **File:** `sessions/transcoding.go` (122 lines)
- **Pattern:** `Transcoder` interface (Marshal/Unmarshal) with pluggable implementations
- **Extract:** The interface pattern
- **Use as-is** or simplify

---

## What We're Stripping

| Component | Reason |
|-----------|--------|
| HTTP router (`core/router/`) | We use Express, not Go |
| View/template engine (`view/`) | Not needed for relay |
| i18n, macros, hero DI | Framework features, not relay |
| Full middleware stack | Only need JWT |
| Full auth system | Only need JWT validation |
| Desktop app examples | Not relevant |
| MVC framework | Overkill |
| Configuration system | 40+ fields, too heavy |
| Apps (multi-app switching) | Not needed |
| Versioning, cache | Not needed |

---

## Code Quality

**8.5/10.** High quality Go code. Clean interface design (Database interface with pluggable backends). Concurrency-safe with proper mutex usage. Strong typing. Comprehensive session lifecycle. Clean separation in the websocket adapter (226 lines wrapping neffos). Weaknesses: verbose getter methods, inconsistent error handling, leaked internals in Session struct, no automatic WebSocket reconnection.

---

## Extraction Priority

1. **Namespace/Event pattern** — extract the concept, implement in TypeScript for our relay
2. **Room-based broadcasting** — extract pattern for multi-client agent watching
3. **Redis StackExchange pattern** — reference for our cloud relay's cross-instance communication
4. **JWT-on-upgrade auth** — extract pattern for secure mobile connections
5. **Session + Redis pattern** — extract for relay state persistence

---

## Post-Hackathon Note

For the hackathon, we can skip the full Redis StackExchange and use a simpler in-memory WebSocket relay. The room-based broadcasting and namespace patterns are the key takeaways. Redis integration is Phase 2+ when we need multi-server relay.
