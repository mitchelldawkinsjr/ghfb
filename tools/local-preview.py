#!/usr/bin/env python3
"""Local static preview with CSV API proxies (no Docker required)."""

from __future__ import annotations

import http.server
import json
import os
import socketserver
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("GHFB_PREVIEW_PORT", "8765"))
CHECKIN_TARGET = os.environ.get(
    "CHECKIN_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycby7ykwXCKjdIHrPDHFLKRvfoMgaSDhqh_eZ_w7mYrZ8CmiQI7sDkCR-V4nKUqpqfkAE2w/exec",
).rstrip("/")

PROXIES = {
    "/api/practice-schedule.csv": (
        "https://docs.google.com/spreadsheets/d/e/2PACX-1vRySfoBRMxX7GG1W32Kjccmv83429tkhEPbdHdf09xaAjNBu0Ztqh11FF6MUbGkD2DppxK_PYTMzSkT/pub?gid=224955206&single=true&output=csv"
    ),
    "/api/attendance.csv": (
        "https://docs.google.com/spreadsheets/d/e/2PACX-1vT-oEpo0pvk7YAWpv2jAhyqmWeIYVEZRRXliKY6uY-_NGZwE3rl28BG2HSSLtamqfeTLvR5AT8ywh28/pub?gid=585894674&single=true&output=csv"
    ),
    "/api/lift-plan.csv": (
        "https://docs.google.com/spreadsheets/d/e/2PACX-1vT-oEpo0pvk7YAWpv2jAhyqmWeIYVEZRRXliKY6uY-_NGZwE3rl28BG2HSSLtamqfeTLvR5AT8ywh28/pub?gid=1599839883&single=true&output=csv"
    ),
}


class PreviewHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/checkin":
            self.proxy_checkin()
            return
        upstream = PROXIES.get(path)
        if upstream:
            self.proxy_csv(upstream)
            return
        return super().do_GET()

    def proxy_checkin(self) -> None:
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        url = CHECKIN_TARGET
        if query:
            url = f"{url}&{query}" if "?" in url else f"{url}?{query}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ghfb-local-preview/1.0"})
            with urllib.request.urlopen(req, timeout=45) as response:
                data = response.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except urllib.error.HTTPError as err:
            body = err.read()
            self.send_response(err.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body or json.dumps({"ok": False, "error": str(err)}).encode("utf-8"))
        except Exception as err:
            body = json.dumps({"ok": False, "error": str(err)}).encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

    def proxy_csv(self, url: str) -> None:
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
        except Exception as err:
            body = f"Proxy error: {err}".encode("utf-8")
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:
        print(f"[preview] {self.address_string()} {format % args}")


def main() -> None:
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), PreviewHandler) as httpd:
        print(f"GHFB local preview: http://localhost:{PORT}/")
        print(f"Practice timeline:  http://localhost:{PORT}/practice-schedule.html")
        print(f"Hub:                http://localhost:{PORT}/")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
