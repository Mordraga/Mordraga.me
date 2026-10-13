"""Render a motion document to video: Chromium seeks it frame by frame, FFmpeg encodes the screenshots.

    python render.py projects/chat-popup.json                       -> out/chat-popup.webm
    python render.py projects/chat-popup.json --set name=Vex --set "message=hello crypt"
    python render.py projects/chat-popup.json --batch messages.csv  one clip per row (columns are vars;
                                                                    an optional 'out' column names the file)
    python render.py ../stinger/stinger.html --query style=sigil    any page with the contract below
    --format webm   VP9 with alpha (OBS)           [default]
             mov    ProRes 4444 with alpha (Premiere, Resolve, After Effects)
             gif    looping GIF with transparency, cropped to what's ever visible (--no-crop: full frame)
             png    a folder of frames
    --fps N         default: the project's fps, else 60 (GIF: 50, the fastest rate players respect)
    --out PATH      default: out/<name>.<format>
    --max-seconds N / --max-size WxH   refuse anything longer / bigger (serve.py sets these)

While rendering, the page may only load files from its own folder, data: URLs and Google Fonts —
a project can't read the rest of the disk or reach the local network.

The whole contract a document needs to be renderable:
    window.motion.ready     Promise -> {duration, width, height}   (ms, px)
    window.motion.seek(ms)  Promise that resolves once that moment has painted
A .json project is loaded into player.html, which provides that contract from keyframe data.
Needs once:  pip install --user playwright imageio-ffmpeg pillow   (pillow: GIF only)
             python -m playwright install chromium
"""
import argparse
import csv
import json
import os
import subprocess
import sys
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import url2pathname

import imageio_ffmpeg
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
OUT = HERE / 'out'
PLAYER = HERE / 'player.html'

ENCODERS = {
    # yuva420p keeps the alpha channel; OBS plays it as-is
    'webm': ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '18',
             '-row-mt', '1', '-auto-alt-ref', '0'],
    'mov': ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0'],
    # one palette for the whole clip, a slot kept for transparency; GIF alpha is on/off, so pixels
    # under half opacity drop out. -loop 0 = loop forever
    'gif': ['-filter_complex', '[0:v]split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=full[p];'
            '[b][p]paletteuse=alpha_threshold=128:dither=sierra2_4a:diff_mode=rectangle', '-loop', '0'],
}
# the only outside hosts a page may load from while rendering
ALLOWED_HOSTS = {'fonts.googleapis.com', 'fonts.gstatic.com'}

# GIF stores frame delays in 1/100 s, and players slow anything under 2/100 s down to a crawl
GIF_FPS = 50


@contextmanager
def browser():
    """One headless Chromium page, reused across renders."""
    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            yield b.new_page(viewport={'width': 1920, 'height': 1080})
        finally:
            b.close()


def lock_down(page, folder):
    """Let the page load only files under folder, data:/blob: URLs and ALLOWED_HOSTS; abort the rest."""
    root = os.path.normcase(str(Path(folder).resolve()))

    def check(route):
        url = urlparse(route.request.url)
        if url.scheme in ('data', 'blob', 'about'):
            return route.continue_()
        if url.scheme == 'file':
            path = os.path.normcase(str(Path(url2pathname(url.path)).resolve()))
            if path == root or path.startswith(root + os.sep):
                return route.continue_()
        elif url.scheme == 'https' and url.hostname in ALLOWED_HOSTS:
            return route.continue_()
        route.abort()

    page.unroute('**/*')
    page.route('**/*', check)


class TooBig(ValueError):
    pass


def open_document(page, source, query='', variables=None, max_seconds=None, max_size=None):
    """Load a .json project or a contract page; returns its info dict."""
    source = Path(source).resolve()
    lock_down(page, PLAYER.parent if source.suffix.lower() == '.json' else source.parent)
    if source.suffix.lower() == '.json':
        project = json.loads(source.read_text(encoding='utf-8'))
        page.set_viewport_size({'width': int(project.get('width', 1920)), 'height': int(project.get('height', 1080))})
        page.goto(PLAYER.as_uri() + '?render')
        info = page.evaluate('([p, v]) => motion.load(p, v)', [project, variables or {}])
    else:
        page.goto(source.as_uri() + '?render' + ('&' + query if query else ''))
        info = page.evaluate('motion.ready')
        size = {'width': int(info['width']), 'height': int(info['height'])}
        if page.viewport_size != size:
            page.set_viewport_size(size)
    if max_seconds and info['duration'] > max_seconds * 1000:
        raise TooBig(f"{info['duration'] / 1000:g} s is longer than the {max_seconds:g} s limit")
    if max_size and (info['width'] > max_size[0] or info['height'] > max_size[1]):
        raise TooBig(f"{info['width']}x{info['height']} is bigger than the {max_size[0]}x{max_size[1]} limit")
    return info


def gif_frames(pngs, crop=True):
    """RGBA frames for the GIF encoder, cut to the area that is ever visible across the whole clip."""
    from io import BytesIO
    from PIL import Image
    images = [Image.open(BytesIO(p)).convert('RGBA') for p in pngs]
    box = None
    if crop:
        for img in images:
            b = img.getchannel('A').getbbox()
            if b:
                box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    for img in images:
        if box:
            img = img.crop(box)
        buf = BytesIO()
        img.save(buf, 'PNG', compress_level=1)
        yield buf.getvalue()


