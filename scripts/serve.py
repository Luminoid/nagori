#!/usr/bin/env python3
"""Serve the site for development the way the static hosts do: `/song` and `/songs/<id>`
find song.html and songs/<id>.html (Cloudflare Pages and GitHub Pages serve pages that way,
which is what `cleanUrls` in data/site.json is for), an unknown path gets 404.html, and
nothing is cached, so every reload shows the current files.

    python3 scripts/serve.py [port]        (make serve; port 8123 by default)
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        full = super().translate_path(path)
        if not Path(full).exists() and not Path(full).suffix and Path(f"{full}.html").is_file():
            return f"{full}.html"
        return full

    def send_error(self, code, message=None, explain=None):
        page = ROOT / "404.html"
        if code == 404 and page.is_file():
            body = page.read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(Handler, directory=str(ROOT)))
    print(f"Serving {ROOT} at http://127.0.0.1:{port}/ (Ctrl-C stops)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
