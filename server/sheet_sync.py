"""Best-effort copy of attendance marks from SQLite to the school Google Sheet."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from attendance_db import AttendanceDB


def sync_pending_marks(db: AttendanceDB, pin: str = "") -> dict[str, Any]:
    target = os.environ.get("CHECKIN_SCRIPT_URL", "").rstrip("/")
    if not target:
        return {"ok": False, "error": "CHECKIN_SCRIPT_URL not configured", "synced": 0}

    jobs = db.pending_sync_jobs()
    synced = 0
    errors: list[str] = []

    for job in jobs:
        params = urllib.parse.urlencode(
            {
                "action": "setCheckInMark",
                "sheetRow": str(job["sheet_row"]),
                "sessionType": job["session_type"],
                "checked": "1" if job["present"] else "0",
                "pin": pin,
            }
        )
        url = f"{target}?{params}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ghfb-sheet-sync/1.0"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            if not payload.get("ok"):
                raise RuntimeError(payload.get("error") or "Sheet sync failed")
            db.mark_synced(int(job["id"]))
            synced += 1
        except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError, RuntimeError) as err:
            message = str(err)
            db.mark_synced(int(job["id"]), error=message)
            errors.append(message)

    return {"ok": True, "synced": synced, "attempted": len(jobs), "errors": errors[:5]}
