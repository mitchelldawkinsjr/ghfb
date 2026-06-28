#!/usr/bin/env python3
"""Local static preview with CSV API proxies and attendance DB (no Docker required)."""

from __future__ import annotations

import http.server
import json
import os
import socketserver
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = ROOT / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from attendance_db import AttendanceDB, DEFAULT_SEASON  # noqa: E402
from csv_import import bootstrap_from_csv  # noqa: E402

PORT = int(os.environ.get("GHFB_PREVIEW_PORT", "8765"))
CHECKIN_TARGET = os.environ.get(
    "CHECKIN_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycby7ykwXCKjdIHrPDHFLKRvfoMgaSDhqh_eZ_w7mYrZ8CmiQI7sDkCR-V4nKUqpqfkAE2w/exec",
).rstrip("/")
DB_PATH = os.environ.get("ATTENDANCE_DB_PATH", str(ROOT / ".local" / "attendance.db"))
DB_ENABLED = os.environ.get("ATTENDANCE_DB_ENABLED", "1") != "0"
COACH_PIN = os.environ.get("COACH_PIN", "").strip()
SEASON_NAME = os.environ.get("ATTENDANCE_SEASON_NAME", DEFAULT_SEASON)

_db: AttendanceDB | None = None


def get_db() -> AttendanceDB:
    global _db
    if _db is None:
        _db = AttendanceDB(DB_PATH)
        if DB_ENABLED and _db.player_count() == 0:
            bootstrap_from_csv(_db, season_name=SEASON_NAME)
    return _db


def verify_pin(pin: str | None) -> None:
    if not COACH_PIN:
        return
    if (pin or "").strip() != COACH_PIN:
        raise ValueError("Incorrect coach PIN.")


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
            self.handle_checkin()
            return
        if path == "/api/attendance.json":
            self.handle_attendance_json()
            return
        upstream = PROXIES.get(path)
        if upstream:
            self.proxy_csv(upstream)
            return
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/attendance/import":
            self.handle_attendance_import()
            return
        return super().do_POST()

    def handle_attendance_json(self) -> None:
        if not DB_ENABLED:
            self.send_json({"ok": False, "error": "Attendance DB disabled"}, 503)
            return
        rows = get_db().export_grid_rows(season_name=SEASON_NAME)
        self.send_json({"ok": True, "source": "db", "rows": rows})

    def handle_attendance_import(self) -> None:
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode("utf-8") if length else "{}")
        try:
            verify_pin(body.get("pin"))
            stats = bootstrap_from_csv(get_db(), season_name=SEASON_NAME)
            self.send_json({"ok": True, **stats})
        except ValueError as err:
            self.send_json({"ok": False, "error": str(err)}, 403)

    def handle_checkin(self) -> None:
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        params = {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}
        action = params.get("action", "")

        if DB_ENABLED and action in {"getCheckInData", "toggleCheckIn", "setCheckInMark"}:
            db = get_db()
            try:
                if action == "getCheckInData":
                    payload = db.get_check_in_data(
                        params.get("sessionType", "weightroom"),
                        season_name=SEASON_NAME,
                    )
                else:
                    verify_pin(params.get("pin"))
                    checked = None if action == "toggleCheckIn" else params.get("checked", "0") in {"1", "true", "True"}
                    payload = db.set_check_in(
                        int(params.get("sheetRow", "0")),
                        params.get("sessionType", "weightroom"),
                        checked=checked,
                        season_name=SEASON_NAME,
                    )
                self.send_json(payload)
                return
            except ValueError as err:
                self.send_json({"ok": False, "error": str(err)})
                return

        self.proxy_checkin()

    def send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

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
