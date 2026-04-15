# Flash-Drive Docker Appliance Hardening

**Summary**
- Convert the repo to one supported runtime flow: launcher creates repo-root `.env` from a committed root template, Docker Compose reads that config, the app stores SQLite only under repo-root `./data`, and backend startup auto-creates schema plus default bootstrap data.
- Finish the existing SQLite/portability migration rather than restarting it: keep the current single-service Docker direction, but remove the remaining split-config, Postgres-era, and launcher/runtime mismatches that still break first-run portability.
- Rewrite the README to match the verified Docker-only flow and add a concise repo-root `Handoff.md` that records current state, blockers found, fixes made, verification performed, and remaining risks.

**Interfaces**
- Introduce a committed root env template as `.env.example` and make generated root `.env` the only supported runtime config file; retire `.env.docker`, `.env.docker.local`, and `backend/.env` from the supported flow.
- Define the user-facing root `.env` contract around portable settings only: `APP_PORT` for host binding, Twilio credentials/recipients, cron/scraper tuning, and matching threshold; remove `DB_*` settings entirely from supported docs and templates.
- Add a lightweight readiness endpoint at `GET /api/v1/status/health` for Docker healthchecks and launcher wait logic; keep the existing richer status/dashboard endpoints unchanged for UI use.

**Implementation Changes**
- Centralize backend path resolution so config loading targets repo-root `.env` and persistence always targets repo-root `./data/antigravity.db`; have database/bootstrap code consume that shared path source instead of hardcoding its own path, and do not read ignored local `backend/.env`.
- Make Docker packaging actually portable: add a real `.dockerignore` that excludes `.git`, all local env files except the committed template, both root and backend `node_modules`, `data/`, logs, and OS clutter; tighten the Dockerfile to copy only runtime files and switch install to a reproducible production install path.
- Simplify Compose to a single portable service: remove `container_name`, replace fixed host port mapping with `${APP_PORT:-3000}:3000`, mount `./data:/app/data`, wire in the root `.env`, and add a healthcheck that uses Node 18 `fetch()` against the new health endpoint so no host `curl` is required.
- Unify the launch surface across `Antigravity.command`, `Antigravity.bat`, `start.sh`, `stop.sh`, and `setup.sh`: every start path should verify Docker/Compose v2, create `.env` and `data/` if missing, run `docker compose up -d --build --wait`, discover the published URL from Compose, open the app, and print the same stop/restart guidance using `docker compose` only.
- Fix the SQLite query compatibility gap by making the shared query runner detect row-returning statements such as `SELECT`, `WITH`, and any statement containing `RETURNING`, using row-fetch APIs for those cases and `run()` only for non-returning writes; this is what unblocks hunt create/update/toggle and other SQLite write paths.
- Remove the remaining frontend portability regressions: replace Google Fonts with a local/system font stack, and replace the dead `loadHunts()` call with an immediate post-mutation refresh path so create/toggle updates the UI without waiting 30 seconds or throwing a runtime error.
- Clean up stale Postgres references in docs, comments, migration notes, and scripts so the repo surface consistently describes SQLite-on-drive persistence and Docker-only startup; keep ignored user-local files in place, but ensure they are neither read nor copied into the image.

**Test Plan**
- Run `docker compose config` after bootstrap and confirm Compose resolves the single-service config from generated root `.env`.
- Run `docker compose build` and then inspect the built image/container filesystem to confirm no host env files or host `node_modules` were copied into the runtime image.
- Delete repo-root `.env` and `data/`, then run the launcher flow from scratch and confirm it recreates `.env`, recreates `data/`, waits for health, and starts successfully from a blank portable folder.
- Verify SQLite persistence by confirming `./data/antigravity.db` is created under the repo root, allowing for `-wal` and `-shm` sidecars while the app is running, and confirm hunts survive stop/start.
- Verify the dashboard has no external font dependency by checking the served frontend and runtime network activity for absence of `fonts.googleapis.com` and `fonts.gstatic.com`.
- Verify hunt create/toggle end to end in the dashboard: create a hunt, confirm it appears immediately, toggle active state, confirm no JS/runtime error occurs, and confirm the updated state persists after page refresh and service restart.
- Update README and `Handoff.md` only after the above checks so the documentation reflects the verified behavior, not the intended behavior.
- If `docker compose build` repeats the currently observed Docker Desktop overlayfs `input/output error` during image export, treat that as a host Docker health issue rather than a repo-code failure, restart Docker, and rerun verification on a healthy daemon.

**Assumptions**
- `.env.example` is the committed template and generated root `.env` is the only supported runtime config file.
- SQLite path override is not a supported feature; the only supported persistence target is repo-root `./data/antigravity.db`.
- Existing ignored local files such as `backend/.env` and local dependency folders are preserved but excluded from Docker and ignored by the runtime path.
