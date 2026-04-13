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
    `SELECT * FROM hunts WHERE is_active = true ORDER BY id`
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
  const result = await query(`SELECT * FROM hunts WHERE id = $1`, [id]);
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
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      hunt.name,
      (hunt.make || '').toUpperCase().trim(),
      (hunt.model || '').toUpperCase().trim(),
      hunt.year_min || null,
      hunt.year_max || null,
      hunt.body_style ? hunt.body_style.toUpperCase().trim() : null,
      hunt.keywords || [],
      hunt.max_bid || null,
      hunt.is_active !== false,
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
  let paramIndex = 1;

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
      fields.push(`${field} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (fields.length === 0) return getHuntById(id);

  fields.push(`updated_at = NOW() AT TIME ZONE 'UTC'`);
  values.push(id);

  const result = await query(
    `UPDATE hunts SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
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
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
     ON CONFLICT (lot_number) DO UPDATE SET
       hunt_id          = COALESCE(EXCLUDED.hunt_id, lots.hunt_id),
       title            = COALESCE(EXCLUDED.title, lots.title),
       current_bid      = EXCLUDED.current_bid,
       buy_now_price    = EXCLUDED.buy_now_price,
       sale_date        = COALESCE(EXCLUDED.sale_date, lots.sale_date),
       raw_data         = EXCLUDED.raw_data,
       match_confidence = GREATEST(EXCLUDED.match_confidence, lots.match_confidence),
       parser_version   = EXCLUDED.parser_version,
       last_seen        = NOW() AT TIME ZONE 'UTC',
       -- Only upgrade status, never downgrade
       status = CASE
         WHEN EXCLUDED.match_confidence > lots.match_confidence THEN EXCLUDED.status
         ELSE lots.status
       END
     RETURNING *,
       (xmax = 0) AS is_new`,
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
      lot.raw_data || {},
      lot.match_confidence || 0,
      lot.parser_version || '1.0.0',
      lot.status || LOT_STATUS.NEW,
    ]
  );

  const row = result.rows[0];
  return { row, isNew: row.is_new };
}

/**
 * Get lots with optional filtering and pagination.
 * @param {Object} options - { status, hunt_id, limit, offset }
 * @returns {Promise<Array>}
 */
async function getLots({ status, hunt_id, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }
  if (hunt_id) {
    conditions.push(`hunt_id = $${paramIndex++}`);
    params.push(hunt_id);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const result = await query(
    `SELECT * FROM lots ${where} ORDER BY first_seen DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
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
    `SELECT * FROM lots WHERE lot_number = $1`,
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
    `UPDATE lots SET status = $1, last_seen = NOW() AT TIME ZONE 'UTC' WHERE id = $2 RETURNING *`,
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
    `SELECT buy_now_price FROM lots WHERE lot_number = $1`,
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
     WHERE lot_id = $1 AND hunt_id = $2 AND recipient = $3
       AND channel = $4 AND trigger_fingerprint = $5`,
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
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
     SET status = COALESCE($1, status),
         message_sid = COALESCE($2, message_sid),
         retry_count = COALESCE($3, retry_count),
         error_code = $4,
         error_message = $5,
         sent_at = CASE WHEN $1 = 'sent' THEN NOW() AT TIME ZONE 'UTC' ELSE sent_at END
     WHERE id = $6
     RETURNING *`,
    [
      updates.status || null,
      updates.message_sid || null,
      updates.retry_count !== undefined ? updates.retry_count : null,
      updates.error_code || null,
      updates.error_message || null,
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
  let paramIndex = 1;

  if (status) {
    conditions.push(`a.status = $${paramIndex++}`);
    params.push(status);
  }
  if (lot_id) {
    conditions.push(`a.lot_id = $${paramIndex++}`);
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
     LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
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
     VALUES ($1, $2, $3, $4)
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
     SET finished_at = NOW() AT TIME ZONE 'UTC',
         status = $1,
         lots_found = $2,
         new_lots = $3,
         matches_found = $4,
         alerts_sent = $5,
         alerts_suppressed = $6,
         error_code = $7,
         error_message = $8,
         block_reason = $9,
         duration_ms = $10,
         metadata = $11
     WHERE run_id = $12
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
      results.metadata || {},
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
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex++}`);
    params.push(status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const result = await query(
    `SELECT * FROM scrape_logs ${where} ORDER BY started_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    params
  );
  return result.rows;
}

/**
 * Get the latest scrape log for each status type (for dashboard).
 * @returns {Promise<Object>} { lastSuccess, lastFailed, lastBlocked }
 */
async function getLatestRunsByStatus() {
  const result = await query(
    `SELECT DISTINCT ON (status) *
     FROM scrape_logs
     WHERE status IN ('success', 'failed', 'blocked', 'partial')
     ORDER BY status, started_at DESC`
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
    `DELETE FROM job_locks WHERE lock_name = $1 AND expires_at < NOW() AT TIME ZONE 'UTC'`,
    [lockName]
  );

  try {
    await query(
      `INSERT INTO job_locks (lock_name, locked_by, locked_at, expires_at, run_id)
       VALUES ($1, $2, NOW() AT TIME ZONE 'UTC', (NOW() AT TIME ZONE 'UTC') + ($3 || ' milliseconds')::INTERVAL, $4)`,
      [lockName, lockedBy, ttlMs.toString(), runId]
    );
    return true;
  } catch (err) {
    // Unique constraint violation = lock already held
    if (err.code === '23505') {
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
    `DELETE FROM job_locks WHERE lock_name = $1 AND run_id = $2`,
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
    `SELECT * FROM job_locks WHERE lock_name = $1 AND expires_at > NOW() AT TIME ZONE 'UTC'`,
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
    query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active) as active FROM hunts`),
    query(`SELECT
             COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'new') as new_count,
             COUNT(*) FILTER (WHERE status = 'matched') as matched_count,
             COUNT(*) FILTER (WHERE status = 'alerted') as alerted_count,
             COUNT(*) FILTER (WHERE status = 'sold') as sold_count
           FROM lots`),
    query(`SELECT
             COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'sent' OR status = 'delivered') as sent_count,
             COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
             COUNT(*) FILTER (WHERE status = 'suppressed') as suppressed_count
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
