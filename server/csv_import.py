"""CSV parsing and import helpers for attendance bootstrap."""

from __future__ import annotations

import csv
import io
import os
import urllib.request
from typing import Any

from attendance_db import AttendanceDB, DEFAULT_SEASON


DEFAULT_ATTENDANCE_CSV_URL = os.environ.get(
    "ATTENDANCE_CSV_URL",
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vT-oEpo0pvk7YAWpv2jAhyqmWeIYVEZRRXliKY6uY-_NGZwE3rl28BG2HSSLtamqfeTLvR5AT8ywh28/pub?gid=585894674&single=true&output=csv",
)


def parse_csv_text(text: str) -> list[list[str]]:
    reader = csv.reader(io.StringIO(text))
    return [list(row) for row in reader]


def fetch_attendance_csv(url: str = DEFAULT_ATTENDANCE_CSV_URL) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "ghfb-attendance-import/1.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read().decode("utf-8")


def bootstrap_from_csv(
    db: AttendanceDB,
    csv_text: str | None = None,
    season_name: str = DEFAULT_SEASON,
) -> dict[str, Any]:
    text = csv_text if csv_text is not None else fetch_attendance_csv()
    rows = parse_csv_text(text)
    stats = db.import_csv_rows(rows, season_name=season_name)
    stats["source"] = "csv-import"
    return stats
