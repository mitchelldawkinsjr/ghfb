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
SCHEDULE_DOC_ID = os.environ.get(
    "SCHEDULE_DOC_ID", "1W-uFWhJuSTu5JiscKi3rqzrSpbVgvVlh"
)
PORT = int(os.environ.get("CHECKIN_PROXY_PORT", "8081"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json_response(self, payload, cache_control="no-store"):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", cache_control)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _schedule_doc_status(self):
        """True when the Google Doc is publicly readable (not a login wall)."""
        url = (
            f"https://docs.google.com/document/d/{SCHEDULE_DOC_ID}/export?format=txt"
        )
        embeddable = False
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "ghfb-schedule-check/1.0"}
            )
            with urllib.request.urlopen(req, timeout=12) as resp:
                chunk = resp.read(6000).decode("utf-8", errors="ignore")
                lowered = chunk.lower()
                blocked = (
                    chunk.lstrip().startswith("<")
                    or "accounts.google.com" in lowered
                    or "service login" in lowered
                    or ("sign in" in lowered and "google" in lowered)
                )
                embeddable = resp.status == 200 and not blocked and len(chunk.strip()) > 40
        except (urllib.error.URLError, TimeoutError, OSError):
            embeddable = False
        self._json_response({"embeddable": embeddable}, cache_control="public, max-age=300")

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
            self._json_response({"ok": True})
            return
        if self.path == "/schedule-doc-status" or self.path.startswith(
            "/schedule-doc-status?"
        ):
            self._schedule_doc_status()
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
