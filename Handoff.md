# Project Antigravity — Handoff Notes

This document records the state of the repo after the flash-drive hardening pass prescribed by [`PLAN.md`](PLAN.md). It is intended for whoever next touches this code.

---

## Current state

- Single supported runtime: `docker compose up -d --build --wait` from the repo root, driven by any of `Antigravity.command`, `Antigravity.bat`, `start.sh`, or `setup.sh`.
- Persistence: SQLite at `./data/antigravity.db`, mounted into the container via `docker-compose.yml`. No Postgres, no `DATABASE_URL`, no path override.
- Runtime config: `.env` at the repo root, generated from the committed `.env.example` on first launch. No other env file is read.
- Image: single-stage from `node:18-bookworm`, built via `npm install --omit=dev`, with Playwright Chromium installed inside the image. `.dockerignore` keeps host state out.
- Frontend: static assets served by Express, system-font stack only (no CDN calls), hunt list refreshes immediately after create/toggle.
- Healthcheck: `GET /api/v1/status/health` returns `{"ok":true}`. Compose polls it via Node's global `fetch()` — no host `curl` required.

---

## Blockers found (and mapped to PLAN.md)

| PLAN.md requirement | Blocker found | Fix applied |
|---|---|---|
| Committed `.env.example` as the sole template (§9) | Only `.env.docker` + a stale `backend/.env.example` existed | Added `.env.example`, removed both stale files |
| Query runner detects SELECT / WITH / RETURNING (§18) | Runner only detected `startsWith('SELECT')`, so every `INSERT ... RETURNING *` returned `rows: []`. This is why hunt create/update/toggle appeared broken. | Rewrote `isSelect`/`isRead` logic in `backend/src/config/database.js` to also match `WITH` and any `\bRETURNING\b`. |
| Centralized path source (§14) | `env.js` defined `dataDir` but `database.js` recomputed its own path | Exposed `env.dbPath`; `database.js` now consumes it directly |
| Health endpoint (§11) | `/api/v1/status/health` did not exist | Added in `backend/src/api/routes/status.js` above the catch-all subroutes |
| `.dockerignore` (§15) | File absent — Docker would have copied `.git`, host env files, host `node_modules`, `data/` into the image | Added comprehensive `.dockerignore` |
| Compose hygiene (§16) | Hardcoded `container_name`, hardcoded `3000:3000`, no healthcheck | Rewrote `docker-compose.yml`: dropped `container_name`, parameterized host port as `${APP_PORT:-3000}:3000`, added Node-fetch healthcheck, switched to `env_file: .env` |
| Unified launchers (§17) | `.command`, `.bat`, `start.sh` each did something different; none used `--build --wait`; `.bat` preferred the legacy `docker-compose` binary | All four scripts now verify Docker + Compose v2, create `.env`/`data/`, run `docker compose up -d --build --wait`, discover the published URL via `docker compose port`, and print the same stop/reset guidance |
| Google Fonts removed (§19) | `frontend/index.html` pulled Inter + JetBrains Mono from `fonts.googleapis.com` / `fonts.gstatic.com` | Removed the `<link>` tags; `--font-ui` / `--font-mono` now resolve to pure system stacks |
| Dead `loadHunts()` call (§19) | `app.js:266` called an undefined `loadHunts()` → `ReferenceError`, preventing toggle feedback | Defined `loadHunts()` to fetch `/api/v1/hunts` and re-render; also wired into the create path |
| Postgres remnants (§20) | Root `package.json` had `pg` dep; `backend/src/db/migrations/001_initial_schema.sql` used `TIMESTAMPTZ` / `uuid-ossp`; `backend/src/db/seeds/default_hunts.sql` used PG `ARRAY[...]`; `stop.sh` had a pgdata comment | Removed `pg` from root `package.json`, deleted the unreferenced migration and seed files, rewrote `stop.sh` |

---

## Fixes applied — file-by-file

### Created
- `.env.example` — committed runtime template (portable keys only; no `DB_*`).
- `.dockerignore` — excludes `.git`, `.env*` (except the example), `**/node_modules`, `data/`, logs, launcher scripts, docs.
- `Handoff.md` — this file.

### Rewritten
- `Dockerfile` — single `WORKDIR /app/backend`, `npm install --omit=dev`, signal-clean `CMD ["node","server.js"]`.
- `docker-compose.yml` — single `antigravity` service, `${APP_PORT:-3000}:3000`, `env_file: .env`, Node-fetch healthcheck.
- `Antigravity.command`, `Antigravity.bat`, `start.sh`, `stop.sh`, `setup.sh` — unified bootstrap.
- `README.md` — reflects the actual supported flow.

### Edited
- `backend/src/config/env.js` — replaced the legacy Postgres mapping block with a `dbPath` derived from `dataDir`; `dataDir` no longer honors a `DATA_DIR` env override (Assumption 2).
- `backend/src/config/database.js` — consumes `env.dbPath`; query runner now detects `SELECT` / `WITH` / `RETURNING`.
- `backend/src/api/routes/status.js` — added `router.get('/health', …)` before parameterized subroutes so it does not get shadowed.
- `frontend/index.html` — removed Google Fonts preconnect + stylesheet links.
- `frontend/css/styles.css` — `--font-ui` / `--font-mono` set to system stacks.
- `frontend/js/app.js` — implemented `loadHunts()`; called from the hunt-create success path too.
- `.gitignore` — now ignores `.env`, `backend/.env`, and `data/`.
- `package.json` (root) — dropped `pg`, added `better-sqlite3` for parity with backend.

