# Motion — give HTML/SVG a timeline, render it deterministically

```
serve.py ──► editor.html ──► projects/<name>.json ──► render.py ──► out/<name>.webm | .mov | frames
                 │                                        │
                 └──── player.html + runtime.js ◄─────────┘   (the same code previews and renders)
```

**Three layers, kept apart**

| Layer | What | Where |
|---|---|---|
| Document | what exists: HTML, SVG, text, images | `html` / `css` in the project, `{{vars}}` swapped in |
| Animation | how it changes: `element + property + keyframes + ease` | `tracks` in the project, evaluated by `runtime.js` |
| Renderer | timeline → file: Chromium seeks each frame, FFmpeg encodes | `render.py`, knows nothing about the contents |

## Editing

    python the-fucking-toolshed/motion/serve.py        → http://localhost:8790/editor.html

- **Import SVG** (or drop a file on the page): every `<path>`, `<g>`, `<circle>`… becomes its own layer.
  **Text / Box / Image** add HTML pieces.
- Click on the stage to select, double-click to go inside a group, drag to move (keys X/Y at the playhead).
- Every property has a ◇: click it to key the current value at the playhead. Typing a value keys it too.
  One key = a fixed value.
- **Presets** (fade, slide, pop, draw on, wipe, glitch, shake…) are just keys written at the playhead,
  so you can edit them afterwards like any others.
- Timeline: drag diamonds to retime (they snap to frames; hold Shift to stop that), double-click a lane to add a key,
  click a diamond to set its value and its **ease to the next key**. Space plays, ←/→ step a frame, Ctrl+Z / Ctrl+Y undo and redo.
- **Document** tab: size, length, fps, vars, fonts, and the raw HTML/CSS if you want to edit it by hand.
- **Render**: saves the project, then writes `out/<name>.webm` (OBS), `.mov` (ProRes 4444 for Premiere/Resolve/AE) or PNG frames.

## Rendering from the command line

    python render.py projects/chat-popup.json                           → out/chat-popup.webm
    python render.py projects/chat-popup.json --format mov
    python render.py projects/chat-popup.json --set name=Vex --set "message=hello crypt"
    python render.py projects/chat-popup.json --batch chats.csv         one clip per row

For `--batch`, the CSV's columns are var names (`name,message,nameColor`). An optional `out` column sets each clip's
file name, without the extension.

## Making any page renderable

`render.py` will render any `.html` that provides this:

```js
window.motion = {
  ready: Promise.resolve({ duration: 1800, width: 1920, height: 1080 }),  // ms, px
  seek: ms => { /* show the moment ms */ return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); }
};
```

`../stinger/stinger.html` does exactly this, and `../stinger/render.py` is a thin wrapper around `render.py`.

    python render.py ../stinger/stinger.html --query style=sigil

## Putting the editor on a website

The editor is plain static files: `editor.html`, `editor.js`, `player.html`, `runtime.js` and `projects/`.
Upload them to any web host, in the site root or a subfolder like `/motion/`. With no server behind it:

- **Save .json** downloads the project, and the editor autosaves in each visitor's own browser, so a reload
  picks up where they left off.
- **Open an example…** lists `projects/index.json`. `serve.py` rewrites that file on every save; edit it
  by hand to choose which examples people see.
- There's no Render button. Visitors render on their own PC with `render.py`.

`python serve.py --public` does the same from this PC: it listens on the network, read-only, with no rendering,
and doesn't serve `out/` or the `.py` files.

**Why rendering stays local:** a render runs a real Chromium on the server against whatever HTML the
project holds. `render.py` fences that in. The page may load only files from its own folder, `data:` URLs
and Google Fonts, never the rest of the disk or the local network, and `serve.py` caps renders at
120 s, 3840×2160 and 15 minutes of work. It's still heavy, and it still runs a stranger's document on your
machine. Offering rendering publicly would need a sandboxed render queue.

**Opening other people's projects is safe:** before a document touches the page, `runtime.js` removes
scripts, `on…` handlers, `javascript:` links, iframes/objects and SVG `href` animations. A project is
something to look at, never a program.

Needs once: `pip install --user playwright imageio-ffmpeg pillow` then `python -m playwright install chromium`.
