// File Path: scripts/sigil-draw.js

import { generateCirclePoints } from './sigil-logic.js';

export function drawSigil(ctx, centerX, centerY, radius, {
  points,
  symbolMap,
  symbols,
  outerGlyphs = [],
  showOuterGlyphs = true,
  showOuterLabels = false,
  showInnerLabels = false,
  lineColor = '#222',
  lineWidth = 2,
  backgroundColor = '#fafafa',
  glyphColor = null,
  labelColor = null,
  outerRingOffset = 20,
  backgroundRingOffset = 0,
  lineCap = 'round',
  lineJoin = 'round',
  endPointStyle = 'dot',
  shadowBlur = 0,
  shadowAlpha = 0,
  closePath = false
}) {
  const { width, height } = ctx.canvas;
  const glyphFill = glyphColor ?? lineColor;
  const labelFill = labelColor ?? lineColor;
  const hasShadow = shadowBlur > 0 && shadowAlpha > 0;
  const shadowColor = hasShadow ? toShadowColor(lineColor, shadowAlpha) : 'transparent';

  ctx.save();
  // Clear and optionally paint background (null => transparent).
  ctx.clearRect(0, 0, width, height);
  if (backgroundColor) {
    const bgRadius = radius + outerRingOffset + backgroundRingOffset;
    ctx.beginPath();
    ctx.fillStyle = backgroundColor;
    ctx.arc(centerX, centerY, bgRadius, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Configure stroke defaults for the sigil
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = lineCap;
  ctx.lineJoin = lineJoin;
  ctx.shadowBlur = hasShadow ? shadowBlur : 0;
  ctx.shadowColor = hasShadow ? shadowColor : 'transparent';
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  drawCircleBase(ctx, centerX, centerY, radius);

  if (showOuterGlyphs && outerGlyphs.length > 0) {
    drawOuterRing(
      ctx,
      centerX,
      centerY,
      radius + outerRingOffset,
      outerGlyphs,
      showOuterLabels ? symbols : [],
      glyphFill,
      labelFill
    );
  }

  const lastPathPoint = drawSigilPath(ctx, points, symbolMap, symbols, closePath);

  if (showInnerLabels) {
    drawSymbolLabels(ctx, centerX, centerY, points, symbolMap, symbols, labelFill);
  }

  if (lastPathPoint) {
    drawEndPoint(ctx, lastPathPoint, endPointStyle, lineColor);
  }

  ctx.restore();
}

export function drawCircleBase(ctx, centerX, centerY, radius) {
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
  ctx.fill();
}

export function drawOuterRing(ctx, centerX, centerY, r, glyphs, labels = [], glyphColor, labelColor) {
  const count = glyphs.length;
  if (count === 0) return;

  const ringPoints = generateCirclePoints(count, centerX, centerY, r);

  for (let i = 0; i < count; i++) {
    const pt = ringPoints[i];

    ctx.font = "18px serif";
    ctx.fillStyle = glyphColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyphs[i], pt.x, pt.y);

    if (labels[i]) {
      ctx.font = "12px monospace";
      ctx.fillStyle = labelColor;
      ctx.fillText(labels[i], pt.x, pt.y + 16);
    }
  }
}

export function drawSigilPath(ctx, points, symbolMap, symbols, closePath = false) {
  if (!symbols || symbols.length === 0) return null;

  const pathPoints = symbols.map((s) => {
    const idx = symbolMap?.[s];
    return idx == null ? null : points?.[idx];
  }).filter(Boolean);

  if (pathPoints.length === 0) return null;

  ctx.beginPath();
  pathPoints.forEach((pt, i) => {
    if (i === 0) ctx.moveTo(pt.x, pt.y);
    else ctx.lineTo(pt.x, pt.y);
  });
  if (closePath) ctx.closePath();
  ctx.stroke();

  return pathPoints[pathPoints.length - 1];
}

export function drawSymbolLabels(ctx, centerX, centerY, points, symbolMap, symbols, labelColor) {
  if (!symbols || symbols.length === 0) return;

  symbols.forEach(symbol => {
    const pt = points?.[symbolMap?.[symbol]];
    if (!pt) return;

    const dx = pt.x - centerX;
    const dy = pt.y - centerY;
    const mag = Math.hypot(dx, dy);
    if (mag === 0) return;

    const offsetX = (dx / mag) * 8;
    const offsetY = (dy / mag) * 8;

    ctx.font = "12px monospace";
    ctx.fillStyle = labelColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(symbol, pt.x + offsetX, pt.y + offsetY);
  });
}

export function drawEndPoint(ctx, pt, style = "dot", color = "#000") {
  if (!pt) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.beginPath();

  switch (style) {
    case "circle":
      ctx.arc(pt.x, pt.y, 6, 0, 2 * Math.PI);
      ctx.stroke();
      break;
    case "cross":
      ctx.moveTo(pt.x - 4, pt.y);
      ctx.lineTo(pt.x + 4, pt.y);
      ctx.moveTo(pt.x, pt.y - 4);
      ctx.lineTo(pt.x, pt.y + 4);
      ctx.stroke();
      break;
    case "dot":
    default:
      ctx.arc(pt.x, pt.y, 4, 0, 2 * Math.PI);
      ctx.fill();
      break;
  }
}

function toShadowColor(hex, alpha) {
  const clean = (hex || '').replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean.padEnd(6, '0').slice(0, 6);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, isFinite(alpha) ? alpha : 1));
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || a <= 0) return 'transparent';
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
