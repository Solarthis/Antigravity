#!/usr/bin/env bash
# =============================================================================
# PROJECT ANTIGRAVITY — First-time Setup
# =============================================================================
# Thin alias for "verify environment + build the image" without starting the
# app. Useful for pre-building the image on first plug-in of a flash drive
# before the user double-clicks the launcher.
# =============================================================================

set -eu

CDIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CDIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         🚀 PROJECT ANTIGRAVITY — Build & Prep                ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

echo -e "${CYAN}[1/3] Checking prerequisites...${NC}"
if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}✗ Docker is not installed.${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ Docker found${NC}"

if ! docker info >/dev/null 2>&1; then
  echo -e "${RED}✗ Docker daemon is not running. Start Docker Desktop.${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ Docker daemon is running${NC}"

if ! docker compose version >/dev/null 2>&1; then
  echo -e "${RED}✗ Docker Compose v2 is not available. Update Docker Desktop.${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ Docker Compose v2 available${NC}"

echo ""
echo -e "${CYAN}[2/3] Initializing config and data directories...${NC}"
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo -e "${GREEN}  ✓ Generated .env from .env.example${NC}"
else
  echo -e "${GREEN}  ✓ .env already present${NC}"
fi
mkdir -p "$CDIR/data"
echo -e "${GREEN}  ✓ ./data ready${NC}"

echo ""
echo -e "${CYAN}[3/3] Building Antigravity image...${NC}"
docker compose build
echo -e "${GREEN}  ✓ Image built successfully${NC}"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    ✅ Ready for Launch!                      ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Launch now:  ${CYAN}./Antigravity.command${NC}  (macOS/Linux)"
echo -e "               ${CYAN}Antigravity.bat${NC}         (Windows)"
echo -e "  Or headless: ${CYAN}./start.sh${NC}"
echo ""
