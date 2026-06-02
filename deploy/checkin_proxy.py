#!/usr/bin/env python3
"""Local proxy: follows Google Apps Script redirects (avoids browser JSONP to googleusercontent)."""
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TARGET = os.environ.get(
    "CHECKIN_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycby7ykwXCKjdIHrPDHFLKRvfoMgaSDhqh_eZ_w7mYrZ8CmiQI7sDkCR-V4nKUqpqfkAE2w/exec",
).rstrip("/")
PORT = int(os.environ.get("CHECKIN_PROXY_PORT", "8081"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _forward(self, method, query, body=None):
        url = TARGET
        if query:
            url = url + ("&" if "?" in url else "?") + query.lstrip("?")
        req = urllib.request.Request(
            url,
            data=body,
            method=method,
            headers={"Content-Type": "application/json"} if body else {},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.status, resp.read(), resp.headers.get_content_type()
        except urllib.error.HTTPError as e:
            return e.code, e.read(), "application/json"

    def do_GET(self):
        if self.path == "/health" or self.path.startswith("/health?"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return
        query = ""
        if "?" in self.path:
            query = self.path.split("?", 1)[1]
        status, data, ctype = self._forward("GET", query)
        self.send_response(status if status == 200 else 200)
        self.send_header("Content-Type", ctype or "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else None
        query = ""
        if "?" in self.path:
            query = self.path.split("?", 1)[1]
        status, data, ctype = self._forward("POST", query, body)
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


if __name__ == "__main__":
    print("checkin proxy ->", TARGET, "port", PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
