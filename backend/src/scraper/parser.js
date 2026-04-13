// =============================================================================
// PROJECT ANTIGRAVITY — Copart DOM Parser
// =============================================================================
// Extracts structured data from Copart search result pages.
// Uses saved HTML structure for testing — does NOT rely on live site for tests.

const {
  normalizeText,
  normalizeMake,
  normalizeModel,
  normalizeBodyStyle,
  extractYear,
  PARSER_VERSION,
} = require('../services/matchingEngine');

/**
 * Parse all lot listings from a Copart search results page.
 *
 * @param {Object} page - Playwright Page object
 * @returns {Promise<Array<Object>>} Array of parsed lot objects
 */
async function parseSearchResults(page) {
  const lots = await page.evaluate(() => {
    const results = [];

    // Strategy 1: Table rows (Copart's primary format)
    const rows = document.querySelectorAll(
      '#serverSideDataTable tbody tr, .search-results tr, [data-uname="lotSearchTable"] tbody tr'
    );

    for (const row of rows) {
      try {
        // Skip header rows or empty rows
        if (row.classList.contains('header') || row.children.length < 3) continue;

        const cells = row.querySelectorAll('td');
        if (cells.length < 3) continue;

        // Extract lot number
        const lotLink = row.querySelector('a[href*="/lot/"]');
        const lotNumber = lotLink
          ? (lotLink.href.match(/\/lot\/(\d+)/)?.[1] || '')
          : (row.getAttribute('data-lot-id') || row.getAttribute('data-id') || '');

        if (!lotNumber) continue;

        // Extract data from cells/attributes
        const title = (
          row.querySelector('.lot-description, .lot-title, [data-uname="lotTitle"]')?.textContent ||
          row.querySelector('a[href*="/lot/"]')?.textContent ||
          ''
        ).trim();

        const imageEl = row.querySelector('img[src*="copart"], img.lot-image, img[data-src]');
        const imageUrl = imageEl?.src || imageEl?.getAttribute('data-src') || '';

        const bidEl = row.querySelector('.bid-info, [data-uname="currentBid"], .current-bid');
        const bidText = bidEl?.textContent || '';
        const bidMatch = bidText.replace(/[^0-9.]/g, '');

        const buyNowEl = row.querySelector('.buy-now, [data-uname="buyNow"]');
        const buyNowText = buyNowEl?.textContent || '';
        const buyNowMatch = buyNowText.replace(/[^0-9.]/g, '');

        const locationEl = row.querySelector('.lot-location, [data-uname="lotLocation"]');
        const location = locationEl?.textContent?.trim() || '';

        const saleEl = row.querySelector('.sale-date, [data-uname="saleDate"]');
        const saleDate = saleEl?.textContent?.trim() || '';

        const damageEl = row.querySelector('.damage-type, [data-uname="damageType"]');
        const damageType = damageEl?.textContent?.trim() || '';

        const odometerEl = row.querySelector('.odometer, [data-uname="odometer"]');
        const odometerText = odometerEl?.textContent || '';
        const odometerMatch = odometerText.replace(/[^0-9]/g, '');

        const driveEl = row.querySelector('.drive-type, [data-uname="driveType"]');
        const driveType = driveEl?.textContent?.trim() || '';

        const lotUrl = lotLink ? lotLink.href : '';

        results.push({
          lot_number: lotNumber,
          title,
          image_url: imageUrl,
          current_bid: bidMatch ? parseFloat(bidMatch) : null,
          buy_now_price: buyNowMatch ? parseFloat(buyNowMatch) : null,
          location,
          sale_date_raw: saleDate,
          damage_type: damageType,
          odometer: odometerMatch ? parseInt(odometerMatch, 10) : null,
          drive_type: driveType,
          lot_url: lotUrl,
          raw_html: row.innerHTML.substring(0, 2000), // Cap raw for storage
        });
      } catch (e) {
        // Skip individual parse errors — don't fail the whole batch
        console.warn('Parse error on row:', e.message);
      }
    }

    // Strategy 2: Card layout fallback
    if (results.length === 0) {
      const cards = document.querySelectorAll('.lot-card, .search-result-card, [data-lot-id]');
      for (const card of cards) {
        try {
          const lotNumber = card.getAttribute('data-lot-id') || '';
          if (!lotNumber) continue;

          const title = (card.querySelector('.lot-title, .title, h3, h4')?.textContent || '').trim();
          const lotUrl = card.querySelector('a')?.href || '';

          results.push({
            lot_number: lotNumber,
            title,
            image_url: card.querySelector('img')?.src || '',
            current_bid: null,
            buy_now_price: null,
            location: '',
            sale_date_raw: '',
            damage_type: '',
            odometer: null,
            drive_type: '',
            lot_url: lotUrl,
            raw_html: card.innerHTML.substring(0, 2000),
          });
        } catch (e) {
          console.warn('Card parse error:', e.message);
        }
      }
    }

    return results;
  });

  // Post-process: normalize and enrich each lot
  return lots.map((lot) => normalizeLot(lot));
}

/**
 * Normalize a raw parsed lot into the canonical schema.
 * Extracts year, make, model from title.
 * @param {Object} raw - Raw lot data from page.evaluate
 * @returns {Object} Normalized lot
 */
function normalizeLot(raw) {
  const title = raw.title || '';

  // Extract year from title
  const year = extractYear(title);

  // Parse make/model from title (common format: "YYYY MAKE MODEL - BODYINFO")
  let make = '';
  let model = '';
  let bodyStyle = '';

  const titleParts = normalizeText(title).split(/[\s-]+/);
  if (titleParts.length >= 3) {
    // Skip year if it's the first token
    const startIdx = /^\d{4}$/.test(titleParts[0]) ? 1 : 0;
    if (titleParts[startIdx]) make = normalizeMake(titleParts[startIdx]);
    if (titleParts[startIdx + 1]) model = normalizeModel(titleParts[startIdx + 1]);

    // Remaining parts may contain body style info
    const remaining = titleParts.slice(startIdx + 2).join(' ');
    if (remaining) bodyStyle = normalizeBodyStyle(remaining);
  }

  // Attempt to parse sale_date_raw into ISO format
  let saleDate = null;
  if (raw.sale_date_raw) {
    try {
      const parsed = new Date(raw.sale_date_raw);
      if (!isNaN(parsed.getTime())) {
        saleDate = parsed.toISOString();
      }
    } catch {
      // Leave as null — don't trust unparseable dates
    }
  }

  return {
    lot_number: raw.lot_number,
    title: raw.title,
    year,
    make,
    model,
    body_style: bodyStyle,
    damage_type: raw.damage_type || null,
    location: raw.location || null,
    sale_date: saleDate,
    current_bid: raw.current_bid,
    buy_now_price: raw.buy_now_price,
    odometer: raw.odometer,
    drive_type: raw.drive_type || null,
    fuel_type: null,
    engine: null,
    color: null,
    image_url: raw.image_url || null,
    lot_url: raw.lot_url || null,
    raw_data: {
      raw_title: raw.title,
      sale_date_raw: raw.sale_date_raw,
      raw_html: raw.raw_html,
    },
    parser_version: PARSER_VERSION,
  };
}

module.exports = {
  parseSearchResults,
  normalizeLot,
};
