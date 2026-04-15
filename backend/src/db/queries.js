// =============================================================================
// PROJECT ANTIGRAVITY — Database Query Layer
// =============================================================================
// All parameterized queries. Idempotent upserts. Fingerprint dedup.
// Every function treats the DB as unreliable (catches errors, logs clearly).

const { query, transaction } = require('../config/database');
const { LOT_STATUS, ALERT_STATUS, SCRAPE_STATUS } = require('../config/constants');

// ===========================================================================
// HUNTS
// ===========================================================================

/**
 * Get all active hunts.
 * @returns {Promise<Array>} Active hunt configurations
 */
async function getActiveHunts() {
  const result = await query(
    `SELECT * FROM hunts WHERE is_active = 1 ORDER BY id`
  );
  return result.rows;
}

/**
 * Get all hunts (active and inactive).
 * @returns {Promise<Array>}
 */
async function getAllHunts() {
  const result = await query(`SELECT * FROM hunts ORDER BY id`);
  return result.rows;
}

/**
 * Get a single hunt by ID.
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function getHuntById(id) {
  const result = await query(`SELECT * FROM hunts WHERE id = ?`, [id]);
  return result.rows[0] || null;
}

/**
 * Create a new hunt.
 * @param {Object} hunt
 * @returns {Promise<Object>} Created hunt
 */
