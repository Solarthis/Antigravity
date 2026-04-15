# 🚀 Project Antigravity — Flash-Drive Ready
### Enterprise Auction Sourcing & Alert Pipeline

**One launcher. One container. One SQLite file on the drive.**

Project Antigravity monitors **Copart.com** auction listings in real time, scores each lot against your custom hunts, and fires alerts via WhatsApp / SMS. This build is designed to live on a flash drive: plug it in, double-click the launcher, and the full stack runs inside Docker with data persisting alongside the source.

---

## Quick start

Prerequisites on the host:

- **Docker Desktop 4.x or later** (includes `docker compose` v2)
- Nothing else. No Node, no Postgres, no system packages.

### macOS / Linux
1. Plug in the drive.
2. Double-click **`Antigravity.command`** (or run `./Antigravity.command` from a terminal).
3. Wait for the dashboard to open in your browser.

### Windows
1. Plug in the drive.
2. Double-click **`Antigravity.bat`**.
3. Wait for the dashboard to open in your browser.

First launch builds the image (a few minutes). Subsequent launches reuse the cached image and start in seconds.

---

## What the launcher does

Every launcher (`Antigravity.command`, `Antigravity.bat`, `start.sh`, `setup.sh`) follows the same steps:

1. Verifies Docker Desktop is installed, running, and has Compose v2.
2. Creates **`.env`** from **`.env.example`** if it doesn't exist.
3. Creates **`./data/`** for the SQLite database.
4. Runs `docker compose up -d --build --wait` so the container is healthy before returning.
5. Opens the dashboard in your default browser.
6. Tails logs (for the double-click launchers) or exits (for `start.sh`).

---

## Configuration

Runtime config lives in **`.env`** (git-ignored, generated on first launch from the committed template at `.env.example`). Edit `.env` and restart to apply changes.

| Variable | Purpose | Default |
|---|---|---|
| `APP_PORT` | Host port the dashboard is published on | `3000` |
| `TWILIO_ACCOUNT_SID` | Twilio SID (required for live alerts) | *(empty = dry-run)* |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | *(empty)* |
| `TWILIO_WHATSAPP_FROM` / `TWILIO_SMS_FROM` | Sending numbers | Twilio sandbox |
| `ALERT_RECIPIENTS_WHATSAPP` | Comma-separated WhatsApp recipients | *(empty)* |
| `ALERT_RECIPIENTS_SMS` | Comma-separated SMS recipients | *(empty)* |
| `ADMIN_ALERT_RECIPIENT` | Admin escalation channel | *(empty)* |
| `CRON_SCHEDULE` | Scrape cadence | `*/30 7-21 * * 1-6` |
| `CRON_TIMEZONE` | Cron timezone | `America/New_York` |
| `MATCH_CONFIDENCE_THRESHOLD` | Minimum score to alert (0–1) | `0.6` |
| `SCRAPE_*` | Playwright/scraper tuning | see `.env.example` |

Leave Twilio blank to run in dry-run mode — hunts still execute and matches appear in the dashboard, but no external messages are sent.

---

## Persistence

All state lives in a single SQLite file: **`./data/antigravity.db`** (plus `-wal` / `-shm` sidecars while the app is running). Copy the `data/` folder to back up, or rename it to snapshot. Docker mounts `./data` into the container; nothing else needs to be persisted.

Schema and a default "Toyota Tacoma 2012–2015 Access Cab" hunt are auto-created on first boot.

---

## Stop / reset

| Command | Effect |
|---|---|
| `./stop.sh` | Stop the container. `./data/antigravity.db` is preserved. |
| `./stop.sh --clean` | Stop **and** delete `./data/` (full factory reset — confirms first). |
| `docker compose logs -f antigravity` | Follow live logs. |
| `docker compose restart` | Restart without rebuilding. |

Windows users can run `docker compose down` directly or re-open the launcher.

---

## Architecture

```
Flash drive
├── Antigravity.command / .bat   ← one-click launcher
├── .env.example                 ← committed template (read)
├── .env                         ← generated on first launch (ignored)
├── data/antigravity.db          ← SQLite state (ignored)
├── Dockerfile                   ← single-stage image
├── docker-compose.yml           ← single service, ${APP_PORT:-3000}:3000
├── backend/                     ← Node 18 + Express + better-sqlite3
│   └── src/api/v1/status/health ← readiness endpoint for healthcheck
└── frontend/                    ← static dashboard (system fonts, no CDN)
```

The container exposes port 3000 internally and is mapped to `${APP_PORT:-3000}` on the host. A Node-native healthcheck (`fetch('/api/v1/status/health')`) runs every 10 seconds so Compose and the launcher can wait for genuine readiness before handing the URL to the browser.

---

## Troubleshooting

- **`docker compose build` fails with `input/output error` during image export.** Restart Docker Desktop and retry — this is a known Docker Desktop overlayfs issue, not a repo problem.
- **Port 3000 is taken.** Edit `APP_PORT` in `.env` (e.g. `APP_PORT=3100`) and relaunch.
- **Dashboard stuck on "Connecting..."** Check `docker compose ps` — the container should be `(healthy)`. If not, `docker compose logs antigravity` will show the failure.
- **Hunts don't appear after create/toggle.** This was fixed by repairing the query runner's `RETURNING` handling; if it recurs, confirm you're on the current build (`docker compose up -d --build`).

---

**Developed by MAT Solutions.**
_Flash-Drive Portable Edition._
