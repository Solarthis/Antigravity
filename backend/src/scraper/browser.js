// =============================================================================
// PROJECT ANTIGRAVITY — Browser Manager
// =============================================================================
// Playwright + Stealth. Guaranteed browser.close() in finally blocks.
// No zombie processes. No memory leaks.

const { chromium } = require('playwright-extra');
// FIX: playwright-extra-plugin-stealth@0.0.1 is a broken stub that throws on require().
// The correct stealth plugin is puppeteer-extra-plugin-stealth, which is fully
// compatible with playwright-extra.
const stealth = require('puppeteer-extra-plugin-stealth');
const env = require('../config/env');
const { USER_AGENTS, VIEWPORTS } = require('../config/constants');

// Apply stealth plugin
chromium.use(stealth());

/**
 * Pick a random element from an array.
 */
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Sleep for a random duration within a range.
 * @param {number} minMs
 * @param {number} maxMs
 */
function randomDelay(minMs, maxMs) {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((r) => setTimeout(r, delay));
}

/**
 * Create a new stealth browser instance with a fresh context.
 * IMPORTANT: Caller MUST call browser.close() in a finally block.
 *
 * @returns {Promise<{browser: Object, context: Object, page: Object}>}
 */
async function createBrowser() {
  const userAgent = randomChoice(USER_AGENTS);
  const viewport = randomChoice(VIEWPORTS);

  const browser = await chromium.launch({
    headless: env.scraper.headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--lang=en-US,en',
    ],
  });

  const context = await browser.newContext({
    userAgent,
    viewport,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    permissions: [],
    javaScriptEnabled: true,
    bypassCSP: false,
  });

  // Block unnecessary resources for faster loading
  await context.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,woff,woff2,ttf,eot}', (route) => {
    route.abort();
  });

  const page = await context.newPage();

  // Set reasonable timeout
  page.setDefaultTimeout(env.scraper.pageTimeoutMs);
  page.setDefaultNavigationTimeout(env.scraper.pageTimeoutMs);

  return { browser, context, page };
}

/**
 * Safely close a browser instance. Never throws.
 * @param {Object} browser - Playwright browser instance
 */
async function closeBrowser(browser) {
  if (!browser) return;
  try {
    await browser.close();
    console.log('[BROWSER] Browser closed successfully.');
  } catch (err) {
    console.error(`[BROWSER] Error closing browser: ${err.message}`);
    // Force kill if close fails
    try {
      const pid = browser.process()?.pid;
      if (pid) {
        process.kill(pid, 'SIGKILL');
        console.log(`[BROWSER] Force-killed browser process ${pid}`);
      }
    } catch {
      // Nothing more we can do
    }
  }
}

module.exports = {
  createBrowser,
  closeBrowser,
  randomDelay,
  randomChoice,
};
