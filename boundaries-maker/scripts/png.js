import { state } from './state.js';
import { toast } from './toast.js';

const SITE_URL = 'mordraga.me/boundaries-maker';

async function capture() {
  await document.fonts.ready;
  const card = document.querySelector('#card-preview .card');
  if (!card) return null;
  return window.html2canvas(card, {
    backgroundColor: '#0f0d0f',
    scale: 3,
    useCORS: true,
    logging: false,
  });
}

function slug() {
  return (state.name.trim() || 'my')
    .replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase().slice(0, 40);
}

export async function downloadPNG() {
  const btn = document.getElementById('btn-download');
  const original = btn.textContent;
  btn.textContent = 'Rendering…';
  btn.disabled = true;
  try {
    const canvas = await capture();
    if (!canvas) { toast('Fill in the form first.'); return; }
    const a = document.createElement('a');
    a.download = `${slug()}-boundaries-card.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  } catch (e) {
    console.error('png.js:', e);
    toast('Could not generate PNG — try a different browser.');
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

export async function shareCard() {
  const btn = document.getElementById('btn-share');
  const original = btn.textContent;
  btn.textContent = 'Rendering…';
  btn.disabled = true;
  try {
    const canvas = await capture();
    if (!canvas) { toast('Fill in the form first.'); return; }

    const tweetText = `My boundaries & consent card.\n\nMake your own at https://${SITE_URL}`;
    const tweetUrl = 'https://twitter.com/intent/tweet?' + new URLSearchParams({
      text: tweetText,
      via: 'Mordraga0',
    });

    canvas.toBlob(async (blob) => {
      const file = new File([blob], `${slug()}-boundaries-card.png`, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], text: tweetText });
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }
      const a = document.createElement('a');
      a.download = file.name;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => window.open(tweetUrl, '_blank', 'noopener,noreferrer'), 400);
    });
  } catch (e) {
    console.error('png.js shareCard:', e);
    toast('Could not generate PNG — try a different browser.');
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}