def render(page, source, out, fps=None, query='', variables=None, on_frame=None, crop=True,
           max_seconds=None, max_size=None):
    """Render source to out (.webm / .mov / .gif, anything else = a folder of PNGs).
    on_frame(index, png_bytes, info) sees every frame. Returns the document's info."""
    info = open_document(page, source, query, variables, max_seconds, max_size)
    out = Path(out)
    fmt = out.suffix.lower().lstrip('.')
    fps = fps or (GIF_FPS if fmt == 'gif' else info.get('fps') or 60)
    frames = max(1, round(info['duration'] * fps / 1000))
    out.parent.mkdir(parents=True, exist_ok=True)
    print(f'{out.name}: {frames} frames at {fps} fps...', flush=True)

    if fmt == 'gif':
        # the crop needs every frame first, so capture all, then encode
        pngs = []
        for i in range(frames):
            page.evaluate('t => motion.seek(t)', i * 1000 / fps)
            png = page.screenshot(omit_background=True)
            if on_frame:
                on_frame(i, png, info)
            pngs.append(png)
        encoder = subprocess.Popen([
            imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error',
            '-f', 'image2pipe', '-framerate', str(fps), '-c:v', 'png', '-i', '-',
            *ENCODERS['gif'], str(out),
        ], stdin=subprocess.PIPE)
        try:
            for png in gif_frames(pngs, crop):
                encoder.stdin.write(png)
        finally:
            encoder.stdin.close()
            if encoder.wait():
                raise RuntimeError(f'ffmpeg failed on {out}')
        print(f'  -> {out}', flush=True)
        return info

    encoder = None
    if fmt in ENCODERS:
        encoder = subprocess.Popen([
            imageio_ffmpeg.get_ffmpeg_exe(), '-y', '-loglevel', 'error',
            '-f', 'image2pipe', '-framerate', str(fps), '-c:v', 'png', '-i', '-',
            *ENCODERS[fmt], str(out),
        ], stdin=subprocess.PIPE)
    else:
        out.mkdir(exist_ok=True)

    try:
        for i in range(frames):
            page.evaluate('t => motion.seek(t)', i * 1000 / fps)
            png = page.screenshot(omit_background=True)
            if on_frame:
                on_frame(i, png, info)
            if encoder:
                encoder.stdin.write(png)
            else:
                (out / f'f{i:04d}.png').write_bytes(png)
    finally:
        if encoder:
            encoder.stdin.close()
            if encoder.wait():
                raise RuntimeError(f'ffmpeg failed on {out}')

    print(f'  -> {out}', flush=True)
    return info


def main():
    ap = argparse.ArgumentParser(description='Render a motion project or contract page to video.')
    ap.add_argument('source', help='projects/<name>.json or an .html page exposing window.motion')
    ap.add_argument('--format', choices=['webm', 'mov', 'gif', 'png'], default='webm')
    ap.add_argument('--no-crop', action='store_true', help='GIF: keep the full frame instead of cropping to the content')
    ap.add_argument('--fps', type=float)
    ap.add_argument('--out', help='output file (or folder, for png)')
    ap.add_argument('--set', action='append', default=[], metavar='NAME=VALUE', help='override a {{var}}')
    ap.add_argument('--query', default='', help='extra query string for an .html page, e.g. style=sigil')
    ap.add_argument('--batch', help='CSV of vars, one clip per row')
    ap.add_argument('--max-seconds', type=float, help='refuse documents longer than this')
    ap.add_argument('--max-size', metavar='WxH', help='refuse documents bigger than this, e.g. 3840x2160')
    args = ap.parse_args()
    max_size = None
    if args.max_size:
        try:
            max_size = tuple(int(n) for n in args.max_size.lower().split('x'))
            assert len(max_size) == 2
        except (ValueError, AssertionError):
            sys.exit('--max-size looks like 1920x1080')

    source = Path(args.source)
    ext = '' if args.format == 'png' else '.' + args.format
    name = source.stem + ''.join('-' + v for _, v in (kv.split('=', 1) for kv in args.query.split('&') if '=' in kv))

    variables = {}
    for kv in args.set:
        if '=' not in kv:
            sys.exit(f'--set needs NAME=VALUE, got {kv!r}')
        k, v = kv.split('=', 1)
        variables[k] = v

    jobs = []
    if args.batch:
        with open(args.batch, newline='', encoding='utf-8-sig') as f:
            for i, row in enumerate(csv.DictReader(f), 1):
                row_out = row.pop('out', None) or f'{name}-{i:02d}'
                jobs.append((OUT / (row_out + ext), {**variables, **row}))
    else:
        jobs.append((Path(args.out) if args.out else OUT / (name + ext), variables))

    with browser() as page:
        for out, v in jobs:
            try:
                render(page, source, out, fps=args.fps, query=args.query, variables=v, crop=not args.no_crop,
                       max_seconds=args.max_seconds, max_size=max_size)
            except TooBig as err:
                sys.exit(f'Not rendered: {err}')


if __name__ == '__main__':
    main()
