#!/bin/sh
set -e

IMAGE="${IMAGE:-quay.io/rh_ee_micyang/rh-agent}"
TAG="${TAG:-latest}"
FULL="${IMAGE}:${TAG}"
PLATFORMS="linux/amd64,linux/arm64"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

info()  { printf "${GREEN}  ✓ %s${RESET}\n" "$*"; }
step()  { printf "\n${BOLD}  %s${RESET}\n" "$*"; }
error() { printf "${RED}  ✗ %s${RESET}\n" "$*" >&2; }

usage() {
  echo ""
  echo "  Usage: ./build.sh [--push] [--tag <tag>]"
  echo ""
  echo "  Options:"
  echo "    --push       Push manifest to registry after build"
  echo "    --tag <tag>  Image tag (default: latest)"
  echo ""
  echo "  Environment variables:"
  echo "    IMAGE        Image name (default: quay.io/rh_ee_micyang/rh-agent)"
  echo "    TAG          Image tag (default: latest)"
  echo ""
  exit 0
}

PUSH=false
while [ $# -gt 0 ]; do
  case "$1" in
    --push)  PUSH=true; shift ;;
    --tag)   TAG="$2"; FULL="${IMAGE}:${TAG}"; shift 2 ;;
    --help)  usage ;;
    *)       echo "Unknown option: $1"; usage ;;
  esac
done

if ! command -v podman >/dev/null 2>&1; then
  error "podman is required but not found."
  exit 1
fi

step "Building multi-arch image: ${FULL}"
printf "${DIM}    Platforms: %s${RESET}\n" "$PLATFORMS"

# Clean up any existing manifest/image with this name
podman manifest rm "$FULL" 2>/dev/null || true
podman rmi "$FULL" 2>/dev/null || true

step "Creating manifest..."
podman manifest create "$FULL"
info "Manifest created"

step "Building linux/amd64..."
podman build --platform linux/amd64 --manifest "$FULL" .
info "amd64 built"

step "Building linux/arm64..."
podman build --platform linux/arm64 --manifest "$FULL" .
info "arm64 built"

step "Manifest contents:"
podman manifest inspect "$FULL" | grep -E '"architecture"|"os"' | while read -r line; do
  printf "${DIM}    %s${RESET}\n" "$line"
done

if [ "$PUSH" = "true" ]; then
  step "Pushing manifest to registry..."
  podman manifest push --all "$FULL"
  info "Pushed ${FULL}"
else
  echo ""
  printf "${DIM}    Skipping push. Run with --push to push to registry:${RESET}\n"
  printf "${CYAN}    ./build.sh --push${RESET}\n"
fi

echo ""
printf "${GREEN}${BOLD}  Done!${RESET}\n"
echo ""
