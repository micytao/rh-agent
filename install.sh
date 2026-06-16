#!/bin/sh
set -e

IMAGE="quay.io/rh_ee_micyang/rh-agent:latest"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
WRAPPER="$INSTALL_DIR/rh-agent"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

RH_RED='\033[38;5;196m'

info()  { printf "${GREEN}  ✓ %s${RESET}\n" "$*"; }
step()  { printf "\n${BOLD}  %s${RESET}\n" "$*"; }
dim()   { printf "${DIM}    %s${RESET}\n" "$*"; }
error() { printf "${RED}  ✗ %s${RESET}\n" "$*" >&2; }

# ── Welcome banner ──
echo ""
printf "${RH_RED}      ____           __   __  __      __     ___                    __ ${RESET}\n"
printf "${RH_RED}     / __ \\___  ____/ /  / / / /___ _/ /_   /   | ____  ___  ____  / /_${RESET}\n"
printf "${RH_RED}    / /_/ / _ \\/ __  /  / /_/ / __ \`/ __/  / /| |/ __ \`/ _ \\/ __ \\/ __/${RESET}\n"
printf "${RH_RED}   / _, _/  __/ /_/ /  / __  / /_/ / /_   / ___ / /_/ /  __/ / / / /_  ${RESET}\n"
printf "${RH_RED}  /_/ |_|\\___/\\__,_/  /_/ /_/\\__,_/\\__/  /_/  |_\\__, /\\___/_/ /_/\\__/  ${RESET}\n"
printf "${RH_RED}                                               /____/                  ${RESET}\n"
printf "${DIM}  Your AI-powered Red Hat assistant${RESET}\n"
echo ""

# ── Pre-install summary ──
printf "${BOLD}  This installer will:${RESET}\n"
echo ""
printf "    1. Check for a container runtime (podman or docker)\n"
printf "    2. Pull the rh-agent container image from:\n"
printf "       ${CYAN}%s${RESET}\n" "$IMAGE"
printf "    3. Create a small shell wrapper at:\n"
printf "       ${CYAN}%s${RESET}\n" "$WRAPPER"
echo ""
printf "${BOLD}  After install, the setup wizard will:${RESET}\n"
echo ""
printf "    4. Ask you to pick a model provider:\n"
printf "       ${DIM}OpenAI, Anthropic, Google Gemini, Azure OpenAI,${RESET}\n"
printf "       ${DIM}or a local endpoint (Ollama, vLLM, LM Studio, etc.)${RESET}\n"
printf "    5. Ask for an API key (or detect one from your environment)\n"
printf "    6. Let you choose a default model\n"
echo ""
printf "${BOLD}  What you'll need:${RESET}\n"
echo ""
printf "    • An API key from one of the supported providers, ${BOLD}or${RESET}\n"
printf "    • A local model server already running (e.g. ${CYAN}ollama serve${RESET})\n"
echo ""
printf "${BOLD}  Security & privacy:${RESET}\n"
echo ""
printf "    • The container runs ${BOLD}rootless${RESET} with no elevated privileges\n"
printf "    • Your API keys and config are stored locally in ${CYAN}~/.rh-agent/${RESET}\n"
printf "      and are ${BOLD}never${RESET} sent to Red Hat or baked into the image\n"
printf "    • Only the current directory is mounted ${BOLD}read-only${RESET} as ${CYAN}/workspace${RESET}\n"
printf "    • No other host files or directories are accessible to the container\n"
printf "    • Source: ${YELLOW}${BOLD}https://github.com/micytao/rh-agent${RESET}\n"
echo ""

