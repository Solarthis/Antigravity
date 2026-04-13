// =============================================================================
// PROJECT ANTIGRAVITY — Environment Configuration
// =============================================================================
// Loads and validates environment variables. Fails fast on missing required vars.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Validates that all required environment variables are present.
 * Throws immediately on missing required vars — fail fast.
 */
function validateEnv(requiredVars) {
  const missing = requiredVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `[FATAL] Missing required environment variables: ${missing.join(', ')}`
    );
  }
}

// Only DB vars are truly required at startup. Twilio vars are checked at send time.
validateEnv(['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER']);

const env = {
  // --- Database ---
  db: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD || '',
    max: parseInt(process.env.DB_MAX_POOL || '10', 10),
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
  },

  // --- Twilio ---
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    whatsappFrom: process.env.TWILIO_WHATSAPP_FROM || '',
    smsFrom: process.env.TWILIO_SMS_FROM || '',
  },

  // --- Alert Recipients ---
  alerts: {
    whatsappRecipients: (process.env.ALERT_RECIPIENTS_WHATSAPP || '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    smsRecipients: (process.env.ALERT_RECIPIENTS_SMS || '')
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean),
    adminRecipient: process.env.ADMIN_ALERT_RECIPIENT || '',
  },

  // --- Scraper ---
  scraper: {
    baseUrl: process.env.COPART_BASE_URL || 'https://www.copart.com',
    headless: process.env.SCRAPE_HEADLESS !== 'false',
    delayMinMs: parseInt(process.env.SCRAPE_DELAY_MIN_MS || '2000', 10),
    delayMaxMs: parseInt(process.env.SCRAPE_DELAY_MAX_MS || '8000', 10),
    pageTimeoutMs: parseInt(process.env.SCRAPE_PAGE_TIMEOUT_MS || '30000', 10),
    maxPages: parseInt(process.env.SCRAPE_MAX_PAGES || '10', 10),
  },

  // --- Cron ---
  cron: {
    schedule: process.env.CRON_SCHEDULE || '*/30 7-21 * * 1-6',
    timezone: process.env.CRON_TIMEZONE || 'America/New_York',
  },

  // --- Job Lock ---
  jobLockTtlMs: parseInt(process.env.JOB_LOCK_TTL_MS || '300000', 10),

  // --- Matching ---
  matchConfidenceThreshold: parseFloat(process.env.MATCH_CONFIDENCE_THRESHOLD || '0.6'),

  // --- Server ---
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  /** Returns true if Twilio credentials are configured */
  isTwilioConfigured() {
    return !!(this.twilio.accountSid && this.twilio.authToken);
  },
};

module.exports = env;