async function createHunt(hunt) {
  const result = await query(
    `INSERT INTO hunts (name, make, model, year_min, year_max, body_style, keywords, max_bid, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
    [
      hunt.name,
      (hunt.make || '').toUpperCase().trim(),
      (hunt.model || '').toUpperCase().trim(),
      hunt.year_min || null,
      hunt.year_max || null,
      hunt.body_style ? hunt.body_style.toUpperCase().trim() : null,
      JSON.stringify(hunt.keywords || []),
      hunt.max_bid || null,
      hunt.is_active !== false ? 1 : 0,
    ]
  );
  return result.rows[0];
}

/**
 * Update a hunt (partial update).
 * @param {number} id
 * @param {Object} updates
 * @returns {Promise<Object|null>}
 */
async function updateHunt(id, updates) {
  const fields = [];
  const values = [];

  const allowedFields = [
    'name', 'make', 'model', 'year_min', 'year_max',
    'body_style', 'keywords', 'max_bid', 'is_active',
  ];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      let value = updates[field];
      // Normalize text fields
      if (['make', 'model', 'body_style'].includes(field) && typeof value === 'string') {
        value = value.toUpperCase().trim();
      }
      if (field === 'keywords') {
        value = JSON.stringify(value || []);
      }
      if (field === 'is_active') {
        value = value ? 1 : 0;
      }
      fields.push(`${field} = ?`);
      values.push(value);
    }
  }

  if (fields.length === 0) return getHuntById(id);

  fields.push(`updated_at = datetime('now')`);
  values.push(id);

  const result = await query(
    `UPDATE hunts SET ${fields.join(', ')} WHERE id = ? RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

// ===========================================================================
// LOTS — Idempotent upserts
// ===========================================================================

/**
 * Upsert a lot by lot_number. Idempotent.
 * On conflict: updates last_seen, current_bid, buy_now_price, raw_data, status (if meaningful).
 * Does NOT overwrite first_seen or downgrade status.
 *
 * @param {Object} lot - Lot data with lot_number as the unique key
 * @returns {Promise<{row: Object, isNew: boolean}>}
 */
async function upsertLot(lot) {
  const result = await query(
    `INSERT INTO lots (
       lot_number, hunt_id, title, year, make, model, body_style,
       damage_type, location, sale_date, current_bid, buy_now_price,
       odometer, drive_type, fuel_type, engine, color,
       image_url, lot_url, raw_data, match_confidence, parser_version, status
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (lot_number) DO UPDATE SET
       hunt_id          = COALESCE(EXCLUDED.hunt_id, lots.hunt_id),
       title            = COALESCE(EXCLUDED.title, lots.title),
       current_bid      = EXCLUDED.current_bid,
       buy_now_price    = EXCLUDED.buy_now_price,
       sale_date        = COALESCE(EXCLUDED.sale_date, lots.sale_date),
       raw_data         = EXCLUDED.raw_data,
       match_confidence = MAX(EXCLUDED.match_confidence, lots.match_confidence),
       parser_version   = EXCLUDED.parser_version,
       last_seen        = datetime('now'),
       status = CASE
         WHEN EXCLUDED.match_confidence > lots.match_confidence THEN EXCLUDED.status
         ELSE lots.status
       END
     RETURNING *,
       (created_at = last_seen) AS is_new`,
    [
      lot.lot_number,
      lot.hunt_id || null,
      lot.title || null,
      lot.year || null,
      lot.make ? lot.make.toUpperCase().trim() : null,
      lot.model ? lot.model.toUpperCase().trim() : null,
      lot.body_style ? lot.body_style.toUpperCase().trim() : null,
      lot.damage_type || null,
      lot.location || null,
      lot.sale_date || null,
      lot.current_bid || null,
      lot.buy_now_price || null,
      lot.odometer || null,
      lot.drive_type || null,
      lot.fuel_type || null,
      lot.engine || null,
      lot.color || null,
      lot.image_url || null,
      lot.lot_url || null,
      JSON.stringify(lot.raw_data || {}),
      lot.match_confidence || 0,
      lot.parser_version || '1.0.0',
      lot.status || LOT_STATUS.NEW,
    ]
  );

  const row = result.rows[0];
  // Simple heuristic for isNew since SQLite xmax/returning is different
  return { row, isNew: row.is_new === 1 };
}

/**
 * Get lots with optional filtering and pagination.
 * @param {Object} options - { status, hunt_id, limit, offset }
 * @returns {Promise<Array>}
 */
async function getLots({ status, hunt_id, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push(`status = ?`);
    params.push(status);
  }
  if (hunt_id) {
    conditions.push(`hunt_id = ?`);
    params.push(hunt_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const result = await query(
    `SELECT * FROM lots ${where} ORDER BY first_seen DESC LIMIT ? OFFSET ?`,
    params
  );
  return result.rows;
}

/**
 * Get a lot by lot_number.
 * @param {string} lotNumber
 * @returns {Promise<Object|null>}
 */
async function getLotByNumber(lotNumber) {
  const result = await query(
    `SELECT * FROM lots WHERE lot_number = ?`,
    [lotNumber]
  );
  return result.rows[0] || null;
}

/**
 * Update lot status.
 * @param {number} id
 * @param {string} status - Must be a valid LOT_STATUS value
 * @returns {Promise<Object|null>}
 */
async function updateLotStatus(id, status) {
  const validStatuses = Object.values(LOT_STATUS);
  if (!validStatuses.includes(status)) {
    throw new Error(`[DB] Invalid lot status: ${status}. Valid: ${validStatuses.join(', ')}`);
  }
  const result = await query(
    `UPDATE lots SET status = ?, last_seen = datetime('now') WHERE id = ? RETURNING *`,
    [status, id]
  );
  return result.rows[0] || null;
}

/**
 * Check if a Buy Now price has changed for a lot (for priority escalation alerts).
 * @param {string} lotNumber
 * @param {number} newBuyNowPrice
 * @returns {Promise<boolean>} True if buy_now_price is newly set or changed
 */
async function hasBuyNowChanged(lotNumber, newBuyNowPrice) {
  if (!newBuyNowPrice) return false;
  const result = await query(
    `SELECT buy_now_price FROM lots WHERE lot_number = ?`,
    [lotNumber]
  );
  if (result.rows.length === 0) return true; // new lot
  const current = result.rows[0].buy_now_price;
  return current === null || parseFloat(current) !== parseFloat(newBuyNowPrice);
}

// ===========================================================================
// ALERTS — Deduplication via trigger_fingerprint
// ===========================================================================

/**
 * Check if an alert already exists (by fingerprint composite key).
 * @param {Object} params - { lot_id, hunt_id, recipient, channel, trigger_fingerprint }
 * @returns {Promise<boolean>}
 */
async function alertExists({ lot_id, hunt_id, recipient, channel, trigger_fingerprint }) {
  const result = await query(
    `SELECT id FROM alerts
     WHERE lot_id = ? AND hunt_id = ? AND recipient = ?
       AND channel = ? AND trigger_fingerprint = ?`,
    [lot_id, hunt_id, recipient, channel, trigger_fingerprint]
  );
  return result.rows.length > 0;
}

/**
 * Create a new alert record (idempotent via UNIQUE constraint).
 * Returns null if duplicate (suppressed).
 * @param {Object} alert
 * @returns {Promise<Object|null>}
 */
async function createAlert(alert) {
  try {
    const result = await query(
      `INSERT INTO alerts (lot_id, hunt_id, channel, recipient, message_sid,
                           trigger_fingerprint, priority, status, retry_count,
                           error_code, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (lot_id, hunt_id, recipient, channel, trigger_fingerprint)
       DO NOTHING
       RETURNING *`,
      [
        alert.lot_id,
        alert.hunt_id,
        alert.channel,
        alert.recipient,
        alert.message_sid || null,
        alert.trigger_fingerprint,
        alert.priority || 'normal',
        alert.status || ALERT_STATUS.PENDING,
        alert.retry_count || 0,
        alert.error_code || null,
        alert.error_message || null,
      ]
    );
    // If DO NOTHING fired, rows will be empty → duplicate was suppressed
    return result.rows[0] || null;
  } catch (err) {
    console.error('[DB] createAlert error:', err.message);
    throw err;
  }
}

/**
 * Update alert status after send attempt.
 * @param {number} id
 * @param {Object} updates - { status, message_sid, retry_count, error_code, error_message }
 * @returns {Promise<Object|null>}
 */
async function updateAlertStatus(id, updates) {
  const validStatuses = Object.values(ALERT_STATUS);
  if (updates.status && !validStatuses.includes(updates.status)) {
    throw new Error(`[DB] Invalid alert status: ${updates.status}`);
  }
  const result = await query(
    `UPDATE alerts
     SET status = COALESCE(?, status),
         message_sid = COALESCE(?, message_sid),
         retry_count = COALESCE(?, retry_count),
         error_code = ?,
         error_message = ?,
         sent_at = CASE WHEN ? = 'sent' THEN datetime('now') ELSE sent_at END
     WHERE id = ?
     RETURNING *`,
    [
      updates.status || null,
      updates.message_sid || null,
      updates.retry_count !== undefined ? updates.retry_count : null,
      updates.error_code || null,
      updates.error_message || null,
      updates.status || null,
      id,
    ]
  );
  return result.rows[0] || null;
}

/**
 * Get alerts with optional filtering.
 * @param {Object} options - { status, lot_id, limit, offset }
 * @returns {Promise<Array>}
 */
async function getAlerts({ status, lot_id, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push(`a.status = ?`);
    params.push(status);
  }
  if (lot_id) {
    conditions.push(`a.lot_id = ?`);
    params.push(lot_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const result = await query(
    `SELECT a.*, l.lot_number, l.title, l.year, l.make, l.model, h.name as hunt_name
     FROM alerts a
     LEFT JOIN lots l ON a.lot_id = l.id
     LEFT JOIN hunts h ON a.hunt_id = h.id
     ${where}
     ORDER BY a.sent_at DESC
     LIMIT ? OFFSET ?`,
    params
  );
  return result.rows;
}

// ===========================================================================
// SCRAPE LOGS
// ===========================================================================

/**
 * Create a new scrape log entry (marks run as RUNNING).
 * @param {Object} params - { run_id, hunt_id, parser_version }
 * @returns {Promise<Object>}
 */
async function createScrapeLog({ run_id, hunt_id, parser_version }) {
  const result = await query(
    `INSERT INTO scrape_logs (run_id, hunt_id, parser_version, status)
     VALUES (?, ?, ?, ?)
     RETURNING *`,
    [run_id, hunt_id || null, parser_version, SCRAPE_STATUS.RUNNING]
  );
  return result.rows[0];
}

/**
 * Finalize a scrape log entry with results.
 * @param {string} run_id
 * @param {Object} results
 * @returns {Promise<Object|null>}
 */
async function finalizeScrapeLog(run_id, results) {
  const validStatuses = Object.values(SCRAPE_STATUS);
  if (results.status && !validStatuses.includes(results.status)) {
    throw new Error(`[DB] Invalid scrape status: ${results.status}`);
  }

  const result = await query(
    `UPDATE scrape_logs
     SET finished_at = datetime('now'),
         status = ?,
         lots_found = ?,
         new_lots = ?,
         matches_found = ?,
         alerts_sent = ?,
         alerts_suppressed = ?,
         error_code = ?,
         error_message = ?,
         block_reason = ?,
         duration_ms = ?,
         metadata = ?
     WHERE run_id = ?
     RETURNING *`,
    [
      results.status,
      results.lots_found || 0,
      results.new_lots || 0,
      results.matches_found || 0,
      results.alerts_sent || 0,
      results.alerts_suppressed || 0,
      results.error_code || null,
      results.error_message || null,
      results.block_reason || null,
      results.duration_ms || null,
      JSON.stringify(results.metadata || {}),
      run_id,
    ]
  );
  return result.rows[0] || null;
}

/**
 * Get recent scrape logs.
 * @param {Object} options - { status, limit, offset }
 * @returns {Promise<Array>}
 */
async function getScrapeLogs({ status, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];

  if (status) {
    conditions.push(`status = ?`);
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const result = await query(
    `SELECT * FROM scrape_logs ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`,
    params
  );
  return result.rows;
}

/**
 * Get the latest scrape log for each status type (for dashboard).
 * @returns {Promise<Object>} { lastSuccess, lastFailed, lastBlocked }
 */
async function getLatestRunsByStatus() {
  // SQLite version of DISTINCT ON using a subquery grouping
  const result = await query(
    `SELECT * FROM scrape_logs 
     WHERE id IN (
       SELECT MAX(id) FROM scrape_logs 
       WHERE status IN ('success', 'failed', 'blocked', 'partial')
       GROUP BY status
     )`
  );

  const map = {};
  for (const row of result.rows) {
    map[row.status] = row;
  }

  return {
    lastSuccess: map[SCRAPE_STATUS.SUCCESS] || null,
    lastFailed: map[SCRAPE_STATUS.FAILED] || null,
    lastBlocked: map[SCRAPE_STATUS.BLOCKED] || null,
    lastPartial: map[SCRAPE_STATUS.PARTIAL] || null,
  };
}

// ===========================================================================
// JOB LOCKS — Mutex with TTL
// ===========================================================================

/**
 * Attempt to acquire a job lock. Returns true if acquired.
 * Automatically releases stale locks (expired TTL).
 * @param {string} lockName - e.g., 'scrape_job'
 * @param {string} lockedBy - Identifier of the process
 * @param {string} runId - UUID of the current run
 * @param {number} ttlMs - Time-to-live in milliseconds
 * @returns {Promise<boolean>}
 */
async function acquireJobLock(lockName, lockedBy, runId, ttlMs) {
  // First, clean up any expired locks
  await query(
    `DELETE FROM job_locks WHERE lock_name = ? AND expires_at < datetime('now')`,
    [lockName]
  );

  try {
    await query(
      `INSERT INTO job_locks (lock_name, locked_by, locked_at, expires_at, run_id)
       VALUES (?, ?, datetime('now'), datetime('now', '+' || ? || ' milliseconds'), ?)`,
      [lockName, lockedBy, ttlMs.toString(), runId]
    );
    return true;
  } catch (err) {
    // Unique constraint violation = lock already held
    if (err.message.includes('UNIQUE constraint failed')) {
      console.warn(`[LOCK] Job lock '${lockName}' is already held.`);
      return false;
    }
    throw err;
  }
}

/**
 * Release a job lock.
 * @param {string} lockName
 * @param {string} runId - Only release if this run holds it
 * @returns {Promise<boolean>}
 */
async function releaseJobLock(lockName, runId) {
  const result = await query(
    `DELETE FROM job_locks WHERE lock_name = ? AND run_id = ?`,
    [lockName, runId]
  );
  return result.rowCount > 0;
}

/**
 * Check if a lock is currently held.
 * @param {string} lockName
 * @returns {Promise<Object|null>} Lock info or null
 */
async function getJobLock(lockName) {
  const result = await query(
    `SELECT * FROM job_locks WHERE lock_name = ? AND expires_at > datetime('now')`,
    [lockName]
  );
  return result.rows[0] || null;
}

// ===========================================================================
// SYSTEM STATUS (Dashboard)
// ===========================================================================

/**
 * Get aggregate system status for the dashboard.
 * @returns {Promise<Object>}
 */
async function getSystemStatus() {
  const [huntsResult, lotsResult, alertsResult, runsResult, lockResult] = await Promise.all([
    query(`SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active FROM hunts`),
    query(`SELECT
             COUNT(*) as total,
             SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
             SUM(CASE WHEN status = 'matched' THEN 1 ELSE 0 END) as matched_count,
             SUM(CASE WHEN status = 'alerted' THEN 1 ELSE 0 END) as alerted_count,
             SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold_count
           FROM lots`),
    query(`SELECT
             COUNT(*) as total,
             SUM(CASE WHEN status = 'sent' OR status = 'delivered' THEN 1 ELSE 0 END) as sent_count,
             SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
             SUM(CASE WHEN status = 'suppressed' THEN 1 ELSE 0 END) as suppressed_count
           FROM alerts`),
    getLatestRunsByStatus(),
    getJobLock('scrape_job'),
  ]);

  return {
    hunts: huntsResult.rows[0],
    lots: lotsResult.rows[0],
    alerts: alertsResult.rows[0],
    latestRuns: runsResult,
    currentLock: lockResult,
  };
}

module.exports = {
  // Hunts
  getActiveHunts,
  getAllHunts,
  getHuntById,
  createHunt,
  updateHunt,
  // Lots
  upsertLot,
  getLots,
  getLotByNumber,
  updateLotStatus,
  hasBuyNowChanged,
  // Alerts
  alertExists,
  createAlert,
  updateAlertStatus,
  getAlerts,
  // Scrape Logs
  createScrapeLog,
  finalizeScrapeLog,
  getScrapeLogs,
  getLatestRunsByStatus,
  // Job Locks
  acquireJobLock,
  releaseJobLock,
  getJobLock,
  // System
  getSystemStatus,
};
