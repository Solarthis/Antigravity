// =============================================================================
// PROJECT ANTIGRAVITY — Matching & Normalization Engine
// =============================================================================
// Fuzzy matching with synonym maps, regex patterns, and confidence scoring.
// NEVER uses simple .includes() — all matching is normalized + regex-based.

const { PARSER_VERSION } = require('../config/constants');

// ---------------------------------------------------------------------------
// Synonym Maps — Canonical form → all known variations
// ---------------------------------------------------------------------------

const BODY_STYLE_SYNONYMS = {
  'ACCESS CAB': [
    'access cab',
    'access',
    'accesscab',
    'acc cab',
    'a-cab',
  ],
  'EXTENDED CAB': [
    'extended cab',
    'ext cab',
    'ext',
    'extended',
    'extra cab',
    'extra',
    'extcab',
    'x-cab',
    'xcab',
  ],
  'DOUBLE CAB': [
    'double cab',
    'dbl cab',
    'doublecab',
    'dblcab',
    'crew cab',
    'crewcab',
  ],
  'REGULAR CAB': [
    'regular cab',
    'reg cab',
    'regularcab',
    'regcab',
    'standard cab',
    'std cab',
    'single cab',
  ],
};

const MAKE_SYNONYMS = {
  'TOYOTA': ['toyota', 'toyo'],
  'HONDA': ['honda'],
  'FORD': ['ford'],
  'CHEVROLET': ['chevrolet', 'chevy', 'chev'],
  'NISSAN': ['nissan'],
  'RAM': ['ram', 'dodge ram'],
  'GMC': ['gmc'],
  'JEEP': ['jeep'],
  'HYUNDAI': ['hyundai'],
  'KIA': ['kia'],
};

const MODEL_SYNONYMS = {
  'TACOMA': ['tacoma', 'taco'],
  'TUNDRA': ['tundra'],
  'HIGHLANDER': ['highlander'],
  '4RUNNER': ['4runner', '4-runner', 'four runner', 'forerunner'],
  'RAV4': ['rav4', 'rav-4', 'rav 4'],
  'CAMRY': ['camry'],
  'COROLLA': ['corolla'],
};

// ---------------------------------------------------------------------------
// Normalizers
// ---------------------------------------------------------------------------

/**
 * Normalize a text string for matching: uppercase, trim, collapse whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9\s\-]/g, '')  // Remove special chars except dash
    .replace(/\s+/g, ' ');           // Collapse whitespace
}

/**
 * Normalize a make value using synonym lookup.
 * @param {string} rawMake
 * @returns {string} Canonical make or normalized input
 */
function normalizeMake(rawMake) {
  const normalized = normalizeText(rawMake);
  for (const [canonical, variants] of Object.entries(MAKE_SYNONYMS)) {
    for (const variant of variants) {
      if (normalized === variant.toUpperCase()) return canonical;
    }
  }
  return normalized;
}

/**
 * Normalize a model value using synonym lookup.
 * @param {string} rawModel
 * @returns {string} Canonical model or normalized input
 */
function normalizeModel(rawModel) {
  const normalized = normalizeText(rawModel);
  for (const [canonical, variants] of Object.entries(MODEL_SYNONYMS)) {
    for (const variant of variants) {
      if (normalized === variant.toUpperCase()) return canonical;
    }
  }
  return normalized;
}

/**
 * Normalize a body style value using synonym lookup.
 * Returns the canonical form if any synonym matches.
 * @param {string} rawBodyStyle
 * @returns {string} Canonical body style or normalized input
 */
function normalizeBodyStyle(rawBodyStyle) {
  const normalized = normalizeText(rawBodyStyle);
  for (const [canonical, variants] of Object.entries(BODY_STYLE_SYNONYMS)) {
    for (const variant of variants) {
      if (normalized === variant.toUpperCase()) return canonical;
    }
  }
  return normalized;
}

/**
 * Extract year from a title string.
 * @param {string} title
 * @returns {number|null}
 */
