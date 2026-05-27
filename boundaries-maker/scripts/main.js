import { state, subscribe, notify } from './state.js';
import { renderCard } from './render.js';
import { initRoles, refreshChips } from './roles.js';
import { makeList } from './lists.js';
import { downloadPNG, shareCard } from './png.js';

const STORAGE_KEY = 'boundaries-card';

function saveToStorage() {
  const data = { ...state, roles: [...state.roles] };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    Object.assign(state, data);
    state.roles = new Set(data.roles ?? []);
    return true;
  } catch { return false; }
}

subscribe(renderCard);
subscribe(saveToStorage);

const TEXT_FIELDS = [
  ['input-name',       'name'],
  ['input-subtitle',   'subtitle'],
  ['input-url',        'url'],
  ['input-footer',     'footer'],
  ['input-sw-green',   'swGreen'],
  ['input-sw-yellow',  'swYellow'],
  ['input-sw-red',     'swRed'],
  ['input-note',       'note'],
  ['input-dm',         'dm'],
];

function syncInputs() {
  for (const [id, key] of TEXT_FIELDS) {
    const el = document.getElementById(id);
    if (el) el.value = state[key] ?? '';
  }
}

function wireInputs() {
  for (const [id, key] of TEXT_FIELDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('input', () => { state[key] = el.value; notify(); });
  }
}

initRoles();
wireInputs();

const lists = {
  sub:        makeList({ listElId: 'list-sub',   inputElId: 'input-sub',   addBtnId: 'add-sub',   stateKey: 'subItems'   }),
  dom:        makeList({ listElId: 'list-dom',   inputElId: 'input-dom',   addBtnId: 'add-dom',   stateKey: 'domItems'   }),
  both:       makeList({ listElId: 'list-both',  inputElId: 'input-both',  addBtnId: 'add-both',  stateKey: 'bothItems'  }),
  hardLimits: makeList({ listElId: 'list-hard',  inputElId: 'input-hard',  addBtnId: 'add-hard',  stateKey: 'hardLimits' }),
};

document.getElementById('btn-download')?.addEventListener('click', downloadPNG);
document.getElementById('btn-share')?.addEventListener('click', shareCard);
document.getElementById('btn-reset')?.addEventListener('click', () => {
  if (!confirm('Reset all fields?')) return;
  Object.assign(state, {
    name: '', subtitle: '', url: '', footer: '',
    swGreen: '', swYellow: '', swRed: '',
    roles: new Set(), customRoles: [],
    subItems: [], domItems: [], bothItems: [], hardLimits: [],
    note: '', dm: ''
  });
  localStorage.removeItem(STORAGE_KEY);
  syncInputs();
  refreshChips();
  for (const list of Object.values(lists)) list.refresh();
  notify();
});

if (loadFromStorage()) {
  syncInputs();
  refreshChips();
  for (const list of Object.values(lists)) list.refresh();
}

notify();
