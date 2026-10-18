/* Motion export — renders a project to GIF, APNG, WebM (with alpha) or MP4 in the visitor's browser,
   for hosts with no render server behind the editor. editor.js loads it on demand:
       import('./export.js').then(m => m.exportProject(project, { format: 'webm', onProgress, signal }))  → Blob

   Same frames as render.py: player.html + runtime.js seek each moment. Instead of a screenshot, the stage is
   serialized into an SVG <foreignObject> and drawn onto a canvas. An SVG drawn as an image can't fetch
   anything, so fonts, images and CSS url()s are inlined as data: URLs first.

   GIF   gifenc quantizes and LZW-packs each frame; cropped to what's ever visible, alpha on/off at 50% (as render.py)
   APNG  written here: full alpha, each frame stored as just its visible rectangle
   WebM  WebCodecs won't encode alpha, so colour and alpha go through two VP9 encoders and are muxed the way
         libvpx does it — the alpha frame rides along as a BlockAdditional. OBS and browsers play it transparent.
   MP4   H.264 over black (MP4 has no alpha), muxed by mp4-muxer. */

const GIFENC = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js';
const MP4_MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs';

// GIF stores frame delays in 1/100 s, and players slow anything under 2/100 s down to a crawl
const GIF_FPS = 50;

export const FORMATS = {
  webm: { label: 'WebM (alpha)', type: 'video/webm' },
  mp4: { label: 'MP4 (no alpha)', type: 'video/mp4' },
  gif: { label: 'GIF (cropped, loops)', type: 'image/gif' },
  apng: { label: 'APNG (cropped, loops)', type: 'image/apng', ext: 'png' }
};

export async function exportProject(project, { format = 'webm', onProgress = () => {}, signal } = {}) {
  if (!FORMATS[format]) throw new Error('Unknown format ' + format);
  if ((format === 'webm' || format === 'mp4') && typeof VideoEncoder === 'undefined') {
    throw new Error('This browser can\'t encode video (no WebCodecs) — try Chrome, Edge or Firefox, or export a GIF/APNG');
  }
  const player = await openPlayer(project);
  try {
    const { info } = player;
    const fps = format === 'gif' ? GIF_FPS : info.fps || 60;
    const count = Math.max(1, Math.round(info.duration * fps / 1000));
    // 4:2:0 video needs even sizes; the extra row/column stays transparent
    const even = format === 'webm' || format === 'mp4';
    const W = even ? info.width + (info.width & 1) : info.width;
    const H = even ? info.height + (info.height & 1) : info.height;

    onProgress(0, count, 'Preparing');
    const draw = await rasterizer(player, W, H);
    const out = await ENCODERS[format](W, H, fps, count, info.duration);
    for (let i = 0; i < count; i++) {
      if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const canvas = await draw(i * 1000 / fps);
      await out.add(canvas, i);
      onProgress(i + 1, count, 'Drawing');
    }
    onProgress(count, count, 'Encoding');
    return new Blob(await out.finish(), { type: FORMATS[format].type });
  } finally {
    player.close();
  }
}

// ════════ DRAWING FRAMES ════════

// player.html, off-screen, with the project loaded — the same page render.py captures
async function openPlayer(project) {
  const width = Number(project.width) || 1920, height = Number(project.height) || 1080;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.style.cssText = 'position:fixed; top:0; left:' + -(width + 100) + 'px; width:' + width + 'px; height:' +
    height + 'px; border:0; opacity:0; pointer-events:none;';
  const loaded = new Promise((done, fail) => { frame.onload = done; frame.onerror = fail; });
  frame.src = new URL('player.html?render', import.meta.url).href;
  document.body.appendChild(frame);
  try {
    await loaded;
    const win = frame.contentWindow;
    const info = await win.motion.load(project);
    return { info, win, project, stage: win.document.getElementById('stage'), scene: win.motion.scene,
             close: () => frame.remove() };
  } catch (err) {
    frame.remove();
    throw err;
  }
}

const dataUrls = new Map();
function toDataUrl(url) {
  if (!dataUrls.has(url)) {
    dataUrls.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.blob();
    }).then(blob => new Promise((done, fail) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result);
      reader.onerror = fail;
      reader.readAsDataURL(blob);
    })).catch(() => ''));
  }
  return dataUrls.get(url);
}

