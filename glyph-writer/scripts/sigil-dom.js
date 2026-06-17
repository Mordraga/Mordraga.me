// File Path: scripts/sigil-dom.js

import {
  sanitizeInput,
  generatePointsAndMap,
  getShuffledGlyphs,
  generateCirclePoints
} from './sigil-logic.js';

import { drawSigil } from './sigil-draw.js';
import { initAlphaColorPicker } from './alpha-color-picker.js';

// === DOM Setup ===
const canvas = document.getElementById('sigilCanvas');
const ctx = canvas?.getContext?.('2d');
let centerX = canvas ? canvas.width / 2 : 0;
let centerY = canvas ? canvas.height / 2 : 0;
let radius = 140;
let lastRender = null;

if (!canvas || !ctx) {
  console.error('sigil-dom: canvas or 2d context not available.');
}

// Glyph sets (escaped to avoid encoding issues)
const GLYPH_SETS = {
  alchemical: [
    '\u2609', '\u263e', '\u263f', '\u2640', '\u2642', '\u2643', '\u2644', '\u2645', '\u2646', '\u2647',
    '\u{1F701}', '\u{1F702}', '\u{1F703}', '\u{1F704}', '\u{1F70D}', '\u{1F70E}', '\u{1F70F}', '\u{1F714}', '\u{1F715}', '\u{1F716}'
  ],
  runic: [
    '\u16A0','\u16A2','\u16A6','\u16A8','\u16B1','\u16B7','\u16B9','\u16BB','\u16BE','\u16C1',
    '\u16C7','\u16C8','\u16C9','\u16CB','\u16CF','\u16D2','\u16D6','\u16D7','\u16DA','\u16DC'
  ],
  greek: [
    '\u0391','\u0392','\u0393','\u0394','\u0395','\u0396','\u0397','\u0398','\u0399','\u039A',
    '\u039B','\u039C','\u039D','\u039E','\u039F','\u03A0','\u03A1','\u03A3','\u03A4','\u03A5'
  ],
  coptic: [
    '\u03E2','\u03E4','\u03E6','\u03E8','\u03EA','\u03EC','\u03EE','\u03F0','\u03F2','\u03F4',
    '\u2C80','\u2C82','\u2C84','\u2C86','\u2C88','\u2C8A','\u2C8C','\u2C8E','\u2C90','\u2C92'
  ],
  ogham: [
    '\u1680','\u1681','\u1683','\u1684','\u1685','\u1686','\u1687','\u1688','\u1689','\u168A',
    '\u168B','\u168C','\u168D','\u168E','\u1690','\u1691','\u1692','\u1693','\u1694','\u1695'
  ],
  hieroglyphs: [
    '\u{13000}','\u{13001}','\u{13002}','\u{13005}','\u{13006}','\u{13007}','\u{13008}','\u{13009}','\u{1300A}','\u{1300B}',
    '\u{1300C}','\u{1300D}','\u{1300E}','\u{1300F}','\u{13010}','\u{13011}','\u{13012}','\u{13013}','\u{13014}','\u{13015}'
  ]
};

const settingsCard = document.querySelector('.settings-card');
const rerenderEvents = ['input', 'change'];
const clamp = (val, min, max) => Math.min(max, Math.max(min, val));
const readNumber = (id, fallback = 0) => {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const raw = el.value;
  const num = typeof raw === 'string' ? parseFloat(raw) : Number(raw);
  return Number.isFinite(num) ? num : fallback;
};
let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    handleGenerate();
  });
}
function bindControl(el) {
  if (!el) return;
  rerenderEvents.forEach(evt => el.addEventListener(evt, requestRender));
}
function syncCanvasSize() {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const safeWidth = rect.width || canvas.width || 400;
  const safeHeight = rect.height || canvas.height || 400;
  canvas.width = safeWidth * dpr;
  canvas.height = safeHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  centerX = safeWidth / 2;
  centerY = safeHeight / 2;
  const baseRadius = Math.min(safeWidth, safeHeight) / 2 - 20;
  radius = Math.max(60, baseRadius);
}

const generateBtn = document.getElementById('generateBtn');
if (generateBtn) {
  generateBtn.addEventListener('click', requestRender);
  bindControl(generateBtn);
}
const textInput = document.getElementById('sigilText');
bindControl(textInput);
const exportBtn = document.getElementById('exportBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', () => {
    handleGenerate();
    exportSigil();
  });
  rerenderEvents.forEach(evt => exportBtn.addEventListener(evt, requestRender));
}