function extractYear(title) {
  const match = normalizeText(title).match(/\b(19|20)\d{2}\b/);
  return match ? parseInt(match[0], 10) : null;
}

// ---------------------------------------------------------------------------
// Matching Engine
// ---------------------------------------------------------------------------

/**
 * Build a regex pattern for a body style, including all synonyms.
 * @param {string} targetBodyStyle - Canonical body style
 * @returns {RegExp}
 */
function buildBodyStyleRegex(targetBodyStyle) {
  const canonical = normalizeText(targetBodyStyle);
  const synonymEntry = BODY_STYLE_SYNONYMS[canonical];
  const allTerms = synonymEntry
    ? [canonical, ...synonymEntry.map((s) => s.toUpperCase())]
    : [canonical];

  // Escape regex special chars and join with OR
  const escaped = allTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

/**
 * Match a single lot against a single hunt configuration.
 * Returns a match result with confidence score.
 *
 * Confidence breakdown:
 *   - Make match: 0.25
 *   - Model match: 0.25
 *   - Year in range: 0.20
 *   - Body style match: 0.20
 *   - Keyword match: 0.10
 *
 * @param {Object} lot - Parsed lot data
 * @param {Object} hunt - Hunt configuration
 * @returns {{ matched: boolean, confidence: number, reasons: string[], huntId: number }}
 */
function matchLot(lot, hunt) {
  let confidence = 0;
  const reasons = [];

  // --- Make match (required, 0.25) ---
  const lotMake = normalizeMake(lot.make || '');
  const huntMake = normalizeMake(hunt.make || '');
  if (lotMake && huntMake) {
    if (lotMake === huntMake) {
      confidence += 0.25;
      reasons.push(`make:${lotMake}`);
    } else {
      // Make mismatch is a hard fail — return immediately
      return { matched: false, confidence: 0, reasons: ['make_mismatch'], huntId: hunt.id };
    }
  }

  // --- Model match (required, 0.25) ---
  const lotModel = normalizeModel(lot.model || '');
  const huntModel = normalizeModel(hunt.model || '');
  if (lotModel && huntModel) {
    if (lotModel === huntModel) {
      confidence += 0.25;
      reasons.push(`model:${lotModel}`);
    } else {
      // Also check if model appears in the title (fuzzy)
      const titleNorm = normalizeText(lot.title || '');
      const modelRegex = new RegExp(`\\b${huntModel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (modelRegex.test(titleNorm)) {
        confidence += 0.20; // Slightly lower confidence for title-only match
        reasons.push(`model_in_title:${huntModel}`);
      } else {
        return { matched: false, confidence: 0, reasons: ['model_mismatch'], huntId: hunt.id };
      }
    }
  }

  // --- Year range (0.20) ---
  const lotYear = lot.year || extractYear(lot.title);
  if (lotYear && (hunt.year_min || hunt.year_max)) {
    const inRange =
      (!hunt.year_min || lotYear >= hunt.year_min) &&
      (!hunt.year_max || lotYear <= hunt.year_max);
    if (inRange) {
      confidence += 0.20;
      reasons.push(`year:${lotYear}`);
    } else {
      // Year out of range is a hard fail
      return { matched: false, confidence: 0, reasons: [`year_out_of_range:${lotYear}`], huntId: hunt.id };
    }
  }

  // --- Body style match (0.20) ---
  if (hunt.body_style) {
    const bodyRegex = buildBodyStyleRegex(hunt.body_style);
    const lotBodyNorm = normalizeText(lot.body_style || '');
    const titleNorm = normalizeText(lot.title || '');

    if (bodyRegex.test(lotBodyNorm)) {
      confidence += 0.20;
      reasons.push(`body_style:${normalizeBodyStyle(lot.body_style)}`);
    } else if (bodyRegex.test(titleNorm)) {
      confidence += 0.15; // Title match is less confident
      reasons.push(`body_style_in_title:${hunt.body_style}`);
    } else {
      // Check raw_data keys/values if available
      const rawStr = normalizeText(JSON.stringify(lot.raw_data || {}));
      if (bodyRegex.test(rawStr)) {
        confidence += 0.10;
        reasons.push(`body_style_in_raw:${hunt.body_style}`);
      }
      // Body style mismatch reduces confidence but doesn't hard-fail
      // (some listings don't specify body style)
    }
  }

  // --- Keyword match (0.10) ---
  if (hunt.keywords && hunt.keywords.length > 0) {
    const titleNorm = normalizeText(lot.title || '');
    const bodyNorm = normalizeText(lot.body_style || '');
    const combinedText = `${titleNorm} ${bodyNorm}`;

    let keywordHits = 0;
    for (const keyword of hunt.keywords) {
      const kwNorm = normalizeText(keyword);
      const kwRegex = new RegExp(`\\b${kwNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (kwRegex.test(combinedText)) {
        keywordHits++;
      }
    }

    if (keywordHits > 0) {
      const keywordScore = Math.min(0.10, (keywordHits / hunt.keywords.length) * 0.10);
      confidence += keywordScore;
      reasons.push(`keywords:${keywordHits}/${hunt.keywords.length}`);
    }
  }

  // Clamp confidence to [0, 1]
  confidence = Math.min(1, Math.max(0, parseFloat(confidence.toFixed(2))));

  return {
    matched: confidence > 0, // Anything with non-zero confidence was at least a partial match
    confidence,
    reasons,
    huntId: hunt.id,
  };
}

/**
 * Match a lot against ALL active hunts and return the best match.
 * @param {Object} lot - Parsed lot data
 * @param {Array} hunts - Array of active hunt configurations
 * @param {number} threshold - Minimum confidence to consider a match
 * @returns {{ matched: boolean, confidence: number, reasons: string[], huntId: number|null, allResults: Array }}
 */
function matchLotAgainstHunts(lot, hunts, threshold = 0.6) {
  const allResults = hunts.map((hunt) => matchLot(lot, hunt));

  // Find the best match above threshold
  const bestMatch = allResults
    .filter((r) => r.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence)[0];

  if (bestMatch) {
    return {
      matched: true,
      confidence: bestMatch.confidence,
      reasons: bestMatch.reasons,
      huntId: bestMatch.huntId,
      allResults,
    };
  }

  return {
    matched: false,
    confidence: 0,
    reasons: ['no_match_above_threshold'],
    huntId: null,
    allResults,
  };
}

/**
 * Generate a trigger fingerprint for alert deduplication.
 * The fingerprint identifies the specific event that triggers an alert.
 *
 * Fingerprint types:
 *   - "new_listing:{lot_number}" — First time lot is matched
 *   - "buy_now:{lot_number}:{price}" — Buy Now price appeared or changed
 *   - "price_drop:{lot_number}:{price}" — Significant price drop (future)
 *
 * @param {string} type - Event type
 * @param {Object} lot - Lot data
 * @returns {string}
 */
function generateTriggerFingerprint(type, lot) {
  switch (type) {
    case 'new_listing':
      return `new_listing:${lot.lot_number}`;
    case 'buy_now':
      return `buy_now:${lot.lot_number}:${lot.buy_now_price}`;
    case 'price_drop':
      return `price_drop:${lot.lot_number}:${lot.current_bid}`;
    default:
      return `${type}:${lot.lot_number}`;
  }
}

module.exports = {
  // Normalizers
  normalizeText,
  normalizeMake,
  normalizeModel,
  normalizeBodyStyle,
  extractYear,
  // Matchers
  matchLot,
  matchLotAgainstHunts,
  buildBodyStyleRegex,
  // Fingerprints
  generateTriggerFingerprint,
  // Constants
  BODY_STYLE_SYNONYMS,
  MAKE_SYNONYMS,
  MODEL_SYNONYMS,
  PARSER_VERSION,
};