// url(...) → url(data:...); url(#id) points inside the document and stays
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
async function inlineUrls(css, base) {
  const urls = new Map();
  css.replace(CSS_URL, (m, q, u) => {
    if (!/^(data:|#)/i.test(u)) urls.set(u, toDataUrl(new URL(u, base).href));
    return m;
  });
  for (const [u, p] of urls) urls.set(u, await p);
  return css.replace(CSS_URL, (m, q, u) => urls.get(u) ? 'url("' + urls.get(u) + '")' : m);
}

// does a unicode-range like "U+0000-00FF, U+0131, U+4??" cover any of these code points?
function covers(range, points) {
  return range.split(',').some(part => {
    const m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part);
    if (!m) return true;
    const lo = parseInt(m[1].replace(/\?/g, '0'), 16);
    const hi = parseInt(m[2] || m[1].replace(/\?/g, 'f'), 16);
    for (const p of points) if (p >= lo && p <= hi) return true;
    return false;
  });
}

// the project's font stylesheets, with only the faces its text needs, fonts inlined
async function fontCss(hrefs, points) {
  let out = '';
  for (const href of hrefs) {
    let css;
    try { css = await (await fetch(href)).text(); } catch (err) { continue; }
    for (const face of css.match(/@font-face\s*\{[^}]*\}/g) || []) {
      const range = /unicode-range\s*:\s*([^;}]+)/i.exec(face);
      if (range && !covers(range[1], points)) continue;
      out += await inlineUrls(face, href) + '\n';
    }
  }
  return out;
}

