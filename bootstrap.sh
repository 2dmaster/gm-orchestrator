#!/usr/bin/env bash
# bootstrap.sh — one-click setup: deps → stack → seed plan task → sprint
#
# Usage:
#   ./bootstrap.sh                          — asks for goal interactively
#   ./bootstrap.sh "goal"                   — non-interactive
#   ./bootstrap.sh "goal" --skip-plan       — skip seeding, run sprint on existing tasks
#   ./bootstrap.sh "goal" --dry-run         — seed plan task but don't run sprint

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="$(basename "$PROJECT_DIR")"
CONFIG_FILE="${PROJECT_DIR}/.gm-orchestrator.json"
GM_YAML="${PROJECT_DIR}/graph-memory.yaml"

# ── Parse args ────────────────────────────────────────────────────────────

GOAL=""
SKIP_PLAN=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --skip-plan) SKIP_PLAN=true ;;
    --dry-run)   DRY_RUN=true ;;
    --help|-h)
      echo "Usage: ./bootstrap.sh [goal] [--skip-plan] [--dry-run]"
      echo ""
      echo "  goal          High-level goal — first Claude session decomposes it"
      echo "  --skip-plan   Skip seeding, run sprint on existing tasks"
      echo "  --dry-run     Seed plan task but don't run sprint"
      exit 0
      ;;
    -*) echo "Unknown flag: $arg. Use --help for usage."; exit 1 ;;
    *)  [ -z "$GOAL" ] && GOAL="$arg" ;;
  esac
done

# ── Helpers ───────────────────────────────────────────────────────────────

red()    { echo -e "\033[31m$*\033[0m"; }
green()  { echo -e "\033[32m$*\033[0m"; }
yellow() { echo -e "\033[33m$*\033[0m"; }
bold()   { echo -e "\033[1m$*\033[0m"; }
dim()    { echo -e "\033[2m$*\033[0m"; }
step()   { echo ""; echo "▶ $*"; echo ""; }
die()    { red "  ✗ $*"; exit 1; }

port_free() {
  ! ss -tlnp 2>/dev/null | grep -q ":${1} " && \
  ! lsof -i ":${1}" > /dev/null 2>&1
}

find_free_port() {
  local port="${1:-3000}"
  while ! port_free "$port"; do port=$((port + 1)); done
  echo "$port"
}

ask() {
  local prompt="$1" default="$2"
  if [ -n "$default" ]; then
    printf "  %s [%s]: " "$prompt" "$default"
  else
    printf "  %s: " "$prompt"
  fi
  read -r ASK_RESULT
  [ -z "$ASK_RESULT" ] && ASK_RESULT="$default"
}

require_cmd() {
  if ! command -v "$1" > /dev/null 2>&1; then
    red "  ✗ '$1' not found in PATH"
    [ -n "$2" ] && dim "  Install: $2"
    exit 1
  fi
  green "  ✓ $1 $($1 --version 2>/dev/null | head -1 || true)"
}

# ── Header ────────────────────────────────────────────────────────────────

echo ""
bold "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bold "  gm-orchestrator — one-click setup"
dim  "  project: ${PROJECT_ID}"
bold "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: Requirements ──────────────────────────────────────────────────

step "Checking requirements"

require_cmd "node"        "https://nodejs.org"
require_cmd "npm"         "https://nodejs.org"
require_cmd "graphmemory" "npm install -g @graphmemory/server"
require_cmd "claude"      "npm install -g @anthropic-ai/claude-code"

NODE_MAJOR=$(node -e "console.log(parseInt(process.versions.node))")
[ "$NODE_MAJOR" -lt 18 ] && die "Node.js 18+ required. Current: $(node --version)"

# ── Step 2: Dependencies ──────────────────────────────────────────────────

step "Installing dependencies"

cd "${PROJECT_DIR}"

if [ -d "node_modules" ] && [ -f "package-lock.json" ]; then
  npm ci --silent && green "  ✓ Dependencies up to date (npm ci)"
else
  npm install --silent && green "  ✓ Dependencies installed"
fi

# ── Step 3: Port ──────────────────────────────────────────────────────────

step "GraphMemory port"

CHOSEN_PORT=""

if [ -f "$GM_YAML" ]; then
  yaml_port=$(grep '^\s*port:' "$GM_YAML" | sed 's/[^0-9]//g' | tr -d '[:space:]')
  if [[ "$yaml_port" =~ ^[0-9]+$ ]]; then
    CHOSEN_PORT="$yaml_port"
    echo "  Found existing config: port ${CHOSEN_PORT}"
  fi
