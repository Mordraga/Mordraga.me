import { state, notify } from './state.js';

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function makeList({ listElId, inputElId, addBtnId, stateKey }) {
  const listEl  = document.getElementById(listElId);
  const inputEl = document.getElementById(inputElId);
  const addBtn  = document.getElementById(addBtnId);

  function add() {
    const val = inputEl?.value.trim();
    if (!val) return;
    state[stateKey].push(val);
    inputEl.value = '';
    refresh();
    notify();
  }

  function remove(i) {
    state[stateKey].splice(i, 1);
    refresh();
    notify();
  }

  function refresh() {
    if (!listEl) return;
    listEl.innerHTML = '';
    state[stateKey].forEach((item, i) => {
      const pill = document.createElement('span');
      pill.className = 'list-pill';
      pill.innerHTML = `${esc(item)} <button class="pill-remove" aria-label="Remove">×</button>`;
      pill.querySelector('.pill-remove').addEventListener('click', () => remove(i));
      listEl.appendChild(pill);
    });
  }

  addBtn?.addEventListener('click', add);
  inputEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); add(); }
  });

  return { refresh };
}