// returns draw(ms) → a canvas holding that moment, transparent where nothing is
async function rasterizer(player, W, H) {
  const { win, stage, scene, project, info } = player;
  const base = win.location.href;

  // everything the document points at becomes a data: URL, once
  for (const img of stage.querySelectorAll('img[src]')) {
    if (!/^data:/i.test(img.getAttribute('src'))) img.src = await toDataUrl(new URL(img.getAttribute('src'), base).href);
  }
  for (const img of stage.querySelectorAll('image')) {
    for (const attr of ['href', 'xlink:href']) {
      const v = img.getAttribute(attr);
      if (v && !/^(data:|#)/i.test(v)) img.setAttribute(attr, await toDataUrl(new URL(v, base).href));
    }
  }
  for (const el of stage.querySelectorAll('[style*="url("]')) {
    el.setAttribute('style', await inlineUrls(el.getAttribute('style'), base));
  }

  const docCss = scene.style.textContent;
  const points = new Set();
  for (const ch of stage.textContent + docCss) points.add(ch.codePointAt(0));
  const css = 'html, body { margin: 0; padding: 0; background: transparent; }\n' +
    '#stage { position: relative; overflow: hidden; }\n' +
    await fontCss(project.fonts || [], points) +
    // the document's root here is the <svg>, so :root rules go to <html> instead
    (await inlineUrls(docCss, base)).replace(/:root\b/g, 'html');

  const head = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '">' +
    '<foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' +
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><style><![CDATA[' +
    css.replace(/\]\]>/g, ']]]]><![CDATA[>') + ']]></style></head><body>';
  const tail = '</body></html></foreignObject></svg>';
  const serializer = new XMLSerializer();

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let checked = false;
  return async function draw(ms) {
    scene.apply(ms);
    // a data: URL, not a blob: one — Chrome marks a canvas unreadable after drawing a blob: SVG with HTML in it
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(head + serializer.serializeToString(stage) + tail);
    try {
      await img.decode();
    } catch (err) {
      throw new Error('a frame could not be drawn (' + (err.message || err) + ')');
    }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0);
    if (!checked) {
      try { ctx.getImageData(0, 0, 1, 1); } catch (err) {
        throw new Error('this browser won\'t let a page read back what it drew (Safari does this) — try Chrome, Edge or Firefox');
      }
      checked = true;
    }
    return canvas;
  };
}

// ════════ PIXELS ════════

function pixels(canvas) {
  return canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
}

// the rectangle holding every pixel at least this opaque, or null
function alphaBox(img, threshold) {
  const { data, width, height } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    let row = y * width * 4 + 3;
    for (let x = 0; x < width; x++, row += 4) {
      if (data[row] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(img, b) {
  const out = new Uint8Array(b.w * b.h * 4);
  for (let y = 0; y < b.h; y++) {
    const from = ((b.y + y) * img.width + b.x) * 4;
    out.set(img.data.subarray(from, from + b.w * 4), y * b.w * 4);
  }
  return out;
}

function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

const EMPTY = { x: 0, y: 0, w: 1, h: 1 };

// ════════ ENCODERS ════════
// each: (W, H, fps, count, durationMs) → { add(canvas, index), finish() → Blob parts }

const ENCODERS = { gif: gifEncoder, apng: apngEncoder, webm: webmEncoder, mp4: mp4Encoder };

// ── GIF: one palette per frame (255 colours + a transparent slot), each frame only its visible rectangle,
//    the canvas cut to what's ever visible. GIF alpha is on/off: pixels under half opacity drop out.
async function gifEncoder(W, H, fps) {
  const { GIFEncoder, quantize, applyPalette } = await import(GIFENC);
  const frames = [];
  let all = null;
  return {
    add(canvas) {
      const img = pixels(canvas);
      const box = alphaBox(img, 128);
      const b = box || EMPTY;
      const rgba = crop(img, b);
      const solid = [];
      for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] >= 128) solid.push(i);
      const opaque = new Uint8Array(Math.max(1, solid.length) * 4);
      solid.forEach((i, n) => { opaque.set(rgba.subarray(i, i + 3), n * 4); opaque[n * 4 + 3] = 255; });
      const palette = solid.length ? quantize(opaque, 255, { format: 'rgb565' }) : [[0, 0, 0]];
      const index = applyPalette(rgba, palette, 'rgb565');
      const clear = palette.length;
      palette.push([0, 0, 0]);
      for (let i = 0, p = 3; i < index.length; i++, p += 4) if (rgba[p] < 128) index[i] = clear;
      const g = GIFEncoder({ auto: false });
      // dispose 2: clear the frame's rectangle before the next one
      g.writeFrame(index, b.w, b.h, { palette, delay: 1000 / fps, transparent: true, transparentIndex: clear, dispose: 2 });
      frames.push({ bytes: g.bytes(), box });
      all = union(all, box);
    },
    finish() {
      const screen = all || EMPTY;
      const head = new Uint8Array(13 + 19);
      const v = new DataView(head.buffer);
      head.set([...'GIF89a'].map(c => c.charCodeAt(0)));
      v.setUint16(6, screen.w, true);
      v.setUint16(8, screen.h, true);
      // no global palette; then NETSCAPE2.0, loop forever
      head.set([0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map(c => c.charCodeAt(0)), 0x03, 0x01, 0, 0, 0], 13);
      // gifenc writes each frame at 0,0: its graphic control block is 8 bytes, then the image descriptor
      for (const f of frames) {
        const d = new DataView(f.bytes.buffer, f.bytes.byteOffset);
        d.setUint16(9, f.box ? f.box.x - screen.x : 0, true);
        d.setUint16(11, f.box ? f.box.y - screen.y : 0, true);
      }
      return [head, ...frames.map(f => f.bytes), Uint8Array.of(0x3b)];
    }
  };
}

// ── APNG: full alpha. The canvas is cut to what's ever visible; every frame after the first is just its
//    own visible rectangle, cleared before the next. Compressed as it goes, so long clips stay small in memory.
async function apngEncoder(W, H, fps) {
  if (typeof CompressionStream === 'undefined') throw new Error('This browser can\'t compress PNGs (no CompressionStream)');
  const frames = [];
  let all = null, first = null;
  return {
    async add(canvas, i) {
      const img = pixels(canvas);
      const box = alphaBox(img, 1);
      all = union(all, box);
      if (i === 0) {
        // the first frame is the PNG's own image and must fill the canvas, which isn't known until the end
        first = { box, rgba: box && crop(img, box) };
        return;
      }
      const b = box || EMPTY;
      frames.push({ box, data: await deflate(filterRows(crop(img, b), b.w, b.h)) });
    },
    async finish() {
      const screen = all || EMPTY;
      const full = new Uint8Array(screen.w * screen.h * 4);
      if (first.box) {
        for (let y = 0; y < first.box.h; y++) {
          full.set(first.rgba.subarray(y * first.box.w * 4, (y + 1) * first.box.w * 4),
            ((first.box.y - screen.y + y) * screen.w + first.box.x - screen.x) * 4);
        }
      }
      const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)];
      parts.push(chunk('IHDR', be(4, screen.w, 4, screen.h, 1, 8, 1, 6, 1, 0, 1, 0, 1, 0)));
      parts.push(chunk('acTL', be(4, frames.length + 1, 4, 0)));
      let seq = 0;
      // delay = 100 / (fps * 100) s; dispose 1: clear to transparent, blend 0: replace
      const control = (b, w, h) => chunk('fcTL', be(4, seq++, 4, w, 4, h, 4, b ? b.x - screen.x : 0,
        4, b ? b.y - screen.y : 0, 2, 100, 2, Math.round(fps * 100), 1, 1, 1, 0));
      parts.push(control(null, screen.w, screen.h));
      parts.push(chunk('IDAT', await deflate(filterRows(full, screen.w, screen.h))));
      for (const f of frames) {
        const b = f.box || EMPTY;
        parts.push(control(f.box, b.w, b.h));
        const data = new Uint8Array(4 + f.data.length);
        new DataView(data.buffer).setUint32(0, seq++);
        data.set(f.data, 4);
        parts.push(chunk('fdAT', data));
      }
      parts.push(chunk('IEND', new Uint8Array(0)));
      return parts;
    }
  };
}