fi

if [ -n "$CHOSEN_PORT" ]; then
  if curl -s "http://localhost:${CHOSEN_PORT}" > /dev/null 2>&1; then
    green "  ✓ GraphMemory already running on :${CHOSEN_PORT}"
  elif port_free "$CHOSEN_PORT"; then
    green "  ✓ Port ${CHOSEN_PORT} is free"
  else
    yellow "  ⚠ Port ${CHOSEN_PORT} is taken by another process"
    suggested=$(find_free_port "$((CHOSEN_PORT + 1))")
    ask "Enter a free port (suggested)" "$suggested"
    CHOSEN_PORT="$ASK_RESULT"
  fi
else
  suggested=$(find_free_port 3000)
  [ "$suggested" != "3000" ] && yellow "  ⚠ Port 3000 is taken, suggested: ${suggested}"
  ask "GraphMemory port" "$suggested"
  CHOSEN_PORT="$ASK_RESULT"
fi

[[ "$CHOSEN_PORT" =~ ^[0-9]+$ ]] || die "Invalid port: '${CHOSEN_PORT}'"

if ! port_free "$CHOSEN_PORT"; then
  curl -s "http://localhost:${CHOSEN_PORT}" > /dev/null 2>&1 \
    || die "Port ${CHOSEN_PORT} is taken. Choose another and restart."
fi

GM_BASE_URL="http://localhost:${CHOSEN_PORT}"
GM_MCP_URL="${GM_BASE_URL}/mcp/${PROJECT_ID}"
GM_API="${GM_BASE_URL}/api/projects/${PROJECT_ID}"

green "  ✓ Using port ${CHOSEN_PORT}"

# ── Step 4: graph-memory.yaml ─────────────────────────────────────────────

step "GraphMemory config"

NEED_GM_YAML=false
if [ ! -f "$GM_YAML" ]; then
  NEED_GM_YAML=true
  dim "  graph-memory.yaml not found — creating"
elif ! grep -q "port: ${CHOSEN_PORT}" "$GM_YAML" 2>/dev/null; then
  NEED_GM_YAML=true
  dim "  Port changed — updating graph-memory.yaml"
fi

if [ "$NEED_GM_YAML" = true ]; then
  cat > "$GM_YAML" << EOF
server:
  port: ${CHOSEN_PORT}
  host: 127.0.0.1

projects:
  ${PROJECT_ID}:
    projectDir: "${PROJECT_DIR}"
EOF
  green "  ✓ graph-memory.yaml saved (port ${CHOSEN_PORT})"
else
  green "  ✓ graph-memory.yaml is up to date"
fi

# ── Step 5: Orchestrator config ───────────────────────────────────────────

step "Orchestrator config"

existing_port=""
if [ -f "$CONFIG_FILE" ]; then
  existing_port=$(grep '"baseUrl"' "$CONFIG_FILE" | grep -o ':[0-9]*"' | tr -d ':"')
fi

if [ ! -f "$CONFIG_FILE" ] || [ "$existing_port" != "$CHOSEN_PORT" ]; then
  cat > "$CONFIG_FILE" << EOF
{
  "baseUrl": "${GM_BASE_URL}",
  "projectId": "${PROJECT_ID}",
  "apiKey": "",
  "timeoutMs": 900000,
  "pauseMs": 2000,
  "maxRetries": 1,
  "claudeArgs": [],
  "dryRun": false
}
EOF
  green "  ✓ .gm-orchestrator.json saved"
else
  green "  ✓ Config is up to date"
fi

# ── Step 6: GraphMemory ───────────────────────────────────────────────────

step "GraphMemory"

if curl -s "${GM_BASE_URL}" > /dev/null 2>&1; then
  green "  ✓ Already running on :${CHOSEN_PORT}"
