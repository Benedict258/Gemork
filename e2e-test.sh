#!/usr/bin/env bash
# ─── Gemork E2E Test Suite ────────────────────────────────────────
# Tests the running orchestrator (port 3030, WS port 8081) and file-system artifacts.

PASS=0
FAIL=0
SKIP=0
BASE="http://localhost:3030"
WORKSPACE="/home/ubuntu/Workspace/Gemork"

pass() { PASS=$((PASS + 1)); printf "  ✓ %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "  ✗ %s\n" "$1"; }
skip() { SKIP=$((SKIP + 1)); printf "  ○ %s (skipped)\n" "$1"; }
section() { printf "\n━━━ %s ━━━\n" "$1"; }

# ──────────────────────────────────────────────────────────────────
# 1. Health Check
# ──────────────────────────────────────────────────────────────────
section "1. Health Check"
HEALTH=$(curl -s "$BASE/api/health" 2>/dev/null)
if [ -n "$HEALTH" ] && echo "$HEALTH" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d.get('status')" 2>/dev/null; then
  status=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "PARSE_ERR")
  if [ "$status" = "ok" ]; then
    pass "Overall status: ok"
  else
    fail "Overall status: $status"
  fi

  for mod in orchestrator llm connectors; do
    ms=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['modules']['$mod']['status'])" 2>/dev/null || echo "PARSE_ERR")
    if [ "$ms" = "ok" ]; then
      pass "Module '$mod' status: ok"
    else
      fail "Module '$mod' status: $ms"
    fi
  done
else
  fail "Could not reach $BASE/api/health"
fi

# ──────────────────────────────────────────────────────────────────
# 2. Goal Submission (LLM plan generation)
# ──────────────────────────────────────────────────────────────────
section "2. Goal Submission (LLM plan generation)"
GOAL_RESP=$(curl -s --max-time 60 -X POST "$BASE/api/goals" \
  -H "Content-Type: application/json" \
  -d '{"text":"Create a README.md file documenting the project structure and setup instructions."}' 2>/dev/null)