// PNG rows, each with the Sub filter (difference from the pixel to the left)
function filterRows(rgba, w, h) {
  const stride = w * 4, out = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1), r = y * stride;
    out[o] = 1;
    for (let x = 0; x < stride; x++) out[o + 1 + x] = rgba[r + x] - (x >= 4 ? rgba[r + x - 4] : 0);
  }
  return out;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// big-endian fields: be(4, value, 2, value, 1, value, …)
function be(...fields) {
  let size = 0;
  for (let i = 0; i < fields.length; i += 2) size += fields[i];
  const out = new Uint8Array(size), v = new DataView(out.buffer);
  for (let i = 0, o = 0; i < fields.length; o += fields[i], i += 2) {
    if (fields[i] === 4) v.setUint32(o, fields[i + 1]);
    else if (fields[i] === 2) v.setUint16(o, fields[i + 1]);
    else v.setUint8(o, fields[i + 1]);
  }
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// ── video plumbing shared by WebM and MP4

async function pickCodec(codecs, W, H, fps, bitrate) {
  for (const codec of codecs) {
    const config = { codec, width: W, height: H, framerate: fps, bitrate, latencyMode: 'quality' };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return config; } catch (err) {}
  }
  return null;
}

function videoEncoder(config, onChunk) {
  let failed = null;
  const enc = new VideoEncoder({ output: onChunk, error: err => { failed = err; } });
  enc.configure(config);
  return {
    async encode(frame, key) {
      if (failed) throw failed;
      // don't let frames pile up faster than the encoder takes them
      while (enc.encodeQueueSize > 8) await new Promise(done => setTimeout(done, 5));
      enc.encode(frame, { keyFrame: key });
      frame.close();
    },
    async flush() {
      if (failed) throw failed;
      await enc.flush();
      enc.close();
      if (failed) throw failed;
    }
  };
}

function bitrateFor(W, H, fps) {
  return Math.round(Math.min(40e6, Math.max(2e6, W * H * fps * 0.12)));
}

// ── WebM: VP9 colour + VP9 alpha (the alpha plane encoded as the luma of a second stream)
async function webmEncoder(W, H, fps, count, durationMs) {
  const bitrate = bitrateFor(W, H, fps);
  const VP9 = ['vp09.00.41.08', 'vp09.00.40.08', 'vp09.00.10.08'];
  const colorConfig = await pickCodec(VP9, W, H, fps, bitrate);
  const alphaConfig = await pickCodec(VP9, W, H, fps, Math.round(bitrate / 3));
  if (!colorConfig || !alphaConfig) throw new Error('This browser can\'t encode VP9 video — try Chrome or Edge, or export a GIF/APNG');

  const colors = new Map(), alphas = new Map();
  const color = videoEncoder(colorConfig, (c, meta) => colors.set(c.timestamp, copyChunk(c)));
  const alpha = videoEncoder(alphaConfig, (c, meta) => alphas.set(c.timestamp, copyChunk(c)));
  const keyEvery = Math.max(1, Math.round(fps * 2));
  const space = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

  return {
    async add(canvas, i) {
      const { color: yuv, alpha: a } = toI420(pixels(canvas).data, W, H);
      const init = { format: 'I420', codedWidth: W, codedHeight: H, timestamp: Math.round(i * 1e6 / fps),
                     duration: Math.round(1e6 / fps), colorSpace: space };
      await color.encode(new VideoFrame(yuv, init), i % keyEvery === 0);
      await alpha.encode(new VideoFrame(a, init), i % keyEvery === 0);
    },
    async finish() {
      await Promise.all([color.flush(), alpha.flush()]);
      const frames = [...colors.keys()].sort((a, b) => a - b).map(ts => ({
        ms: Math.round(ts / 1000), key: colors.get(ts).key, data: colors.get(ts).data,
        alpha: alphas.has(ts) ? alphas.get(ts).data : null
      }));
      return muxWebm(frames, W, H, fps, durationMs);
    }
  };
}

