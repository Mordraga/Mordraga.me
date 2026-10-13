"""Server for the motion editor: serves this folder, saves projects, runs renders.

    python the-fucking-toolshed/motion/serve.py                 -> opens http://localhost:8790/editor.html
    python the-fucking-toolshed/motion/serve.py --no-browser
    python the-fucking-toolshed/motion/serve.py --public        let other machines use the editor:
                                                                 read-only, no rendering, out/ not served
    --host ADDR --port N    where to listen (default 127.0.0.1:8790; --public defaults to 0.0.0.0)
    --read-only             no saving          --no-render     no rendering

Saving and rendering stay local on purpose: a render runs a real browser on this PC against whatever
HTML the project holds. render.py fences that in (own folder + Google Fonts only, length/size limits),
but it's still not something to hand to strangers. For a public site, any static host serving this
folder works too — the editor falls back to downloads and in-browser autosave.

API (paths work under a subfolder too, e.g. /motion/api/...):
    GET  api/config                   what this server allows
    GET  api/projects                 names in projects/
    PUT  api/projects/<name>          save projects/<name>.json (also refreshes projects/index.json)
    POST api/render/<name>?format=    render projects/<name>.json -> out/<name>.<format>
"""
import argparse
import json
import re
import subprocess
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
PROJECTS = HERE / 'projects'
OUT = HERE / 'out'
PORT = 8790  # the crypt server has 8765
NAME = re.compile(r'^[\w-]{1,64}$')
FORMATS = ('webm', 'mov', 'gif', 'png')
MAX_BODY = 20 * 1024 * 1024      # a project with a few embedded images fits easily
RENDER_LIMITS = ['--max-seconds', '120', '--max-size', '3840x2160']
RENDER_TIMEOUT = 15 * 60         # seconds
render_lock = threading.Lock()
settings = {'save': True, 'render': True, 'public': False}


def write_index():
    """projects/index.json lists the projects, so a static host (no api/) can still offer them."""
    names = sorted(p.stem for p in PROJECTS.glob('*.json') if p.name != 'index.json')
    (PROJECTS / 'index.json').write_text(json.dumps(names, indent=2) + '\n', encoding='utf-8')
    return names


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(HERE), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def api(self):
        """('projects/foo', query) for .../api/projects/foo, else (None, None)."""
        url = urlparse(self.path)
        head, sep, rest = url.path.partition('/api/')
        return (rest, parse_qs(url.query)) if sep else (None, None)

    def do_GET(self):
        route, _ = self.api()
        if route == 'config':
            return self.reply(200, {'save': settings['save'], 'render': settings['render'],
                                    'formats': list(FORMATS) if settings['render'] else []})
        if route == 'projects':
            return self.reply(200, sorted(p.stem for p in PROJECTS.glob('*.json') if p.name != 'index.json'))
        if route is not None:
            return self.reply(404, {'error': 'no such api'})
        path = urlparse(self.path).path
        if settings['public'] and (path.startswith('/out/') or path.endswith('.py') or '/.' in path):
            return self.reply(404, {'error': 'not here'})
        super().do_GET()

    def do_PUT(self):
        route, _ = self.api()
        if not (route or '').startswith('projects/'):
            return self.reply(404, {'error': 'no such api'})
        if not settings['save']:
            return self.reply(403, {'error': 'saving is off on this server — use Download'})
        name = route[len('projects/'):]
        if not NAME.match(name) or name == 'index':
            return self.reply(400, {'error': 'project names are letters, numbers, - and _'})
        try:
            size = int(self.headers.get('Content-Length', 0))
        except ValueError:
            size = -1
        if not 0 < size <= MAX_BODY:
            return self.reply(413, {'error': f'projects are limited to {MAX_BODY // (1024 * 1024)} MB'})
        try:
            project = json.loads(self.rfile.read(size))
            assert isinstance(project, dict)
        except (ValueError, AssertionError):
            return self.reply(400, {'error': 'not a project'})
        PROJECTS.mkdir(exist_ok=True)
        tmp = PROJECTS / f'{name}.json.tmp'
        tmp.write_text(json.dumps(project, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
        tmp.replace(PROJECTS / f'{name}.json')
        write_index()
        self.reply(200, {'saved': f'projects/{name}.json'})

    def do_POST(self):
        route, query = self.api()
        if not (route or '').startswith('render/'):
            return self.reply(404, {'error': 'no such api'})
        if not settings['render']:
            return self.reply(403, {'error': 'rendering is off on this server'})
        name = route[len('render/'):]
        fmt = query.get('format', ['webm'])[0]
        if not NAME.match(name) or not (PROJECTS / f'{name}.json').exists():
            return self.reply(404, {'error': 'save the project first'})
        if fmt not in FORMATS:
            return self.reply(400, {'error': 'format is ' + ', '.join(FORMATS)})
        if not render_lock.acquire(blocking=False):
            return self.reply(409, {'error': 'already rendering'})
        try:
            run = subprocess.run(
                [sys.executable, str(HERE / 'render.py'), str(PROJECTS / f'{name}.json'), '--format', fmt,
                 *RENDER_LIMITS],
                capture_output=True, text=True, timeout=RENDER_TIMEOUT)
        except subprocess.TimeoutExpired:
            return self.reply(500, {'error': f'render took over {RENDER_TIMEOUT // 60} minutes and was stopped'})
        finally:
            render_lock.release()
        if run.returncode:
            return self.reply(500, {'error': (run.stderr or run.stdout).strip()[-2000:]})
        out = OUT / (name + ('' if fmt == 'png' else '.' + fmt))
        self.reply(200, {'out': str(out)})


def main():
    ap = argparse.ArgumentParser(description='Serve the motion editor.')
    ap.add_argument('--public', action='store_true', help='listen on the network; read-only, no rendering')
    ap.add_argument('--host', help='address to listen on (default 127.0.0.1, or 0.0.0.0 with --public)')
    ap.add_argument('--port', type=int, default=PORT)
    ap.add_argument('--read-only', action='store_true', help='no saving')
    ap.add_argument('--no-render', action='store_true', help='no rendering')
    ap.add_argument('--no-browser', action='store_true', help="don't open the editor")
    args = ap.parse_args()

    settings['public'] = args.public
    settings['save'] = not (args.read_only or args.public)
    settings['render'] = not (args.no_render or args.public)
    host = args.host or ('0.0.0.0' if args.public else '127.0.0.1')
    if host not in ('127.0.0.1', 'localhost', '::1') and (settings['save'] or settings['render']):
        print('WARNING: saving/rendering are on and other machines can reach this server.\n'
              '         Anyone who can open it can write projects and run renders on this PC.')

    PROJECTS.mkdir(exist_ok=True)
    write_index()
    server = ThreadingHTTPServer((host, args.port), Handler)
    url = f'http://localhost:{args.port}/editor.html'
    on = [k for k in ('save', 'render') if settings[k]]
    print(f'Motion editor at {url}  ({", ".join(on) or "read-only"}; Ctrl+C to stop)')
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