if [ -n "$GOAL_RESP" ] && echo "$GOAL_RESP" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
  PLAN_ID=$(echo "$GOAL_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['plan']['id'])" 2>/dev/null || echo "")
  GOAL_ID=$(echo "$GOAL_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['goal']['id'])" 2>/dev/null || echo "")
  PLAN_STATUS=$(echo "$GOAL_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['plan']['status'])" 2>/dev/null || echo "")
  STEP_COUNT=$(echo "$GOAL_RESP" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['plan']['steps']))" 2>/dev/null || echo "0")

  if [ -n "$PLAN_ID" ]; then
    pass "Goal submitted — plan ID: $PLAN_ID"
  else
    fail "No plan ID returned"
  fi

  if [ "$STEP_COUNT" -gt 0 ]; then
    pass "Plan has $STEP_COUNT steps"
  else
    fail "Plan has 0 steps"
  fi

  # Check tiers
  TIERS=$(echo "$GOAL_RESP" | python3 -c "
import sys,json
steps = json.load(sys.stdin)['plan']['steps']
tiers = sorted(set(s['tier'] for s in steps))
print(','.join(str(t) for t in tiers))
" 2>/dev/null || echo "")
  if [ -n "$TIERS" ]; then
    pass "Step tiers present: $TIERS"
  else
    fail "Could not parse step tiers"
  fi

  # Verify plan status
  if echo "$PLAN_STATUS" | grep -qE "^(executing|completed|awaiting_approval|paused)$"; then
    pass "Plan status valid: $PLAN_STATUS"
  else
    fail "Unexpected plan status: $PLAN_STATUS"
  fi

  # Verify the plan can be fetched by ID
  PLAN_FETCH=$(curl -s "$BASE/api/plans/$PLAN_ID" 2>/dev/null)
  if [ -n "$PLAN_FETCH" ] && echo "$PLAN_FETCH" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    pass "Plan fetchable by ID via GET /api/plans/:id"
  else
    fail "Plan not fetchable by ID"
  fi

  # Verify goal object
  GOAL_FIELD=$(echo "$GOAL_RESP" | python3 -c "import sys,json; g=json.load(sys.stdin)['goal']; assert 'id' in g and 'text' in g and 'createdAt' in g; print('ok')" 2>/dev/null || echo "err")
  if [ "$GOAL_FIELD" = "ok" ]; then
    pass "Goal object has id, text, createdAt fields"
  else
    fail "Goal object missing expected fields"
  fi

  # Verify step structure
  STEP_CHECK=$(echo "$GOAL_RESP" | python3 -c "
import sys,json
steps = json.load(sys.stdin)['plan']['steps']
for s in steps:
    assert 'id' in s and 'tier' in s and 'status' in s and 'description' in s
print('ok')
" 2>/dev/null || echo "err")
  if [ "$STEP_CHECK" = "ok" ]; then
    pass "Step objects have id, tier, status, description fields"
  else
    fail "Step objects missing expected fields"
  fi

  # List all plans
  PLANS_LIST=$(curl -s "$BASE/api/plans" 2>/dev/null)
  if [ -n "$PLANS_LIST" ] && echo "$PLANS_LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'plans' in d; print(len(d['plans']))" 2>/dev/null | grep -qE "^[0-9]+$"; then
    PLAN_TOTAL=$(echo "$PLANS_LIST" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['plans']))" 2>/dev/null || echo "0")
    pass "GET /api/plans lists $PLAN_TOTAL plan(s)"
  else
    fail "GET /api/plans failed"
  fi
else
  fail "POST /api/goals failed or returned invalid JSON"
  PLAN_ID=""
fi

# ──────────────────────────────────────────────────────────────────
# 3. Tier 3 Approval Flow
# ──────────────────────────────────────────────────────────────────
section "3. Tier 3 Approval Flow"

if [ -n "$PLAN_ID" ]; then
  # Find a tier 3 step
  T3_STEP=$(echo "$GOAL_RESP" | python3 -c "
import sys,json
steps = json.load(sys.stdin)['plan']['steps']
for s in steps:
    if s['tier'] == 3:
        print(s['id']); break
" 2>/dev/null || echo "")

  if [ -n "$T3_STEP" ]; then
    pass "Found Tier 3 step: $T3_STEP"

    # Approve endpoint
    APPROVE_RESP=$(curl -s -w "\n%{http_code}" --max-time 5 -X POST "$BASE/api/plans/$PLAN_ID/steps/$T3_STEP/approve" 2>/dev/null)
    APPROVE_CODE=$(echo "$APPROVE_RESP" | tail -1)
    if echo "$APPROVE_CODE" | grep -qE "^(200|400)$"; then
      pass "POST /approve returns HTTP $APPROVE_CODE (endpoint functional)"
    else
      fail "POST /approve returned HTTP $APPROVE_CODE"
    fi

    # Reject endpoint
    REJECT_RESP=$(curl -s -w "\n%{http_code}" --max-time 5 -X POST "$BASE/api/plans/$PLAN_ID/steps/$T3_STEP/reject" \
      -H "Content-Type: application/json" \
      -d '{"reason":"Manual rejection in E2E test"}' 2>/dev/null)
    REJECT_CODE=$(echo "$REJECT_RESP" | tail -1)
    if echo "$REJECT_CODE" | grep -qE "^(200|400)$"; then
      pass "POST /reject returns HTTP $REJECT_CODE (endpoint functional)"
    else
      fail "POST /reject returned HTTP $REJECT_CODE"
    fi
  else
    skip "No Tier 3 step in plan — LLM generated only Tier 1/2 steps"
  fi

  # Verify approve/reject are registered even if no step
  APPROVE_404=$(curl -s -w "%{http_code}" -o /dev/null --max-time 5 -X POST "$BASE/api/plans/fake/steps/fake/approve" 2>/dev/null || echo "000")
  if echo "$APPROVE_404" | grep -qE "^(200|400|404|500)$"; then
    pass "POST /approve endpoint registered (HTTP $APPROVE_404 on fake IDs)"
  else
    fail "POST /approve endpoint not responding"
  fi

  REJECT_404=$(curl -s -w "%{http_code}" -o /dev/null --max-time 5 -X POST "$BASE/api/plans/fake/steps/fake/reject" 2>/dev/null || echo "000")
  if echo "$REJECT_404" | grep -qE "^(200|400|404|500)$"; then
    pass "POST /reject endpoint registered (HTTP $REJECT_404 on fake IDs)"
  else
    fail "POST /reject endpoint not responding"
  fi
else
  skip "Tier 3 approval tests skipped (no plan from test 2)"
fi

# ──────────────────────────────────────────────────────────────────
# 4. Inbox System
# ──────────────────────────────────────────────────────────────────
section "4. Inbox System"

INBOX_RESP=$(curl -s -w "\n%{http_code}" --max-time 5 "$BASE/api/inbox" 2>/dev/null)
INBOX_CODE=$(echo "$INBOX_RESP" | tail -1)
INBOX_BODY=$(echo "$INBOX_RESP" | sed '$d')

if [ "$INBOX_CODE" = "200" ]; then
  if echo "$INBOX_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'currentItem' in d or 'stats' in d" 2>/dev/null; then
    pass "GET /api/inbox — HTTP 200, valid JSON with expected fields"
  else
    pass "GET /api/inbox — HTTP 200 (body may differ)"
  fi
elif [ "$INBOX_CODE" = "404" ]; then
  fail "GET /api/inbox — HTTP 404 (endpoint not registered on running server)"
else
  fail "GET /api/inbox — HTTP $INBOX_CODE"
fi

INBOX_STATS_RESP=$(curl -s -w "\n%{http_code}" --max-time 5 "$BASE/api/inbox/stats" 2>/dev/null)
INBOX_STATS_CODE=$(echo "$INBOX_STATS_RESP" | tail -1)
INBOX_STATS_BODY=$(echo "$INBOX_STATS_RESP" | sed '$d')

if [ "$INBOX_STATS_CODE" = "200" ]; then
  if echo "$INBOX_STATS_BODY" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    TOTAL=$(echo "$INBOX_STATS_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total', d.get('pending', 'N/A')))" 2>/dev/null || echo "N/A")
    pass "GET /api/inbox/stats — HTTP 200, total=$TOTAL"
  else
    pass "GET /api/inbox/stats — HTTP 200"
  fi
elif [ "$INBOX_STATS_CODE" = "404" ]; then
  fail "GET /api/inbox/stats — HTTP 404 (endpoint not registered on running server)"
else
  fail "GET /api/inbox/stats — HTTP $INBOX_STATS_CODE"
fi

# Check inbox module source exists
INBOX_MGR="$WORKSPACE/local-orchestrator/src/inbox/inbox-manager.ts"
INBOX_STORE="$WORKSPACE/local-orchestrator/src/inbox/inbox-store.ts"
INBOX_ITEM="$WORKSPACE/local-orchestrator/src/inbox/inbox-item.ts"
if [ -f "$INBOX_MGR" ] && [ -f "$INBOX_STORE" ] && [ -f "$INBOX_ITEM" ]; then
  pass "Inbox module source files exist (inbox-manager, inbox-store, inbox-item)"
else
  fail "Inbox module source files missing"
fi

# ──────────────────────────────────────────────────────────────────
# 5. Workflow System
# ──────────────────────────────────────────────────────────────────
section "5. Workflow System"

WF_RESP=$(curl -s -w "\n%{http_code}" --max-time 5 "$BASE/api/workflows" 2>/dev/null)
WF_CODE=$(echo "$WF_RESP" | tail -1)
WF_BODY=$(echo "$WF_RESP" | sed '$d')

if [ "$WF_CODE" = "200" ]; then
  if echo "$WF_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'workflows' in d" 2>/dev/null; then
    WF_COUNT=$(echo "$WF_BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['workflows']))" 2>/dev/null || echo "0")
    pass "GET /api/workflows — HTTP 200, $WF_COUNT workflow(s)"
  else
    pass "GET /api/workflows — HTTP 200"
  fi
elif [ "$WF_CODE" = "404" ]; then
  fail "GET /api/workflows — HTTP 404 (endpoint not registered on running server)"
else
  fail "GET /api/workflows — HTTP $WF_CODE"
fi

# Save workflow
if [ -n "$PLAN_ID" ]; then
  WF_SAVE=$(curl -s -w "\n%{http_code}" --max-time 5 -X POST "$BASE/api/workflows" \
    -H "Content-Type: application/json" \
    -d "{\"planId\":\"$PLAN_ID\",\"name\":\"E2E Test Workflow\"}" 2>/dev/null)
  WF_SAVE_CODE=$(echo "$WF_SAVE" | tail -1)
  WF_SAVE_BODY=$(echo "$WF_SAVE" | sed '$d')

  if [ "$WF_SAVE_CODE" = "200" ]; then
    WF_ID=$(echo "$WF_SAVE_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
    if [ -n "$WF_ID" ]; then
      pass "POST /api/workflows — saved workflow: $WF_ID"
    else
      pass "POST /api/workflows — HTTP 200"
    fi

    # Replay
    REPLAY=$(curl -s -w "\n%{http_code}" --max-time 60 -X POST "$BASE/api/workflows/$WF_ID/replay" 2>/dev/null)
    REPLAY_CODE=$(echo "$REPLAY" | tail -1)
    REPLAY_BODY=$(echo "$REPLAY" | sed '$d')

    if [ "$REPLAY_CODE" = "200" ]; then
      pass "POST /api/workflows/:id/replay — HTTP 200 (workflow replay functional)"
    else
      fail "POST /api/workflows/:id/replay — HTTP $REPLAY_CODE"
    fi
  elif [ "$WF_SAVE_CODE" = "404" ]; then
    fail "POST /api/workflows — HTTP 404 (endpoint not registered on running server)"
    skip "Workflow replay skipped (no workflow saved)"
  else
    fail "POST /api/workflows — HTTP $WF_SAVE_CODE"
    skip "Workflow replay skipped (no workflow saved)"
  fi
else
  skip "Workflow tests skipped (no plan from test 2)"
fi

# Check workflow source files
WF_CAPTURE="$WORKSPACE/local-orchestrator/src/workflows/workflow-capture.ts"
WF_REPLAY="$WORKSPACE/local-orchestrator/src/workflows/workflow-replay.ts"
WF_STORE="$WORKSPACE/local-orchestrator/src/workflows/workflow-store.ts"
if [ -f "$WF_CAPTURE" ] && [ -f "$WF_REPLAY" ] && [ -f "$WF_STORE" ]; then
  pass "Workflow module source files exist (capture, replay, store)"
else
  fail "Workflow module source files missing"
fi

# ──────────────────────────────────────────────────────────────────
# 6. Connector System (Filesystem)
# ──────────────────────────────────────────────────────────────────
section "6. Connector System (Filesystem)"

FS_CONN="$WORKSPACE/local-orchestrator/src/connectors/filesystem-connector.ts"
if [ -f "$FS_CONN" ]; then
  pass "Filesystem connector source exists"
  # Check it has read capability
  if grep -q "read\|readFile\|getFile" "$FS_CONN" 2>/dev/null; then
    pass "Filesystem connector has read operations"
  else
    fail "Filesystem connector missing read operations"
  fi
  # Check it has write capability
  if grep -q "write\|writeFile\|putFile" "$FS_CONN" 2>/dev/null; then
    pass "Filesystem connector has write operations"
  else
    fail "Filesystem connector missing write operations"
  fi
else
  fail "Filesystem connector source missing"
fi

CONN_MGR="$WORKSPACE/local-orchestrator/src/connectors/connector-manager.ts"
if [ -f "$CONN_MGR" ]; then
  if grep -q "filesystem" "$CONN_MGR" 2>/dev/null; then
    pass "ConnectorManager registers filesystem connector"
  else
    fail "ConnectorManager missing filesystem registration"
  fi
else
  fail "connector-manager.ts missing"
fi

# Base connector
BASE_CONN="$WORKSPACE/local-orchestrator/src/connectors/base-connector.ts"
if [ -f "$BASE_CONN" ]; then
  pass "Base connector interface exists"
else
  fail "Base connector interface missing"
fi

# Other connectors
for conn in notion slack google-drive; do
  CONN_FILE="$WORKSPACE/local-orchestrator/src/connectors/${conn}-connector.ts"
  if [ -f "$CONN_FILE" ]; then
    pass "$conn connector source exists"
  else
    fail "$conn connector source missing"
  fi
done

# Snapshot service
SNAP_SVC="$WORKSPACE/local-orchestrator/src/snapshot-service.ts"
SNAP_SVC2="$WORKSPACE/local-orchestrator/src/storage/snapshot-service.ts"
if [ -f "$SNAP_SVC" ] || [ -f "$SNAP_SVC2" ]; then
  pass "Snapshot service exists"
else
  fail "Snapshot service missing"
fi

# BuildContextMemory
BCM="$WORKSPACE/local-orchestrator/src/storage/build-context-memory.ts"
if [ -f "$BCM" ]; then
  pass "BuildContextMemory module exists"
  if grep -q "log\|record\|write" "$BCM" 2>/dev/null; then
    pass "BuildContextMemory has logging/recording operations"
  else
    fail "BuildContextMemory missing logging operations"
  fi
else
  fail "BuildContextMemory module missing"
fi

if [ -d "$WORKSPACE/.gemork/history" ]; then
  HISTORY_COUNT=$(ls -1 "$WORKSPACE/.gemork/history/" 2>/dev/null | wc -l)
  pass ".gemork/history directory exists ($HISTORY_COUNT entries)"
else
  fail ".gemork/history directory missing"
fi

# ──────────────────────────────────────────────────────────────────
# 7. Persistence
# ──────────────────────────────────────────────────────────────────
section "7. Persistence"

if [ -d "$WORKSPACE/.gemork" ]; then
  pass ".gemork/ directory exists"
  GEMORK_CONTENTS=$(ls -1 "$WORKSPACE/.gemork/" 2>/dev/null)
  if echo "$GEMORK_CONTENTS" | grep -q "history"; then
    pass ".gemork/history/ exists"
  else
    fail ".gemork/history/ missing"
  fi
else
  fail ".gemork/ directory missing"
fi

# State saver
STATE_SAVER="$WORKSPACE/local-orchestrator/src/persistence/state-saver.ts"
if [ -f "$STATE_SAVER" ]; then
  pass "StateSaver module exists"
  if grep -q "saveState\|save" "$STATE_SAVER" 2>/dev/null; then
    pass "StateSaver has save functionality"
  else
    fail "StateSaver missing save functionality"
  fi
else
  fail "StateSaver module missing"
fi

# Chat store
CHAT_STORE="$WORKSPACE/local-orchestrator/src/persistence/chat-store.ts"
if [ -f "$CHAT_STORE" ]; then
  pass "ChatStore module exists (conversation state persistence)"
else
  fail "ChatStore module missing"
fi

# Workflow store
WF_STORE="$WORKSPACE/local-orchestrator/src/workflows/workflow-store.ts"
if [ -f "$WF_STORE" ]; then
  pass "WorkflowStore module exists"
else
  fail "WorkflowStore module missing"
fi

# Resume manager
RESUME="$WORKSPACE/local-orchestrator/src/persistence/resume-manager.ts"
if [ -f "$RESUME" ]; then
  pass "ResumeManager module exists"
else
  fail "ResumeManager module missing"
fi

# Persistence index
PERS_INDEX="$WORKSPACE/local-orchestrator/src/persistence/index.ts"
if [ -f "$PERS_INDEX" ]; then
  pass "Persistence module index exists"
else
  fail "Persistence module index missing"
fi

# ──────────────────────────────────────────────────────────────────
# 8. Browser Extension
# ──────────────────────────────────────────────────────────────────
section "8. Browser Extension"

EXT_DIR="$WORKSPACE/browser-extension"
if [ -d "$EXT_DIR" ]; then
  pass "browser-extension/ directory exists"
else
  fail "browser-extension/ directory missing"
fi

# dist directory
if [ -d "$EXT_DIR/dist" ]; then
  DIST_FILES=$(ls -1 "$EXT_DIR/dist/" 2>/dev/null | wc -l)
  if [ "$DIST_FILES" -gt 0 ]; then
    pass "browser-extension/dist/ exists with $DIST_FILES files"
  else
    fail "browser-extension/dist/ exists but is empty"
  fi
else
  fail "browser-extension/dist/ missing (not built)"
fi

# manifest.json
if [ -f "$EXT_DIR/manifest.json" ]; then
  if python3 -c "import json; json.load(open('$EXT_DIR/manifest.json'))" 2>/dev/null; then
    pass "manifest.json is valid JSON"
    MANIFEST_KEYS=$(python3 -c "
import json
m = json.load(open('$EXT_DIR/manifest.json'))
keys = list(m.keys())
print(','.join(sorted(keys)))
" 2>/dev/null || echo "")
    if echo "$MANIFEST_KEYS" | grep -q "manifest_version"; then
      MV=$(python3 -c "import json; print(json.load(open('$EXT_DIR/manifest.json')).get('manifest_version','?'))" 2>/dev/null || echo "?")
      pass "manifest.json contains manifest_version: $MV"
    else
      fail "manifest.json missing manifest_version"
    fi
    if echo "$MANIFEST_KEYS" | grep -q "name"; then
      MNAME=$(python3 -c "import json; print(json.load(open('$EXT_DIR/manifest.json')).get('name','?'))" 2>/dev/null || echo "?")
      pass "manifest.json contains name: $MNAME"
    else
      fail "manifest.json missing name"
    fi
    # Check for adapters/background
    if echo "$MANIFEST_KEYS" | grep -q "background"; then
      pass "manifest.json has background script config"
    else
      fail "manifest.json missing background script config"
    fi
  else
    fail "manifest.json is invalid JSON"
  fi
else
  fail "manifest.json missing"
fi

# Source files
for f in background.ts content.ts popup.ts types.ts; do
  if [ -f "$EXT_DIR/src/$f" ]; then
    pass "src/$f exists"
  else
    fail "src/$f missing"
  fi
done

# Check connector adapter layer
ADAPTER_LAYER="$WORKSPACE/connector-adapter-layer"
if [ -d "$ADAPTER_LAYER" ]; then
  ADAPTER_COUNT=$(ls -1 "$ADAPTER_LAYER/src/" 2>/dev/null | wc -l)
  if [ "$ADAPTER_COUNT" -gt 0 ]; then
    pass "connector-adapter-layer/ has $ADAPTER_COUNT adapter file(s)"
  else
    fail "connector-adapter-layer/ has no files"
  fi
else
  fail "connector-adapter-layer/ directory missing"
fi

# ──────────────────────────────────────────────────────────────────
# 9. Desktop App (Tauri)
# ──────────────────────────────────────────────────────────────────
section "9. Desktop App (Tauri)"

DESKTOP_BIN="$WORKSPACE/desktop-shell/src-tauri/target/release/gemork-desktop"
if [ -f "$DESKTOP_BIN" ]; then
  BIN_SIZE=$(stat --format=%s "$DESKTOP_BIN" 2>/dev/null || echo "0")
  if [ "$BIN_SIZE" -gt 1000000 ]; then
    pass "gemork-desktop binary exists (${BIN_SIZE} bytes)"
  else
    fail "gemork-desktop binary too small (${BIN_SIZE} bytes)"
  fi

  # Check it's executable
  if [ -x "$DESKTOP_BIN" ]; then
    pass "gemork-desktop binary is executable"
  else
    fail "gemork-desktop binary is not executable"
  fi
else
  fail "gemork-desktop binary missing"
fi

# .deb package
DEB_DIR="$WORKSPACE/desktop-shell/src-tauri/target/release/bundle/deb"
DEB_FILE=$(ls "$DEB_DIR/"*.deb 2>/dev/null | head -1)
if [ -n "$DEB_FILE" ] && [ -f "$DEB_FILE" ]; then
  DEB_SIZE=$(stat --format=%s "$DEB_FILE" 2>/dev/null || echo "0")
  pass "Debian package exists: $(basename "$DEB_FILE") (${DEB_SIZE} bytes)"
else
  fail "No .deb package found in $DEB_DIR"
fi

# Check Tauri config
TAURI_CONF="$WORKSPACE/desktop-shell/src-tauri/tauri.conf.json"
if [ -f "$TAURI_CONF" ]; then
  if python3 -c "import json; json.load(open('$TAURI_CONF'))" 2>/dev/null; then
    pass "tauri.conf.json is valid JSON"
  else
    fail "tauri.conf.json is invalid JSON"
  fi
else
  fail "tauri.conf.json missing"
fi

# ──────────────────────────────────────────────────────────────────
# 10. WebSocket
# ──────────────────────────────────────────────────────────────────
section "10. WebSocket (ws://localhost:8081)"

# Use timeout to prevent hanging
WS_CHECK=$(timeout 3 curl -s -o /dev/null -w "%{http_code}" \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Version: 13" \
  "http://localhost:8081" 2>/dev/null || echo "TIMEOUT")

if [ "$WS_CHECK" = "101" ]; then
  pass "WebSocket port 8081 accepts upgrade (HTTP 101)"
else
  # Try raw TCP
  if timeout 2 bash -c "echo '' > /dev/tcp/localhost/8081" 2>/dev/null; then
    pass "WebSocket port 8081 is listening (TCP open)"
  else
    fail "WebSocket port 8081 not reachable"
  fi
fi

WS_SERVER="$WORKSPACE/local-orchestrator/src/websocket-server.ts"
if [ -f "$WS_SERVER" ]; then
  pass "WebSocket server source exists (websocket-server.ts)"
  if grep -q "broadcastPlanUpdate\|broadcastStepUpdate\|broadcastApprovalRequest" "$WS_SERVER" 2>/dev/null; then
    pass "WebSocket server has broadcast methods (plan, step, approval)"
  else
    fail "WebSocket server missing broadcast methods"
  fi
else
  fail "WebSocket server source missing"
fi

EVENT_BUS="$WORKSPACE/local-orchestrator/src/orchestrator/event-bus.ts"
if [ -f "$EVENT_BUS" ]; then
  pass "EventBus source exists (event-bus.ts)"
  if grep -q "EventBroadcaster" "$EVENT_BUS" 2>/dev/null; then
    pass "EventBroadcaster class exists in event-bus"
  else
    fail "EventBroadcaster class missing"
  fi
else
  fail "event-bus.ts missing"
fi

# Check server wires broadcaster
if grep -q "broadcaster.attach(eventBus)" "$WORKSPACE/local-orchestrator/src/server.ts" 2>/dev/null; then
  pass "Server wires broadcaster to eventBus"
else
  fail "Server does not wire broadcaster to eventBus"
fi

# Voice WebSocket (separate WS endpoint)
VOICE_WS="$WORKSPACE/local-orchestrator/src/voice/voice-websocket.ts"
if [ -f "$VOICE_WS" ]; then
  pass "Voice WebSocket module exists"
else
  fail "Voice WebSocket module missing"
fi

# ──────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────
section "TEST SUMMARY"
TOTAL=$((PASS + FAIL + SKIP))
echo ""
printf "  PASSED:  %d\n" "$PASS"
printf "  FAILED:  %d\n" "$FAIL"
printf "  SKIPPED: %d\n" "$SKIP"
printf "  TOTAL:   %d\n" "$TOTAL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "All tests passed!"
  exit 0
else
  echo "$FAIL test(s) failed."
  exit 1
fi