# ── Check for existing non-container rh-agent ──
EXISTING_RH=$(command -v rh-agent 2>/dev/null || true)
if [ -n "$EXISTING_RH" ] && [ "$EXISTING_RH" != "$WRAPPER" ]; then
  printf "${YELLOW}  ⚠ An existing rh-agent was found at: ${BOLD}%s${RESET}\n" "$EXISTING_RH"
  if file "$EXISTING_RH" 2>/dev/null | grep -q "text"; then
    if head -1 "$EXISTING_RH" 2>/dev/null | grep -q "node"; then
      printf "${YELLOW}    This appears to be a dev install (npm install -g).${RESET}\n"
    fi
  fi
  if echo "$PATH" | tr ':' '\n' | awk -v w="$INSTALL_DIR" -v e="$(dirname "$EXISTING_RH")" \
    'BEGIN{wi=-1;ei=-1} {i++} $0==w{wi=i} $0==e{ei=i} END{exit (wi>=0 && wi<ei) ? 0 : 1}'; then
    printf "${YELLOW}    ${BOLD}%s${RESET}${YELLOW} comes first in PATH and will shadow it.${RESET}\n" "$INSTALL_DIR"
  else
    printf "${YELLOW}    It takes priority over ${BOLD}%s${RESET}${YELLOW} in your PATH.${RESET}\n" "$WRAPPER"
    printf "${YELLOW}    After install, run: ${CYAN}which rh-agent${YELLOW} to verify which one is active.${RESET}\n"
  fi
  echo ""
fi

if [ -e /dev/tty ]; then
  printf "  ${CYAN}Continue? [Y/n]${RESET} "
  read -r REPLY </dev/tty
  case "$REPLY" in
    [nN]*) echo ""; printf "  Cancelled.\n"; echo ""; exit 0 ;;
  esac
  echo ""
fi

# ── Step 1: Detect container runtime ──
step "Step 1/3: Checking container runtime..."

if command -v podman >/dev/null 2>&1; then
  RUNTIME=podman
  info "Found podman"
elif command -v docker >/dev/null 2>&1; then
  RUNTIME=docker
  info "Found docker"
else
  error "podman or docker is required but neither was found."
  echo ""
  dim "Install Podman:  https://podman.io/getting-started/installation"
  dim "Install Docker:  https://docs.docker.com/get-docker/"
  echo ""
  exit 1
fi

# ── Step 2: Pull image ──
step "Step 2/3: Pulling container image..."
dim "$IMAGE"

if $RUNTIME pull "$IMAGE" >/dev/null 2>&1; then
  info "Image ready"
else
  error "Could not pull image. Check your network and credentials."
  exit 1
fi

# ── Step 3: Install wrapper ──
step "Step 3/3: Installing rh-agent command..."

mkdir -p "$INSTALL_DIR"

cat > "$WRAPPER" <<'SCRIPT'
#!/bin/sh
IMAGE="@@IMAGE@@"
RUNTIME="@@RUNTIME@@"
CONTAINER_NAME="rh-agent"

DIM='\033[2m'
RESET='\033[0m'

if [ "$1" = "update" ]; then
  echo "Pulling latest $IMAGE ..."
  $RUNTIME pull "$IMAGE"
  RC=$?
  if [ $RC -eq 0 ]; then
    $RUNTIME rm -f "$CONTAINER_NAME" >/dev/null 2>&1
    echo "Container stopped — next run will use the new image."
  fi
  exit $RC
fi

if [ "$1" = "uninstall" ]; then
  echo "Removing rh-agent..."
  $RUNTIME rm -f "$CONTAINER_NAME" >/dev/null 2>&1
  rm -f "@@WRAPPER@@"
  echo "Wrapper removed. Config remains at ~/.rh-agent (delete manually if desired)."
  exit 0
fi

if [ "$1" = "stop" ]; then
  $RUNTIME rm -f "$CONTAINER_NAME" >/dev/null 2>&1
  echo "rh-agent container stopped."
  exit 0
fi

mkdir -p "$HOME/.rh-agent"

EXTRA_FLAGS=""
if [ "$RUNTIME" = "podman" ]; then
  EXTRA_FLAGS="--userns=keep-id --security-opt label=disable"
fi

# Short-lived commands (status, onboard): use existing container if running,
# otherwise do a one-shot run --rm (don't start a persistent container for these).
case "$1" in
  status|onboard)
    if $RUNTIME inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q "true"; then
      exec $RUNTIME exec -it \
        -w /workspace \
        "$CONTAINER_NAME" \
        node /app/dist/index.js "$@"
    else
      exec $RUNTIME run -it --rm \
        --pull=never \
        $EXTRA_FLAGS \
        -v "$HOME/.rh-agent:/home/node/.rh-agent" \
        -v "$(pwd)":/workspace:ro \
        -w /workspace \
        $IMAGE "$@"
    fi
    ;;
esac

