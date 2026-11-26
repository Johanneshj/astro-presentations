"""
Serve the presentation locally and open it in the browser.

    python3 tools/serve.py            # http://localhost:8000
    python3 tools/serve.py 8080       # another port
    python3 tools/serve.py --no-open  # don't open a browser window

Why a server: browsers refuse to load JavaScript modules and data files from file:// pages.
This one also tells the browser not to cache anything, so a reload always shows your latest edits.
"""
import functools
import http.server
import os
import sys
import webbrowser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):            # only log problems
        if len(args) > 1 and str(args[1]).startswith(('4', '5')):
            super().log_message(fmt, *args)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = int(args[0]) if args else 8000
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(('localhost', port), handler) as server:
        url = f'http://localhost:{port}/index.html'
        print(f'Serving {ROOT}\n  -> {url}\n(Ctrl+C to stop)')
        if '--no-open' not in sys.argv:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nstopped')


if __name__ == '__main__':
    main()
