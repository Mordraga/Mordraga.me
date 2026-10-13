/* Motion editor — select elements of an HTML/SVG document, keyframe them, preview, render.
   Needs editor.html, runtime.js and player.html over http:// (browsers wall off file:// frames).
   serve.py adds saving and rendering; on any other host it saves as downloads and autosaves locally.
   The project object is the only state that matters: html/css source strings + tracks.
   Document edits go through the source (so {{vars}} survive) and reload the preview;
   track edits just recompile the scene, which is instant. */
(function () {
  'use strict';

  var R = MotionRuntime, PROPS = R.PROPS;
  function $(id) { return document.getElementById(id); }

  var FONTS = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@600&family=Cinzel+Decorative:wght@400;700' +
              '&family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&display=swap';
  // elements that are definitions, not things you see — no ids, not in the layer list
  var HIDDEN = 'defs, defs *, clipPath, clipPath *, mask, mask *, linearGradient, linearGradient *, ' +
               'radialGradient, radialGradient *, pattern, pattern *, filter, filter *, symbol, symbol *, ' +
               'style, script, title, desc, metadata, br';
  var LABEL_W = 190, LANE_PAD = 10;

  var project, name = 'untitled', dirty = false;
  var selId = null, selKey = null;          // selKey: { track, key }
  var playhead = 0, playing = false, playStart = 0;
  var undoStack = [], redoStack = [];
  var frame = $('frame'), frameWin = null, frameDoc = null, scene = null, scale = 1;
  var tab = 'element';

  // ════════ PROJECT / HISTORY ════════

  function blank() {
    return { width: 1920, height: 1080, duration: 3000, fps: 60, fonts: [FONTS], vars: {}, css: '', html: '', tracks: [] };
  }

  function setProject(p, n) {
    project = R.normalize(p);
    name = n || 'untitled';
    selId = null; selKey = null; playhead = 0;
    undoStack = []; redoStack = []; dirty = false;
    ensureIds();
    fit();
    reloadDoc();
  }

  function snapshot() { return JSON.stringify(project); }

  function checkpoint() {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
    redoStack = [];
    dirty = true;
  }

  // make a change: kind 'doc' rebuilds the document, anything else only recompiles tracks
  function change(fn, kind) {
    checkpoint();
    fn();
    if (kind === 'doc') reloadDoc(); else refreshTracks();
  }

  function restore(from, to) {
    if (!from.length) return;
    to.push(snapshot());
    project = JSON.parse(from.pop());
    selKey = null;
    dirty = true;
    if (selId && !sourceIds().has(selId)) selId = null;
    fit();
    reloadDoc();
  }

  function serialize() {
    var p = JSON.parse(JSON.stringify(project));
    p.html = project.html.split('\n');
    p.css = project.css.split('\n');
    return p;
  }

  // ════════ SOURCE (the document as written, {{vars}} and all) ════════

  function parseSource() {
    var t = document.createElement('template');
    t.innerHTML = project.html;
    return t;
  }

  function editSource(fn) {
    var t = parseSource();
    fn(t.content);
    project.html = t.innerHTML;
  }

  function srcEl(root, id) { return root.querySelector('#' + CSS.escape(id)); }

  function sourceIds() {
    var ids = new Set();
    parseSource().content.querySelectorAll('[id]').forEach(function (el) { ids.add(el.id); });
    return ids;
  }

  function uniqueId(base, used) {
    base = (base || 'el').replace(/[^\w-]/g, '') || 'el';
    var n = 1;
    while (used.has(base + '-' + n)) n++;
    used.add(base + '-' + n);
    return base + '-' + n;
  }

  // SVG shapes pasted into HTML without their <svg> parse as unknown HTML tags and draw nothing.
  // Wrap each loose one in an <svg> that fits it, placed so the shapes stay where their coordinates say.
  var SVG_ONLY = /^(g|path|circle|ellipse|line|polyline|polygon|rect|use|defs|text|tspan|textpath|symbol|clippath|mask|pattern|lineargradient|radialgradient|stop)$/;
  var measurer = null;

  function strayBox(markup) {
    if (!measurer) {
      measurer = document.createElementNS(SVG_NS, 'svg');
      measurer.setAttribute('style', 'position:absolute; left:-10000px; top:0; width:10px; height:10px; visibility:hidden; overflow:visible');
      document.body.appendChild(measurer);
    }
    measurer.innerHTML = markup;           // parsed in SVG context, so these become real shapes
    var b = { x: 0, y: 0, width: 0, height: 0 };
    try { b = measurer.getBBox(); } catch (e) {}
    measurer.innerHTML = '';
    return b;
  }

  function wrapStraySvg(root) {
    [].slice.call(root.querySelectorAll('*')).forEach(function (n) {
      if (n.namespaceURI === SVG_NS || !SVG_ONLY.test(n.localName)) return;
      var p = n.parentElement;
      if (p && p.namespaceURI !== SVG_NS && SVG_ONLY.test(p.localName)) return;  // its loose ancestor gets wrapped
      var b = strayBox(n.outerHTML), pad = 4;
      var x = Math.floor(b.x - pad), y = Math.floor(b.y - pad);
      var w = Math.ceil(b.width + 2 * pad), h = Math.ceil(b.height + 2 * pad);
      var t = document.createElement('template');
      t.innerHTML = '<svg data-name="' + escapeAttr(labelOf(n)) + '" viewBox="' + [x, y, w, h].join(' ') +
        '" width="' + w + '" height="' + h + '" style="position:absolute; left:' + x + 'px; top:' + y +
        'px; overflow:visible;">' + n.outerHTML + '</svg>';
      n.replaceWith(t.content);
    });
  }

  // every visible element gets an id, so tracks can point at it
  function ensureIds() {
    editSource(function (root) {
      wrapStraySvg(root);
      var used = new Set();
      root.querySelectorAll('[id]').forEach(function (el) { used.add(el.id); });
      root.querySelectorAll('*').forEach(function (el) {
        if (!el.id && !el.matches(HIDDEN)) el.id = uniqueId(el.localName, used);
      });
    });
  }

  function labelOf(el) {
    return el.getAttribute('data-name') || el.getAttribute('inkscape:label') || el.id || el.localName;
  }

  function onlyText(el) { return !el.children.length; }

  // ════════ PREVIEW ════════

  // ── position: X/Y read as where the element's centre is, measured from the canvas centre ──
  // Tracks still store offsets from where the document lays the element out (that's what renders);
  // the editor adds this per-element origin for display. Measured with every animation at rest,
  // so a child's position doesn't include its parents' movement.
  var origins = {};
  function origin(id) {
    if (origins[id]) return origins[id];
    var live = liveEl(id);
    if (!live) return { x: 0, y: 0, sx: 1, sy: 1 };
    scene.reset();
    var r = live.getBoundingClientRect(), sx = 1, sy = 1;
    if (live.ownerSVGElement && live.parentNode.getScreenCTM) {
      var m = live.parentNode.getScreenCTM();   // SVG offsets are in user units, not px
      sx = Math.hypot(m.a, m.b) || 1;
      sy = Math.hypot(m.c, m.d) || 1;
    }
    scene.setTracks(project.tracks);
    scene.apply(playhead);
    return (origins[id] = {
      x: r.left + r.width / 2 - project.width / 2, y: r.top + r.height / 2 - project.height / 2, sx: sx, sy: sy
    });
  }
  function toShown(id, prop, v) {
    if (prop !== 'x' && prop !== 'y') return v;
    var o = origin(id);
    return prop === 'x' ? o.x + v * o.sx : o.y + v * o.sy;
  }
  function fromShown(id, prop, v) {
    if (prop !== 'x' && prop !== 'y') return v;
    var o = origin(id);
    return round(prop === 'x' ? (v - o.x) / o.sx : (v - o.y) / o.sy);
  }

  function centre(axes) {
    var id = selId;
    if (!liveEl(id)) return;
    change(function () {
      axes.forEach(function (a) { setKey(id, a, playhead, fromShown(id, a, 0)); });
    });
    status('Centred at ' + fmtTime(playhead));
  }

  function reloadDoc() {
    if (!scene) return;
    var p = project;
    origins = {};
    scene.load(project).then(function () {
      origins = {};   // fonts may have changed text sizes
      if (p !== project) return;
      scene.apply(playhead);
      renderAll();
    });
    scene.apply(playhead);
    renderAll();
  }

  function refreshTracks() {
    project.tracks = project.tracks.filter(function (t) { return t.keys.length; });
    scene.setTracks(project.tracks);
    scene.apply(playhead);
    renderAll();
  }

  function fit() {
    if (!project) return;
    var vp = $('viewport');
    scale = Math.min((vp.clientWidth - 40) / project.width, (vp.clientHeight - 40) / project.height);
    $('canvas').style.width = project.width * scale + 'px';
    $('canvas').style.height = project.height * scale + 'px';
    frame.style.width = project.width + 'px';
    frame.style.height = project.height + 'px';
    frame.style.transform = 'scale(' + scale + ')';
    drawSelection();
  }

  function liveEl(id) { return scene && id ? scene.find(id) : null; }

  function drawSelection() {
    var box = $('selbox'), el = liveEl(selId);
    if (!el) { box.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left * scale - 1 + 'px';
    box.style.top = r.top * scale - 1 + 'px';
    box.style.width = r.width * scale + 2 + 'px';
    box.style.height = r.height * scale + 2 + 'px';
    var handles = resizeHandles(el);
    box.querySelectorAll('.handle').forEach(function (h) {
      h.style.display = handles.indexOf(h.dataset.dir) >= 0 ? '' : 'none';
    });
  }

  // ── resize handles ──
  // HTML (and a whole <svg>): real width/height, plus left/top when a left/top edge moves.
  // SVG rect/image/svg: their x/y/width/height. circle/ellipse: radius, around the centre.
  // Anything else (paths, groups, text) has no size to change, so corners key its Scale at the playhead.
  var ALL_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  var SVG_SIZED = /^(rect|image|svg|foreignObject|use)$/;

  function resizeMode(live) {
    if (!(live instanceof frameWin.SVGElement) || !live.ownerSVGElement) return 'box';
    if (SVG_SIZED.test(live.localName) && live.hasAttribute('width') && live.hasAttribute('height')) return 'attr';
    if (live.localName === 'circle') return 'circle';
    if (live.localName === 'ellipse') return 'ellipse';
    return 'scale';
  }

  function resizeHandles(live) {
    var mode = resizeMode(live);
    if (mode === 'scale') return ['nw', 'ne', 'se', 'sw'];
    if (mode === 'box' && !/absolute|fixed/.test(frameWin.getComputedStyle(live).position)) return ['e', 's', 'se'];
    return ALL_HANDLES;
  }

  (function () {
    var box = $('selbox');
    ALL_HANDLES.forEach(function (dir) {
      var h = document.createElement('div');
      h.className = 'handle h-' + dir;
      h.dataset.dir = dir;
      h.addEventListener('mousedown', function (e) { startResize(e, dir); });
      box.appendChild(h);
    });
  })();

  function startResize(e, dir) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (playing) play();
    flushEdit();
    var id = selId, live = liveEl(id);
    if (!live) return;
    var mode = resizeMode(live), cs = frameWin.getComputedStyle(live), r = live.getBoundingClientRect();
    var east = /e/.test(dir), west = /w/.test(dir), south = /s/.test(dir), north = /n/.test(dir);
    var sx = e.clientX, sy = e.clientY, moved = false, result = null;

    // stage px per layout px, so a handle tracks the pointer even if the element is scaled
    var boxW = live.offsetWidth || parseFloat(cs.width) || 1, boxH = live.offsetHeight || parseFloat(cs.height) || 1;
    var kx = r.width / boxW || 1, ky = r.height / boxH || 1;
    // SVG attributes are in the parent's user units
    var m = live.ownerSVGElement && live.parentNode.getScreenCTM ? live.parentNode.getScreenCTM().inverse() : null;
    function user(dx, dy) { return m ? { x: m.a * dx + m.c * dy, y: m.b * dx + m.d * dy } : { x: dx, y: dy }; }
    function attr(n) { return parseFloat(live.getAttribute(n)) || 0; }

    var start = {
      w: parseFloat(cs.width), h: parseFloat(cs.height), left: parseFloat(cs.left), top: parseFloat(cs.top),
      x: attr('x'), y: attr('y'), aw: attr('width'), ah: attr('height'),
      r: attr('r'), rx: attr('rx'), ry: attr('ry'), scale: valueAt(id, 'scale', playhead)
    };
    var centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    var startDist = Math.max(1, Math.hypot((sx - $('canvas').getBoundingClientRect().left) / scale - centre.x,
                                           (sy - $('canvas').getBoundingClientRect().top) / scale - centre.y));

    frame.style.pointerEvents = 'none';   // keep the mouse events coming here while over the stage
    document.body.style.cursor = getComputedStyle(e.target).cursor;

    function move(ev) {
      var dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;   // stage px
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      if (!moved) { checkpoint(); moved = true; }

      if (mode === 'box') {
        dx /= kx; dy /= ky;
        var w = start.w + (east ? dx : west ? -dx : 0), h = start.h + (south ? dy : north ? -dy : 0);
        if (ev.shiftKey && (east || west) && (north || south)) {
          var s = Math.max(w / start.w, h / start.h);
          w = start.w * s; h = start.h * s;
        }
        w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
        result = { width: w + 'px', height: h + 'px' };
        if (west) result.left = Math.round(start.left + start.w - w) + 'px';
        if (north) result.top = Math.round(start.top + start.h - h) + 'px';
        Object.keys(result).forEach(function (k) { live.style[k] = result[k]; });
      } else if (mode === 'attr') {
        var u = user(dx, dy);
        var aw = start.aw + (east ? u.x : west ? -u.x : 0), ah = start.ah + (south ? u.y : north ? -u.y : 0);
        if (ev.shiftKey && (east || west) && (north || south)) {
          var s2 = Math.max(aw / start.aw, ah / start.ah);
          aw = start.aw * s2; ah = start.ah * s2;
        }
        aw = Math.max(0.1, round(aw)); ah = Math.max(0.1, round(ah));
        result = { width: aw, height: ah };
        if (west) result.x = round(start.x + start.aw - aw);
        if (north) result.y = round(start.y + start.ah - ah);
        Object.keys(result).forEach(function (k) { live.setAttribute(k, result[k]); });
      } else if (mode === 'circle' || mode === 'ellipse') {
        var v = user(dx, dy), gx = east ? v.x : west ? -v.x : 0, gy = south ? v.y : north ? -v.y : 0;
        if (mode === 'circle') {
          result = { r: Math.max(0.1, round(start.r + (Math.abs(gx) > Math.abs(gy) ? gx : gy))) };
        } else {
          result = { rx: Math.max(0.1, round(start.rx + gx)), ry: Math.max(0.1, round(start.ry + gy)) };
        }
        Object.keys(result).forEach(function (k) { live.setAttribute(k, result[k]); });
      } else {
        var c = $('canvas').getBoundingClientRect();
        var dist = Math.hypot((ev.clientX - c.left) / scale - centre.x, (ev.clientY - c.top) / scale - centre.y);
        setKey(id, 'scale', playhead, Math.max(0.01, round(start.scale * dist / startDist)));
        scene.setTracks(project.tracks);
        scene.apply(playhead);
      }
      drawSelection();
      renderProps();
    }

    function up() {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      frame.style.pointerEvents = '';
      document.body.style.cursor = '';
      if (!moved) return;
      if (result) {
        var set = result;
        editSource(function (root) {
          var n = srcEl(root, id);
          if (!n) return;
          Object.keys(set).forEach(function (k) {
            if (mode === 'box') n.style[k] = set[k]; else n.setAttribute(k, set[k]);
          });
        });
        reloadDoc();
      } else {
        renderAll();
      }
    }
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  function seekTo(t) {
    playhead = Math.max(0, Math.min(project.duration, t));
    scene.apply(playhead);
    drawSelection();
    placePlayhead();
    updateTime();
    renderProps();
  }

  function play() {
    if (playing) { playing = false; $('btn-play').textContent = '▶'; return; }
    playing = true;
    $('btn-play').textContent = '❚❚';
    if (playhead >= project.duration) playhead = 0;
    playStart = performance.now() - playhead;
    requestAnimationFrame(function tick(now) {
      if (!playing) return;
      seekTo((now - playStart) % project.duration);
      requestAnimationFrame(tick);
    });
  }

  function frameMs() { return 1000 / (project.fps || 60); }
  function snap(t, free) {
    t = free ? Math.round(t) : Math.round(Math.round(t / frameMs()) * frameMs());
    return Math.max(0, Math.min(project.duration, t));
  }
  function round(v) { return Math.round(v * 1000) / 1000; }

  // ════════ TRACKS ════════

  function trackOf(id, prop, create) {
    for (var i = 0; i < project.tracks.length; i++) {
      var t = project.tracks[i];
      if (t.target === id && t.prop === prop) return t;
    }
    if (!create) return null;
    var track = { target: id, prop: prop, keys: [] };
    project.tracks.push(track);
    return track;
  }

  function sortKeys(track) { track.keys.sort(function (a, b) { return a.t - b.t; }); }

  function keyAt(track, t) {
    if (!track) return null;
    for (var i = 0; i < track.keys.length; i++) if (Math.abs(track.keys[i].t - t) < 0.5) return track.keys[i];
    return null;
  }

  function setKey(id, prop, t, v) {
    var track = trackOf(id, prop, true), key = keyAt(track, t);
    if (key) key.v = v;
    else { key = { t: t, v: v, ease: 'ease-in-out' }; track.keys.push(key); sortKeys(track); }
    return key;
  }

  function computedColor(el, prop) {
    var cs = frameWin.getComputedStyle(el), svg = el instanceof frameWin.SVGElement;
    var v = prop === 'fill' ? (svg ? cs.fill : cs.backgroundColor)
          : prop === 'stroke' ? (svg ? cs.stroke : cs.borderTopColor)
          : cs.color;
    return !v || v === 'none' ? 'rgba(0,0,0,0)' : v;
  }

  // what a property is at time t — its track if it has one, else what the document says
  function valueAt(id, prop, t) {
    var track = trackOf(id, prop);
    if (track && track.keys.length) return R.valueAt(track, t);
    var def = PROPS[prop], el = liveEl(id);
    if (def.type === 'color') return el ? computedColor(el, prop) : 'rgba(0,0,0,0)';
    if (prop === 'strokeWidth' && el) return parseFloat(frameWin.getComputedStyle(el).strokeWidth) || 1;
    if (prop === 'opacity' && el) return parseFloat(frameWin.getComputedStyle(el).opacity);
    return def.def;
  }

  function propsFor(el) {
    var svg = el instanceof frameWin.SVGElement;
    return Object.keys(PROPS).filter(function (p) {
      return !(PROPS[p].svg && !svg) && !(PROPS[p].html && svg);
    });
  }

  // ════════ PRESETS ════════
  // keys are [fraction of the preset's length, value or fn(current value), ease]; 'at' is when the
  // current value is read — 'end' for ins (land where the element already is), 'start' for outs

  function same(c) { return c; }
  var PRESETS = [
    { name: 'Fade in', len: 400, at: 'end', props: { opacity: [[0, 0, 'ease-out'], [1, 1]] } },
    { name: 'Fade out', len: 400, at: 'start', props: { opacity: [[0, same, 'ease-in'], [1, 0]] } },
    { name: 'Slide in from left', len: 500, at: 'end', props: {
      x: [[0, function (c) { return c - 400; }, 'ease-out-strong'], [1, same]], opacity: [[0, 0, 'ease-out'], [0.5, 1]] } },
    { name: 'Slide in from right', len: 500, at: 'end', props: {
      x: [[0, function (c) { return c + 400; }, 'ease-out-strong'], [1, same]], opacity: [[0, 0, 'ease-out'], [0.5, 1]] } },
    { name: 'Slide in from below', len: 500, at: 'end', props: {
      y: [[0, function (c) { return c + 200; }, 'ease-out-strong'], [1, same]], opacity: [[0, 0, 'ease-out'], [0.5, 1]] } },
    { name: 'Slide in from above', len: 500, at: 'end', props: {
      y: [[0, function (c) { return c - 200; }, 'ease-out-strong'], [1, same]], opacity: [[0, 0, 'ease-out'], [0.5, 1]] } },
    { name: 'Slide out left', len: 450, at: 'start', props: {
      x: [[0, same, 'ease-in-strong'], [1, function (c) { return c - 400; }]], opacity: [[0.5, 1, 'ease-in'], [1, 0]] } },
    { name: 'Slide out right', len: 450, at: 'start', props: {
      x: [[0, same, 'ease-in-strong'], [1, function (c) { return c + 400; }]], opacity: [[0.5, 1, 'ease-in'], [1, 0]] } },
    { name: 'Pop in', len: 450, at: 'end', props: {
      scale: [[0, 0, 'overshoot'], [1, function (c) { return c || 1; }]], opacity: [[0, 0], [0.3, 1]] } },
    { name: 'Pop out', len: 350, at: 'start', props: {
      scale: [[0, same, 'anticipate'], [1, 0]], opacity: [[0.6, 1], [1, 0]] } },
    { name: 'Drop in (bounce)', len: 800, at: 'end', props: {
      y: [[0, function (c) { return c - 300; }, 'bounce'], [1, same]], opacity: [[0, 0], [0.2, 1]] } },
    { name: 'Spin in', len: 600, at: 'end', props: {
      rotate: [[0, function (c) { return c - 180; }, 'ease-out-strong'], [1, same]],
      scale: [[0, 0, 'ease-out-strong'], [1, function (c) { return c || 1; }]], opacity: [[0, 0], [0.3, 1]] } },
    { name: 'Blur in', len: 500, at: 'end', props: { blur: [[0, 16, 'ease-out'], [1, 0]], opacity: [[0, 0, 'ease-out'], [1, 1]] } },
    { name: 'Blur out', len: 500, at: 'start', props: { blur: [[0, 0, 'ease-in'], [1, 16]], opacity: [[0, same, 'ease-in'], [1, 0]] } },
    { name: 'Draw on (SVG strokes)', len: 800, at: 'end', props: { draw: [[0, 0, 'ease-in-out'], [1, 1]] } },
    { name: 'Draw off (SVG strokes)', len: 600, at: 'start', props: { draw: [[0, 1, 'ease-in-out'], [1, 0]] } },
    { name: 'Wipe in (left → right)', len: 500, at: 'end', props: { clipRight: [[0, 100, 'ease-out-strong'], [1, 0]] } },
    { name: 'Wipe out (left → right)', len: 500, at: 'start', props: { clipLeft: [[0, 0, 'ease-in-strong'], [1, 100]] } },
    { name: 'Glitch in', len: 450, at: 'end', props: {
      opacity: [[0, 0, 'hold'], [0.12, 1, 'hold'], [0.24, 0.15, 'hold'], [0.4, 1, 'hold'], [0.52, 0.3, 'hold'], [0.64, 1]],
      x: [[0, function (c) { return c - 16; }, 'hold'], [0.12, function (c) { return c + 10; }, 'hold'],
          [0.24, function (c) { return c - 8; }, 'hold'], [0.4, function (c) { return c + 5; }, 'hold'],
          [0.52, function (c) { return c - 3; }, 'hold'], [0.64, same]] } },
    { name: 'Glitch out', len: 400, at: 'start', props: {
      opacity: [[0, same, 'hold'], [0.2, 0.2, 'hold'], [0.35, 1, 'hold'], [0.55, 0.1, 'hold'], [0.7, 0.8, 'hold'], [0.85, 0]],
      x: [[0, same, 'hold'], [0.2, function (c) { return c + 12; }, 'hold'], [0.35, function (c) { return c - 9; }, 'hold'],
          [0.55, function (c) { return c + 16; }, 'hold'], [0.85, same]] } },
    { name: 'Shake', len: 500, at: 'start', props: {
      x: [[0, same, 'ease-in-out'], [0.15, function (c) { return c - 10; }, 'ease-in-out'],
          [0.3, function (c) { return c + 9; }, 'ease-in-out'], [0.45, function (c) { return c - 7; }, 'ease-in-out'],
          [0.6, function (c) { return c + 5; }, 'ease-in-out'], [0.8, function (c) { return c - 2; }, 'ease-in-out'], [1, same]] } },
    { name: 'Pulse', len: 500, at: 'start', props: {
      scale: [[0, same, 'ease-in-out'], [0.5, function (c) { return c * 1.12; }, 'ease-in-out'], [1, same]] } }
  ];

  function applyPreset(preset, len) {
    var el = liveEl(selId);
    if (!el) return;
    var t0 = playhead, t1 = t0 + len;
    if (t1 > project.duration) { t1 = project.duration; t0 = Math.max(0, t1 - len); }
    var allowed = propsFor(el);
    var props = Object.keys(preset.props).filter(function (p) { return allowed.indexOf(p) >= 0; });
    // read the current values before any keys change
    var current = {};
    props.forEach(function (p) { current[p] = valueAt(selId, p, preset.at === 'end' ? t1 : t0); });
    change(function () {
      props.forEach(function (p) {
        var track = trackOf(selId, p, true);
        track.keys = track.keys.filter(function (k) { return k.t < t0 - 0.5 || k.t > t1 + 0.5; });
        preset.props[p].forEach(function (k) {
          var v = typeof k[1] === 'function' ? k[1](current[p]) : k[1];
          track.keys.push({ t: Math.round(t0 + k[0] * (t1 - t0)), v: typeof v === 'number' ? round(v) : v, ease: k[2] || 'linear' });
        });
        sortKeys(track);
      });
    });
    status(preset.name + ' added at ' + fmtTime(t0));
  }

  // ════════ RENDERING THE UI ════════

  function renderAll() {
    renderLayers();
    renderInspector();
    renderTimeline();
    drawSelection();
    updateTime();
    document.title = (dirty ? '• ' : '') + name + ' — Motion Editor';
    saveDraft();
  }

  // an inspector field being typed in commits on blur — let it, while its element is still the selection
  function flushEdit() {
    var a = document.activeElement;
    if (a && a !== document.body && $('side').contains(a)) a.blur();
  }

  function select(id) {
    flushEdit();
    selId = id;
    if (selKey && selKey.track.target !== id) selKey = null;
    if (id) tab = 'element';
    renderAll();
  }

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (k === 'class') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) e.appendChild(k); });
    return e;
  }

  // ── layers ──
  // rows drag onto each other: top quarter of a row = before it, bottom quarter = after it, middle = inside it.
  // Later in the list draws on top.
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var NO_CHILDREN = /^(img|input|br|hr|video|audio|canvas|iframe|textarea|select)$/;
  var SVG_GROUPS = /^(svg|g|a|switch)$/;
  var dragId = null;

  // can node live inside parent (null = the top level)? SVG shapes only render inside SVG groups,
  // HTML only outside SVG
  function canHold(parent, node) {
    if (parent && (parent === node || node.contains(parent))) return false;
    var svgPart = node.namespaceURI === SVG_NS && node.localName !== 'svg';
    if (!parent) return !svgPart;
    if (parent.namespaceURI === SVG_NS) return node.namespaceURI === SVG_NS && SVG_GROUPS.test(parent.localName);
    return !svgPart && !NO_CHILDREN.test(parent.localName);
  }

  function dropZone(e, row, target, node) {
    if (target === node) return null;
    var r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
    var inside = canHold(target, node);
    if (inside && y > 0.25 && y < 0.75) return 'inside';
    if (canHold(target.parentElement, node)) return y < 0.5 ? 'before' : 'after';
    return inside ? 'inside' : null;
  }

  function clearDropMarks() {
    document.querySelectorAll('.drop-before, .drop-after, .drop-inside, .drop-end').forEach(function (n) {
      n.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-end');
    });
  }

  function moveLayer(id, targetId, zone) {
    var live = liveEl(id), was = live && live.getBoundingClientRect();
    change(function () {
      editSource(function (r) {
        var n = srcEl(r, id), t = targetId ? srcEl(r, targetId) : null;
        if (!t) r.appendChild(n);
        else if (zone === 'before') t.before(n);
        else if (zone === 'after') t.after(n);
        else t.appendChild(n);
      });
      selId = id;
    }, 'doc');

    // a positioned HTML element keeps its spot on screen: its left/top change to suit the new parent
    live = liveEl(id);
    if (!was || !live || live instanceof frameWin.SVGElement) return;
    var cs = frameWin.getComputedStyle(live);
    if (!/absolute|fixed/.test(cs.position)) return;
    var now = live.getBoundingClientRect(), dx = was.left - now.left, dy = was.top - now.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    var left = Math.round(parseFloat(cs.left) + dx), top = Math.round(parseFloat(cs.top) + dy);
    editSource(function (r) {
      var n = srcEl(r, id);
      n.style.left = left + 'px';
      n.style.top = top + 'px';
    });
    reloadDoc();
  }

  function renderLayers() {
    var list = $('layer-list'), animated = {}, src = parseSource().content;
    project.tracks.forEach(function (t) { animated[t.target] = true; });
    list.innerHTML = '';
    (function walk(parent, depth) {
      [].forEach.call(parent.children, function (node) {
        if (node.matches(HIDDEN)) return;
        var hint = onlyText(node) && node.textContent.trim() ? ' — ' + node.textContent.trim().slice(0, 24) : '';
        var row = el('div', {
          class: 'layer' + (node.id === selId ? ' sel' : ''),
          style: 'padding-left:' + (8 + depth * 14) + 'px',
          title: '#' + node.id + ' — drag to move or nest',
          draggable: 'true',
          onclick: function () { select(node.id); }
        }, [
          el('span', { class: 'tag', text: node.localName }),
          el('span', { class: 'nm', text: labelOf(node) + hint }),
          animated[node.id] ? el('span', { class: 'anim', text: '◆' }) : null
        ]);
        row.addEventListener('dragstart', function (e) {
          dragId = node.id;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.id);
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', function () {
          dragId = null;
          row.classList.remove('dragging');
          clearDropMarks();
        });
        row.addEventListener('dragover', function (e) {
          if (!dragId) return;
          e.stopPropagation();
          var zone = dropZone(e, row, node, srcEl(src, dragId));
          clearDropMarks();
          if (!zone) { e.dataTransfer.dropEffect = 'none'; return; }
          e.preventDefault();
          row.classList.add('drop-' + zone);
        });
        row.addEventListener('drop', function (e) {
          if (!dragId) return;
          e.preventDefault();
          e.stopPropagation();
          var zone = dropZone(e, row, node, srcEl(src, dragId)), id = dragId;
          dragId = null;
          clearDropMarks();
          if (zone) moveLayer(id, node.id, zone);
        });
        list.appendChild(row);
        walk(node, depth + 1);
      });
    })(src, 0);
    if (!list.children.length) {
      list.appendChild(el('div', { class: 'muted', style: 'padding:10px', text: 'Empty. Import an SVG or add text / a box.' }));
    }
  }

  // a field mid-edit would blur on mousedown, save, and redraw the rows under the pointer — the click
  // would never land. Keep focus until the click, where select() saves the edit itself.
  ['layer-list', 'tl-body'].forEach(function (id) {
    $(id).addEventListener('mousedown', function (e) {
      if ($('side').contains(document.activeElement)) e.preventDefault();
    });
  });

  // the empty space under the rows = the end of the top level
  $('layer-list').addEventListener('dragover', function (e) {
    if (!dragId || e.target !== this) return;
    e.stopPropagation();
    clearDropMarks();
    if (!canHold(null, srcEl(parseSource().content, dragId))) { e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault();
    this.classList.add('drop-end');
  });
  $('layer-list').addEventListener('drop', function (e) {
    if (!dragId || e.target !== this) return;
    e.preventDefault();
    e.stopPropagation();
    var id = dragId;
    dragId = null;
    clearDropMarks();
    if (canHold(null, srcEl(parseSource().content, id))) moveLayer(id, null, 'end');
  });

  // ── inspector ──
  function renderInspector() {
    $('tab-element').classList.toggle('on', tab === 'element');
    $('tab-document').classList.toggle('on', tab === 'document');
    var box = $('inspector');
    box.innerHTML = '';
    if (tab === 'document') return renderDocument(box);
    var id = selId;
    var live = liveEl(id), src = id ? srcEl(parseSource().content, id) : null;
    if (!live || !src) {
      box.appendChild(el('div', { class: 'muted', text: 'Click something on the stage or in Layers.' }));
      return;
    }

    box.appendChild(el('div', { class: 'sect' }, [
      el('div', { class: 'row' }, [el('label', { text: 'Name' }), el('input', {
        value: labelOf(src), onchange: function (e) {
          var v = e.target.value;
          change(function () { editSource(function (r) { var n = srcEl(r, id); if (n) n.setAttribute('data-name', v); }); }, 'doc');
        }
      })]),
      el('div', { class: 'row' }, [el('label', { text: 'Id' }), el('input', {
        value: id, title: 'tracks point at this; renaming keeps them', onchange: function (e) { renameId(e.target.value.trim(), id); }
      })]),
      el('div', { class: 'btns' }, [
        el('span', { class: 'muted', style: 'align-self:center', text: '<' + src.localName + '>' }),
        src.parentElement ? el('button', { text: '↑ Parent', onclick: function () { select(src.parentElement.id); } }) : null,
        el('button', { class: 'danger', text: 'Delete', onclick: deleteSelected })
      ]),
      el('div', { class: 'btns', style: 'margin-top:6px' }, [
        el('button', { text: '✛ Centre', title: 'Move its centre to 0,0 (keys X/Y at the playhead)', onclick: function () { centre(['x', 'y']); } }),
        el('button', { text: '↔', title: 'Centre horizontally', onclick: function () { centre(['x']); } }),
        el('button', { text: '↕', title: 'Centre vertically', onclick: function () { centre(['y']); } })
      ])
    ]));

    if (onlyText(src) && !src.matches('img, svg, path, circle, rect, line, polyline, polygon, ellipse, use, image')) {
      box.appendChild(el('div', { class: 'sect' }, [
        el('div', { class: 'title', text: 'Text' }),
        el('textarea', { rows: 2, text: src.textContent, onchange: function (e) {
          var v = e.target.value;
          change(function () { editSource(function (r) { var n = srcEl(r, id); if (n) n.textContent = v; }); }, 'doc');
        } }),
        el('div', { class: 'muted', text: '{{name}} pulls from the document\'s vars.' })
      ]));
    }

    box.appendChild(el('div', { class: 'sect', id: 'props' }));
    renderProps();

    if (selKey) renderKeyEditor(box);

    var presetSel = el('select', {}, PRESETS.map(function (p, i) { return el('option', { value: i, text: p.name }); }));
    var presetLen = el('input', { type: 'number', value: 500, min: 50, step: 50, style: 'width:70px' });
    presetSel.addEventListener('change', function () { presetLen.value = PRESETS[presetSel.value].len; });
    presetLen.value = PRESETS[0].len;
    box.appendChild(el('div', { class: 'sect' }, [
      el('div', { class: 'title', text: 'Presets' }),
      el('div', { class: 'row' }, [presetSel]),
      el('div', { class: 'row' }, [
        el('label', { text: 'Length (ms)' }), presetLen,
        el('button', { text: 'Add at playhead', onclick: function () {
          applyPreset(PRESETS[presetSel.value], Math.max(50, Number(presetLen.value) || 500));
        } })
      ])
    ]));

    var styleIn = el('input', { value: src.getAttribute('style') || '', style: 'width:100%', onchange: function (e) {
      var v = e.target.value;
      change(function () { editSource(function (r) {
        var n = srcEl(r, id);
        if (!n) return;
        if (v.trim()) n.setAttribute('style', v); else n.removeAttribute('style');
      }); }, 'doc');
    } });
    var htmlIn = el('textarea', { rows: 8, text: src.outerHTML });
    box.appendChild(el('details', {}, [
      el('summary', { text: 'Inline style' }), styleIn
    ]));
    box.appendChild(el('details', {}, [
      el('summary', { text: 'Element HTML' }), htmlIn,
      el('div', { class: 'btns', style: 'margin-top:6px' }, [el('button', { text: 'Apply', onclick: function () {
        change(function () {
          editSource(function (r) {
            var t = document.createElement('template');
            t.innerHTML = htmlIn.value;
            var n = srcEl(r, id);
            if (n) n.replaceWith(t.content);
          });
          ensureIds();
        }, 'doc');
      } })])
    ]));
  }

  function renderProps() {
    var box = $('props');
    if (!box || box.contains(document.activeElement)) return;
    var id = selId, live = liveEl(id);
    if (!live) return;
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'title', text: 'Properties at ' + fmtTime(playhead) }));
    box.appendChild(el('div', { class: 'muted', style: 'margin:-2px 0 6px', text: 'X/Y: its centre, from the canvas centre (0,0)' }));
    propsFor(live).forEach(function (prop) {
      var def = PROPS[prop], track = trackOf(id, prop), key = keyAt(track, playhead);
      var v = valueAt(id, prop, playhead);
      var input, extra = null;
      function commit(value) {
        change(function () { selKey = { track: trackOf(id, prop, true), key: setKey(id, prop, playhead, value) }; });
      }
      if (def.type === 'color') {
        input = el('input', { value: v, onchange: function (e) { commit(e.target.value.trim()); } });
        var c = R.parseColor(v);
        extra = el('input', { type: 'color', class: 'swatch', value: '#' + c.slice(0, 3).map(function (n) {
          return ('0' + Math.round(n).toString(16)).slice(-2);
        }).join(''), onchange: function (e) {
          var h = e.target.value, a = R.parseColor(v)[3];
          commit(a < 1 ? 'rgba(' + R.parseColor(h).slice(0, 3).join(',') + ',' + a + ')' : h);
        } });
      } else {
        input = el('input', { type: 'number', value: round(toShown(id, prop, v)), step: def.step,
          onchange: function (e) { var n = parseFloat(e.target.value); if (!isNaN(n)) commit(fromShown(id, prop, n)); } });
        if (def.min !== undefined) input.min = def.min;
        if (def.max !== undefined) input.max = def.max;
      }
      box.appendChild(el('div', { class: 'row' }, [
        el('label', { text: def.label }), input, extra,
        el('span', { class: 'unit', text: def.unit || '' }),
        el('button', {
          class: 'key' + (key ? ' on' : track ? ' has' : ''),
          text: key ? '◆' : '◇',
          title: key ? 'Remove the key here' : 'Add a key here',
          onclick: function () {
            change(function () {
              if (key) { track.keys.splice(track.keys.indexOf(key), 1); if (selKey && selKey.key === key) selKey = null; }
              else selKey = { track: trackOf(id, prop, true), key: setKey(id, prop, playhead, v) };
            });
          }
        })
      ]));
    });
  }

  function renderKeyEditor(box) {
    var track = selKey.track, key = selKey.key, def = PROPS[track.prop];
    if (track.keys.indexOf(key) < 0) { selKey = null; return; }
    var names = Object.keys(R.EASES), custom = names.indexOf(key.ease) < 0;
    var easeSel = el('select', {}, names.map(function (n) { return el('option', { value: n, text: n }); })
      .concat([el('option', { value: 'custom', text: 'cubic-bezier…' })]));
    easeSel.value = custom ? 'custom' : key.ease;
    var bez = el('input', { value: custom ? key.ease : 'cubic-bezier(.25,.1,.25,1)', style: 'display:' + (custom ? '' : 'none') });
    easeSel.addEventListener('change', function () {
      if (easeSel.value === 'custom') { bez.style.display = ''; bez.focus(); return; }
      change(function () { key.ease = easeSel.value; });
    });
    bez.addEventListener('change', function () { change(function () { key.ease = bez.value.trim(); }); });

    box.appendChild(el('div', { class: 'sect' }, [
      el('div', { class: 'title', text: 'Key — ' + def.label }),
      el('div', { class: 'row' }, [el('label', { text: 'Time (ms)' }), el('input', {
        type: 'number', value: key.t, step: 1, onchange: function (e) {
          var t = parseFloat(e.target.value);
          if (!isNaN(t)) change(function () { key.t = snap(t, true); sortKeys(track); });
        }
      })]),
      el('div', { class: 'row' }, [el('label', { text: 'Value' }), el('input', {
        value: def.type === 'color' ? key.v : round(toShown(track.target, track.prop, key.v)), onchange: function (e) {
          var raw = e.target.value.trim(), n = parseFloat(raw);
          change(function () { key.v = def.type === 'color' ? raw : (isNaN(n) ? key.v : fromShown(track.target, track.prop, n)); });
        }
      })]),
      el('div', { class: 'row' }, [el('label', { text: 'Ease to next' }), easeSel]),
      el('div', { class: 'row' }, [el('label', { text: '' }), bez]),
      el('div', { class: 'btns' }, [
        el('button', { text: 'Go to key', onclick: function () { seekTo(key.t); } }),
        el('button', { class: 'danger', text: 'Delete key', onclick: deleteKey })
      ])
    ]));
  }

  function renderDocument(box) {
    function num(label, prop, min) {
      return el('div', { class: 'row' }, [el('label', { text: label }), el('input', {
        type: 'number', value: project[prop], min: min, onchange: function (e) {
          var n = parseFloat(e.target.value);
          if (!(n >= min)) return;
          change(function () { project[prop] = n; }, 'doc');
          if (prop === 'duration') playhead = Math.min(playhead, n);
          fit();
        }
      })]);
    }
    box.appendChild(el('div', { class: 'sect' }, [
      el('div', { class: 'title', text: 'Project' }),
      el('div', { class: 'row' }, [el('label', { text: 'File name' }), el('input', {
        value: name, title: 'saved as projects/<name>.json', onchange: function (e) {
          var n = e.target.value.trim();
          if (/^[\w-]{1,64}$/.test(n)) { name = n; renderAll(); } else status('Names are letters, numbers, - and _', true);
        }
      })]),
      num('Width', 'width', 16), num('Height', 'height', 16), num('Duration (ms)', 'duration', 100), num('FPS', 'fps', 1)
    ]));

    var vars = el('div', { class: 'sect' }, [el('div', { class: 'title', text: 'Vars — {{name}} in the HTML / CSS' })]);
    Object.keys(project.vars).forEach(function (k) {
      vars.appendChild(el('div', { class: 'row' }, [
        el('input', { value: k, style: 'width:90px;flex:none', onchange: function (e) {
          var nk = e.target.value.trim();
          if (!nk || nk === k) return;
          change(function () { project.vars[nk] = project.vars[k]; delete project.vars[k]; }, 'doc');
        } }),
        el('input', { value: project.vars[k], onchange: function (e) {
          var v = e.target.value;
          change(function () { project.vars[k] = v; }, 'doc');
        } }),
        el('button', { class: 'key', text: '×', title: 'Remove', onclick: function () {
          change(function () { delete project.vars[k]; }, 'doc');
        } })
      ]));
    });
    vars.appendChild(el('button', { text: '+ Var', onclick: function () {
      var n = 1;
      while (('var' + n) in project.vars) n++;
      change(function () { project.vars['var' + n] = ''; }, 'doc');
    } }));
    box.appendChild(vars);

    var fonts = el('textarea', { rows: 3, text: project.fonts.join('\n') });
    var css = el('textarea', { rows: 12, text: project.css });
    var html = el('textarea', { rows: 14, text: project.html });
    box.appendChild(el('div', { class: 'sect' }, [
      el('div', { class: 'title', text: 'Font stylesheets (one URL a line)' }), fonts,
      el('div', { class: 'title', style: 'margin-top:10px', text: 'CSS' }), css,
      el('div', { class: 'title', style: 'margin-top:10px', text: 'HTML' }), html,
      el('div', { class: 'btns', style: 'margin-top:6px' }, [el('button', { class: 'primary', text: 'Apply source', onclick: function () {
        change(function () {
          project.fonts = fonts.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
          project.css = css.value;
          project.html = html.value;
          ensureIds();
        }, 'doc');
      } })])
    ]));
  }

  // ── timeline ──
  function laneWidth() { return Math.max(100, $('tl-body').clientWidth - LABEL_W - 2 * LANE_PAD); }
  function tToX(t) { return LANE_PAD + t / project.duration * laneWidth(); }
  function xToT(x) { return (x - LANE_PAD) / laneWidth() * project.duration; }
  function fmtTime(t) { return (t / 1000).toFixed(3) + ' s'; }

  function updateTime() {
    $('time').textContent = fmtTime(playhead) + ' / ' + fmtTime(project.duration) +
      '  f' + Math.round(playhead / frameMs());
  }

  function placePlayhead() {
    var ph = $('playhead');
    if (ph) ph.style.left = LABEL_W + tToX(playhead) + 'px';
  }

  function renderTimeline() {
    var body = $('tl-body'), scroll = body.scrollTop;
    body.innerHTML = '';

    // ruler: pick a label step that leaves room between labels
    var ruler = el('div', { class: 'tl-lane' });
    var steps = [50, 100, 250, 500, 1000, 2000, 5000, 10000], step = steps[steps.length - 1];
    for (var s = 0; s < steps.length; s++) {
      if (steps[s] / project.duration * laneWidth() >= 70) { step = steps[s]; break; }
    }
    var minor = step / 5;
    for (var t = 0; t <= project.duration + 0.1; t += minor) {
      var major = Math.round(t / minor) % 5 === 0;
      ruler.appendChild(el('div', { class: 'tick' + (major ? ' major' : ''), style: 'left:' + tToX(t) + 'px' },
        [major ? el('span', { text: (t / 1000) + 's' }) : null]));
    }
    ruler.addEventListener('mousedown', scrub);
    body.appendChild(el('div', { class: 'tl-row tl-ruler' }, [el('div', { class: 'tl-label', text: 'Tracks' }), ruler]));

    // one group per animated element, in document order
    var order = [], src = parseSource().content;
    src.querySelectorAll('[id]').forEach(function (n) { order.push(n.id); });
    var groups = {};
    project.tracks.forEach(function (tr) { (groups[tr.target] = groups[tr.target] || []).push(tr); });
    var ids = order.filter(function (id) { return groups[id]; });

    ids.forEach(function (id) {
      var node = srcEl(src, id), isSel = id === selId;
      body.appendChild(el('div', { class: 'tl-row el' + (isSel ? ' sel' : '') }, [
        el('div', { class: 'tl-label', text: labelOf(node), onclick: function () { select(id); } }),
        el('div', { class: 'tl-lane', onmousedown: scrub })
      ]));
      groups[id].forEach(function (track) {
        var lane = el('div', { class: 'tl-lane' });
        lane.addEventListener('mousedown', function (e) { select(id); scrub(e); });
        lane.addEventListener('dblclick', function (e) {
          var t = snap(xToT(e.clientX - lane.getBoundingClientRect().left), e.shiftKey);
          var v = R.valueAt(track, t);
          change(function () {
            var key = keyAt(track, t);
            if (!key) { key = { t: t, v: v, ease: 'ease-in-out' }; track.keys.push(key); sortKeys(track); }
            selKey = { track: track, key: key };
          });
        });
        for (var i = 0; i < track.keys.length - 1; i++) {
          var a = track.keys[i], b = track.keys[i + 1];
          lane.appendChild(el('div', {
            class: 'seg' + (a.ease && a.ease !== 'linear' ? ' eased' : ''),
            style: 'left:' + tToX(a.t) + 'px;width:' + (tToX(b.t) - tToX(a.t)) + 'px',
            title: a.ease || 'linear'
          }));
        }
        track.keys.forEach(function (key) {
          var d = el('div', {
            class: 'dia' + (selKey && selKey.key === key ? ' on' : ''),
            style: 'left:' + tToX(key.t) + 'px',
            title: key.t + ' ms → ' + (typeof key.v === 'number' ? round(toShown(id, track.prop, key.v)) : key.v) + ' (' + (key.ease || 'linear') + ')'
          });
          d.addEventListener('mousedown', function (e) { e.stopPropagation(); dragKey(e, id, track, key); });
          d.addEventListener('dblclick', function (e) { e.stopPropagation(); });
          lane.appendChild(d);
        });
        body.appendChild(el('div', { class: 'tl-row prop' + (isSel ? ' sel' : '') }, [
          el('div', { class: 'tl-label' }, [
            el('span', { text: PROPS[track.prop] ? PROPS[track.prop].label : track.prop }),
            el('span', { class: 'x', text: '×', title: 'Delete this track', onclick: function () {
              change(function () {
                project.tracks.splice(project.tracks.indexOf(track), 1);
                if (selKey && selKey.track === track) selKey = null;
              });
            } })
          ]),
          lane
        ]));
      });
    });

    if (!ids.length) {
      body.appendChild(el('div', { class: 'tl-empty', text: 'No animation yet. Select an element, then use a preset or the ◇ next to a property.' }));
    }
    var ph = el('div', { id: 'playhead' });
    ph.style.height = Math.max(body.scrollHeight, body.clientHeight) + 'px';
    body.appendChild(ph);
    placePlayhead();
    body.scrollTop = scroll;
  }

  function scrub(e) {
    if (e.button !== 0) return;
    var body = $('tl-body');
    function at(ev) {
      var x = ev.clientX - body.getBoundingClientRect().left + body.scrollLeft - LABEL_W;
      seekTo(snap(xToT(x), ev.shiftKey));
    }
    if (playing) play();
    at(e);
    function move(ev) { at(ev); }
    function up() { removeEventListener('mousemove', move); removeEventListener('mouseup', up); }
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  function dragKey(e, id, track, key) {
    if (e.button !== 0) return;
    if (playing) play();
    selId = id;
    selKey = { track: track, key: key };
    var startX = e.clientX, startT = key.t, moved = false;
    renderAll();
    function move(ev) {
      var dx = ev.clientX - startX;
      if (!moved && Math.abs(dx) < 3) return;
      if (!moved) { checkpoint(); moved = true; }
      key.t = snap(startT + dx / laneWidth() * project.duration, ev.shiftKey);
      sortKeys(track);
      scene.setTracks(project.tracks);
      scene.apply(playhead);
      renderTimeline();
      renderProps();
    }
    function up() {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      if (moved) renderAll(); else seekTo(key.t);
    }
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  // ════════ STAGE INTERACTION ════════

  function pick(node) {
    var stage = frameDoc.getElementById('stage');
    while (node && node !== stage && node.nodeType === 1) {
      if (node.id && !node.hasAttribute('data-motion-wrap')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function stageDown(e) {
    if (e.button !== 0) return;
    if (playing) play();
    var hit = pick(e.target);
    if (!hit) { select(null); return; }
    var cur = liveEl(selId);
    // clicking inside the selected group keeps the group, so you can drag it; double-click goes deeper
    if (!(cur && cur.contains(hit))) select(hit.id);
    var target = liveEl(selId);
    if (!target) return;
    e.preventDefault();

    var bx = valueAt(selId, 'x', playhead), by = valueAt(selId, 'y', playhead);
    var m = target.ownerSVGElement && target.parentNode.getScreenCTM ? target.parentNode.getScreenCTM().inverse() : null;
    var sx = e.clientX, sy = e.clientY, moved = false, id = selId;
    function move(ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!moved) { checkpoint(); moved = true; }
      if (m) { var ux = m.a * dx + m.c * dy, uy = m.b * dx + m.d * dy; dx = ux; dy = uy; }
      setKey(id, 'x', playhead, round(bx + dx));
      setKey(id, 'y', playhead, round(by + dy));
      scene.setTracks(project.tracks);
      scene.apply(playhead);
      drawSelection();
      renderProps();
    }
    function up() {
      frameDoc.removeEventListener('mousemove', move);
      frameDoc.removeEventListener('mouseup', up);
      if (moved) renderAll();
    }
    frameDoc.addEventListener('mousemove', move);
    frameDoc.addEventListener('mouseup', up);
  }

  function stageDbl(e) {
    var hit = pick(e.target);
    if (hit) select(hit.id);
  }

  // ════════ ELEMENT OPERATIONS ════════

  function renameId(to, from) {
    from = from || selId;
    if (!to || to === from) return;
    if (!/^[A-Za-z][\w-]*$/.test(to)) return status('Ids start with a letter: letters, numbers, - and _', true);
    if (sourceIds().has(to)) return status('#' + to + ' is taken', true);
    change(function () {
      editSource(function (r) { srcEl(r, from).id = to; });
      project.tracks.forEach(function (t) { if (t.target === from) t.target = to; });
      if (selId === from) selId = to;
    }, 'doc');
  }

  function deleteSelected() {
    if (!selId) return;
    change(function () {
      editSource(function (r) { var n = srcEl(r, selId); if (n) n.remove(); });
      var ids = sourceIds();
      project.tracks = project.tracks.filter(function (t) { return ids.has(t.target); });
      selId = null; selKey = null;
    }, 'doc');
  }

  function deleteKey() {
    if (!selKey) return;
    var s = selKey;
    change(function () {
      var i = s.track.keys.indexOf(s.key);
      if (i >= 0) s.track.keys.splice(i, 1);
      selKey = null;
    });
  }

  function insertHtml(markup, selectIt) {
    var id;
    change(function () {
      editSource(function (r) {
        var t = document.createElement('template');
        t.innerHTML = markup;
        id = t.content.firstElementChild && t.content.firstElementChild.id;
        r.appendChild(t.content);
      });
      ensureIds();
      if (selectIt && id) selId = id;
    }, 'doc');
  }

  function newId(base) { return uniqueId(base, sourceIds()); }

  function addText() {
    var id = newId('text');
    insertHtml('<div id="' + id + '" data-name="Text" style="position:absolute; left:' + Math.round(project.width / 2 - 200) +
      'px; top:' + Math.round(project.height / 2 - 30) + 'px; font-family:\'Cinzel\', serif; font-size:48px; ' +
      'color:#e8d49a; white-space:nowrap;">Text</div>', true);
  }

  function addBox() {
    var id = newId('box');
    insertHtml('<div id="' + id + '" data-name="Box" style="position:absolute; left:' + Math.round(project.width / 2 - 200) +
      'px; top:' + Math.round(project.height / 2 - 90) + 'px; width:400px; height:180px; background:rgba(8,8,8,0.85); ' +
      'border:1px solid #8a6e2e;"></div>', true);
  }

  function addImage(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, project.width * 0.6 / img.width, project.height * 0.6 / img.height);
        var w = Math.round(img.width * s), h = Math.round(img.height * s);
        var id = newId('image');
        insertHtml('<img id="' + id + '" data-name="' + escapeAttr(file.name) + '" src="' + reader.result +
          '" style="position:absolute; left:' + Math.round((project.width - w) / 2) + 'px; top:' +
          Math.round((project.height - h) / 2) + 'px; width:' + w + 'px; height:' + h + 'px;">', true);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  // an SVG file becomes live elements: every <path>, <g>, <circle>… is its own layer
  function importSvg(text, fileName) {
    var d = new DOMParser().parseFromString(text, 'image/svg+xml');
    var svg = d.documentElement;
    if (d.querySelector('parsererror') || svg.localName !== 'svg') return status('Could not read that SVG', true);

    [].slice.call(svg.querySelectorAll('*')).forEach(function (n) {
      if (/^(script|metadata|namedview|foreignObject)$/.test(n.localName)) { n.remove(); return; }
      [].slice.call(n.attributes).forEach(function (a) { if (/^on/i.test(a.name)) n.removeAttribute(a.name); });
    });

    // size: plain px width/height if given, else the viewBox; then shrink to fit the canvas
    var vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    var pxOnly = /^\s*[\d.]+(px)?\s*$/;
    var w = pxOnly.test(svg.getAttribute('width') || '') ? parseFloat(svg.getAttribute('width')) : NaN;
    var h = pxOnly.test(svg.getAttribute('height') || '') ? parseFloat(svg.getAttribute('height')) : NaN;
    if (!(w > 0 && h > 0)) {
      if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) { w = vb[2]; h = vb[3]; } else { w = 400; h = 400; }
    }
    if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    var s = Math.min(1, project.width * 0.8 / w, project.height * 0.8 / h);
    w = Math.round(w * s); h = Math.round(h * s);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('style', 'position:absolute; left:' + Math.round((project.width - w) / 2) + 'px; top:' +
      Math.round((project.height - h) / 2) + 'px; overflow:visible;' + (svg.getAttribute('style') ? ' ' + svg.getAttribute('style') : ''));
    svg.setAttribute('data-name', fileName.replace(/\.svg$/i, ''));

    // ids must be unique in the whole document; rename clashes and everything that points at them
    var used = sourceIds(), renames = {};
    [svg].concat([].slice.call(svg.querySelectorAll('[id]'))).forEach(function (n) {
      if (n.id && used.has(n.id)) { renames[n.id] = uniqueId(n.id, used); n.id = renames[n.id]; }
      else if (n.id) used.add(n.id);
    });
    if (Object.keys(renames).length) {
      [svg].concat([].slice.call(svg.querySelectorAll('*'))).forEach(function (n) {
        [].slice.call(n.attributes).forEach(function (a) {
          var v = a.value.replace(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g, function (m, id) {
            return renames[id] ? 'url(#' + renames[id] + ')' : m;
          });
          if (/href$/.test(a.name) && v[0] === '#' && renames[v.slice(1)]) v = '#' + renames[v.slice(1)];
          if (v !== a.value) n.setAttributeNS(a.namespaceURI, a.name, v);
        });
        if (n.localName === 'style') {
          n.textContent = n.textContent.replace(/#([\w-]+)/g, function (m, id) { return renames[id] ? '#' + renames[id] : m; });
        }
      });
    }
    if (!svg.id) svg.id = uniqueId('svg', used);
    insertHtml(new XMLSerializer().serializeToString(svg), true);
    status('Imported ' + fileName + ' — its parts are in Layers');
  }

  // ════════ FILES / SERVER ════════
  // serve.py answers api/config with what it allows. Anywhere else (a static host, a plain web server)
  // there is no api: projects save as downloads, examples come from projects/index.json, no rendering.
  // All URLs are relative, so the editor works from a subfolder like yoursite.com/motion/.

  var server = { api: false, save: false, render: false, formats: [] };
  function api(path, opts) { return fetch('api/' + path, opts); }

  var statusTimer;
  function status(msg, bad) {
    var s = $('status');
    s.textContent = msg;
    s.title = msg;
    s.classList.toggle('bad', !!bad);
    s.classList.remove('offer');
    clearTimeout(statusTimer);
    if (!bad) statusTimer = setTimeout(function () { s.textContent = ''; }, 6000);
  }

  function refreshList(selectName) {
    var get = server.api ? api('projects') : fetch('projects/index.json');
    return get.then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }).then(function (names) {
      names = Array.isArray(names) ? names.filter(function (n) { return /^[\w-]{1,64}$/.test(n); }) : [];
      var sel = $('open-list');
      sel.innerHTML = '';
      sel.appendChild(el('option', { value: '', text: names.length ? (server.save ? 'Open project…' : 'Open an example…') : '(no saved projects)' }));
      names.forEach(function (n) { sel.appendChild(el('option', { value: n, text: n })); });
      sel.value = selectName && names.indexOf(selectName) >= 0 ? selectName : '';
      return names;
    });
  }

  // show only what this server can do
  function applyServer() {
    $('btn-save').textContent = server.save ? 'Save' : 'Save .json';
    $('btn-save').title = server.save ? 'Ctrl+S' : 'Ctrl+S — downloads the project. Your work also autosaves in this browser.';
    $('btn-download').style.display = server.save ? '' : 'none';
    [].forEach.call($('render-format').options, function (o) { o.hidden = server.formats.indexOf(o.value) < 0; });
    $('render-format').style.display = $('btn-render').style.display = server.render ? '' : 'none';
    var fmt = $('render-format');
    if (server.render && server.formats.indexOf(fmt.value) < 0) fmt.value = server.formats[0];
  }

  function openProject(n) {
    if (dirty && !confirm('Discard unsaved changes to ' + name + '?')) { $('open-list').value = name; return; }
    fetch('projects/' + encodeURIComponent(n) + '.json').then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(function (p) {
      setProject(p, n);
      history.replaceState(null, '', '?project=' + encodeURIComponent(n));
      status('Opened ' + n);
    }).catch(function () { status('Could not open ' + n, true); });
  }

  function save() {
    if (!server.save) {
      download();
      dirty = false;
      renderAll();
      return Promise.resolve(false);
    }
    if (name === 'untitled' || !/^[\w-]{1,64}$/.test(name)) {
      var n = prompt('Save as (letters, numbers, - and _):', name === 'untitled' ? '' : name);
      if (!n || !/^[\w-]{1,64}$/.test(n.trim())) { status('Not saved', true); return Promise.resolve(false); }
      name = n.trim();
    }
    var body = JSON.stringify(serialize());
    if (body.length > 20 * 1024 * 1024) {
      status('Too big to save on the server (20 MB) — shrink embedded images, or use Download', true);
      return Promise.resolve(false);
    }
    return api('projects/' + name, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: body
    }).then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error); return b; }); })
      .then(function (b) {
        dirty = false;
        status('Saved ' + b.saved);
        history.replaceState(null, '', '?project=' + encodeURIComponent(name));
        refreshList(name);
        renderAll();
        return true;
      }).catch(function (err) { status('Save failed: ' + err.message, true); return false; });
  }

  function download() {
    var a = el('a', {
      href: URL.createObjectURL(new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' })),
      download: name + '.json'
    });
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function renderVideo() {
    if (!server.render) {
      return status('Rendering runs on your own PC: download the project, then python render.py ' + name + '.json', true);
    }
    var fmt = $('render-format').value, btn = $('btn-render');
    save().then(function (ok) {
      if (!ok) return;
      btn.disabled = true;
      status('Rendering ' + name + '.' + fmt + '… (about ' + Math.ceil(project.duration / 1000 * (fmt === 'gif' ? 50 : project.fps) / 6) + ' s)');
      return api('render/' + name + '?format=' + fmt, { method: 'POST' })
        .then(function (r) { return r.json().then(function (b) { if (!r.ok) throw new Error(b.error); return b; }); })
        .then(function (b) { status('Rendered → ' + b.out); })
        .catch(function (err) { status('Render failed: ' + err.message, true); })
        .then(function () { btn.disabled = false; });
    });
  }

  // ── autosave: the whole project, in this browser only ──
  // With a saving server it's a safety net (offered back if you close with unsaved changes);
  // without one it IS where your work lives between visits.
  var DRAFT = 'motion-editor:draft', draftTimer = null, draftWarned = false;

  function saveDraft() {
    if (!project) return;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      try {
        localStorage.setItem(DRAFT, JSON.stringify({ name: name, dirty: dirty, at: Date.now(), project: serialize() }));
      } catch (err) {
        if (!draftWarned) {
          draftWarned = true;
          status('Autosave is off — this browser won\'t store the project (too big, or storage blocked). Save a .json to keep it.', true);
        }
      }
    }, 700);
  }

  function readDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(DRAFT));
      return d && d.project && typeof d.project === 'object' ? d : null;
    } catch (err) { return null; }
  }

  function offerDraft(d) {
    var s = $('status');
    clearTimeout(statusTimer);
    s.classList.remove('bad');
    s.classList.add('offer');
    s.textContent = 'Unsaved ' + (d.name || 'untitled') + ' from ' + new Date(d.at).toLocaleString();
    s.title = 'Changes this browser kept from last time that were never saved';
    s.appendChild(el('button', { text: 'Restore', onclick: function () {
      setProject(d.project, d.name);
      dirty = true;
      renderAll();
      status('Restored — save it to keep it');
    } }));
    s.appendChild(el('button', { text: 'Dismiss', onclick: function () { status(''); } }));
  }

  // ════════ KEYS ════════

  function onKey(e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || '').toUpperCase());
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (typing) return;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) restore(redoStack, undoStack); else restore(undoStack, redoStack); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); restore(redoStack, undoStack); return; }
    if (e.key === ' ') { e.preventDefault(); play(); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (selKey) { e.preventDefault(); deleteKey(); } }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (playing) play();
      var stepMs = e.shiftKey ? 100 : frameMs();
      seekTo(snap(playhead + (e.key === 'ArrowLeft' ? -stepMs : stepMs), e.shiftKey));
    }
    else if (e.key === 'Home') { seekTo(0); }
    else if (e.key === 'End') { seekTo(project.duration); }
    else if (e.key === 'Escape') { selKey = null; select(null); }
  }

  // ════════ WIRING ════════

  $('btn-new').onclick = function () {
    if (dirty && !confirm('Discard unsaved changes to ' + name + '?')) return;
    setProject(blank(), 'untitled');
    history.replaceState(null, '', location.pathname);
  };
  $('open-list').onchange = function (e) { if (e.target.value) openProject(e.target.value); };
  $('btn-open-file').onclick = function () { $('file-json').click(); };
  $('file-json').onchange = function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    f.text().then(function (t) {
      setProject(JSON.parse(t), f.name.replace(/\.json$/i, '').replace(/[^\w-]/g, '-'));
      status('Opened ' + f.name);
    }).catch(function () { status('That file is not a project', true); });
  };
  $('btn-save').onclick = save;
  $('btn-download').onclick = download;
  $('btn-import-svg').onclick = function () { $('file-svg').click(); };
  $('file-svg').onchange = function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (f) f.text().then(function (t) { importSvg(t, f.name); });
  };
  $('btn-import-img').onclick = function () { $('file-img').click(); };
  $('file-img').onchange = function (e) {
    var f = e.target.files[0];
    e.target.value = '';
    if (f) addImage(f);
  };
  $('btn-add-text').onclick = addText;
  $('btn-add-box').onclick = addBox;
  $('btn-undo').onclick = function () { restore(undoStack, redoStack); };
  $('btn-redo').onclick = function () { restore(redoStack, undoStack); };
  $('btn-render').onclick = renderVideo;
  $('btn-play').onclick = play;
  $('btn-start').onclick = function () { seekTo(0); };
  $('tab-element').onclick = function () { tab = 'element'; renderInspector(); };
  $('tab-document').onclick = function () { tab = 'document'; renderInspector(); };
  addEventListener('keydown', onKey);
  addEventListener('resize', function () { fit(); if (project) renderTimeline(); });
  addEventListener('beforeunload', function (e) {
    if (dirty && server.save) { e.preventDefault(); e.returnValue = ''; }
  });

  // SVG files dropped anywhere import straight in
  addEventListener('dragover', function (e) { e.preventDefault(); });
  addEventListener('drop', function (e) {
    e.preventDefault();
    [].forEach.call(e.dataTransfer.files, function (f) {
      if (/\.svg$/i.test(f.name)) f.text().then(function (t) { importSvg(t, f.name); });
      else if (/^image\//.test(f.type)) addImage(f);
      else if (/\.json$/i.test(f.name)) f.text().then(function (t) { setProject(JSON.parse(t), f.name.replace(/\.json$/i, '')); });
    });
  });

  var started = false;
  function start() {
    if (started) return;
    try {
      frameWin = frame.contentWindow;
      frameDoc = frameWin.document;
      scene = frameWin.motion.scene;
    } catch (err) {
      status('Open this over http — python serve.py, or put the folder on any web server', true);
      return;
    }
    started = true;
    frameDoc.addEventListener('mousedown', stageDown);
    frameDoc.addEventListener('dblclick', stageDbl);
    frameDoc.addEventListener('keydown', onKey);

    var wanted = new URLSearchParams(location.search).get('project');
    api('config').then(function (r) {
      if (!r.ok) throw new Error();
      return r.json();
    }).then(function (cfg) {
      server = { api: true, save: !!cfg.save, render: !!cfg.render, formats: cfg.formats || [] };
    }).catch(function () {}).then(function () {
      applyServer();
      return refreshList();
    }).then(function (names) {
      var draft = readDraft();
      // no server to save to: the browser's copy is the user's work, so carry on with it
      if (draft && !wanted && !server.save) {
        setProject(draft.project, draft.name);
        dirty = !!draft.dirty;
        renderAll();
        status('Picked up where you left off');
        return;
      }
      var first = wanted && names.indexOf(wanted) >= 0 ? wanted : names.indexOf('chat-popup') >= 0 ? 'chat-popup' : null;
      var load = first
        ? fetch('projects/' + first + '.json').then(function (r) { return r.json(); }).then(function (p) {
            setProject(p, first);
            $('open-list').value = first;
          })
        : Promise.resolve(setProject(blank(), 'untitled'));
      return load.then(function () { if (draft && draft.dirty) offerDraft(draft); });
    }).catch(function (err) {
      status('Could not start: ' + err.message, true);
      setProject(blank(), 'untitled');
    });
  }
  // the preview may finish loading before this script runs
  frame.addEventListener('load', start);
  try { if (frame.contentDocument.readyState === 'complete' && frame.contentWindow.motion) start(); } catch (err) {}
})();