# Fast path: if container is already running, check workspace matches
if $RUNTIME inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q "true"; then
  CUR_DIR=$(cd -P . && pwd -P)
  MOUNTED=$($RUNTIME inspect --format '{{range .Mounts}}{{if eq .Destination "/workspace"}}{{.Source}}{{end}}{{end}}' "$CONTAINER_NAME" 2>/dev/null)
  CUR_DIR="${CUR_DIR%/}"
  MOUNTED="${MOUNTED%/}"
  if [ "$MOUNTED" = "$CUR_DIR" ]; then
    exec $RUNTIME exec -it -w /workspace "$CONTAINER_NAME" node /app/dist/index.js "$@"
  fi
  printf "${DIM}  Workspace changed, restarting container...${RESET}\n"
  $RUNTIME rm -f "$CONTAINER_NAME" >/dev/null 2>&1
fi

# Container not running — remove stale container (if any) and start fresh
$RUNTIME rm -f "$CONTAINER_NAME" >/dev/null 2>&1

printf "${DIM}  Starting rh-agent container...${RESET}\n"

# Start persistent container in background
$RUNTIME run -d \
  --name "$CONTAINER_NAME" \
  --pull=never \
  $EXTRA_FLAGS \
  -v "$HOME/.rh-agent:/home/node/.rh-agent" \
  -v "$(pwd)":/workspace:ro \
  -w /workspace \
  $IMAGE --keep-alive >/dev/null 2>&1

# Wait briefly for container to be ready
TRIES=0
while [ $TRIES -lt 20 ]; do
  if $RUNTIME inspect --format '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q "true"; then
    break
  fi
  sleep 0.1
  TRIES=$((TRIES + 1))
done

# Exec interactive session into the running container
exec $RUNTIME exec -it \
  -w /workspace \
  "$CONTAINER_NAME" \
  node /app/dist/index.js "$@"
SCRIPT

# Inject actual values into the wrapper (heredoc uses 'SCRIPT' to avoid expansion)
sed -i.bak \
  -e "s|@@IMAGE@@|$IMAGE|g" \
  -e "s|@@RUNTIME@@|$RUNTIME|g" \
  -e "s|@@WRAPPER@@|$WRAPPER|g" \
  "$WRAPPER" && rm -f "${WRAPPER}.bak"

chmod +x "$WRAPPER"
info "Installed to $WRAPPER"

# ── PATH check ──
PATH_ADDED=true
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    PATH_ADDED=false
    echo ""
    printf "${YELLOW}  ⚠ $INSTALL_DIR is not in your PATH.${RESET}\n"
    echo ""

    SHELL_NAME=$(basename "$SHELL" 2>/dev/null || echo "sh")
    case "$SHELL_NAME" in
      zsh)  PROFILE="~/.zshrc" ;;
      bash) PROFILE="~/.bashrc" ;;
      fish) PROFILE="~/.config/fish/config.fish" ;;
      *)    PROFILE="~/.profile" ;;
    esac

    printf "${BOLD}  Add to ${PROFILE}:${RESET}\n"
    printf "    ${CYAN}export PATH=\"%s:\$PATH\"${RESET}\n" "$INSTALL_DIR"
    echo ""
    printf "  Or run now:  ${CYAN}export PATH=\"%s:\$PATH\"${RESET}\n" "$INSTALL_DIR"
    ;;
esac

# ── Success summary ──
echo ""
printf "${GREEN}${BOLD}  Installation complete!${RESET}\n"
echo ""
printf "${BOLD}  Commands:${RESET}\n"
dim "rh-agent              Start interactive agent"
dim "rh-agent onboard      Re-run setup wizard"
dim "rh-agent update       Pull latest image"
dim "rh-agent stop         Stop persistent container"
dim "rh-agent uninstall    Remove rh-agent"
echo ""

# ── Next steps ──
if [ ! -f "$HOME/.rh-agent/config.json" ]; then
  printf "${BOLD}  Get started:${RESET}\n"
  printf "    ${CYAN}rh-agent${RESET}  to launch the setup wizard and start chatting\n"
else
  printf "${BOLD}  Get started:${RESET}\n"
  printf "    ${CYAN}rh-agent${RESET}  to start the interactive agent\n"
fi
echo ""
