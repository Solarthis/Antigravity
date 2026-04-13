// =============================================================================
// PROJECT ANTIGRAVITY — Constants
// =============================================================================
// All ENUM-like status values and system constants.
// NO free-text statuses allowed anywhere in the system.

// ---------------------------------------------------------------------------
// Status Enums (STRICT — no other values permitted)
// ---------------------------------------------------------------------------

/** @enum {string} Lot lifecycle statuses */
const LOT_STATUS = Object.freeze({
  NEW: 'new',
  MATCHED: 'matched',
  ALERTED: 'alerted',
  SOLD: 'sold',
  EXPIRED: 'expired',
  SUPPRESSED: 'suppressed',
});

/** @enum {string} Alert lifecycle statuses */
const ALERT_STATUS = Object.freeze({
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  SUPPRESSED: 'suppressed',
});

/** @enum {string} Scrape run statuses */
const SCRAPE_STATUS = Object.freeze({
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILED: 'failed',
  BLOCKED: 'blocked',
  PARTIAL: 'partial',
});

/** @enum {string} Alert channels */
const ALERT_CHANNEL = Object.freeze({
  WHATSAPP: 'whatsapp',
  SMS: 'sms',
});

/** @enum {string} Alert priority levels */
const ALERT_PRIORITY = Object.freeze({
  NORMAL: 'normal',
  HIGH: 'high',
});

// ---------------------------------------------------------------------------
// Error Codes (machine-readable)
// ---------------------------------------------------------------------------

const ERROR_CODES = Object.freeze({
  BLOCKED_OR_INVALID_PAGE: 'BLOCKED_OR_INVALID_PAGE',
  CAPTCHA_DETECTED: 'CAPTCHA_DETECTED',
  HTTP_403: 'HTTP_403',
  HTTP_429: 'HTTP_429',
  MISSING_RESULTS_TABLE: 'MISSING_RESULTS_TABLE',
  UNEXPECTED_DOM: 'UNEXPECTED_DOM',
  BROWSER_CRASH: 'BROWSER_CRASH',
  BROWSER_TIMEOUT: 'BROWSER_TIMEOUT',
  NAVIGATION_FAILED: 'NAVIGATION_FAILED',
  PARSE_ERROR: 'PARSE_ERROR',
  DB_ERROR: 'DB_ERROR',
  TWILIO_ERROR: 'TWILIO_ERROR',
  JOB_LOCKED: 'JOB_LOCKED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
});

// ---------------------------------------------------------------------------
// Scraper Constants
// ---------------------------------------------------------------------------

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

// Block detection patterns — these indicate the page is blocked or challenged
const BLOCK_PATTERNS = [
  'pardon our interruption',
  'please verify you are a human',
  'access denied',
  'just a moment',
  'checking your browser',
  'verify you are human',
  'enable javascript and cookies',
  'ray id',
];

// Expected page indicators — at least one must be present for valid Copart pages
const COPART_PAGE_INDICATORS = [
  'copart',
  'lot search',
  'vehicle finder',
  'auction',
];

// ---------------------------------------------------------------------------
// Parser Version (increment on parser logic changes)
// ---------------------------------------------------------------------------
const PARSER_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Alert Retry Config
// ---------------------------------------------------------------------------
const ALERT_RETRY = Object.freeze({
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 1000,  // Exponential: 1s, 2s, 4s
});

// ---------------------------------------------------------------------------
// Display Timezone (Guyana = UTC-4, no DST)
// ---------------------------------------------------------------------------
const DISPLAY_TIMEZONE = 'America/Guyana';

module.exports = {
  LOT_STATUS,
  ALERT_STATUS,
  SCRAPE_STATUS,
  ALERT_CHANNEL,
  ALERT_PRIORITY,
  ERROR_CODES,
  USER_AGENTS,
  VIEWPORTS,
  BLOCK_PATTERNS,
  COPART_PAGE_INDICATORS,
  PARSER_VERSION,
  ALERT_RETRY,
  DISPLAY_TIMEZONE,
};
