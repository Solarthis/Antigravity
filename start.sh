#!/usr/bin/env bash
# =============================================================================
# PROJECT ANTIGRAVITY — Start (POSIX, background mode)
# =============================================================================
# Builds and starts the appliance in detached mode. Same bootstrap as
# Antigravity.command, but exits after the container is healthy instead of
# tailing logs.
# =============================================================================

set -u

CDIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CDIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         🚀 PROJECT ANTIGRAVITY — Starting...                 ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}✗ Docker is not installed.${NC}"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo -e "${RED}✗ Docker daemon is not running. Start Docker Desktop first.${NC}"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo -e "${RED}✗ Docker Compose v2 is not available (update Docker Desktop).${NC}"
  exit 1
fi

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

echo -e "${CYAN}  Building and starting services...${NC}"
docker compose up -d --build --wait

MAPPING="$(docker compose port antigravity 3000 2>/dev/null || true)"
HOST_PORT="${MAPPING##*:}"
[ -z "$HOST_PORT" ] && HOST_PORT="${APP_PORT:-3000}"
URL="http://localhost:${HOST_PORT}"

if command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 || true
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
fi

echo ""
echo -e "${GREEN}  ✓ Services are running in background${NC}"
echo -e "  Dashboard:    ${CYAN}${URL}${NC}"
echo ""
echo -e "  Follow logs:  ${CYAN}docker compose logs -f antigravity${NC}"
echo -e "  Stop:         ${CYAN}./stop.sh${NC}"
echo -e "  Full reset:   ${CYAN}./stop.sh --clean${NC}"
echo ""
