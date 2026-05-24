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

async function generateShareCard(score, verdict) {
    await document.fonts.ready;

    const W = 520, H = 320;
    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
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

async function downloadShareCard(score, verdict) {
    const canvas = await generateShareCard(score, verdict);
    const a = document.createElement('a');
    a.download = 'she-rated-me.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
}

function shareToX(score, verdict) {
    const text = `She rated me ${score.toFixed(1)}/10.\n\n"${verdict}"`;
    const params = new URLSearchParams({
        text,
        url: 'https://' + SITE_URL,
        via: 'Mordraga0',
    });
    window.open('https://twitter.com/intent/tweet?' + params, '_blank', 'noopener,noreferrer');
}
