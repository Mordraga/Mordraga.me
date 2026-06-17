// File Path: scripts/sigil-logic.js

// === Constants ===
export const VOWELS = ['a', 'e', 'i', 'o', 'u'];

// === Input Cleaning ===
export function graphemeSplit(text) {
  const input = (text ?? "").toString();
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    return [...new Intl.Segmenter().segment(input)].map(s => s.segment);
  }
  // Fallback for environments without Intl.Segmenter
  return Array.from(input);
}

export function sanitizeInput(text, stripVowels = false) {
  const segments = graphemeSplit(text).map(c => c.normalize("NFC"))
    .map(c => c.toLowerCase())
    .filter(c => /\S/.test(c)); // remove whitespace and empty stuff

  const filtered = stripVowels
    ? segments.filter(c => !VOWELS.includes(c))
    : segments;

  return [...new Set(filtered)];
}


// === Geometry ===
export function generateCirclePoints(
  count,
  centerX,
  centerY,
  radius,
  offset = 0
) {
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2 + offset;
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    };
  });
}

// === Fuzzy Spacing Helper ===
export function fuzzyTooClose(
  existing,
  candidate,
  totalPoints,
  penaltyRadius = 2,
  penaltyChance = 0.9
) {
  return existing.some((used) => {
    const diff = Math.abs(used - candidate);
    const wrapped = Math.min(diff, totalPoints - diff);
    return wrapped <= penaltyRadius && Math.random() < penaltyChance;
  });
}

// === Mapping Symbols to Points ===
export function buildSymbolMap(
  symbols,
  totalPoints,
  enforceSpacing = false
) {
  const available = [...Array(totalPoints).keys()];
  const used = [];
  const map = {};

  symbols.forEach((symbol) => {
    let tries = 0;
    let candidate;

    do {
      candidate = available[Math.floor(Math.random() * available.length)];
      tries++;
    } while (
      enforceSpacing &&
      fuzzyTooClose(used, candidate, totalPoints) &&
      tries < 100
    );

    map[symbol] = candidate;
    used.push(candidate);
    available.splice(available.indexOf(candidate), 1);
  });

  return map;
}

// === High-Level Builder (Option A) ===
// This is the contract sigil-dom.js expects
export function generatePointsAndMap(
  symbols,
  centerX,
  centerY,
  radius,
  {
    enforceSpacing = false,
    rotationOffset = 0
  } = {}
) {
  const pointCount = symbols.length;

  const points = generateCirclePoints(
    pointCount,
    centerX,
    centerY,
    radius,
    rotationOffset
  );

  const symbolMap = buildSymbolMap(
    symbols,
    pointCount,
    enforceSpacing
  );

  return { points, symbolMap };
}

// === Utility ===
export function shuffleArray(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// === Glyph Utilities ===
export function getShuffledGlyphs(glyphSet, neededLength) {
  return shuffleArray(glyphSet).slice(0, neededLength);
}

