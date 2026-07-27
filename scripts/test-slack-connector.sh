#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────────────────────
# test-slack-connector.sh
# Manual testing script for the Gemork Slack Connector.
# Shows how to configure credentials and test with curl.
# ──────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Gemork — Slack Connector Manual Test${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo

# ─── Step 1: Check credentials ───────────────────────────────

echo -e "${YELLOW}Step 1: Checking credentials...${NC}"
echo

if [ -z "${GEMORK_SLACK_TOKEN:-}" ]; then
  echo -e "${RED}  GEMORK_SLACK_TOKEN is NOT set.${NC}"
  echo
  echo "  To configure, you need a Slack Bot Token (xoxb-...)."
  echo "  See instructions below."
  echo
  echo "  Option A — export in your shell:"
  echo "    export GEMORK_SLACK_TOKEN='xoxb-your-token-here'"
  echo
  echo "  Option B — create a .env file in project root:"
  echo "    echo 'GEMORK_SLACK_TOKEN=xoxb-your-token-here' > .env"
  echo
else
  echo -e "${GREEN}  GEMORK_SLACK_TOKEN is set: ${GEMORK_SLACK_TOKEN:0:12}...${NC}"
fi

echo
echo -e "${YELLOW}Required Slack Bot Token Permissions:${NC}"
echo "  The bot token needs these OAuth scopes:"
echo
echo "  Bot Token Scopes (under OAuth & Permissions):"
echo "    channels:history    — Read messages in public channels"
echo "    channels:read       — List public channels"
echo "    chat:write          — Post messages"
echo "    chat:write.customize — Edit/delete own messages"
echo "    groups:history      — Read messages in private channels"
echo "    groups:read         — List private channels"
echo "    search:read         — Search messages"
echo "    users:read          — Read user info (for auth.test)"
echo
echo "  To create a Slack app and get a bot token:"
echo "    1. Go to https://api.slack.com/apps"
echo "    2. Click 'Create New App' → 'From scratch'"
echo "    3. Enter app name and select workspace"
echo "    4. Go to 'OAuth & Permissions' → add the scopes above"
echo "    5. Click 'Install to Workspace' → 'Allow'"
echo "    6. Copy the 'Bot User OAuth Token' (starts with xoxb-)"
echo

# ─── Step 2: Curl tests ─────────────────────────────────────

if [ -z "${GEMORK_SLACK_TOKEN:-}" ]; then
  echo -e "${YELLOW}Step 2: Skipping curl tests (no token).${NC}"
  echo "  Set GEMORK_SLACK_TOKEN and re-run this script."
  echo
  exit 0
fi

echo -e "${YELLOW}Step 2: Testing with curl...${NC}"
echo

echo -e "${CYAN}── Test: auth.test ──${NC}"
echo "  Verifying the bot token works..."
AUTH_RESPONSE=$(curl -s -X POST "https://slack.com/api/auth.test" \
  -H "Authorization: Bearer ${GEMORK_SLACK_TOKEN}" \
  -H "Content-Type: application/json")

if echo "$AUTH_RESPONSE" | grep -q '"ok":true'; then
  TEAM=$(echo "$AUTH_RESPONSE" | grep -o '"team":"[^"]*"' | cut -d'"' -f4)
  USER=$(echo "$AUTH_RESPONSE" | grep -o '"user":"[^"]*"' | cut -d'"' -f4)
  echo -e "  ${GREEN}✓ auth.test passed${NC}"
  echo "    Team: $TEAM"
  echo "    Bot user: $USER"
else
  echo -e "  ${RED}✗ auth.test failed:${NC}"
  echo "    $AUTH_RESPONSE"
  echo
  exit 1
fi

echo
echo -e "${CYAN}── Test: conversations.list ──${NC}"
echo "  Listing channels the bot can access..."
CHANNELS_RESPONSE=$(curl -s -X POST "https://slack.com/api/conversations.list" \
  -H "Authorization: Bearer ${GEMORK_SLACK_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"types":"public_channel,private_channel","limit":5}')

if echo "$CHANNELS_RESPONSE" | grep -q '"ok":true'; then
  CHANNEL_COUNT=$(echo "$CHANNELS_RESPONSE" | grep -o '"id":"C' | wc -l)
  echo -e "  ${GREEN}✓ conversations.list passed${NC}"
  echo "    Found $CHANNEL_COUNT channel(s)"
else
  ERROR=$(echo "$CHANNELS_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
  echo -e "  ${RED}✗ conversations.list failed: $ERROR${NC}"
fi

echo
echo -e "${CYAN}── Test: chat.postMessage ──${NC}"
echo "  Posting a test message to the first available channel..."
FIRST_CHANNEL=$(echo "$CHANNELS_RESPONSE" | grep -o '"id":"C[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$FIRST_CHANNEL" ]; then
  MSG_RESPONSE=$(curl -s -X POST "https://slack.com/api/chat.postMessage" \
    -H "Authorization: Bearer ${GEMORK_SLACK_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"channel\":\"${FIRST_CHANNEL}\",\"text\":\"Gemork connector test — $(date +%s)\"}")

  if echo "$MSG_RESPONSE" | grep -q '"ok":true'; then
    MSG_TS=$(echo "$MSG_RESPONSE" | grep -o '"ts":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo -e "  ${GREEN}✓ chat.postMessage passed${NC}"
    echo "    Channel: $FIRST_CHANNEL"
    echo "    Message TS: $MSG_TS"

    echo
    echo -e "${CYAN}── Test: chat.delete ──${NC}"
    echo "  Cleaning up test message..."
    DEL_RESPONSE=$(curl -s -X POST "https://slack.com/api/chat.delete" \
      -H "Authorization: Bearer ${GEMORK_SLACK_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "{\"channel\":\"${FIRST_CHANNEL}\",\"ts\":\"${MSG_TS}\"}")

    if echo "$DEL_RESPONSE" | grep -q '"ok":true'; then
      echo -e "  ${GREEN}✓ chat.delete passed (cleanup successful)${NC}"
    else
      DEL_ERROR=$(echo "$DEL_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
      echo -e "  ${YELLOW}⚠ chat.delete failed: $DEL_ERROR (message may need manual cleanup)${NC}"
    fi
  else
    MSG_ERROR=$(echo "$MSG_RESPONSE" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
    echo -e "  ${RED}✗ chat.postMessage failed: $MSG_ERROR${NC}"
  fi
else
  echo -e "  ${YELLOW}⚠ No channels found — cannot test posting${NC}"
fi

echo
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Manual testing complete.${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo
echo "  To use the connector in Gemork, set these env vars:"
echo "    export GEMORK_SLACK_ENABLED=true"
echo "    export GEMORK_SLACK_TOKEN='xoxb-your-token'"
echo "    export GEMORK_SLACK_CHANNELS='C123,C456'  # optional"
echo
