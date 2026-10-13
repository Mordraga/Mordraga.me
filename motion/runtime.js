/* Motion runtime — turns a project (an HTML/SVG document + keyframe tracks) into a page you can seek.
   player.html runs it for render.py; the editor runs the same file inside its preview, so what you
   scrub is exactly what renders.

   Project shape (projects/*.json):
     { width, height, duration (ms), fps,
       fonts: [stylesheet urls], vars: { name: value },
       css, html,                        strings or arrays of lines; {{name}} is swapped for vars.name in both
       tracks: [{ target: element id, prop: 'x', keys: [{ t: ms, v: value, ease: 'ease-out' }] }] }
   A key's ease shapes the move from that key to the next. Before the first key and after the last,
   the track holds that key's value. Nothing here knows what the document contains — it only writes
   the properties in PROPS onto elements by id.
*/
(function () {
  'use strict';

  // ════════ EASING ════════

  function bezier(x1, y1, x2, y2) {
    function coord(a, b, t) { return 3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t; }
    function slope(a, b, t) { return 3 * a * (1 - t) * (1 - t) + 6 * (b - a) * t * (1 - t) + 3 * (1 - b) * t * t; }
    return function (p) {
      if (p <= 0) return 0;
      if (p >= 1) return 1;
      var t = p;
      for (var i = 0; i < 8; i++) {
        var err = coord(x1, x2, t) - p;
        if (Math.abs(err) < 1e-6) return coord(y1, y2, t);
        var d = slope(x1, x2, t);
        if (Math.abs(d) < 1e-6) break;
        t = Math.min(1, Math.max(0, t - err / d));
      }
      var lo = 0, hi = 1;
      for (var j = 0; j < 40; j++) {
        t = (lo + hi) / 2;
        if (coord(x1, x2, t) < p) lo = t; else hi = t;
      }
      return coord(y1, y2, t);
    };
  }

  function bounce(p) {
    var n = 7.5625, d = 2.75;
    if (p < 1 / d) return n * p * p;
    if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
    if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
    return n * (p -= 2.625 / d) * p + 0.984375;
  }

  function elastic(p) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
  }

  // fixed noise, so a glitch looks the same every render
  function noise(i) {
    var x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  // lurches toward the target in 8 jittery steps
  function glitch(p) {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    var i = Math.floor(p * 8);
    if (i === 0) return 0;
    return i / 8 + (noise(i) * 2 - 1) * 0.3 * (1 - i / 8);
  }

  var EASES = {
    'linear':             function (p) { return p; },
    'ease':               bezier(.25, .1, .25, 1),
    'ease-in':            bezier(.42, 0, 1, 1),
    'ease-out':           bezier(0, 0, .58, 1),
    'ease-in-out':        bezier(.42, 0, .58, 1),
    'ease-in-strong':     bezier(.7, 0, .84, 0),
    'ease-out-strong':    bezier(.16, 1, .3, 1),
    'ease-in-out-strong': bezier(.87, 0, .13, 1),
    'overshoot':          bezier(.34, 1.56, .64, 1),
    'anticipate':         bezier(.36, 0, .66, -.56),
    'bounce':             bounce,
    'elastic':            elastic,
    'glitch':             glitch,
    'hold':               function (p) { return p < 1 ? 0 : 1; }
  };

  var customEases = {};
  // a preset name, or 'cubic-bezier(a, b, c, d)'
  function ease(name) {
    if (EASES[name]) return EASES[name];
    if (customEases[name]) return customEases[name];
    var m = /^cubic-bezier\(([^)]*)\)$/.exec(String(name || '').trim());
    var n = m ? m[1].split(',').map(Number) : [];
    if (n.length !== 4 || n.some(isNaN)) return EASES.linear;
    return (customEases[name] = bezier(n[0], n[1], n[2], n[3]));
  }

  // ════════ PROPERTIES ════════
  // type: how values interpolate. svg / html: only offered on that kind of element.

  var PROPS = {
    x:           { label: 'X',            type: 'number', def: 0, step: 1,    unit: 'px' },
    y:           { label: 'Y',            type: 'number', def: 0, step: 1,    unit: 'px' },
    scale:       { label: 'Scale',        type: 'number', def: 1, step: 0.01 },
    rotate:      { label: 'Rotation',     type: 'number', def: 0, step: 1,    unit: '°' },
    opacity:     { label: 'Opacity',      type: 'number', def: 1, step: 0.01, min: 0, max: 1 },
    blur:        { label: 'Blur',         type: 'number', def: 0, step: 0.5,  min: 0, unit: 'px' },
    fill:        { label: 'Fill',         type: 'color' },            // SVG fill; background on HTML
    stroke:      { label: 'Stroke',       type: 'color' },            // SVG stroke; border colour on HTML
    strokeWidth: { label: 'Stroke width', type: 'number', def: 1, step: 0.5,  min: 0, svg: true },
    draw:        { label: 'Draw',         type: 'number', def: 1, step: 0.01, min: 0, max: 1, svg: true },
    color:       { label: 'Text colour',  type: 'color', html: true },
    clipTop:     { label: 'Clip top',     type: 'number', def: 0, step: 1,    min: 0, max: 100, unit: '%' },
    clipRight:   { label: 'Clip right',   type: 'number', def: 0, step: 1,    min: 0, max: 100, unit: '%' },
    clipBottom:  { label: 'Clip bottom',  type: 'number', def: 0, step: 1,    min: 0, max: 100, unit: '%' },
    clipLeft:    { label: 'Clip left',    type: 'number', def: 0, step: 1,    min: 0, max: 100, unit: '%' }
  };

  var GEOMETRY = 'path, line, polyline, polygon, circle, ellipse, rect';

  // every inline style the runtime may write — saved before the first write, put back on reset
  var WRITTEN = ['translate', 'rotate', 'scale', 'transform-box', 'transform-origin', 'opacity', 'filter',
                 'fill', 'stroke', 'stroke-width', 'color', 'background-color', 'border-color', 'clip-path',
                 'stroke-dasharray', 'stroke-dashoffset'];

  var colorCtx = document.createElement('canvas').getContext('2d');
  var colorCache = {};
  function parseColor(str) {
    str = String(str);
    if (colorCache[str]) return colorCache[str];
    colorCtx.fillStyle = '#000';
    colorCtx.fillStyle = str;
    var s = colorCtx.fillStyle, c;
    if (s[0] === '#') {
      c = [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), 1];
    } else {
      var n = s.match(/[\d.]+/g).map(Number);
      c = [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
    }
    return (colorCache[str] = c);
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function mix(a, b, e, type) {
    if (type !== 'color') return Number(a) + (Number(b) - Number(a)) * e;
    var ca = parseColor(a), cb = parseColor(b);
    var c = ca.map(function (v, i) { return v + (cb[i] - v) * e; });
    return 'rgba(' + Math.round(clamp(c[0], 0, 255)) + ',' + Math.round(clamp(c[1], 0, 255)) + ',' +
           Math.round(clamp(c[2], 0, 255)) + ',' + clamp(c[3], 0, 1).toFixed(3) + ')';
  }

  // value of a track at t ms (keys sorted by t)
  function valueAt(track, t) {
    var k = track.keys, type = (PROPS[track.prop] || {}).type;
    if (!k.length) return undefined;
    if (t <= k[0].t) return k[0].v;
    for (var i = 0; i < k.length - 1; i++) {
      var a = k[i], b = k[i + 1];
      if (t < b.t) {
        var span = b.t - a.t;
        return mix(a.v, b.v, span > 0 ? ease(a.ease)((t - a.t) / span) : 1, type);
      }
    }
    return k[k.length - 1].v;
  }

  // ════════ PROJECT ════════

  function text(v) { return Array.isArray(v) ? v.join('\n') : (v || ''); }

  function normalize(p) {
    return {
      width: Number(p.width) || 1920,
      height: Number(p.height) || 1080,
      duration: Number(p.duration) || 3000,
      fps: Number(p.fps) || 60,
      fonts: p.fonts || [],
      vars: p.vars || {},
      css: text(p.css),
      html: text(p.html),
      tracks: p.tracks || []
    };
  }

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

  // A project is a document to look at, never a program: scripts, event handlers, javascript: links and
  // embedded pages are dropped before anything touches the live page. Parsing into a <template> first
  // keeps it inert — nothing loads or runs until it's clean.
  var UNSAFE = 'script, iframe, frame, frameset, object, embed, applet, base, meta, link, portal, ' +
               'animate[attributeName*="href" i], set[attributeName*="href" i], ' +
               'animate[attributeName^="on" i], set[attributeName^="on" i]';
  function sanitize(markup, doc) {
    var t = (doc || document).createElement('template');
    t.innerHTML = markup;
    t.content.querySelectorAll(UNSAFE).forEach(function (n) { n.remove(); });
    t.content.querySelectorAll('*').forEach(function (n) {
      [].slice.call(n.attributes).forEach(function (a) {
        var name = a.name.toLowerCase(), value = a.value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
        if (name.indexOf('on') === 0 || name === 'srcdoc' || name === 'formaction') n.removeAttribute(a.name);
        else if (/(^|:)(href|src|action|data|poster|background)$/.test(name) && /^(javascript|vbscript):/.test(value)) {
          n.removeAttribute(a.name);
        }
      });
    });
    return t.content;
  }

  function fillVars(src, vars, escape) {
    return src.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, function (m, k) {
      if (!Object.prototype.hasOwnProperty.call(vars, k)) return m;
      var s = String(vars[k]);
      return escape ? s.replace(/[&<>"]/g, function (c) { return ESC[c]; }) : s;
    });
  }

  // ════════ SCENE ════════

  function Scene(stage) {
    this.stage = stage;
    this.doc = stage.ownerDocument;
    this.style = this.doc.createElement('style');
    this.doc.head.appendChild(this.style);
    this.project = null;
    this.entries = [];
    this.saved = new Map();   // element → its own inline values of WRITTEN, from before we touched it
  }

  // build the document; resolves with {duration, width, height, fps} once fonts and images are in
  Scene.prototype.load = function (project, vars) {
    var self = this, doc = this.doc, p = normalize(project);
    var v = Object.assign({}, p.vars, vars || {});
    this.project = p;

    var fontsIn = p.fonts.map(function (href) {
      var link = doc.querySelector('link[data-motion-font="' + CSS.escape(href) + '"]');
      if (link) return link.loaded;
      link = doc.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-motion-font', href);
      link.loaded = new Promise(function (done) { link.onload = link.onerror = done; });
      doc.head.appendChild(link);
      return link.loaded;
    });

    this.style.textContent = fillVars(p.css, v, false);
    this.stage.style.width = p.width + 'px';
    this.stage.style.height = p.height + 'px';
    this.saved = new Map();
    this.entries = [];
    this.stage.replaceChildren(sanitize(fillVars(p.html, v, true), doc));
    this.setTracks(p.tracks);
    this.apply(0);

    var images = [].map.call(this.stage.querySelectorAll('img'), function (img) {
      return img.decode().catch(function () {});
    });
    return Promise.all(fontsIn.concat(images)).then(function () {
      void self.stage.offsetWidth;  // lay the text out so its fonts start loading
      return doc.fonts.ready;
    }).then(function () {
      self.setTracks(p.tracks);     // path lengths can change once fonts settle
      return { duration: p.duration, width: p.width, height: p.height, fps: p.fps };
    });
  };

  Scene.prototype.find = function (id) {
    return id ? this.stage.querySelector('#' + CSS.escape(id)) : null;
  };

  Scene.prototype.remember = function (el) {
    if (this.saved.has(el)) return;
    var s = {};
    WRITTEN.forEach(function (p) { s[p] = el.style.getPropertyValue(p); });
    this.saved.set(el, s);
  };

  // put every touched element back how the document had it
  Scene.prototype.reset = function () {
    this.saved.forEach(function (s, el) {
      WRITTEN.forEach(function (p) {
        if (s[p]) el.style.setProperty(p, s[p]); else el.style.removeProperty(p);
      });
    });
    this.saved = new Map();
    this.entries = [];
  };

  // (re)compile the tracks against the current document — cheap, the editor calls it on every change
  Scene.prototype.setTracks = function (tracks) {
    var self = this, byEl = new Map();
    this.reset();
    if (this.project) this.project.tracks = tracks;

    tracks.forEach(function (track) {
      var el = self.find(track.target);
      if (!el || !PROPS[track.prop] || !track.keys || !track.keys.length) return;
      if (!byEl.has(el)) byEl.set(el, { el: el, tracks: [] });
      byEl.get(el).tracks.push({
        prop: track.prop,
        keys: track.keys.slice().sort(function (a, b) { return a.t - b.t; })
      });
    });

    byEl.forEach(function (entry) {
      var el = entry.el;
      var props = entry.tracks.map(function (t) { return t.prop; });
      entry.svg = el instanceof SVGElement;
      entry.mover = el;

      var moves = props.some(function (p) { return p === 'x' || p === 'y' || p === 'scale' || p === 'rotate'; });
      if (moves && el.ownerSVGElement) {
        // inside an SVG: turn around its own centre, and keep any transform="" it already has
        // by moving a wrapper <g> instead of the element itself
        if (el.hasAttribute('transform')) {
          var wrap = el.parentNode;
          if (!(wrap && wrap.hasAttribute && wrap.hasAttribute('data-motion-wrap'))) {
            wrap = self.doc.createElementNS('http://www.w3.org/2000/svg', 'g');
            wrap.setAttribute('data-motion-wrap', '');
            el.parentNode.insertBefore(wrap, el);
            wrap.appendChild(el);
          }
          entry.mover = wrap;
        }
        self.remember(entry.mover);
        entry.mover.style.transformBox = 'fill-box';
        entry.mover.style.transformOrigin = 'center';
      }
      self.remember(el);

      if (props.indexOf('blur') >= 0) {
        var f = getComputedStyle(el).filter;
        entry.baseFilter = f && f !== 'none' ? f + ' ' : '';
      }

      if (props.indexOf('draw') >= 0) {
        var geoms = el.matches(GEOMETRY) ? [el] : [].slice.call(el.querySelectorAll(GEOMETRY));
        entry.geoms = geoms.filter(function (g) { return typeof g.getTotalLength === 'function'; }).map(function (g) {
          self.remember(g);
          var len = 0;
          try { len = g.getTotalLength(); } catch (e) {}
          return { el: g, len: len };
        });
      }
    });

    this.entries = [];
    byEl.forEach(function (entry) { self.entries.push(entry); });
  };

  function write(entry, v) {
    var el = entry.el, s = el.style, m = entry.mover.style;
    if ('x' in v || 'y' in v) m.translate = (v.x || 0) + 'px ' + (v.y || 0) + 'px';
    if ('rotate' in v) m.rotate = v.rotate + 'deg';
    if ('scale' in v) m.scale = String(v.scale);
    if ('opacity' in v) s.opacity = clamp(v.opacity, 0, 1);
    if ('blur' in v) s.filter = v.blur > 0 ? entry.baseFilter + 'blur(' + v.blur + 'px)' : (entry.baseFilter || 'none');
    if ('fill' in v) s[entry.svg ? 'fill' : 'backgroundColor'] = v.fill;
    if ('stroke' in v) s[entry.svg ? 'stroke' : 'borderColor'] = v.stroke;
    if ('strokeWidth' in v) s.strokeWidth = Math.max(0, v.strokeWidth);
    if ('color' in v) s.color = v.color;
    if ('draw' in v) {
      var d = clamp(v.draw, 0, 1);
      entry.geoms.forEach(function (g) {
        g.el.style.strokeDasharray = g.len + ' ' + (g.len + 1);
        g.el.style.strokeDashoffset = g.len * (1 - d);
      });
    }
    if ('clipTop' in v || 'clipRight' in v || 'clipBottom' in v || 'clipLeft' in v) {
      s.clipPath = 'inset(' + (v.clipTop || 0) + '% ' + (v.clipRight || 0) + '% ' +
                   (v.clipBottom || 0) + '% ' + (v.clipLeft || 0) + '%)';
    }
  }

  // draw the moment t ms — synchronous; the caller waits for paint if it needs to
  Scene.prototype.apply = function (t) {
    this.entries.forEach(function (entry) {
      var v = {};
      entry.tracks.forEach(function (tr) { v[tr.prop] = valueAt(tr, t); });
      write(entry, v);
    });
  };

  window.MotionRuntime = {
    Scene: Scene,
    PROPS: PROPS,
    EASES: EASES,
    ease: ease,
    valueAt: valueAt,
    parseColor: parseColor,
    normalize: normalize,
    fillVars: fillVars,
    sanitize: sanitize
  };
})();