const CONTROL_IDS = [
  'stripVowels',
  'showGlyphs',
  'showOuterLabels',
  'showInnerLabels',
  'enforceSpacing',
  'rotationOffset',
  'lineWidth',
  'lineColor',
  'backgroundColor',
  'backgroundAlpha',
  'backgroundRingOffset',
  'shadowBlur',
  'shadowAlpha',
  'exportFormat',
  'exportQuality',
  'exportWidth',
  'exportHeight',
  'glyphSet',
  'closePath'
];
CONTROL_IDS.forEach(id => bindControl(document.getElementById(id)));
document.querySelectorAll('.settings-card input, .settings-card select').forEach(bindControl);
// Keep resize in sync for high-DPI and mobile browsers.
window.addEventListener('resize', () => {
  syncCanvasSize();
  requestRender();
});

initAlphaColorPicker({
  colorInputId: 'backgroundColor',
  alphaInputId: 'backgroundAlpha',
  alphaLabelId: 'backgroundAlphaValue',
  onChange: handleGenerate
});
updateExportQualityLabel();
updateBackgroundRingLabel();
syncCanvasSize();
requestRender();

// === Main Generate Handler ===
function handleGenerate() {
  if (!canvas || !ctx) return;
  const text = document.getElementById('sigilText').value;
  const stripVowels = document.getElementById('stripVowels').checked;
  const showGlyphToggle = document.getElementById('showGlyphs');
  const showOuterGlyphs = showGlyphToggle ? showGlyphToggle.checked : true;
  const showOuterLabels = document.getElementById('showOuterLabels')?.checked ?? false;
  const showInnerLabels = document.getElementById('showInnerLabels')?.checked ?? false;
  const enforceSpacing = document.getElementById('enforceSpacing')?.checked ?? false;
  const rotationOffsetDeg = readNumber('rotationOffset', 0);
  const lineWidth = readNumber('lineWidth', 2);
  const lineColor = document.getElementById('lineColor')?.value || '#222222';
  const glyphSet = document.getElementById('glyphSet')?.value || 'alchemical';
  const glyphSource = GLYPH_SETS[glyphSet] || GLYPH_SETS.alchemical;
  const bgHex = document.getElementById('backgroundColor')?.value || '#fafafa';
  const bgAlphaRaw = readNumber('backgroundAlpha', 0);
  // Slider is transparency (0 = opaque, 1 = fully transparent)
  const bgAlpha = 1 - clamp(bgAlphaRaw, 0, 1);
  const backgroundColor = composeRgba(bgHex, bgAlpha);
  const backgroundRingOffset = readNumber('backgroundRingOffset', 0);
  const shadowBlur = readNumber('shadowBlur', 0);
  const shadowAlpha = readNumber('shadowAlpha', 0);
  const closePath = document.getElementById('closePath')?.checked ?? false;
  const rotationLabel = document.getElementById('rotationValue');
  if (rotationLabel) rotationLabel.textContent = `${rotationOffsetDeg}`;
  updateExportQualityLabel();
  updateBackgroundRingLabel();

  let symbols = sanitizeInput(text, stripVowels);
  if (symbols.length === 0 && lastRender?.symbols?.length) {
    symbols = [...lastRender.symbols];
  }
  if (symbols.length === 0) {
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    if (backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }
    lastRender = null;
    return;
  }

  const { points, symbolMap } = generatePointsAndMap(
    symbols,
    centerX,
    centerY,
    radius,
    {
      enforceSpacing,
      rotationOffset: (rotationOffsetDeg * Math.PI) / 180
    }
  );

  const glyphs = showOuterGlyphs
    ? getShuffledGlyphs(glyphSource, symbols.length)
    : Array(symbols.length).fill(""); // empty string placeholders

  drawSigil(ctx, centerX, centerY, radius, {
    points,
    symbolMap,
    symbols,
    outerGlyphs: glyphs,
    showOuterGlyphs,
    showOuterLabels,
    showInnerLabels,
    lineColor,
    lineWidth,
    backgroundColor,
    backgroundRingOffset,
    shadowBlur,
    shadowAlpha,
    closePath
  });

  lastRender = {
    points,
    symbolMap,
    symbols,
    centerX,
    centerY,
    radius,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    options: {
      outerGlyphs: glyphs,
      showOuterGlyphs,
      showOuterLabels,
      showInnerLabels,
      lineColor,
      lineWidth,
      backgroundColor,
      backgroundRingOffset,
      shadowBlur,
      shadowAlpha,
      closePath,
      outerRingOffset: 20,
      lineCap: 'round',
      lineJoin: 'round',
      endPointStyle: 'dot'
    }
  };
}