function copyChunk(c) {
  const data = new Uint8Array(c.byteLength);
  c.copyTo(data);
  return { key: c.type === 'key', data };
}

// RGBA (straight alpha) → BT.709 limited-range I420, plus a second I420 whose luma is the alpha.
// Chroma averages each 2×2 block weighted by alpha, so invisible pixels don't bleed dark edges.
function toI420(rgba, W, H) {
  const ySize = W * H, cw = W >> 1, ch = H >> 1, cSize = cw * ch;
  const color = new Uint8Array(ySize + 2 * cSize), alpha = new Uint8Array(ySize + 2 * cSize);
  for (let i = 0, p = 0; i < ySize; i++, p += 4) {
    color[i] = 16 + 0.1826 * rgba[p] + 0.6142 * rgba[p + 1] + 0.0620 * rgba[p + 2] + 0.5;
    alpha[i] = rgba[p + 3];
  }
  alpha.fill(128, ySize);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let r = 0, g = 0, b = 0, w = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const p = ((y * 2 + dy) * W + x * 2 + dx) * 4, a = rgba[p + 3] + 1;
          r += rgba[p] * a; g += rgba[p + 1] * a; b += rgba[p + 2] * a; w += a;
        }
      }
      r /= w; g /= w; b /= w;
      const o = y * cw + x;
      color[ySize + o] = 128 - 0.1006 * r - 0.3386 * g + 0.4392 * b + 0.5;
      color[ySize + cSize + o] = 128 + 0.4392 * r - 0.3989 * g - 0.0403 * b + 0.5;
    }
  }
  return { color, alpha };
}

// ── a WebM file, written whole: EBML header, then a segment of SeekHead, Info, Tracks, Clusters, Cues

function idBytes(id) {
  const out = [];
  for (; id > 0; id = Math.floor(id / 256)) out.unshift(id % 256);
  return Uint8Array.from(out);
}

function sizeBytes(n) {
  let len = 1;
  while (n >= 2 ** (7 * len) - 1) len++;
  const out = new Uint8Array(len);
  for (let i = len - 1, v = n; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v % 256;
  out[0] |= 0x80 >> (len - 1);
  return out;
}

function uint(n, width) {
  if (!width) for (width = 1; n >= 2 ** (8 * width); width++);
  const out = new Uint8Array(width);
  for (let i = width - 1, v = n; i >= 0; i--, v = Math.floor(v / 256)) out[i] = v % 256;
  return out;
}

function float64(n) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, n);
  return out;
}

function concat(parts) {
  let size = 0;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  for (let i = 0, o = 0; i < parts.length; o += parts[i].length, i++) out.set(parts[i], o);
  return out;
}

const utf8 = new TextEncoder();
// an element: body is bytes, a number (unsigned int), a string, or a list of child elements
function el(id, body) {
  const bytes = body instanceof Uint8Array ? body
    : typeof body === 'number' ? uint(body)
    : typeof body === 'string' ? utf8.encode(body)
    : concat(body.filter(Boolean));
  return concat([idBytes(id), sizeBytes(bytes.length), bytes]);
}

