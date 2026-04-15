#!/usr/bin/env bash
# =============================================================================
# PROJECT ANTIGRAVITY — macOS / Linux one-click launcher
# =============================================================================
# Double-click on macOS, or run via terminal on any POSIX host.
# Identical behavior to start.sh; this file exists for Finder double-click UX.
# =============================================================================

set -u

CDIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CDIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

banner() {
  echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║         🚀 PROJECT ANTIGRAVITY — MAT Solutions              ║${NC}"
  echo -e "${CYAN}║         Flash-Drive Portable Sourcing Pipeline             ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
  echo ""
}

check_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo -e "${RED}✗ Docker is not installed.${NC}"
    echo "  Install Docker Desktop: https://www.docker.com/products/docker-desktop"
    echo "  Press any key to exit..."
    read -n 1 -r
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}✗ Docker daemon is not running.${NC}"
    echo "  Start Docker Desktop and re-run this script."
    echo "  Press any key to exit..."
    read -n 1 -r
    exit 1
  fi
  if ! docker compose version >/dev/null 2>&1; then
    echo -e "${RED}✗ Docker Compose v2 is not available.${NC}"
    echo "  Update to Docker Desktop 4.x or later (includes 'docker compose')."
    echo "  Press any key to exit..."
    read -n 1 -r
    exit 1
  fi
}

ensure_env_and_data() {
  if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
      cp .env.example .env
      echo -e "${GREEN}  ✓ Generated .env from .env.example${NC}"
    else
      echo -e "${RED}✗ .env.example template is missing. Restore it to continue.${NC}"
      exit 1
    fi
  fi
  mkdir -p "$CDIR/data"
}

published_url() {
  # `docker compose port <service> <internal_port>` prints "0.0.0.0:<host>".
  local mapping
  mapping="$(docker compose port antigravity 3000 2>/dev/null || true)"
  local host_port="${mapping##*:}"
  if [ -z "$host_port" ]; then
    host_port="${APP_PORT:-3000}"
  fi
  echo "http://localhost:${host_port}"
}

open_browser() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

print_guidance() {
  local url="$1"
  echo ""
  echo -e "${GREEN}  ✅ Antigravity is LIVE at ${url}${NC}"
  echo ""
  echo -e "  Follow logs:  ${CYAN}docker compose logs -f antigravity${NC}"
  echo -e "  Stop:         ${CYAN}./stop.sh${NC}"
  echo -e "  Full reset:   ${CYAN}./stop.sh --clean${NC}"
  echo ""
}

main() {
  banner
  check_docker
  ensure_env_and_data

  echo -e "${CYAN}  Building and starting services...${NC}"
  if ! docker compose up -d --build --wait; then
    echo -e "${RED}✗ docker compose up failed. See output above.${NC}"
    echo "  Press any key to exit..."
    read -n 1 -r
    exit 1
  fi

  local url
  url="$(published_url)"
  open_browser "$url"
  print_guidance "$url"

  # Keep terminal window alive with logs so double-click users see activity.
  docker compose logs -f antigravity
}

main "$@"