// === Export Handler ===
function exportSigil() {
  const format = document.getElementById('exportFormat')?.value || 'png';
  const qualityRaw = parseFloat(document.getElementById('exportQuality')?.value || '0.92');
  const quality = Math.max(0.5, Math.min(1, qualityRaw));
  const targetWidth = parseInt(document.getElementById('exportWidth')?.value || canvas.width, 10);
  const targetHeight = parseInt(document.getElementById('exportHeight')?.value || canvas.height, 10);

  if (format === 'svg') {
    if (!lastRender) return;
    const svg = renderToSvg(lastRender, targetWidth, targetHeight);
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const link = document.createElement('a');
    link.download = 'sigil.svg';
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    return;
  }

  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const temp = document.createElement('canvas');
  temp.width = targetWidth;
  temp.height = targetHeight;
  const tctx = temp.getContext('2d');

  // Draw the current canvas scaled to target size.
  tctx.drawImage(canvas, 0, 0, temp.width, temp.height);

  // If exporting JPEG, flatten transparent pixels with a circular fill
  if (format === 'jpeg') {
    const bgHex = document.getElementById('backgroundColor')?.value || '#ffffff';
    const renderRadius = lastRender?.radius ?? radius;
    const renderBgRing = lastRender?.options?.backgroundRingOffset ?? 0;
    const renderOuterOffset = lastRender?.options?.outerRingOffset ?? 20;
    const scaleX = targetWidth / (lastRender?.canvasWidth || canvas.width);
    const scaleY = targetHeight / (lastRender?.canvasHeight || canvas.height);
    const scale = Math.min(scaleX, scaleY);
    const bgRadius = (renderRadius + renderOuterOffset + renderBgRing) * scale;
    tctx.globalCompositeOperation = 'destination-over';
    tctx.fillStyle = bgHex;
    tctx.beginPath();
    tctx.arc(temp.width / 2, temp.height / 2, bgRadius, 0, Math.PI * 2);
    tctx.fill();
    tctx.globalCompositeOperation = 'source-over';
  }

  const dataUrl = format === 'jpeg'
    ? temp.toDataURL(mime, quality)
    : temp.toDataURL(mime);

  const link = document.createElement('a');
  link.download = format === 'jpeg' ? 'sigil.jpg' : 'sigil.png';
  link.href = dataUrl;
  link.click();
}

function updateExportQualityLabel() {
  const label = document.getElementById('exportQualityValue');
  if (!label) return;
  const q = parseFloat(document.getElementById('exportQuality')?.value || '0.92');
  label.textContent = `${Math.round(q * 100)}%`;
}

function updateBackgroundRingLabel() {
  const label = document.getElementById('backgroundRingValue');
  if (!label) return;
  const val = parseFloat(document.getElementById('backgroundRingOffset')?.value || '0');
  label.textContent = `${Math.round(val)} px`;
}

