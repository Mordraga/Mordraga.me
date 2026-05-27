import { state, notify } from './state.js';

export const PRESET_ROLES = [
  'Dominant', 'Submissive', 'Switch',
  'Master / Mistress', 'Slave', 'Owner', 'Pet',
  'Daddy / Mommy', 'Little',
  'Sadist', 'Masochist',
  'Rigger', 'Rope Bunny',
  'Degrader', 'Degradee',
  'Brat Tamer', 'Brat',
  'Caregiver', 'Middle',
  'Exhibitionist', 'Voyeur',
  'Top', 'Bottom',
];

export function initRoles() {
  const container = document.getElementById('role-chips');
  if (!container) return;
  buildChips(container);

  document.getElementById('custom-role-add')?.addEventListener('click', addCustomRole);
  document.getElementById('custom-role-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); addCustomRole(); }
  });
}

function buildChips(container) {
  container.innerHTML = '';
  for (const role of PRESET_ROLES) {
    const chip = document.createElement('span');
    chip.className = 'role-chip' + (state.roles.has(role) ? ' on' : '');
    chip.textContent = role;
    chip.addEventListener('click', () => toggleRole(role, chip));
    container.appendChild(chip);
  }
}

function toggleRole(role, chip) {
  if (state.roles.has(role)) {
    state.roles.delete(role);
    chip.classList.remove('on');
  } else {
    state.roles.add(role);
    chip.classList.add('on');
  }
  notify();
}

function addCustomRole() {
  const input = document.getElementById('custom-role-input');
  const val = input?.value.trim();
  if (!val) return;
  if (state.customRoles.includes(val) || state.roles.has(val)) {
    input.value = '';
    return;
  }
  state.customRoles.push(val);
  input.value = '';
  refreshCustomList();
  notify();
}

function refreshCustomList() {
  const list = document.getElementById('custom-role-list');
  if (!list) return;
  list.innerHTML = '';
  state.customRoles.forEach((role, i) => {
    const pill = document.createElement('span');
    pill.className = 'custom-pill';
    pill.innerHTML = `${esc(role)} <button class="pill-remove" data-i="${i}" aria-label="Remove">×</button>`;
    pill.querySelector('.pill-remove').addEventListener('click', () => {
      state.customRoles.splice(i, 1);
      refreshCustomList();
      notify();
    });
    list.appendChild(pill);
  });
}

function esc(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function refreshChips() {
  const container = document.getElementById('role-chips');
  if (!container) return;
  container.querySelectorAll('.role-chip').forEach(chip => {
    chip.classList.toggle('on', state.roles.has(chip.textContent));
  });
  refreshCustomList();
}
