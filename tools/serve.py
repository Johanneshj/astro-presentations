"""
Serve the presentation locally and open it in the browser.

    python3 tools/serve.py            # http://localhost:8000
    python3 tools/serve.py 8080       # another port
    python3 tools/serve.py --no-open  # don't open a browser window

Why a server: browsers refuse to load JavaScript modules and data files from file:// pages.
This one also tells the browser not to cache anything, so a reload always shows your latest edits,
and it answers "Range" requests (parts of a file), which browsers need to jump to a point in a sound.
"""
import functools
import http.server
import os
import re
import sys
import webbrowser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    # Range requests: "bytes=start-end" -> 206 with just that part of the file
    def send_head(self):
        self._left = None
        m = re.fullmatch(r'bytes=(\d*)-(\d*)', (self.headers.get('Range') or '').strip())
        path = self.translate_path(self.path)
        if not m or not os.path.isfile(path):
            return super().send_head()
        try:
            f = open(path, 'rb')
        except OSError:
            self.send_error(404)
            return None
        size = os.fstat(f.fileno()).st_size
        a, b = m.groups()
        if a == '':                                   # "bytes=-500": the last 500 bytes
            start, end = max(0, size - int(b or 0)), size - 1
        else:
            start, end = int(a), min(int(b) if b else size - 1, size - 1)
        if start > end:
            f.close()
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.end_headers()
            return None
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        f.seek(start)
        self._left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        if self._left is None:
            return super().copyfile(source, outputfile)
        while self._left > 0:
            chunk = source.read(min(64 * 1024, self._left))
            if not chunk:
                break
            outputfile.write(chunk)
            self._left -= len(chunk)

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
