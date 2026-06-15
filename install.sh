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
printf "${RH_RED}     / __ \\___ _____/ /  / / / /___ _/ /_   /   | ____  ____  ____  / /_${RESET}\n"
printf "${RH_RED}    / /_/ / _ \/ __  /  / /_/ / __ \`/ __/  / /| |/ __ \`/ _ \\/ __ \\/ __/${RESET}\n"
printf "${RH_RED}   / _, _/  __/ /_/ /  / __  / /_/ / /_   / ___ / /_/ /  __/ / / / /_  ${RESET}\n"
printf "${RH_RED}  /_/ |_|\\___/\\__,_/  /_/ /_/\\__,_/\\__/  /_/  |_\\__, /\\___/_/ /_/\\__/  ${RESET}\n"
printf "${RH_RED}                                                /___/                  ${RESET}\n"
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
printf "    • Only the current directory is mounted read/write as ${CYAN}/workspace${RESET}\n"
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

if [ -t 0 ] && [ -t 1 ]; then
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

cat > "$WRAPPER" <<SCRIPT
#!/bin/sh
IMAGE="$IMAGE"
RUNTIME="$RUNTIME"

if [ "\$1" = "update" ]; then
  echo "Pulling latest \$IMAGE ..."
  \$RUNTIME pull "\$IMAGE"
  exit \$?
fi

if [ "\$1" = "uninstall" ]; then
  echo "Removing rh-agent..."
  rm -f "$WRAPPER"
  echo "Wrapper removed. Config remains at ~/.rh-agent (delete manually if desired)."
  exit 0
fi

mkdir -p "\$HOME/.rh-agent"
\$RUNTIME rm -f rh-agent 2>/dev/null

EXTRA_FLAGS=""
if [ "\$RUNTIME" = "podman" ]; then
  EXTRA_FLAGS="--userns=keep-id --security-opt label=disable"
fi

printf "\\033[2m  Starting rh-agent...\\033[0m\\r"

exec \$RUNTIME run -it --rm \\
  --name rh-agent \\
  --pull=never \\
  \$EXTRA_FLAGS \\
  -v "\$HOME/.rh-agent:/home/node/.rh-agent" \\
  -v "\$(pwd)":/workspace \\
  -w /workspace \\
  \$IMAGE "\$@"
SCRIPT

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
dim "rh-agent \"query\"      Single query mode"
dim "rh-agent update       Pull latest image"
dim "rh-agent uninstall    Remove rh-agent"
echo ""

# ── Offer to launch immediately ──
FIRST_TIME=false
if [ ! -f "$HOME/.rh-agent/config.json" ]; then
  FIRST_TIME=true
fi

if [ -t 0 ] && [ -t 1 ]; then
  if [ "$FIRST_TIME" = "true" ]; then
    printf "${BOLD}  Ready to set up rh-agent? This takes about 1 minute.${RESET}\n"
    printf "  You'll choose an LLM provider and enter an API key.\n"
    echo ""
    printf "  ${CYAN}Launch setup now? [Y/n]${RESET} "
    read -r REPLY </dev/tty
    case "$REPLY" in
      [nN]*) echo ""; dim "Run 'rh-agent' when you're ready." ; echo "" ;;
      *)
        echo ""
        if [ "$PATH_ADDED" = "false" ]; then
          export PATH="$INSTALL_DIR:$PATH"
        fi
        exec "$WRAPPER"
        ;;
    esac
  else
    printf "${DIM}  Existing config found at ~/.rh-agent/config.json${RESET}\n"
    printf "  ${CYAN}Launch rh-agent now? [Y/n]${RESET} "
    read -r REPLY </dev/tty
    case "$REPLY" in
      [nN]*) echo "" ;;
      *)
        echo ""
        if [ "$PATH_ADDED" = "false" ]; then
          export PATH="$INSTALL_DIR:$PATH"
        fi
        exec "$WRAPPER"
        ;;
    esac
  fi
fi
