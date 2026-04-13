// =============================================================================
// PROJECT ANTIGRAVITY — Twilio Notification Service
// =============================================================================
// WhatsApp (primary) + SMS (fallback). Deduplication before send.
// Retry logic: 3 attempts, exponential backoff. Never sends duplicate alerts.

const env = require('../config/env');
const {
  ALERT_STATUS,
  ALERT_CHANNEL,
  ALERT_PRIORITY,
  ALERT_RETRY,
  ERROR_CODES,
} = require('../config/constants');
const db = require('../db/queries');
const { generateTriggerFingerprint } = require('../services/matchingEngine');
const templates = require('./templates');

let twilioClient = null;

/**
 * Initialize Twilio client (lazy — only when first needed).
 * @returns {Object|null} Twilio client or null if not configured
 */
function getTwilioClient() {
  if (twilioClient) return twilioClient;
  if (!env.isTwilioConfigured()) {
    console.warn('[TWILIO] Credentials not configured. Alerts will be logged only.');
    return null;
  }
  const twilio = require('twilio');
  twilioClient = twilio(env.twilio.accountSid, env.twilio.authToken);
  return twilioClient;
}

/**
 * Send a WhatsApp message via Twilio.
 * @param {string} to - Recipient (whatsapp:+1...)
 * @param {string} body - Message body
 * @returns {Promise<{success: boolean, messageSid?: string, error?: string}>}
 */
