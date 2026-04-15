#!/usr/bin/env bash
# =============================================================================
# PROJECT ANTIGRAVITY — Stop
# =============================================================================
# Stops the appliance. By default persistent data (./data/antigravity.db) is
# kept intact. Use --clean to also remove named volumes (none are currently
# defined; flag is reserved for future use and triggers a confirmation prompt).
#
# Usage:
#   ./stop.sh            → stop containers, keep data
#   ./stop.sh --clean    → stop AND wipe ./data (full reset)
# =============================================================================

set -u

CDIR="$(cd "$(dirname "$0")" && pwd)"
cd "$CDIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

CLEAN=false
for arg in "$@"; do
  [ "$arg" = "--clean" ] && CLEAN=true
done

echo ""
echo -e "${CYAN}[Antigravity] Stopping services...${NC}"

if [ "$CLEAN" = true ]; then
  echo -e "${RED}  ⚠  --clean will DELETE ./data (database and all hunts/lots/alerts).${NC}"
  read -rp "  Type YES to confirm: " CONFIRM
  if [ "$CONFIRM" = "YES" ]; then
    docker compose down -v
    rm -rf "$CDIR/data"
    echo -e "${GREEN}  ✓ Stopped. Volumes removed and ./data wiped.${NC}"
  else
    echo "  Cancelled. No changes made."
    exit 0
  fi
else
  docker compose down
  echo -e "${GREEN}  ✓ Stopped. SQLite data preserved in ./data/antigravity.db${NC}"
  echo ""
  echo -e "  Restart with: ${CYAN}./start.sh${NC} (or double-click Antigravity.command)"
fi
echo ""
