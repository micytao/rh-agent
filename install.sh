#!/bin/sh
set -e

IMAGE="quay.io/rh_ee_micyang/rh-agent:latest"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"
WRAPPER="$INSTALL_DIR/rh-agent"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { printf "${GREEN}%s${RESET}\n" "$*"; }
dim()   { printf "${DIM}%s${RESET}\n" "$*"; }
error() { printf "${RED}%s${RESET}\n" "$*" >&2; }

# Detect container runtime
if command -v podman >/dev/null 2>&1; then
  RUNTIME=podman
elif command -v docker >/dev/null 2>&1; then
  RUNTIME=docker
else
  error "Error: podman or docker is required but neither was found."
  echo "Install Podman: https://podman.io/getting-started/installation"
  exit 1
fi

info "Using $RUNTIME as container runtime"

# Pull image
printf "Pulling %s ... " "$IMAGE"
if $RUNTIME pull "$IMAGE" >/dev/null 2>&1; then
  info "done"
else
  error "failed"
  error "Could not pull $IMAGE. Check your credentials and network."
  exit 1
fi

# Create install directory
mkdir -p "$INSTALL_DIR"

# Write wrapper script
cat > "$WRAPPER" <<SCRIPT
#!/bin/sh
IMAGE="$IMAGE"
RUNTIME="$RUNTIME"

if [ "\$1" = "update" ]; then
  echo "Pulling latest \$IMAGE ..."
  \$RUNTIME pull "\$IMAGE"
  exit \$?
fi

\$RUNTIME rm -f rh-agent 2>/dev/null
exec \$RUNTIME run -it --rm \\
  --name rh-agent \\
  --pull=newer \\
  -v "\$HOME/.rh-agent:/home/node/.rh-agent" \\
  -v "\$(pwd)":/workspace \\
  -w /workspace \\
  \$IMAGE "\$@"
SCRIPT

chmod +x "$WRAPPER"

info ""
info "  rh-agent installed to $WRAPPER"

# Check if INSTALL_DIR is in PATH
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    printf "${BOLD}  Add this to your shell profile (~/.zshrc or ~/.bashrc):${RESET}\n"
    printf "    ${CYAN}export PATH=\"%s:\$PATH\"${RESET}\n" "$INSTALL_DIR"
    echo ""
    ;;
esac

info ""
info "  Get started:"
dim  "    rh-agent              # interactive TUI"
dim  "    rh-agent onboard      # setup wizard"
dim  "    rh-agent \"query\"      # single query"
dim  "    rh-agent update       # pull latest image"
echo ""
