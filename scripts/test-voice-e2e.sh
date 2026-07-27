#!/usr/bin/env bash
# ─── Voice Pipeline E2E Test Script ──────────────────────────
# Tests the full voice input flow:
#   Press-to-talk → Audio capture → Transcription → Goal submission → Plan generation
#
# Prerequisites:
#   1. Ollama running on localhost:11434
#   2. Whisper model pulled: ollama pull whisper
#   3. Orchestrator running on port 3001 (HTTP) and 8081 (WebSocket)
#   4. Desktop shell running on port 5173 (or built Tauri app)
#
# What success looks like:
#   - User holds mic button → audio captured
#   - On release → audio sent to Ollama whisper → text returned
#   - Text appears in the goal input field
#   - User clicks submit (or auto-submit) → goal sent to orchestrator
#   - Plan generated and displayed in the UI

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
info() { echo -e "  $1"; }

echo "═══════════════════════════════════════════════════════"
echo "  Gemork Voice Pipeline E2E Test"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── 1. Check Ollama ────────────────────────────────────────
echo "1. Ollama Infrastructure"
echo "─────────────────────────"

if curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; then
  pass "Ollama is running"
else
  fail "Ollama is not running on localhost:11434"
  info "Start with: ollama serve"
fi

WHISPER_AVAILABLE=false
if TAGS=$(curl -sf http://localhost:11434/api/tags 2>/dev/null); then
  if echo "$TAGS" | grep -q '"whisper"'; then
    pass "Whisper model is available"
    WHISPER_AVAILABLE=true
  else
    fail "Whisper model is NOT installed"
    info "Install with: ollama pull whisper"
    info "Models found:"
    echo "$TAGS" | grep -o '"name":"[^"]*"' | sed 's/"name":"/  - /' || true
  fi
else
  fail "Could not query Ollama tags"
fi

echo ""

# ─── 2. Check Orchestrator ──────────────────────────────────
echo "2. Orchestrator"
echo "────────────────"

if curl -sf http://localhost:3001/api/health >/dev/null 2>&1; then
  pass "HTTP API on port 3001"
else
  warn "HTTP API not responding on port 3001"
  info "Start with: cd local-orchestrator && npm start"
fi

# Test WebSocket port
if timeout 2 bash -c "echo '' > /dev/tcp/localhost/8081" 2>/dev/null; then
  pass "WebSocket on port 8081"
else
  warn "WebSocket not responding on port 8081"
fi

echo ""

# ─── 3. Test Voice API Endpoint ─────────────────────────────
echo "3. Voice Transcription Endpoint"
echo "─────────────────────────────────"

if [ "$WHISPER_AVAILABLE" = true ]; then
  # Create a tiny WAV file for testing (1 second of silence at 16kHz)
  TMPWAV=$(mktemp /tmp/test-voice-XXXXXX.wav)
  python3 -c "
import struct, wave
with wave.open('$TMPWAV', 'w') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes(struct.pack('<' + 'h' * 16000, *([0] * 16000)))
" 2>/dev/null

  if [ -f "$TMPWAV" ]; then
    AUDIO_B64=$(base64 -w0 "$TMPWAV" 2>/dev/null || base64 "$TMPWAV" 2>/dev/null)

    RESPONSE=$(curl -sf -X POST http://localhost:11434/api/transcribe \
      -H "Content-Type: application/json" \
      -d "{\"audio\": \"$AUDIO_B64\", \"model\": \"whisper\", \"language\": \"en\"}" \
      --max-time 30 2>/dev/null || echo '{"error": "request failed"}')

    if echo "$RESPONSE" | grep -q '"text"'; then
      pass "Whisper transcription endpoint works"
      info "Response: $RESPONSE"
    else
      fail "Whisper transcription failed"
      info "Response: $RESPONSE"
    fi

    rm -f "$TMPWAV"
  else
    fail "Could not create test WAV file"
  fi
else
  warn "Skipping — whisper model not available"
fi

echo ""

# ─── 4. Test Goal Submission via API ────────────────────────
echo "4. Goal Submission (simulating voice → goal)"
echo "──────────────────────────────────────────────"

GOAL_RESPONSE=$(curl -sf -X POST http://localhost:3001/api/goals \
  -H "Content-Type: application/json" \
  -d '{"text": "test: voice pipeline verification"}' \
  --max-time 10 2>/dev/null || echo '{"error": "request failed"}')

if echo "$GOAL_RESPONSE" | grep -q '"plan"'; then
  pass "Goal submission creates a plan"
  PLAN_ID=$(echo "$GOAL_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
  info "Plan ID: $PLAN_ID"
else
  fail "Goal submission did not return a plan"
  info "Response: $GOAL_RESPONSE"
fi

echo ""

# ─── 5. Manual Browser Testing Instructions ─────────────────
echo "5. Manual Browser Testing"
echo "──────────────────────────"
echo ""
info "To test voice input in a real browser:"
info ""
info "  1. Start the desktop shell:"
info "     cd desktop-shell && npm run dev"
info ""
info "  2. Open http://localhost:5173 in Chrome/Edge"
info ""
info "  3. Grant microphone permission when prompted"
info ""
info "  4. Press and hold the microphone button"
info ""
info "  5. Speak a clear goal (e.g., 'Create a REST API for todos')"
info ""
info "  6. Release the button"
info ""
info "  7. Check browser console (F12) for:"
info "     - 'Voice transcription received' in orchestrator logs"
info "     - Text appearing in the goal input field"
info "     - Plan appearing in the UI after submit"
info ""

# ─── 6. Summary ─────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"
echo "  Summary"
echo "═══════════════════════════════════════════════════════"

if [ "$WHISPER_AVAILABLE" = true ]; then
  info "Whisper: AVAILABLE — full pipeline can work"
else
  info "Whisper: NOT AVAILABLE — voice transcription will fail"
  info "The pipeline will work structurally but produce no text"
fi

echo ""
info "Voice pipeline components:"
info "  1. Audio capture (MediaRecorder + getUserMedia) — browser only"
info "  2. WAV encoding (audioBufferToWav) — verified in unit tests"
info "  3. Transcription (Ollama whisper) — requires whisper model"
info "  4. Goal submission (WebSocket voice:transcription) — requires server"
info "  5. Plan generation (taskEngine.run) — verified independently"
echo ""