else
  dim "  Starting: graphmemory serve --config graph-memory.yaml"

  nohup graphmemory serve --config "${GM_YAML}" \
    > /tmp/graphmemory-${PROJECT_ID}.log 2>&1 &
  GM_PID=$!
  disown "$GM_PID"

  echo -n "  Waiting"
  for i in $(seq 1 30); do
    sleep 1
    if curl -s "${GM_BASE_URL}" > /dev/null 2>&1; then
      echo ""
      green "  ✓ Started (PID ${GM_PID})"
      dim "  Logs:    /tmp/graphmemory-${PROJECT_ID}.log"
      dim "  Web UI:  ${GM_BASE_URL}"
      dim "  Stop:    kill ${GM_PID}"
      break
    fi
    echo -n "."
    if [ "$i" -eq 30 ]; then
      echo ""
      tail -5 /tmp/graphmemory-${PROJECT_ID}.log 2>/dev/null | sed 's/^/    /' || true
      die "Failed to start in 30s. Check: tail -f /tmp/graphmemory-${PROJECT_ID}.log"
    fi
  done
fi

# ── Step 7: MCP ───────────────────────────────────────────────────────────

step "MCP → Claude Code"

if claude mcp list 2>/dev/null | grep -q "graph-memory"; then
  current_mcp_url=$(claude mcp list 2>/dev/null | grep "graph-memory" | grep -o 'http[^ ]*' || true)
  if [ "$current_mcp_url" = "$GM_MCP_URL" ]; then
    green "  ✓ Already connected: ${GM_MCP_URL}"
  else
    yellow "  ⚠ URL changed, reconnecting..."
    claude mcp remove graph-memory --scope project 2>/dev/null || true
    claude mcp add --transport http --scope project graph-memory "${GM_MCP_URL}"
    green "  ✓ Reconnected: ${GM_MCP_URL}"
  fi
else
  claude mcp add --transport http --scope project graph-memory "${GM_MCP_URL}"
  green "  ✓ Connected: ${GM_MCP_URL}"
fi

# ── Step 8: Goal ──────────────────────────────────────────────────────────

echo ""
bold "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
bold "  Stack is ready"
bold "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ "$SKIP_PLAN" = false ]; then
  if [ -z "$GOAL" ]; then
    ask "Describe your goal" ""
    GOAL="$ASK_RESULT"
    [ -z "$GOAL" ] && die "No goal provided."
  fi

  dim "  Goal: ${GOAL}"
  echo ""

  # ── Step 9: Seed plan task via REST ──────────────────────────────────
  # Claude Code (with MCP) will decompose this into real tasks in its session.

  step "Seeding plan task via GraphMemory REST API"

  PLAN_DESCRIPTION="You are the first session in an autonomous orchestrator pipeline.

Your job: decompose the following goal into atomic tasks in GraphMemory, then mark this planning task as done.

Goal: ${GOAL}

Instructions:
1. Think through what sub-tasks are needed to achieve the goal
2. For each sub-task call tasks_create with:
   - title: clear, action-oriented
   - description: enough context for autonomous execution (no follow-up possible)
   - priority: critical / high / medium / low
3. Link dependent tasks: tasks_link(fromId, toId, 'blocks')
4. When all tasks are created, call tasks_move(THIS_TASK_ID, 'done')
   THIS_TASK_ID will be in your task context when you call tasks_get on yourself.

Do NOT implement anything. Planning only."

  # Create the plan task via REST
  RESPONSE=$(curl -s -X POST "${GM_API}/tasks" \
    -H "Content-Type: application/json" \
    -d "{
      \"title\": \"Plan: ${GOAL}\",
      \"description\": $(echo "$PLAN_DESCRIPTION" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))"),
      \"priority\": \"critical\",
      \"status\": \"todo\"
    }")

  TASK_ID=$(echo "$RESPONSE" | node -e "
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>{
      try { const p=JSON.parse(d); console.log(p.id || p.taskId || p.task?.id || ''); }
      catch(e) { console.log(''); }
    });
  ")

  if [ -n "$TASK_ID" ]; then
    green "  ✓ Plan task created: ${TASK_ID}"
    dim "  Title: Plan: ${GOAL}"
  else
    yellow "  ⚠ Could not parse task ID from response:"
    echo "$RESPONSE" | sed 's/^/    /'
    die "Failed to create plan task. Is GraphMemory running at ${GM_API}?"
  fi
fi

# ── Step 10: Sprint ───────────────────────────────────────────────────────

if [ "$DRY_RUN" = true ]; then
  echo ""
  bold "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  yellow "  --dry-run: sprint not started"
  dim "  Run manually: npx tsx src/cli/index.ts sprint"
  bold "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
else
  echo ""
  bold "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  bold "  Handing off to orchestrator..."
  bold "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  npx tsx src/cli/index.ts sprint
fi