function composeRgba(hex, alpha) {
  const clean = (hex || '').replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const a = clamp(isFinite(alpha) ? alpha : 1, 0, 1);
  if (a <= 0) return null;
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function renderToSvg(render, targetWidth, targetHeight) {
  const {
    points,
    symbolMap,
    symbols,
    centerX,
    centerY,
    radius,
    canvasWidth,
    canvasHeight,
    options
  } = render;

  const {
    outerGlyphs = [],
    showOuterGlyphs = true,
    showOuterLabels = false,
    showInnerLabels = false,
    lineColor = '#222',
    lineWidth = 2,
    backgroundColor = null,
    backgroundRingOffset = 0,
    shadowBlur = 0,
    shadowAlpha = 0,
    closePath = false,
    outerRingOffset = 20,
    lineCap = 'round',
    lineJoin = 'round',
    endPointStyle = 'dot'
  } = options || {};

  const scaleX = targetWidth / canvasWidth;
  const scaleY = targetHeight / canvasHeight;
  const scale = Math.min(scaleX, scaleY);
  const toScale = (val) => val * scale;
  const sx = (x) => x * scale;
  const sy = (y) => y * scale;

  const scaledPoints = points.map(p => ({ x: sx(p.x), y: sy(p.y) }));
  const scaledCenterX = sx(centerX);
  const scaledCenterY = sy(centerY);
  const scaledRadius = toScale(radius);
  const scaledBgRadius = toScale(radius + outerRingOffset + backgroundRingOffset);

  const glyphPoints = generateCirclePoints(
    outerGlyphs.length,
    scaledCenterX,
    scaledCenterY,
    toScale(radius + outerRingOffset)
  );

  const pathPoints = symbols.map(s => {
    const idx = symbolMap?.[s];
    return idx == null ? null : scaledPoints?.[idx];
  }).filter(Boolean);

  const pathD = pathPoints.length
    ? `M ${pathPoints.map((p) => `${p.x} ${p.y}`).join(' L ')}${closePath ? ' Z' : ''}`
    : '';

  const shadowAttrs = shadowBlur > 0 && shadowAlpha > 0
    ? `filter="url(#shadowFilter)"`
    : '';

  const svgParts = [];
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${targetWidth}" height="${targetHeight}" viewBox="0 0 ${targetWidth} ${targetHeight}">`);

  if (shadowBlur > 0 && shadowAlpha > 0) {
    svgParts.push(`<defs><filter id="shadowFilter" x="-50%" y="-50%" width="200%" height="200%">`);
    svgParts.push(`<feDropShadow dx="0" dy="0" stdDeviation="${shadowBlur}" flood-color="${lineColor}" flood-opacity="${shadowAlpha}"/>`);
    svgParts.push(`</filter></defs>`);
  }

  if (backgroundColor) {
    svgParts.push(`<circle cx="${scaledCenterX}" cy="${scaledCenterY}" r="${scaledBgRadius}" fill="${backgroundColor}" />`);
  }

  svgParts.push(`<circle cx="${scaledCenterX}" cy="${scaledCenterY}" r="${scaledRadius}" fill="none" stroke="${lineColor}" stroke-width="${lineWidth}" ${shadowAttrs}/>`);
  svgParts.push(`<circle cx="${scaledCenterX}" cy="${scaledCenterY}" r="5" fill="${lineColor}" ${shadowAttrs}/>`);

  if (showOuterGlyphs && outerGlyphs.length) {
    outerGlyphs.forEach((g, i) => {
      const pt = glyphPoints[i];
      svgParts.push(`<text x="${pt.x}" y="${pt.y}" fill="${lineColor}" font-family="serif" font-size="18" text-anchor="middle" dominant-baseline="middle">${g}</text>`);
      if (showOuterLabels && symbols[i]) {
        svgParts.push(`<text x="${pt.x}" y="${pt.y + 16}" fill="${lineColor}" font-family="monospace" font-size="12" text-anchor="middle" dominant-baseline="middle">${symbols[i]}</text>`);
      }
    });
  }

  if (pathD) {
    svgParts.push(`<path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="${lineWidth}" stroke-linecap="${lineCap}" stroke-linejoin="${lineJoin}" ${shadowAttrs}/>`);
  }

  if (showInnerLabels) {
    symbols.forEach(symbol => {
      const ptIndex = symbolMap?.[symbol];
      const pt = scaledPoints?.[ptIndex];
      if (!pt) return;
      const dx = pt.x - scaledCenterX;
      const dy = pt.y - scaledCenterY;
      const mag = Math.hypot(dx, dy);
      if (mag === 0) return;
      const offsetX = (dx / mag) * 8;
      const offsetY = (dy / mag) * 8;
      svgParts.push(`<text x="${pt.x + offsetX}" y="${pt.y + offsetY}" fill="${lineColor}" font-family="monospace" font-size="12" text-anchor="middle" dominant-baseline="middle">${symbol}</text>`);
    });
  }

  if (pathPoints.length) {
    const endPt = pathPoints[pathPoints.length - 1];
    const endRadius = endPointStyle === 'circle' ? 6 : 4;
    svgParts.push(`<circle cx="${endPt.x}" cy="${endPt.y}" r="${endRadius}" fill="${lineColor}" />`);
  }

  svgParts.push(`</svg>`);
  return svgParts.join('');
}
