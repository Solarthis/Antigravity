// =============================================================================
// PROJECT ANTIGRAVITY — Alert Message Templates
// =============================================================================
// All outbound message content. Timestamps displayed in Guyana time.

const { DateTime } = require('luxon');
const { DISPLAY_TIMEZONE, ALERT_PRIORITY } = require('../config/constants');

/**
 * Format a UTC timestamp for display in Guyana time.
 * @param {Date|string} utcDate
 * @returns {string}
 */
function formatDisplayTime(utcDate) {
  if (!utcDate) return 'TBD';
  return DateTime.fromJSDate(new Date(utcDate), { zone: 'utc' })
    .setZone(DISPLAY_TIMEZONE)
    .toFormat('EEE, MMM d yyyy · h:mm a');
}

/**
 * Format currency.
 * @param {number|string} amount
 * @returns {string}
 */
function formatCurrency(amount) {
  if (!amount && amount !== 0) return 'N/A';
  return `$${parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * New listing alert message.
 * @param {Object} lot - Lot data from DB
 * @param {Object} hunt - Hunt configuration
 * @param {string} priority - 'normal' or 'high'
 * @returns {string}
 */
function newListingAlert(lot, hunt, priority = ALERT_PRIORITY.NORMAL) {
  const header = priority === ALERT_PRIORITY.HIGH
    ? '🔥 *IMMEDIATE ACTION — BUY NOW AVAILABLE*'
    : '🚨 *NEW LISTING ALERT*';

  const lines = [
    header,
    '',
    `🏷 *Hunt:* ${hunt.name}`,
    `🚗 *Vehicle:* ${lot.year || '??'} ${lot.make || ''} ${lot.model || ''} ${lot.body_style || ''}`.trim(),
    '',
  ];

  if (lot.current_bid !== null && lot.current_bid !== undefined) {
    lines.push(`💰 *Current Bid:* ${formatCurrency(lot.current_bid)}`);
  }
  if (lot.buy_now_price !== null && lot.buy_now_price !== undefined) {
    lines.push(`⚡ *Buy Now:* ${formatCurrency(lot.buy_now_price)}`);
  }
  if (lot.location) {
    lines.push(`📍 *Location:* ${lot.location}`);
  }
  if (lot.sale_date) {
    lines.push(`📅 *Sale Date:* ${formatDisplayTime(lot.sale_date)}`);
  }
  if (lot.damage_type) {
    lines.push(`⚠️ *Damage:* ${lot.damage_type}`);
  }
  if (lot.odometer) {
    lines.push(`🔢 *Odometer:* ${lot.odometer.toLocaleString()} mi`);
  }

  lines.push('');
  lines.push(`🔗 *Lot #${lot.lot_number}*`);
  if (lot.lot_url) {
    lines.push(lot.lot_url);
  }

  lines.push('');
  lines.push(`_Confidence: ${Math.round((lot.match_confidence || 0) * 100)}%_`);
  lines.push(`_Project Antigravity · MAT Solutions_`);

  return lines.join('\n');
}

/**
 * Buy Now alert message — used when Buy Now price appears or changes.
 * @param {Object} lot
 * @param {Object} hunt
 * @returns {string}
 */
function buyNowAlert(lot, hunt) {
  return newListingAlert(lot, hunt, ALERT_PRIORITY.HIGH);
}

/**
 * Daily digest message — summary of all new matches.
 * @param {Array} lots - Array of matched lots
 * @param {string} periodLabel - e.g., "24h"
 * @returns {string}
 */
function dailyDigest(lots, periodLabel = '24h') {
  if (!lots || lots.length === 0) {
    return [
      `📊 *Daily Digest — ${periodLabel}*`,
      '',
      'No new matching vehicles found.',
      '',
      '_Project Antigravity · MAT Solutions_',
    ].join('\n');
  }

  const lines = [
    `📊 *Daily Digest — ${periodLabel}*`,
    `Found *${lots.length}* matching vehicle${lots.length === 1 ? '' : 's'}:`,
    '',
  ];

  for (const lot of lots.slice(0, 10)) {
    lines.push(
      `• ${lot.year || '??'} ${lot.make || ''} ${lot.model || ''} — ${formatCurrency(lot.current_bid)} — Lot #${lot.lot_number}`
    );
  }

  if (lots.length > 10) {
    lines.push(`  ...and ${lots.length - 10} more`);
  }

  lines.push('');
  lines.push('_Project Antigravity · MAT Solutions_');

  return lines.join('\n');
}

/**
 * System error alert for admin.
 * @param {string} errorCode
 * @param {string} errorMessage
 * @param {string} runId
 * @returns {string}
 */
function systemErrorAlert(errorCode, errorMessage, runId) {
  return [
    `⚙️ *SYSTEM ALERT*`,
    '',
    `❌ *Error:* ${errorCode}`,
    `📝 *Details:* ${errorMessage || 'No additional details'}`,
    `🆔 *Run ID:* ${runId || 'N/A'}`,
    `🕐 *Time:* ${formatDisplayTime(new Date())}`,
    '',
    '_Project Antigravity · MAT Solutions_',
  ].join('\n');
}

module.exports = {
  newListingAlert,
  buyNowAlert,
  dailyDigest,
  systemErrorAlert,
  formatDisplayTime,
  formatCurrency,
};
