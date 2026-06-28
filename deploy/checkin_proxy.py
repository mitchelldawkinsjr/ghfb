#!/usr/bin/env python3
"""Sidecar API: coach check-in, attendance DB, and Google redirect proxy."""

from __future__ import annotations

import json
import os
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER_DIR = ROOT / "server"
if not SERVER_DIR.is_dir():
    SERVER_DIR = ROOT.parent / "server"
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from attendance_db import AttendanceDB, DEFAULT_SEASON  # noqa: E402
from csv_import import bootstrap_from_csv  # noqa: E402
from sheet_sync import sync_pending_marks  # noqa: E402

TARGET = os.environ.get(
    "CHECKIN_SCRIPT_URL",
    "https://script.google.com/macros/s/AKfycby7ykwXCKjdIHrPDHFLKRvfoMgaSDhqh_eZ_w7mYrZ8CmiQI7sDkCR-V4nKUqpqfkAE2w/exec",
).rstrip("/")
SCHEDULE_DOC_ID = os.environ.get(
    "SCHEDULE_DOC_ID", "1W-uFWhJuSTu5JiscKi3rqzrSpbVgvVlh"
)
PORT = int(os.environ.get("CHECKIN_PROXY_PORT", "8081"))
DB_PATH = os.environ.get("ATTENDANCE_DB_PATH", "/data/attendance.db")
DB_ENABLED = os.environ.get("ATTENDANCE_DB_ENABLED", "1") != "0"
COACH_PIN = os.environ.get("COACH_PIN", "").strip()
SEASON_NAME = os.environ.get("ATTENDANCE_SEASON_NAME", DEFAULT_SEASON)

_db: AttendanceDB | None = None
_db_lock = threading.Lock()


def get_db() -> AttendanceDB:
    global _db
    if _db is None:
        with _db_lock:
            if _db is None:
                _db = AttendanceDB(DB_PATH)
                if DB_ENABLED and _db.player_count() == 0:
                    bootstrap_from_csv(_db, season_name=SEASON_NAME)
    return _db


def verify_pin(pin: str | None) -> None:
    if not COACH_PIN:
        return
    given = (pin or "").strip()
    if given != COACH_PIN:
        raise ValueError("Incorrect coach PIN.")


def queue_sheet_sync(pin: str = "") -> None:
    if not DB_ENABLED:
        return

    def _run() -> None:
        try:
            sync_pending_marks(get_db(), pin=pin)
        except Exception:
            pass

    threading.Thread(target=_run, daemon=True).start()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _json_response(self, payload, status=200, cache_control="no-store"):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", cache_control)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def _query_params(self) -> dict[str, str]:
        query = ""
        if "?" in self.path:
            query = self.path.split("?", 1)[1]
        return {k: v[0] for k, v in urllib.parse.parse_qs(query).items()}

    def _schedule_doc_status(self):
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

    def _attendance_grid(self):
        if not DB_ENABLED:
            self._json_response(
                {"ok": False, "error": "Attendance DB disabled"},
                status=503,
            )
            return
        rows = get_db().export_grid_rows(season_name=SEASON_NAME)
        self._json_response(
            {
                "ok": True,
                "source": "db",
                "rows": rows,
                "updatedAt": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            },
            cache_control="public, max-age=15",
        )

    def _attendance_import(self, body: dict):
        if not DB_ENABLED:
            self._json_response({"ok": False, "error": "Attendance DB disabled"}, status=503)
            return
        try:
            verify_pin(body.get("pin"))
        except ValueError as err:
            self._json_response({"ok": False, "error": str(err)}, status=403)
            return
        csv_text = body.get("csv")
        stats = bootstrap_from_csv(
            get_db(),
            csv_text=csv_text,
            season_name=SEASON_NAME,
        )
        self._json_response({"ok": True, **stats})

    def _attendance_sync(self, params: dict):
        if not DB_ENABLED:
            self._json_response({"ok": False, "error": "Attendance DB disabled"}, status=503)
            return
        try:
            verify_pin(params.get("pin"))
        except ValueError as err:
            self._json_response({"ok": False, "error": str(err)}, status=403)
            return
        result = sync_pending_marks(get_db(), pin=params.get("pin", ""))
        self._json_response(result)

    def _db_checkin_action(self, action: str, params: dict):
        if not DB_ENABLED:
            return None
        db = get_db()
        try:
            if action == "getCheckInData":
                return db.get_check_in_data(
                    params.get("sessionType", "weightroom"),
                    season_name=SEASON_NAME,
                )
            if action == "toggleCheckIn":
                verify_pin(params.get("pin"))
                result = db.set_check_in(
                    int(params.get("sheetRow", "0")),
                    params.get("sessionType", "weightroom"),
                    checked=None,
                    season_name=SEASON_NAME,
                )
                queue_sheet_sync(params.get("pin", ""))
                return result
            if action == "setCheckInMark":
                verify_pin(params.get("pin"))
                checked = params.get("checked", "0") in {"1", "true", "True", True}
                return db.set_check_in(
                    int(params.get("sheetRow", "0")),
                    params.get("sessionType", "weightroom"),
                    checked=checked,
                    season_name=SEASON_NAME,
                )
        except ValueError as err:
            return {"ok": False, "error": str(err)}
        return None

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
        path = self.path.split("?", 1)[0]
        if path in {"/health", "/health/"}:
            payload = {"ok": True}
            if DB_ENABLED:
                payload["attendanceDb"] = {
                    "enabled": True,
                    "path": DB_PATH,
                    "players": get_db().player_count(),
                }
            self._json_response(payload)
            return
        if path in {"/schedule-doc-status", "/schedule-doc-status/"}:
            self._schedule_doc_status()
            return
        if path in {"/attendance.json", "/attendance.json/"}:
            self._attendance_grid()
            return

        params = self._query_params()
        action = params.get("action", "")
        db_result = self._db_checkin_action(action, params)
        if db_result is not None:
            self._json_response(db_result)
            return

        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        status, data, ctype = self._forward("GET", query)
        self.send_response(status if status == 200 else 200)
        self.send_header("Content-Type", ctype or "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        body = self._read_json_body()

        if path in {"/attendance/import", "/attendance/import/"}:
            self._attendance_import(body)
            return
        if path in {"/attendance/sync", "/attendance/sync/"}:
            self._attendance_sync(body)
            return

        action = body.get("action", "")
        db_result = self._db_checkin_action(action, body)
        if db_result is not None:
            if action == "toggleCheckIn":
                queue_sheet_sync(body.get("pin", ""))
            self._json_response(db_result)
            return

        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        payload = json.dumps(body).encode("utf-8")
        status, data, ctype = self._forward("POST", query, payload)
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
    print(
        "checkin proxy ->",
        TARGET,
        "port",
        PORT,
        "db=" + ("on" if DB_ENABLED else "off"),
        DB_PATH,
    )
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
