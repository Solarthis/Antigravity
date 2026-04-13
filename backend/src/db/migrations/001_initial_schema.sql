-- =============================================================================
-- PROJECT ANTIGRAVITY — Initial Schema Migration
-- =============================================================================
-- Run: psql -U postgres -d antigravity -f 001_initial_schema.sql
-- ALL timestamps stored in UTC (TIMESTAMPTZ).
-- ALL statuses use strict ENUM-like CHECK constraints.

-- ---------------------------------------------------------------------------
-- Extension: UUID support
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Table: hunts — Defines what vehicles to watch for
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hunts (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(255) NOT NULL,
    make          VARCHAR(100) NOT NULL,
    model         VARCHAR(100) NOT NULL,
    year_min      INT,
    year_max      INT,
    body_style    VARCHAR(100),
    keywords      TEXT[] DEFAULT '{}',
    max_bid       DECIMAL(10,2),
    is_active     BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'UTC'),
    updated_at    TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- ---------------------------------------------------------------------------
-- Table: lots — Every scraped listing (lot_number is UNIQUE)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lots (
    id            SERIAL PRIMARY KEY,
    lot_number    VARCHAR(50) UNIQUE NOT NULL,
    hunt_id       INT REFERENCES hunts(id) ON DELETE SET NULL,
    title         VARCHAR(500),
    year          INT,
    make          VARCHAR(100),
    model         VARCHAR(100),
    body_style    VARCHAR(100),
    damage_type   VARCHAR(255),
    location      VARCHAR(255),
    sale_date     TIMESTAMPTZ,
    current_bid   DECIMAL(10,2),
    buy_now_price DECIMAL(10,2),
    odometer      INT,
    drive_type    VARCHAR(50),
    fuel_type     VARCHAR(50),
    engine        VARCHAR(100),
    color         VARCHAR(50),
    image_url     TEXT,
    lot_url       TEXT,
    raw_data      JSONB DEFAULT '{}',
    match_confidence  DECIMAL(3,2) DEFAULT 0.00,
    parser_version    VARCHAR(20) DEFAULT '1.0.0',
    status        VARCHAR(20) NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'matched', 'alerted', 'sold', 'expired', 'suppressed')),
    first_seen    TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'UTC'),
    last_seen     TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'UTC'),
    created_at    TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'UTC')
);

-- ---------------------------------------------------------------------------
-- Table: alerts — Track every notification sent
-- Unique constraint on (lot_id, hunt_id, recipient, channel, trigger_fingerprint)
-- prevents duplicate alerts for the same event.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerts (
    id                    SERIAL PRIMARY KEY,
    lot_id                INT REFERENCES lots(id) ON DELETE CASCADE,
    hunt_id               INT REFERENCES hunts(id) ON DELETE SET NULL,
    channel               VARCHAR(20) NOT NULL
                          CHECK (channel IN ('whatsapp', 'sms')),
    recipient             VARCHAR(100) NOT NULL,
    message_sid           VARCHAR(100),
    trigger_fingerprint   VARCHAR(255) NOT NULL,
    priority              VARCHAR(20) NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('normal', 'high')),
    status                VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'suppressed')),
    retry_count           INT DEFAULT 0,
    error_code            VARCHAR(100),
    error_message         TEXT,
    sent_at               TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'UTC'),

    -- Deduplication: one alert per lot+hunt+recipient+channel+trigger
    CONSTRAINT uq_alert_fingerprint
      UNIQUE (lot_id, hunt_id, recipient, channel, trigger_fingerprint)
);

-- ---------------------------------------------------------------------------
-- Table: scrape_logs — Pipeline observability
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_logs (
    id              SERIAL PRIMARY KEY,
    run_id          UUID NOT NULL DEFAULT uuid_generate_v4(),
    hunt_id         INT REFERENCES hunts(id) ON DELETE SET NULL,
    started_at      TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'UTC'),
    finished_at     TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'success', 'failed', 'blocked', 'partial')),
    lots_found      INT DEFAULT 0,
    new_lots        INT DEFAULT 0,
    matches_found   INT DEFAULT 0,
    alerts_sent     INT DEFAULT 0,
    alerts_suppressed INT DEFAULT 0,
    error_code      VARCHAR(100),
    error_message   TEXT,
    block_reason    TEXT,
    duration_ms     INT,
    parser_version  VARCHAR(20),
    metadata        JSONB DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- Table: job_locks — Mutex for single-job-at-a-time constraint
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_locks (
    id              SERIAL PRIMARY KEY,
    lock_name       VARCHAR(100) UNIQUE NOT NULL,
    locked_by       VARCHAR(255),
    locked_at       TIMESTAMPTZ DEFAULT (NOW() AT TIME ZONE 'UTC'),
    expires_at      TIMESTAMPTZ NOT NULL,
    run_id          UUID
);

-- ---------------------------------------------------------------------------
-- Indexes for query performance
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_lots_lot_number      ON lots(lot_number);
CREATE INDEX IF NOT EXISTS idx_lots_status           ON lots(status);
CREATE INDEX IF NOT EXISTS idx_lots_hunt_id          ON lots(hunt_id);
CREATE INDEX IF NOT EXISTS idx_lots_make_model       ON lots(make, model);
CREATE INDEX IF NOT EXISTS idx_lots_first_seen       ON lots(first_seen);
CREATE INDEX IF NOT EXISTS idx_alerts_lot_id         ON alerts(lot_id);
CREATE INDEX IF NOT EXISTS idx_alerts_hunt_id        ON alerts(hunt_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status         ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_fingerprint    ON alerts(trigger_fingerprint);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_run_id    ON scrape_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_hunt_id   ON scrape_logs(hunt_id);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_status    ON scrape_logs(status);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_started   ON scrape_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_job_locks_name        ON job_locks(lock_name);
CREATE INDEX IF NOT EXISTS idx_job_locks_expires     ON job_locks(expires_at);
