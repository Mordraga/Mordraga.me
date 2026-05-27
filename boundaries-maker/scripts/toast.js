let timer = null;

export function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('visible'), 3000);
}
