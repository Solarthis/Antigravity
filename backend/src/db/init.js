/**
 * PROJECT ANTIGRAVITY — SQLite Initialization
 * Automated schema creation and default seeding.
 */
const { join } = require('path');
const fs = require('fs');

const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS hunts (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    make          TEXT NOT NULL,
    model         TEXT NOT NULL,
    year_min      INTEGER,
    year_max      INTEGER,
    body_style    TEXT,
    keywords      TEXT DEFAULT '[]',
    max_bid       REAL,
    is_active     INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lots (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_number    TEXT UNIQUE NOT NULL,
    hunt_id       INTEGER REFERENCES hunts(id) ON DELETE SET NULL,
    title         TEXT,
    year          INTEGER,
    make          TEXT,
    model         TEXT,
    body_style    TEXT,
    damage_type   TEXT,
    location      TEXT,
    sale_date     TEXT,
    current_bid   REAL,
    buy_now_price REAL,
    odometer      INTEGER,
    drive_type    TEXT,
    fuel_type     TEXT,
    engine        TEXT,
    color         TEXT,
    image_url     TEXT,
    lot_url       TEXT,
    raw_data      TEXT DEFAULT '{}',
    match_confidence  REAL DEFAULT 0.00,
    parser_version    TEXT DEFAULT '1.0.0',
    status        TEXT NOT NULL DEFAULT 'new',
    first_seen    TEXT DEFAULT (datetime('now')),
    last_seen     TEXT DEFAULT (datetime('now')),
    created_at    TEXT DEFAULT (datetime('now')),
    CHECK (status IN ('new', 'matched', 'alerted', 'sold', 'expired', 'suppressed'))
);

CREATE TABLE IF NOT EXISTS alerts (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    lot_id                INTEGER REFERENCES lots(id) ON DELETE CASCADE,
    hunt_id               INTEGER REFERENCES hunts(id) ON DELETE SET NULL,
    channel               TEXT NOT NULL,
    recipient             TEXT NOT NULL,
    message_sid           TEXT,
    trigger_fingerprint   TEXT NOT NULL,
    priority              TEXT NOT NULL DEFAULT 'normal',
    status                TEXT NOT NULL DEFAULT 'pending',
    retry_count           INTEGER DEFAULT 0,
    error_code            TEXT,
    error_message         TEXT,
    sent_at               TEXT DEFAULT (datetime('now')),
    UNIQUE (lot_id, hunt_id, recipient, channel, trigger_fingerprint),
    CHECK (channel IN ('whatsapp', 'sms')),
    CHECK (priority IN ('normal', 'high')),
    CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'suppressed'))
);

CREATE TABLE IF NOT EXISTS scrape_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id          TEXT NOT NULL,
    hunt_id         INTEGER REFERENCES hunts(id) ON DELETE SET NULL,
    started_at      TEXT DEFAULT (datetime('now')),
    finished_at     TEXT,
    status          TEXT NOT NULL DEFAULT 'running',
    lots_found      INTEGER DEFAULT 0,
    new_lots        INTEGER DEFAULT 0,
    matches_found   INTEGER DEFAULT 0,
    alerts_sent     INTEGER DEFAULT 0,
    alerts_suppressed INTEGER DEFAULT 0,
    error_code      TEXT,
    error_message   TEXT,
    block_reason    TEXT,
    duration_ms     INTEGER,
    parser_version  TEXT,
    metadata        TEXT DEFAULT '{}',
    CHECK (status IN ('running', 'success', 'failed', 'blocked', 'partial'))
);

CREATE TABLE IF NOT EXISTS job_locks (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    lock_name       TEXT UNIQUE NOT NULL,
    locked_by       TEXT,
    locked_at       TEXT DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL,
    run_id          TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lots_lot_number      ON lots(lot_number);
CREATE INDEX IF NOT EXISTS idx_lots_status           ON lots(status);
CREATE INDEX IF NOT EXISTS idx_lots_hunt_id          ON lots(hunt_id);
CREATE INDEX IF NOT EXISTS idx_alerts_lot_id         ON alerts(lot_id);
CREATE INDEX IF NOT EXISTS idx_scrape_logs_run_id    ON scrape_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_job_locks_name        ON job_locks(lock_name);
`;

const DEFAULT_SEEDS = [
  {
    sql: `
      INSERT INTO hunts (name, make, model, year_min, year_max, body_style, keywords, max_bid, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING;
    `,
    params: [
      'Tacoma Access Cab Hunt',
      'TOYOTA',
      'TACOMA',
      2012,
      2015,
      'ACCESS CAB',
      JSON.stringify(['access', 'ext cab', 'extended', 'extra cab']),
      15000.00,
      1
    ]
  }
];

function initializeSchema(db) {
  console.log('[DB] Ensuring schema is up to date...');
  db.exec(INITIAL_SCHEMA);
  
  const huntCount = db.prepare('SELECT COUNT(*) as count FROM hunts').get().count;
  if (huntCount === 0) {
    console.log('[DB] Seeding default hunts...');
    const insert = db.prepare(DEFAULT_SEEDS[0].sql);
    insert.run(...DEFAULT_SEEDS[0].params);
  }
}

module.exports = {
  initializeSchema
};
