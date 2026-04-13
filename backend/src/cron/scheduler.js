// =============================================================================
// PROJECT ANTIGRAVITY — Cron Scheduler + Job Locking
// =============================================================================
// Business-hour clusters. DB-based mutex with TTL. No overlapping jobs.
// Auto-releases stale locks. Logs start + end of every run.

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const env = require('../config/env');
const {
  SCRAPE_STATUS,
  ERROR_CODES,
  PARSER_VERSION,
} = require('../config/constants');
const db = require('../db/queries');
const { sendSystemAlert } = require('../notifications/twilio');

const JOB_LOCK_NAME = 'scrape_job';
const PROCESS_ID = `worker_${process.pid}`;

let cronTask = null;
let isShuttingDown = false;

/**
 * Execute a single scrape run with full lifecycle:
 * 1. Acquire DB lock (fail if another job is running)
 * 2. Create scrape log (status: running)
 * 3. Execute the scrape pipeline
 * 4. Finalize log (status: success/failed/blocked)
 * 5. Release DB lock
 *
 * @param {Function} scrapePipeline - async function(runId) => results object
 * @returns {Promise<Object|null>} Run results or null if locked
 */
async function executeRun(scrapePipeline) {
  const runId = uuidv4();
  const startTime = Date.now();

  console.log(`\n${'='.repeat(70)}`);
  console.log(`[SCHEDULER] Starting run: ${runId}`);
  console.log(`[SCHEDULER] Time: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(70)}\n`);

  // Step 1: Acquire lock
  const locked = await db.acquireJobLock(
    JOB_LOCK_NAME,
    PROCESS_ID,
    runId,
    env.jobLockTtlMs
  );

  if (!locked) {
    const existingLock = await db.getJobLock(JOB_LOCK_NAME);
    console.warn(
      `[SCHEDULER] Job locked by ${existingLock?.locked_by || 'unknown'} ` +
      `(expires: ${existingLock?.expires_at || 'unknown'}). Skipping run ${runId}.`
    );
    // Log the skip
    await db.createScrapeLog({
      run_id: runId,
      hunt_id: null,
      parser_version: PARSER_VERSION,
    });
    await db.finalizeScrapeLog(runId, {
      status: SCRAPE_STATUS.FAILED,
      error_code: ERROR_CODES.JOB_LOCKED,
      error_message: `Another job is running (locked by ${existingLock?.locked_by})`,
      duration_ms: Date.now() - startTime,
    });
    return null;
  }

  // Step 2: Create scrape log
  await db.createScrapeLog({
    run_id: runId,
    hunt_id: null,
    parser_version: PARSER_VERSION,
  });

  let results = null;

  try {
    // Step 3: Execute pipeline
    results = await scrapePipeline(runId);

    // Step 4: Finalize log
    await db.finalizeScrapeLog(runId, {
      status: results.status || SCRAPE_STATUS.SUCCESS,
      lots_found: results.lotsFound || 0,
      new_lots: results.newLots || 0,
      matches_found: results.matchesFound || 0,
      alerts_sent: results.alertsSent || 0,
      alerts_suppressed: results.alertsSuppressed || 0,
      error_code: results.errorCode || null,
      error_message: results.errorMessage || null,
      block_reason: results.blockReason || null,
      duration_ms: Date.now() - startTime,
      metadata: results.metadata || {},
    });

    const emoji = results.status === SCRAPE_STATUS.SUCCESS ? '✅' :
                  results.status === SCRAPE_STATUS.BLOCKED ? '🚫' :
                  results.status === SCRAPE_STATUS.PARTIAL ? '⚠️' : '❌';

    console.log(`\n${emoji} [SCHEDULER] Run ${runId} completed: ${results.status}`);
    console.log(`   Lots found: ${results.lotsFound || 0}`);
    console.log(`   New lots: ${results.newLots || 0}`);
    console.log(`   Matches: ${results.matchesFound || 0}`);
    console.log(`   Alerts sent: ${results.alertsSent || 0}`);
    console.log(`   Alerts suppressed: ${results.alertsSuppressed || 0}`);
    console.log(`   Duration: ${Date.now() - startTime}ms\n`);

    // Send system alert on blocked runs
    if (results.status === SCRAPE_STATUS.BLOCKED) {
      await sendSystemAlert(
        results.errorCode || ERROR_CODES.BLOCKED_OR_INVALID_PAGE,
        results.blockReason || 'Scrape was blocked',
        runId
      );
    }
  } catch (err) {
    // Unexpected error — log and alert
    console.error(`[SCHEDULER] Run ${runId} crashed: ${err.message}`);
    console.error(err.stack);

    await db.finalizeScrapeLog(runId, {
      status: SCRAPE_STATUS.FAILED,
      error_code: ERROR_CODES.UNKNOWN_ERROR,
      error_message: err.message,
      duration_ms: Date.now() - startTime,
    });

    // Alert admin
    await sendSystemAlert(ERROR_CODES.UNKNOWN_ERROR, err.message, runId);
  } finally {
    // Step 5: ALWAYS release lock
    const released = await db.releaseJobLock(JOB_LOCK_NAME, runId);
    if (released) {
      console.log(`[SCHEDULER] Lock released for run ${runId}`);
    } else {
      console.warn(`[SCHEDULER] Lock was not held by run ${runId} (may have expired)`);
    }
  }

  return results;
}

/**
 * Start the cron scheduler.
 * @param {Function} scrapePipeline - async function(runId) => results
 */
function startScheduler(scrapePipeline) {
  if (cronTask) {
    console.warn('[SCHEDULER] Scheduler already running. Ignoring start.');
    return;
  }

  const schedule = env.cron.schedule;
  const timezone = env.cron.timezone;

  if (!cron.validate(schedule)) {
    throw new Error(`[SCHEDULER] Invalid cron schedule: ${schedule}`);
  }

  console.log(`[SCHEDULER] Starting with schedule: "${schedule}" (tz: ${timezone})`);

  cronTask = cron.schedule(
    schedule,
    async () => {
      if (isShuttingDown) {
        console.log('[SCHEDULER] Shutting down — skipping scheduled run.');
        return;
      }
      await executeRun(scrapePipeline);
    },
    {
      timezone,
      scheduled: true,
    }
  );

  console.log('[SCHEDULER] Cron scheduler started.');
}

/**
 * Stop the cron scheduler gracefully.
 */
function stopScheduler() {
  isShuttingDown = true;
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
    console.log('[SCHEDULER] Cron scheduler stopped.');
  }
}

/**
 * Manually trigger a single run (for API endpoint).
 * @param {Function} scrapePipeline
 * @returns {Promise<Object|null>}
 */
async function triggerManualRun(scrapePipeline) {
  console.log('[SCHEDULER] Manual run triggered.');
  return executeRun(scrapePipeline);
}

module.exports = {
  startScheduler,
  stopScheduler,
  triggerManualRun,
  executeRun,
};
