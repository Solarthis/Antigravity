// =============================================================================
// PROJECT ANTIGRAVITY — Copart Scraper
// =============================================================================
// Navigates Copart search, applies filters, extracts lots.
// ALL Playwright logic wrapped in try/catch/finally.
// finally MUST call browser.close(). No exceptions. No leaks.

const { createBrowser, closeBrowser, randomDelay } = require('./browser');
const { validatePage, validateResultsExist, BlockedPageError } = require('./validator');
const { parseSearchResults } = require('./parser');
const env = require('../config/env');
const { ERROR_CODES } = require('../config/constants');

/**
 * Scrape Copart search results for a given hunt configuration.
 *
 * Flow:
 * 1. Launch stealth browser
 * 2. Navigate to Copart search
 * 3. Validate page (block detection)
 * 4. Parse results
 * 5. Paginate (up to maxPages)
 * 6. Close browser (ALWAYS, in finally)
 *
 * @param {Object} hunt - Hunt configuration { make, model, year_min, year_max, ... }
 * @returns {Promise<{lots: Array, blocked: boolean, blockReason?: string, errorCode?: string}>}
 */
async function scrapeCopart(hunt) {
  let browser = null;
  const allLots = [];
  const seenLotNumbers = new Set();

  try {
    // Step 1: Create browser
    console.log('[SCRAPER] Launching browser...');
    const browserBundle = await createBrowser();
    browser = browserBundle.browser;
    const page = browserBundle.page;

    // Step 2: Build search URL
    const searchQuery = `${hunt.make} ${hunt.model}`.trim();
    const searchUrl = `${env.scraper.baseUrl}/lotSearchResults/?free=true&query=${encodeURIComponent(searchQuery)}`;

    console.log(`[SCRAPER] Navigating to: ${searchUrl}`);

    // Small random delay before navigation (behavioral)
    await randomDelay(500, 1500);

    const response = await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: env.scraper.pageTimeoutMs,
    });

    // Step 3: Wait for content to settle
    await randomDelay(env.scraper.delayMinMs, env.scraper.delayMaxMs);

    // Try to wait for dynamic content
    try {
      await page.waitForSelector(
        '#serverSideDataTable, .search-results, [data-uname="lotSearchTable"], .lot-card',
        { timeout: 15000 }
      );
    } catch {
      // Timeout waiting for results — might be blocked or empty
      console.warn('[SCRAPER] Timed out waiting for results container.');
    }

    // Step 4: MANDATORY — Validate page before ANY parsing
    await validatePage(page, response);
    console.log('[SCRAPER] Page validation passed.');

    // Step 5: Check if results exist
    const resultCheck = await validateResultsExist(page);
    if (!resultCheck.hasResults) {
      console.log('[SCRAPER] No results found (legitimate empty result).');
      return { lots: [], blocked: false };
    }

    // Step 6: Parse first page
    const pageOneLots = await parseSearchResults(page);
    for (const lot of pageOneLots) {
      if (lot.lot_number) seenLotNumbers.add(lot.lot_number);
    }
    allLots.push(...pageOneLots);
    console.log(`[SCRAPER] Page 1: Found ${pageOneLots.length} lots.`);

    // Step 7: Paginate
    for (let pageNum = 2; pageNum <= env.scraper.maxPages; pageNum++) {
      // Check for next page button
      const nextButton = await page.$(
        '.next-page, [data-uname="pageNext"], a.next, .pagination .next'
      );
      if (!nextButton) {
        console.log(`[SCRAPER] No more pages after page ${pageNum - 1}.`);
        break;
      }

      const isDisabled = await nextButton.evaluate((el) =>
        el.classList.contains('disabled') ||
        el.hasAttribute('disabled') ||
        el.getAttribute('aria-disabled') === 'true'
      );
      if (isDisabled) {
        console.log(`[SCRAPER] Pagination ended (next button disabled) at page ${pageNum - 1}.`);
        break;
      }

      // Random delay between pages (behavioral anti-detection)
      await randomDelay(env.scraper.delayMinMs, env.scraper.delayMaxMs);

      // Click next page
      await nextButton.click();

      // Wait for new content
      await randomDelay(2000, 4000);

      try {
        await page.waitForSelector(
          '#serverSideDataTable, .search-results',
          { timeout: 10000 }
        );
      } catch {
        console.warn(`[SCRAPER] Page ${pageNum} content didn't load in time. Stopping pagination.`);
        break;
      }

      // Re-validate each page (blocks can appear on any page)
      await validatePage(page, null);

      const pageLots = await parseSearchResults(page);
      
      let newLotsInPage = 0;
      for (const lot of pageLots) {
        if (!lot.lot_number || !seenLotNumbers.has(lot.lot_number)) {
          if (lot.lot_number) seenLotNumbers.add(lot.lot_number);
          newLotsInPage++;
        }
      }

      allLots.push(...pageLots);
      console.log(`[SCRAPER] Page ${pageNum}: Found ${pageLots.length} lots (${newLotsInPage} new).`);

      // Safety: stop if no new lots (anti-loop)
      if (newLotsInPage === 0) {
        console.log(`[SCRAPER] Empty or duplicate page ${pageNum}. Stopping pagination.`);
        break;
      }
    }

    console.log(`[SCRAPER] Total lots scraped: ${allLots.length}`);
    return { lots: allLots, blocked: false };

  } catch (err) {
    if (err instanceof BlockedPageError) {
      console.error(`[SCRAPER] 🚫 BLOCKED: ${err.reason}`);
      return {
        lots: allLots, // Return any lots we managed to get before block
        blocked: true,
        blockReason: err.reason,
        errorCode: err.errorCode,
        metadata: err.metadata,
      };
    }

    // Classify other errors
    if (err.message?.includes('Timeout') || err.message?.includes('timeout')) {
      console.error(`[SCRAPER] Browser timeout: ${err.message}`);
      return {
        lots: allLots,
        blocked: false,
        errorCode: ERROR_CODES.BROWSER_TIMEOUT,
        error: err.message,
      };
    }

    if (err.message?.includes('Navigation') || err.message?.includes('net::')) {
      console.error(`[SCRAPER] Navigation failed: ${err.message}`);
      return {
        lots: allLots,
        blocked: false,
        errorCode: ERROR_CODES.NAVIGATION_FAILED,
        error: err.message,
      };
    }

    console.error(`[SCRAPER] Unexpected error: ${err.message}`);
    console.error(err.stack);
    return {
      lots: allLots,
      blocked: false,
      errorCode: ERROR_CODES.UNKNOWN_ERROR,
      error: err.message,
    };

  } finally {
    // GUARANTEED browser cleanup — no exceptions, no leaks
    await closeBrowser(browser);
  }
}

module.exports = {
  scrapeCopart,
};