function muxWebm(frames, W, H, fps, durationMs) {
  const header = el(0x1A45DFA3, [
    el(0x4286, 1), el(0x42F7, 1), el(0x42F2, 4), el(0x42F3, 8),   // EBML versions, max id / size length
    el(0x4282, 'webm'), el(0x4287, 4), el(0x4285, 2)               // DocType, its versions
  ]);
  const info = el(0x1549A966, [
    el(0x2AD7B1, 1000000),                                         // timestamps in ms
    el(0x4D80, 'motion'), el(0x5741, 'motion editor'),
    el(0x4489, float64(durationMs))
  ]);
  const tracks = el(0x1654AE6B, [el(0xAE, [
    el(0xD7, 1), el(0x73C5, 1), el(0x83, 1),                       // track 1, uid 1, video
    el(0x86, 'V_VP9'), el(0x9C, 0), el(0x23E383, Math.round(1e9 / fps)),
    el(0xE0, [
      el(0xB0, W), el(0xBA, H),
      el(0x53C0, 1),                                               // AlphaMode: BlockAdditionals carry alpha
      el(0x55B0, [el(0x55B1, 1), el(0x55B9, 1), el(0x55BA, 1), el(0x55BB, 1)])   // BT.709, limited range
    ])
  ])]);

  // a cluster starts at every keyframe (block times are 16-bit offsets from the cluster's)
  const clusters = [];
  let current = null, prev = 0;
  for (const f of frames) {
    if (!current || f.key || f.ms - current.ms > 30000) {
      current = { ms: f.ms, blocks: [el(0xE7, f.ms)] };
      clusters.push(current);
    }
    const rel = f.ms - current.ms;
    current.blocks.push(el(0xA0, [
      el(0xA1, concat([Uint8Array.of(0x81, (rel >> 8) & 255, rel & 255, 0), f.data])),
      f.key ? null : el(0xFB, Uint8Array.of(((prev - f.ms) >> 8) & 255, (prev - f.ms) & 255)),   // ReferenceBlock
      f.alpha ? el(0x75A1, [el(0xA6, [el(0xEE, 1), el(0xA5, f.alpha)])]) : null                 // BlockAdditions
    ]));
    prev = f.ms;
  }
  const clusterBytes = clusters.map(c => el(0x1F43B675, c.blocks));

  // positions are from the start of the segment's body; written 8 bytes wide so sizes don't shift
  const seek = (id, pos) => el(0x4DBB, [el(0x53AB, idBytes(id)), el(0x53AC, uint(pos, 8))]);
  const seekHead = (a, b, c) => el(0x114D9B74, [seek(0x1549A966, a), seek(0x1654AE6B, b), seek(0x1C53BB6B, c)]);
  const infoAt = seekHead(0, 0, 0).length, tracksAt = infoAt + info.length;
  let at = tracksAt + tracks.length;
  const cuePoints = clusters.map((c, i) => {
    const point = el(0xBB, [el(0xB3, c.ms), el(0xB7, [el(0xF7, 1), el(0xF1, uint(at, 8))])]);
    at += clusterBytes[i].length;
    return point;
  });
  const cues = el(0x1C53BB6B, cuePoints);
  const body = [seekHead(infoAt, tracksAt, at), info, tracks, ...clusterBytes, cues];
  let size = 0;
  for (const p of body) size += p.length;
  return [header, idBytes(0x18538067), sizeBytes(size), ...body];
}

// ── MP4: H.264 (VP9 where there's no H.264 encoder), composited onto black
async function mp4Encoder(W, H, fps) {
  const { Muxer, ArrayBufferTarget } = await import(MP4_MUXER);
  const bitrate = bitrateFor(W, H, fps);
  let config = await pickCodec(['avc1.640033', 'avc1.640028', 'avc1.4d0033', 'avc1.42003e'], W, H, fps, bitrate);
  let codec = 'avc';
  if (config) config.avc = { format: 'avc' };
  else {
    config = await pickCodec(['vp09.00.41.08', 'vp09.00.40.08', 'vp09.00.10.08'], W, H, fps, bitrate);
    codec = 'vp9';
  }
  if (!config) throw new Error('This browser can\'t encode H.264 or VP9 video — export a GIF/APNG instead');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec, width: W, height: H, frameRate: fps },
                            fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  const enc = videoEncoder(config, (c, meta) => muxer.addVideoChunk(c, meta));
  const flat = document.createElement('canvas');
  flat.width = W;
  flat.height = H;
  const ctx = flat.getContext('2d', { alpha: false });
  const keyEvery = Math.max(1, Math.round(fps * 2));

  return {
    async add(canvas, i) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(canvas, 0, 0);
      await enc.encode(new VideoFrame(flat, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) }),
        i % keyEvery === 0);
    },
    async finish() {
      await enc.flush();
      muxer.finalize();
      return [target.buffer];
    }
  };
}
