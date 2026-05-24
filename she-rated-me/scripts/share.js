const SITE_URL = 'mordraga.me/she-rated-me';

// Mirror crypt.css variables
const C = {
    black:    '#080808',
    border:   '#2a1f2a',
    border2:  '#3a2a3a',
    accent:   '#8b1a1a',
    gold:     '#c9a84c',
    textDim:  '#7a6d7a',
    textMute: '#4a3f4a',
};

function drawGradientBar(ctx, y, w) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0,   'transparent');
    g.addColorStop(0.2, C.accent);
    g.addColorStop(0.5, C.gold);
    g.addColorStop(0.8, C.accent);
    g.addColorStop(1,   'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, y, w, 2);
}

function countLines(ctx, text, maxWidth) {
    const words = text.split(' ');
    let line = '', count = 1;
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) { count++; line = word; }
        else line = test;
    }
    return count;
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, y);
            line = word;
            y += lineHeight;
        } else {
            line = test;
        }
    }
    if (line) ctx.fillText(line, x, y);
}

async function generateShareCard(score, verdict, stats = null) {
    await document.fonts.ready;

    const W = 520, SCALE = 4;

    // Pre-measure tag lines so we can size the canvas before drawing
    let tagLines = 0;
    if (stats?.tags?.length) {
        const mCtx = document.createElement('canvas').getContext('2d');
        mCtx.font = '10px "Cinzel Decorative"';
        tagLines = countLines(mCtx, stats.tags.join(' · '), W - 80);
    }
    const H = 320 + (stats ? tagLines * 16 : 0);
    const canvas = document.createElement('canvas');
    canvas.width  = W * SCALE;
    canvas.height = H * SCALE;
    const ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);
    ctx.textAlign = 'center';

    // Background + border
    ctx.fillStyle = C.black;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Gradient bars
    drawGradientBar(ctx, 0, W);
    drawGradientBar(ctx, H - 2, W);

    // Sigil
    ctx.font = '13px "Cinzel Decorative"';
    ctx.letterSpacing = '0.4em';
    ctx.fillStyle = C.accent;
    ctx.fillText('⸸ ✦ ⸸', W / 2, 36);

    // Title
    ctx.font = 'bold 15px "Cinzel Decorative"';
    ctx.letterSpacing = '0.06em';
    ctx.fillStyle = C.gold;
    ctx.fillText("Mordraga's Thoughts on You", W / 2, 60);

    // Divider
    ctx.strokeStyle = C.border2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, 74); ctx.lineTo(W - 40, 74);
    ctx.stroke();

    // "Final Rating" label
    ctx.font = '9px "Cinzel Decorative"';
    ctx.letterSpacing = '0.2em';
    ctx.fillStyle = C.textMute;
    ctx.fillText('FINAL RATING', W / 2, 96);

    // Score box
    ctx.font = 'bold 56px "Cinzel Decorative"';
    ctx.letterSpacing = '0';
    const scoreStr  = score.toFixed(1);
    const boxW = ctx.measureText(scoreStr).width + 48;
    const boxH = 68;
    const boxX = (W - boxW) / 2;
    const boxY = 104;

    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxW, boxH);
    ctx.fillStyle = C.accent;
    ctx.fillText(scoreStr, W / 2, boxY + 50);

    // "Out of 10"
    ctx.font = '9px "Cinzel Decorative"';
    ctx.letterSpacing = '0.2em';
    ctx.fillStyle = C.textMute;
    ctx.fillText('OUT OF 10', W / 2, 192);

    // Verdict
    ctx.font = 'italic 14px "Cormorant Garamond"';
    ctx.letterSpacing = '0.02em';
    ctx.fillStyle = C.textDim;
    wrapText(ctx, verdict, W / 2, 216, W - 80, 20);

    // Stats section
    if (stats) {
        ctx.strokeStyle = C.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(80, 240); ctx.lineTo(W - 80, 240);
        ctx.stroke();

        const u = stats.unit === 'cm' ? 'cm' : '"';
        ctx.font = '9px "Cinzel Decorative"';
        ctx.letterSpacing = '0.1em';
        ctx.fillStyle = C.gold;
        ctx.fillText(`L: ${stats.length}${u}  ·  G: ${stats.girth}${u}`, W / 2, 256);

        if (stats.tags.length) {
            ctx.font = '10px "Cinzel Decorative"';
            ctx.letterSpacing = '0.05em';
            ctx.fillStyle = C.textDim;
            wrapText(ctx, stats.tags.join(' · '), W / 2, 272, W - 80, 16);
        }
    }

    // Footer divider
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, H - 28); ctx.lineTo(W - 40, H - 28);
    ctx.stroke();

    // Attribution
    ctx.font = '9px "Cinzel Decorative"';
    ctx.letterSpacing = '0.1em';
    ctx.fillStyle = C.textMute;
    ctx.fillText('get rated at ' + SITE_URL, W / 2, H - 10);

    return canvas;
}

export async function downloadShareCard(score, verdict, stats = null) {
    const canvas = await generateShareCard(score, verdict, stats);
    const a = document.createElement('a');
    a.download = 'she-rated-me.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
}

export async function shareToX(score, verdict, stats = null) {
    const canvas = await generateShareCard(score, verdict, stats);
    const tweetText = `She rated me ${score.toFixed(1)}/10.\n\n"${verdict}"`;
    const tweetUrl  = 'https://twitter.com/intent/tweet?' + new URLSearchParams({
        text: tweetText,
        url:  'https://' + SITE_URL,
        via:  'Mordraga0',
    });

    canvas.toBlob(async (blob) => {
        const file = new File([blob], 'she-rated-me.png', { type: 'image/png' });

        // Web Share API with file — works on mobile + Chrome/Edge desktop
        if (navigator.canShare?.({ files: [file] })) {
            try {
                await navigator.share({ files: [file], text: tweetText });
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
                // share failed — fall through to download + tweet
            }
        }

        // Desktop fallback: download image, then open tweet window
        const a = document.createElement('a');
        a.download = 'she-rated-me.png';
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(() => window.open(tweetUrl, '_blank', 'noopener,noreferrer'), 400);
    });
}