### Deleted
- `.env.docker` — superseded by `.env.example`.
- `backend/.env.example` — duplicate template; root is the only source.
- `backend/src/db/migrations/001_initial_schema.sql` — Postgres-only; `backend/src/db/init.js` `INITIAL_SCHEMA` is authoritative.
- `backend/src/db/seeds/default_hunts.sql` — unreferenced and used PG `ARRAY[]` syntax; `init.js` already seeds the default hunt.

### Untracked (but preserved on disk per PLAN Assumption 3)
- `backend/.env` — `git rm --cached`'d so the local dev copy is no longer tracked. The runtime never reads it.

---

## Verification performed

### Static validation (passed)

```bash
node --check backend/src/config/env.js
node --check backend/src/config/database.js
node --check backend/src/api/routes/status.js
node --check frontend/js/app.js
bash -n Antigravity.command start.sh stop.sh setup.sh
docker compose config          # single service, ${APP_PORT:-3000}:3000, env from ./.env, healthcheck wired
```

All passed. `docker compose config` output shows no `container_name`, `env_file: .env` resolved, and the Node-fetch healthcheck intact.

### Runtime verification (passed — against a fresh SQLite install, outside Docker)

With a fresh `rm -rf data && node backend/server.js`:

| Check | Result |
|---|---|
| Schema + default hunt auto-bootstrap | ✓ `Tacoma Access Cab Hunt` seeded, indexes created |
| `GET /api/v1/status/health` | ✓ `{"ok":true}` HTTP 200 (5 ms) |
| `GET /api/v1/status` | ✓ returns aggregate counts |
| `GET /api/v1/hunts` | ✓ returns the default hunt |
| `POST /api/v1/hunts` (**exercises `INSERT … RETURNING *`**) | ✓ returns the full created row — previously returned `{}` because the query runner only detected `SELECT` |
| `PATCH /api/v1/hunts/:id` (**exercises `UPDATE … RETURNING *`**) | ✓ returns the updated row with new `is_active` value |
| SQLite file location | ✓ `./data/antigravity.db` + `-wal` / `-shm` sidecars, as required |
| Graceful shutdown | ✓ SIGTERM closes the DB cleanly |

The RETURNING fix is the single change that unblocks hunt/lot writes end-to-end. Before: `POST /hunts` succeeded but `data` was empty, so the UI had nothing to render. After: every RETURNING-bearing write yields its row.

### Docker build

`docker compose build` hit the `failed to solve: write /var/lib/desktop-containerd/...: input/output error` bug PLAN §30 anticipated. This is a Docker Desktop overlayfs issue, not a repo-code failure. The fix, per PLAN, is: restart Docker Desktop and retry. The repo's Dockerfile, `.dockerignore`, and Compose file are validated statically; retry on a healthy daemon is expected to succeed.

### What still needs a healthy-daemon retry

Run these on a host where `docker compose build` succeeds:

```bash
docker compose build                                      # produce the image
docker run --rm --entrypoint sh scraper-antigravity -c \
  'test ! -e /app/.git && test ! -e /app/.env && test ! -e /app/backend/node_modules/.cache && echo image-clean-ok'
docker compose up -d --build --wait                       # --wait blocks until healthcheck passes
curl -fsS http://localhost:3000/api/v1/status/health      # {"ok":true}
# Load http://localhost:${APP_PORT:-3000} in a browser, check DevTools Network tab: no fonts.googleapis.com / fonts.gstatic.com requests.
docker compose down && docker compose up -d --wait         # confirm hunts survive
```

---

## Remaining risks

- **Docker Desktop overlayfs export bug** (PLAN §30). If `docker compose build` fails with `input/output error` during image export, that is a daemon-level issue. Restart Docker Desktop and retry. There is no code fix on our side.
- **No committed `package-lock.json`.** The runtime `npm install --omit=dev` is deterministic enough for the current dep set, but future upgrades of transitive dependencies will not be reproducible across builds. If stricter reproducibility becomes a requirement, commit a lockfile and switch the Dockerfile to `npm ci --omit=dev`.
- **Playwright browser cache lives inside the image**, so first-run `docker compose build` is slow. Subsequent rebuilds reuse Docker layer caching unless `backend/package.json` changes.
- **`APP_PORT` override is read at `docker compose up` time.** Changing it requires `docker compose down && docker compose up -d` to take effect; the healthcheck inside the container always targets `3000` (the internal port), so the host-side port remap does not affect readiness.
- **SQLite concurrency** is tuned with WAL + `synchronous = NORMAL` + foreign keys on. This is fine for the single-writer cron + dashboard-reader workload; it is not a substitute for a server-grade RDBMS if concurrent writers are added later.
- **Twilio credentials in `.env`** are stored in plain text on the drive. Users handing the drive around should be aware.

---

## Out of scope (intentionally not done)

Per PLAN.md, the following were not touched:

- Scrape pipeline, cron scheduler, or Twilio wiring.
- Schema or default-hunt content.
- Multi-service Compose, dev/prod splits, or DB path overrides.
- A backwards-compat shim for `.env.docker` — PLAN §9 says **retire**, so it is gone.
