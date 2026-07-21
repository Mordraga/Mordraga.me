import { state } from './state.js';

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderSafewords() {
  const { swGreen, swYellow, swRed } = state;
  if (!swGreen && !swYellow && !swRed) return '';
  const rows = [];
  if (swGreen)  rows.push(`<span class="sw green"><span class="dot">●</span> ${esc(swGreen)}</span>`);
  if (swYellow) rows.push(`<span class="sw yellow"><span class="dot">●</span> ${esc(swYellow)}</span>`);
  if (swRed)    rows.push(`<span class="sw red"><span class="dot">●</span> ${esc(swRed)}</span>`);
  return `<div class="safewords">${rows.join('')}</div>`;
}

function renderRoles() {
  const all = [...state.roles, ...state.customRoles];
  if (!all.length) return '';
  const badges = all.map(r => `<span class="badge">${esc(r)}</span>`).join('');
  return `<div class="bdsm-bar">
    <div class="bdsm-label">Who You're Dealing With</div>
    <div class="badges">${badges}</div>
  </div>`;
}

function renderItems(items) {
  return items.map(i => `<li>${esc(i)}</li>`).join('');
}

function renderColumns() {
  const hasSub  = state.subItems.length > 0;
  const hasDom  = state.domItems.length > 0;
  const hasBoth = state.bothItems.length > 0;
  if (!hasSub && !hasDom && !hasBoth) return '';

  let cols = '';

  if (hasSub && hasDom) {
    cols += `
      <div class="col sub-col">
        <h2 class="yes-header">✦ When I am subbing ✦</h2>
        <ul>${renderItems(state.subItems)}</ul>
      </div>
      <div class="col dom-col">
        <h2 class="no-header">✦ When I am domming ✦</h2>
        <ul>${renderItems(state.domItems)}</ul>
      </div>`;
  } else if (hasSub) {
    cols += `
      <div class="col sub-col col-full">
        <h2 class="yes-header">✦ When I am subbing ✦</h2>
        <ul>${renderItems(state.subItems)}</ul>
      </div>`;
  } else if (hasDom) {
    cols += `
      <div class="col dom-col col-full">
        <h2 class="no-header">✦ When I am domming ✦</h2>
        <ul>${renderItems(state.domItems)}</ul>
      </div>`;
  }

  if (hasBoth) {
    cols += `
      <div class="col both-col">
        <h2 class="both-header">✦ Things I like both domming and subbing ✦</h2>
        <ul>${renderItems(state.bothItems)}</ul>
      </div>`;
  }

  return `<div class="columns">${cols}</div>`;
}

export function renderCard() {
  const wrap = document.getElementById('card-preview');
  if (!wrap) return;

  const hasSomething =
    state.name || state.subtitle || state.url || state.footer ||
    state.swGreen || state.swYellow || state.swRed ||
    state.roles.size || state.customRoles.length ||
    state.subItems.length || state.domItems.length || state.bothItems.length ||
    state.hardLimits.length || state.note || state.dm;

  if (!hasSomething) {
    wrap.innerHTML = '<div class="card-empty">Fill in the form below to build your card.</div>';
    return;
  }

  const name     = esc(state.name)     || 'Your Name';
  const subtitle = esc(state.subtitle) || 'Boundaries &amp; Consent Card';

  let html = `<div class="card">
    <header>
      <div class="sigil">⸸ ✦ ⸸</div>
      <h1>${name}</h1>
      <div class="subtitle">${subtitle}</div>`;

  if (state.url) html += `<div class="url">${esc(state.url)}</div>`;

  html += `</header>`;
  html += renderSafewords();
  html += renderRoles();
  html += renderColumns();

  if (state.hardLimits.length) {
    const items = state.hardLimits.map(i => `<li>${esc(i)}</li>`).join('');
    html += `<div class="hard-limits">
      <h2 class="hard-header">⸸ Hard Limits</h2>
      <ul>${items}</ul>
    </div>`;
  }

  if (state.note) {
    html += `<div class="yellow-note">🟡 ${esc(state.note)}</div>`;
  }

  if (state.dm) {
    html += `<div class="dm-section"><h2>⸸ DM Policy</h2><p>${esc(state.dm)}</p></div>`;
  }

  if (state.footer) html += `<footer>${esc(state.footer)}</footer>`;

  html += `</div>`;
  wrap.innerHTML = html;
}
