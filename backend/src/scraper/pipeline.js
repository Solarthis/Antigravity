// =============================================================================
// PROJECT ANTIGRAVITY — Scrape Pipeline Orchestrator
// =============================================================================
// Full pipeline: Scrape → Validate → Parse → Normalize → Match →
//                Deduplicate → Store → Alert → Log
// Each step fails safely and independently.

const db = require('../db/queries');
const { scrapeCopart } = require('./copart');
const {
  matchLotAgainstHunts,
  generateTriggerFingerprint,
  PARSER_VERSION,
} = require('../services/matchingEngine');
const { processAlert } = require('../notifications/twilio');
const env = require('../config/env');
const {
  SCRAPE_STATUS,
  LOT_STATUS,
  ERROR_CODES,
} = require('../config/constants');

/**
 * Run the full scrape pipeline for ALL active hunts.
 *
 * Pipeline flow:
 * 1. Get active hunts
 * 2. For each hunt: scrape → match → store → alert
 * 3. Aggregate results
 *
 * @param {string} runId - UUID of the current run
 * @returns {Promise<Object>} Pipeline results
 */
async function runScrapePipeline(runId) {
  console.log(`[PIPELINE] Starting pipeline for run ${runId}`);

  const results = {
    status: SCRAPE_STATUS.SUCCESS,
    lotsFound: 0,
    newLots: 0,
    matchesFound: 0,
    alertsSent: 0,
    alertsSuppressed: 0,
    errorCode: null,
    errorMessage: null,
    blockReason: null,
    metadata: { runId, parser_version: PARSER_VERSION, hunts: [] },
  };

  // Step 1: Get active hunts
  let hunts;
  try {
    hunts = await db.getActiveHunts();
  } catch (err) {
    console.error(`[PIPELINE] Failed to load hunts: ${err.message}`);
    results.status = SCRAPE_STATUS.FAILED;
    results.errorCode = ERROR_CODES.DB_ERROR;
    results.errorMessage = `Failed to load hunts: ${err.message}`;
    return results;
  }

  if (hunts.length === 0) {
    console.warn('[PIPELINE] No active hunts found. Nothing to do.');
    results.status = SCRAPE_STATUS.SUCCESS;
    results.metadata.note = 'No active hunts';
    return results;
  }

  console.log(`[PIPELINE] Processing ${hunts.length} active hunt(s).`);

  let wasBlocked = false;
  let hadErrors = false;
  
  const pendingAlerts = [];

  // Step 2: Process each hunt
  for (const hunt of hunts) {
    console.log(`\n[PIPELINE] --- Hunt: ${hunt.name} (${hunt.make} ${hunt.model}) ---`);

    const huntResult = {
      huntId: hunt.id,
      huntName: hunt.name,
      lotsFound: 0,
      newLots: 0,
      matches: 0,
      alertsSent: 0,
      alertsSuppressed: 0,
      status: 'success',
    };

    // Step 2a: Scrape
    let scrapeResult;
    try {
      scrapeResult = await scrapeCopart(hunt);
    } catch (err) {
      console.error(`[PIPELINE] Scrape failed for hunt ${hunt.id}: ${err.message}`);
      huntResult.status = 'failed';
      huntResult.error = err.message;
      hadErrors = true;
      results.metadata.hunts.push(huntResult);
      continue; // Move to next hunt, don't crash pipeline
    }

    // Step 2b: Handle blocked page
    if (scrapeResult.blocked) {
      console.error(`[PIPELINE] Hunt ${hunt.id} was BLOCKED: ${scrapeResult.blockReason}`);
      wasBlocked = true;
      huntResult.status = 'blocked';
      huntResult.blockReason = scrapeResult.blockReason;

      if (scrapeResult.lots.length === 0) {
        results.metadata.hunts.push(huntResult);
        continue; // No data to process
      }
      // If we got partial data before block, process what we have
    }

    const scrapedLots = scrapeResult.lots || [];
    huntResult.lotsFound = scrapedLots.length;
    results.lotsFound += scrapedLots.length;

    if (scrapedLots.length === 0) {
      console.log(`[PIPELINE] No lots found for hunt ${hunt.id}.`);
      results.metadata.hunts.push(huntResult);
      continue;
    }

    // Step 2c: Match, deduplicate, store, alert for each lot
    for (const lot of scrapedLots) {
      try {
        // Match against all hunts (in case a lot matches multiple)
        const matchResult = matchLotAgainstHunts(lot, hunts, env.matchConfidenceThreshold);

        if (!matchResult.matched) continue; // Not a match — skip

        results.matchesFound++;
        huntResult.matches++;

        // Prepare lot for storage
        lot.hunt_id = matchResult.huntId;
        lot.match_confidence = matchResult.confidence;
        lot.status = LOT_STATUS.MATCHED;

        // Step 2d: Check Buy Now state BEFORE upsert so we can compare old vs new.
        // BUG FIX: hasBuyNowChanged must be called before upsertLot; calling it after
        // always returns false because the upsert already wrote the new buy_now_price.
        let buyNowTriggered = false;
        if (
          lot.buy_now_price &&
          hunt.max_bid &&
          parseFloat(lot.buy_now_price) <= parseFloat(hunt.max_bid)
        ) {
          buyNowTriggered = await db.hasBuyNowChanged(lot.lot_number, lot.buy_now_price);
        }

        // Step 2d: Idempotent upsert
        const { row: storedLot, isNew } = await db.upsertLot(lot);

        if (isNew) {
          results.newLots++;
          huntResult.newLots++;
          console.log(
            `[PIPELINE] NEW LOT: #${storedLot.lot_number} — ` +
            `${storedLot.year || '?'} ${storedLot.make} ${storedLot.model} ` +
            `(confidence: ${matchResult.confidence})`
          );
        }

        // Step 2e: Determine alert triggers

        // Trigger 1: New listing alert (covers brand-new lots regardless of buy_now)
        if (isNew && matchResult.confidence >= env.matchConfidenceThreshold) {
          pendingAlerts.push({
            lot: storedLot,
            hunt,
            type: 'new_listing',
            huntResult
          });
        }

        // Trigger 2: Buy Now appeared or changed on an EXISTING lot (priority escalation).
        // We skip new lots here because they are already covered by the new_listing alert above.
        if (!isNew && buyNowTriggered) {
          console.log(
            `[PIPELINE] 🔥 BUY NOW under budget: #${storedLot.lot_number} ` +
            `$${storedLot.buy_now_price} <= $${hunt.max_bid}`
          );
          pendingAlerts.push({
            lot: storedLot,
            hunt,
            type: 'buy_now',
            huntResult
          });
        }

      } catch (err) {
        // Individual lot processing errors should NOT crash the pipeline
        console.error(`[PIPELINE] Error processing lot ${lot.lot_number}: ${err.message}`);
        hadErrors = true;
      }
    }

    results.metadata.hunts.push(huntResult);
  }

  // Step 2.5: Process all collected alerts asynchronously
  if (pendingAlerts.length > 0) {
    console.log(`\n[PIPELINE] Sending ${pendingAlerts.length} pending alerts asynchronously...`);
    const alertPromises = pendingAlerts.map(async (alertTask) => {
      try {
        const alertResult = await processAlert(
          alertTask.lot,
          alertTask.hunt,
          alertTask.type
        );
        results.alertsSent += alertResult.sent;
        results.alertsSuppressed += alertResult.suppressed;
        alertTask.huntResult.alertsSent += alertResult.sent;
        alertTask.huntResult.alertsSuppressed += alertResult.suppressed;

        // Update lot status to ALERTED if alert was sent
        if (alertResult.sent > 0 && alertTask.type === 'new_listing') {
          await db.updateLotStatus(alertTask.lot.id, LOT_STATUS.ALERTED);
        }
      } catch (err) {
        console.error(`[PIPELINE] Failed to send alert for lot ${alertTask.lot.lot_number}: ${err.message}`);
      }
    });
    
    await Promise.allSettled(alertPromises);
  }

  // Step 3: Determine final status
  if (wasBlocked && results.lotsFound === 0) {
    results.status = SCRAPE_STATUS.BLOCKED;
    results.blockReason = results.metadata.hunts
      .filter((h) => h.blockReason)
      .map((h) => h.blockReason)
      .join('; ');
    results.errorCode = ERROR_CODES.BLOCKED_OR_INVALID_PAGE;
  } else if (wasBlocked && results.lotsFound > 0) {
    results.status = SCRAPE_STATUS.PARTIAL;
    results.blockReason = 'Some hunts were blocked but partial data was recovered';
  } else if (hadErrors && results.lotsFound > 0) {
    results.status = SCRAPE_STATUS.PARTIAL;
    results.errorMessage = 'Some lots failed processing';
  } else if (hadErrors && results.lotsFound === 0) {
    results.status = SCRAPE_STATUS.FAILED;
    results.errorCode = ERROR_CODES.UNKNOWN_ERROR;
    results.errorMessage = 'All hunts failed';
  }

  console.log(`\n[PIPELINE] Pipeline complete for run ${runId}:`);
  console.log(`   Status: ${results.status}`);
  console.log(`   Lots: ${results.lotsFound} found, ${results.newLots} new`);
  console.log(`   Matches: ${results.matchesFound}`);
  console.log(`   Alerts: ${results.alertsSent} sent, ${results.alertsSuppressed} suppressed`);

  return results;
}

module.exports = {
  runScrapePipeline,
};
