// =============================================================================
// PROJECT ANTIGRAVITY — Page Validator & Block Detector
// =============================================================================
// MANDATORY checks before ANY data parsing.
// If ANY check fails → THROW BLOCKED_OR_INVALID_PAGE → STOP immediately.

const {
  BLOCK_PATTERNS,
  COPART_PAGE_INDICATORS,
  ERROR_CODES,
} = require('../config/constants');

/**
 * Custom error class for blocked/invalid pages.
 */
class BlockedPageError extends Error {
  constructor(errorCode, reason, metadata = {}) {
    super(`Blocked or invalid page: ${reason}`);
    this.name = 'BlockedPageError';
    this.errorCode = errorCode;
    this.reason = reason;
    this.metadata = metadata;
  }
}

/**
 * Validate a page before parsing. ALL checks must pass.
 * If ANY check fails, throws BlockedPageError.
 *
 * Checks performed:
 * 1. Page URL is expected (contains copart.com)
 * 2. Page title is expected (not a CAPTCHA/challenge page)
 * 3. No CAPTCHA / challenge / block page present
 * 4. Listing container exists (results table/div)
 * 5. HTTP status is not 403/429
 *
 * @param {Object} page - Playwright Page object
 * @param {Object} response - Playwright Response from navigation
 * @returns {Promise<{valid: boolean, pageTitle: string, url: string}>}
 * @throws {BlockedPageError}
 */
async function validatePage(page, response) {
  const url = page.url();
  const pageTitle = await page.title();
  const titleLower = (pageTitle || '').toLowerCase();
  const urlLower = (url || '').toLowerCase();

  // --- Check 1: HTTP Status ---
  if (response) {
    const status = response.status();
    if (status === 403) {
      throw new BlockedPageError(
        ERROR_CODES.HTTP_403,
        `HTTP 403 Forbidden at ${url}`,
        { url, status }
      );
    }
    if (status === 429) {
      throw new BlockedPageError(
        ERROR_CODES.HTTP_429,
        `HTTP 429 Too Many Requests at ${url}`,
        { url, status }
      );
    }
    if (status >= 500) {
      throw new BlockedPageError(
        ERROR_CODES.BLOCKED_OR_INVALID_PAGE,
        `HTTP ${status} Server Error at ${url}`,
        { url, status }
      );
    }
  }

  // --- Check 2: URL is expected ---
  if (!urlLower.includes('copart.com') && !urlLower.includes('localhost')) {
    throw new BlockedPageError(
      ERROR_CODES.BLOCKED_OR_INVALID_PAGE,
      `Unexpected URL: ${url}`,
      { url }
    );
  }

  // --- Check 3: Block patterns detection ---
  const bodyText = await page.evaluate(() => {
    return (document.body?.innerText || '').toLowerCase().substring(0, 5000);
  }).catch(() => '');

  for (const pattern of BLOCK_PATTERNS) {
    if (bodyText.includes(pattern.toLowerCase())) {
      throw new BlockedPageError(
        ERROR_CODES.CAPTCHA_DETECTED,
        `Block pattern detected: "${pattern}"`,
        { url, pattern, pageTitle }
      );
    }
    if (titleLower.includes(pattern.toLowerCase())) {
      throw new BlockedPageError(
        ERROR_CODES.CAPTCHA_DETECTED,
        `Block pattern in title: "${pattern}"`,
        { url, pattern, pageTitle }
      );
    }
  }

  // --- Check 4: Page title sanity ---
  const hasCopartIndicator = COPART_PAGE_INDICATORS.some(
    (indicator) => titleLower.includes(indicator.toLowerCase()) || urlLower.includes(indicator.toLowerCase())
  );
  if (!hasCopartIndicator) {
    // Allow if we're on localhost (development)
    if (!urlLower.includes('localhost')) {
      throw new BlockedPageError(
        ERROR_CODES.UNEXPECTED_DOM,
        `Page title "${pageTitle}" does not contain expected Copart indicators`,
        { url, pageTitle }
      );
    }
  }

  // --- Check 5: CAPTCHA iframe detection ---
  const hasCaptchaFrame = await page.evaluate(() => {
    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = (iframe.src || '').toLowerCase();
      if (
        src.includes('captcha') ||
        src.includes('recaptcha') ||
        src.includes('hcaptcha') ||
        src.includes('challenge')
      ) {
        return true;
      }
    }
    return false;
  }).catch(() => false);

  if (hasCaptchaFrame) {
    throw new BlockedPageError(
      ERROR_CODES.CAPTCHA_DETECTED,
      'CAPTCHA iframe detected on page',
      { url, pageTitle }
    );
  }

  return { valid: true, pageTitle, url };
}

/**
 * Verify that search results exist on the page.
 * Must be called AFTER validatePage.
 *
 * @param {Object} page - Playwright Page object
 * @throws {BlockedPageError}
 */
async function validateResultsExist(page) {
  // Copart uses several possible containers for results
  const resultSelectors = [
    '#serverSideDataTable',
    '.search-results',
    '[data-uname="lotSearchTable"]',
    '.lot-list',
    'table.table',
    '#tabBody',
  ];

  let found = false;
  for (const selector of resultSelectors) {
    const element = await page.$(selector);
    if (element) {
      found = true;
      break;
    }
  }

  if (!found) {
    // Check if it's a "no results" message (valid, not blocked)
    const bodyText = await page.evaluate(() => {
      return (document.body?.innerText || '').toLowerCase().substring(0, 5000);
    }).catch(() => '');

    if (
      bodyText.includes('no results') ||
      bodyText.includes('0 results') ||
      bodyText.includes('no lots found') ||
      bodyText.includes('no vehicles')
    ) {
      // Legitimate zero results — not blocked
      return { hasResults: false, count: 0 };
    }

    throw new BlockedPageError(
      ERROR_CODES.MISSING_RESULTS_TABLE,
      'Expected results container not found in DOM',
      { url: page.url(), selectorsChecked: resultSelectors }
    );
  }

  return { hasResults: true };
}

module.exports = {
  validatePage,
  validateResultsExist,
  BlockedPageError,
};