async function sendWhatsApp(to, body) {
  const client = getTwilioClient();
  if (!client) {
    console.log(`[TWILIO] (DRY RUN) WhatsApp to ${to}:\n${body}\n`);
    return { success: true, messageSid: `dry_run_${Date.now()}` };
  }

  try {
    const message = await client.messages.create({
      body,
      from: env.twilio.whatsappFrom,
      to,
    });
    return { success: true, messageSid: message.sid };
  } catch (err) {
    console.error(`[TWILIO] WhatsApp send failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Send an SMS message via Twilio.
 * @param {string} to - Recipient (+1...)
 * @param {string} body - Message body
 * @returns {Promise<{success: boolean, messageSid?: string, error?: string}>}
 */
async function sendSMS(to, body) {
  const client = getTwilioClient();
  if (!client) {
    console.log(`[TWILIO] (DRY RUN) SMS to ${to}:\n${body}\n`);
    return { success: true, messageSid: `dry_run_${Date.now()}` };
  }

  try {
    const message = await client.messages.create({
      body,
      from: env.twilio.smsFrom,
      to,
    });
    return { success: true, messageSid: message.sid };
  } catch (err) {
    console.error(`[TWILIO] SMS send failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Send a message with retry logic (exponential backoff).
 * @param {Function} sendFn - sendWhatsApp or sendSMS
 * @param {string} to - Recipient
 * @param {string} body - Message body
 * @returns {Promise<{success: boolean, messageSid?: string, attempts: number, error?: string}>}
 */
async function sendWithRetry(sendFn, to, body) {
  let lastError = null;

  for (let attempt = 1; attempt <= ALERT_RETRY.MAX_ATTEMPTS; attempt++) {
    const result = await sendFn(to, body);

    if (result.success) {
      return { ...result, attempts: attempt };
    }

    lastError = result.error;
    console.warn(
      `[TWILIO] Attempt ${attempt}/${ALERT_RETRY.MAX_ATTEMPTS} failed: ${result.error}`
    );

    if (attempt < ALERT_RETRY.MAX_ATTEMPTS) {
      const delay = ALERT_RETRY.BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[TWILIO] Retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return {
    success: false,
    attempts: ALERT_RETRY.MAX_ATTEMPTS,
    error: lastError,
  };
}

/**
 * Process an alert for a matched lot. Handles:
 * 1. Fingerprint generation
 * 2. Dedup check (DB)
 * 3. Priority detection (Buy Now)
 * 4. Message formatting
 * 5. Send with retry
 * 6. Status tracking (pending → sent/failed)
 *
 * @param {Object} lot - Lot data (from DB, with id)
 * @param {Object} hunt - Hunt configuration (from DB, with id)
 * @param {string} triggerType - 'new_listing' or 'buy_now'
 * @returns {Promise<{sent: number, suppressed: number, failed: number}>}
 */
async function processAlert(lot, hunt, triggerType = 'new_listing') {
  const fingerprint = generateTriggerFingerprint(triggerType, lot);
  const stats = { sent: 0, suppressed: 0, failed: 0 };

  // Determine priority
  const priority =
    triggerType === 'buy_now' ||
    (lot.buy_now_price && hunt.max_bid && parseFloat(lot.buy_now_price) <= parseFloat(hunt.max_bid))
      ? ALERT_PRIORITY.HIGH
      : ALERT_PRIORITY.NORMAL;

  // Format message
  const messageBody =
    priority === ALERT_PRIORITY.HIGH
      ? templates.buyNowAlert(lot, hunt)
      : templates.newListingAlert(lot, hunt, priority);

  // --- Send to all WhatsApp recipients ---
  for (const recipient of env.alerts.whatsappRecipients) {
    const alertResult = await _sendToRecipient({
      lot,
      hunt,
      recipient,
      channel: ALERT_CHANNEL.WHATSAPP,
      fingerprint,
      priority,
      messageBody,
      sendFn: sendWhatsApp,
    });

    stats.sent += alertResult.sent;
    stats.suppressed += alertResult.suppressed;
    stats.failed += alertResult.failed;
  }

  // --- Send to all SMS recipients ---
  for (const recipient of env.alerts.smsRecipients) {
    const alertResult = await _sendToRecipient({
      lot,
      hunt,
      recipient,
      channel: ALERT_CHANNEL.SMS,
      fingerprint,
      priority,
      messageBody,
      sendFn: sendSMS,
    });

    stats.sent += alertResult.sent;
    stats.suppressed += alertResult.suppressed;
    stats.failed += alertResult.failed;
  }

  return stats;
}

/**
 * Internal: Send an alert to a single recipient on a single channel.
 * Handles dedup, DB record creation, and retry.
 */
async function _sendToRecipient({
  lot,
  hunt,
  recipient,
  channel,
  fingerprint,
  priority,
  messageBody,
  sendFn,
}) {
  const stats = { sent: 0, suppressed: 0, failed: 0 };

  // Step 1: Dedup check — does this exact alert already exist?
  const exists = await db.alertExists({
    lot_id: lot.id,
    hunt_id: hunt.id,
    recipient,
    channel,
    trigger_fingerprint: fingerprint,
  });

  if (exists) {
    console.log(
      `[ALERT] Suppressed duplicate: ${channel}→${recipient} lot=${lot.lot_number} fp=${fingerprint}`
    );
    stats.suppressed++;
    return stats;
  }

  // Step 2: Create alert record as PENDING (idempotent via UNIQUE constraint)
  const alertRecord = await db.createAlert({
    lot_id: lot.id,
    hunt_id: hunt.id,
    channel,
    recipient,
    trigger_fingerprint: fingerprint,
    priority,
    status: ALERT_STATUS.PENDING,
  });

  if (!alertRecord) {
    // createAlert returned null → constraint prevented duplicate (race condition safety)
    console.log(`[ALERT] Suppressed (constraint): ${channel}→${recipient} lot=${lot.lot_number}`);
    stats.suppressed++;
    return stats;
  }

  // Step 3: Send with retry
  const sendResult = await sendWithRetry(sendFn, recipient, messageBody);

  // Step 4: Update alert status
  if (sendResult.success) {
    await db.updateAlertStatus(alertRecord.id, {
      status: ALERT_STATUS.SENT,
      message_sid: sendResult.messageSid,
      retry_count: sendResult.attempts - 1,
    });
    console.log(
      `[ALERT] Sent: ${channel}→${recipient} lot=${lot.lot_number} sid=${sendResult.messageSid}`
    );
    stats.sent++;
  } else {
    await db.updateAlertStatus(alertRecord.id, {
      status: ALERT_STATUS.FAILED,
      retry_count: sendResult.attempts,
      error_code: ERROR_CODES.TWILIO_ERROR,
      error_message: sendResult.error,
    });
    console.error(
      `[ALERT] Failed after ${sendResult.attempts} attempts: ${channel}→${recipient} lot=${lot.lot_number}`
    );
    stats.failed++;
  }

  return stats;
}

/**
 * Send a system error alert to the admin recipient.
 * @param {string} errorCode
 * @param {string} errorMessage
 * @param {string} runId
 */
async function sendSystemAlert(errorCode, errorMessage, runId) {
  const adminRecipient = env.alerts.adminRecipient;
  if (!adminRecipient) {
    console.warn('[ALERT] No admin recipient configured. Skipping system alert.');
    return;
  }

  const body = templates.systemErrorAlert(errorCode, errorMessage, runId);

  try {
    if (adminRecipient.startsWith('whatsapp:')) {
      await sendWhatsApp(adminRecipient, body);
    } else {
      await sendSMS(adminRecipient, body);
    }
    console.log(`[ALERT] System alert sent to admin: ${errorCode}`);
  } catch (err) {
    // System alerts failing should not crash anything
    console.error(`[ALERT] Failed to send system alert: ${err.message}`);
  }
}

module.exports = {
  sendWhatsApp,
  sendSMS,
  sendWithRetry,
  processAlert,
  sendSystemAlert,
  getTwilioClient,
};
