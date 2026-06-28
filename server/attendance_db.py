"""SQLite attendance store — source of truth for GHFB summer attendance."""

from __future__ import annotations

import re
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime
from pathlib import Path
from typing import Any, Iterator

ATTENDANCE_START_IDX = 2
SUMMARY_HEADERS = {
    "Current Total",
    "Ironman %",
    "# of sessions this summer",
    "% required for ironman",
}
DEFAULT_SEASON = "2026 Summer WR & Conditioning"
DEFAULT_IRONMAN_RATE = 35 / 42


def parse_header_date(value: Any) -> date | None:
    text = str(value or "").strip()
    match = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})$", text)
    if match:
        year = int(match.group(3))
        if year < 100:
            year += 2000
        try:
            return date(year, int(match.group(1)), int(match.group(2)))
        except ValueError:
            return None
    match = re.match(r"^(\d{1,2})/(\d{1,2})$", text)
    if match:
        year = date.today().year
        try:
            return date(year, int(match.group(1)), int(match.group(2)))
        except ValueError:
            return None
    match = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", text)
    if match:
        try:
            return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
        except ValueError:
            return None
    return None


def is_practice_header(header: Any) -> bool:
    text = str(header or "").strip()
    return bool(re.match(r"^P(\s+|\s*\d)", text, re.I))


def parse_practice_header_date(header: Any) -> date | None:
    text = str(header or "").strip()
    direct = re.match(r"^P\s*(\d{1,2}/\d{1,2}(?:/\d{2,4})?)\s*$", text, re.I)
    if direct:
        return parse_header_date(direct.group(1))
    embedded = re.search(r"(\d{1,2}/\d{1,2}(?:/\d{2,4})?)", text)
    if embedded:
        return parse_header_date(embedded.group(1))
    return None


def get_column_kind(header: Any) -> str:
    text = str(header or "").strip()
    if text.upper() == "C":
        return "conditioning"
    if is_practice_header(text):
        return "practice"
    if parse_header_date(text):
        return "weightroom"
    return "other"


def today_label() -> str:
    today = date.today()
    return f"{today.month}/{today.day}"


def session_not_scheduled_message(
    session_type: str, label: str | None = None, has_wr_col: bool = False
) -> str:
    session_type = (session_type or "weightroom").lower()
    label = label or today_label()
    add_day_hint = (
        f"If today should count toward attendance, add a new column in the spreadsheet "
        f"labeled {label} (weight room), with a C column immediately to its right (conditioning)."
    )
    if session_type == "conditioning" and has_wr_col:
        return (
            f"No scheduled conditioning session for today ({label}). "
            f"The weight room column for {label} is set up, but the conditioning column (C) is missing. "
            f"Add a C column in the spreadsheet immediately after {label}."
        )
    if session_type == "weightroom":
        return f"No scheduled weight room session for today ({label}). {add_day_hint}"
    if session_type == "practice":
        return (
            f"No practice column for today ({label}). "
            f"Add a column labeled P {label} on the attendance sheet. "
            f"Practice columns are tracked separately and do not affect ironmen."
        )
    return f"No scheduled weight room or conditioning for today ({label}). {add_day_hint}"


class AttendanceDB:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _init_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS seasons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL UNIQUE,
                    ironman_threshold_rate REAL NOT NULL DEFAULT 0.833333,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS players (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
                    first_name TEXT NOT NULL,
                    last_name TEXT NOT NULL,
                    sheet_row INTEGER NOT NULL,
                    active INTEGER NOT NULL DEFAULT 1,
                    UNIQUE(season_id, sheet_row),
                    UNIQUE(season_id, first_name, last_name)
                );

                CREATE TABLE IF NOT EXISTS session_columns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
                    col_index INTEGER NOT NULL,
                    header_label TEXT NOT NULL,
                    session_type TEXT NOT NULL,
                    session_date TEXT NOT NULL,
                    sheet_col INTEGER NOT NULL,
                    UNIQUE(season_id, col_index)
                );

                CREATE TABLE IF NOT EXISTS attendance_marks (
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    session_column_id INTEGER NOT NULL REFERENCES session_columns(id) ON DELETE CASCADE,
                    present INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    PRIMARY KEY (player_id, session_column_id)
                );

                CREATE TABLE IF NOT EXISTS sheet_sync_outbox (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
                    session_column_id INTEGER NOT NULL REFERENCES session_columns(id) ON DELETE CASCADE,
                    present INTEGER NOT NULL,
                    synced_at TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE INDEX IF NOT EXISTS idx_players_season ON players(season_id, sheet_row);
                CREATE INDEX IF NOT EXISTS idx_sessions_season_date
                    ON session_columns(season_id, session_date, session_type);
                CREATE INDEX IF NOT EXISTS idx_outbox_pending
                    ON sheet_sync_outbox(synced_at) WHERE synced_at IS NULL;
                """
            )

    def ensure_season(self, name: str = DEFAULT_SEASON) -> int:
        with self.connect() as conn:
            row = conn.execute("SELECT id FROM seasons WHERE name = ?", (name,)).fetchone()
            if row:
                return int(row["id"])
            cur = conn.execute(
                "INSERT INTO seasons (name, ironman_threshold_rate) VALUES (?, ?)",
                (name, DEFAULT_IRONMAN_RATE),
            )
            return int(cur.lastrowid)

    def player_count(self, season_id: int | None = None) -> int:
        season_id = season_id or self.ensure_season()
        with self.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) AS n FROM players WHERE season_id = ? AND active = 1",
                (season_id,),
            ).fetchone()
            return int(row["n"])

    def import_csv_rows(
        self, rows: list[list[str]], season_name: str = DEFAULT_SEASON
    ) -> dict[str, int]:
        if len(rows) < 2:
            raise ValueError("CSV must include a header row and at least one player")

        header_row = rows[0]
        season_id = self.ensure_season(season_name)
        ironman_rate = self._ironman_rate_from_rows(header_row, rows[1:])
        session_specs = self._session_specs_from_header(header_row)

        with self.connect() as conn:
            conn.execute(
                "UPDATE seasons SET ironman_threshold_rate = ? WHERE id = ?",
                (ironman_rate, season_id),
            )
            conn.execute("DELETE FROM attendance_marks WHERE player_id IN (SELECT id FROM players WHERE season_id = ?)", (season_id,))
            conn.execute("DELETE FROM session_columns WHERE season_id = ?", (season_id,))
            conn.execute("DELETE FROM players WHERE season_id = ?", (season_id,))

            session_ids: dict[int, int] = {}
            for spec in session_specs:
                cur = conn.execute(
                    """
                    INSERT INTO session_columns
                        (season_id, col_index, header_label, session_type, session_date, sheet_col)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        season_id,
                        spec["col_index"],
                        spec["header_label"],
                        spec["session_type"],
                        spec["session_date"].isoformat(),
                        spec["sheet_col"],
                    ),
                )
                session_ids[spec["col_index"]] = int(cur.lastrowid)

            players_imported = 0
            marks_imported = 0
            data_rows = self._data_rows(rows)
            for offset, row in enumerate(data_rows):
                first = str(row[0] or "").strip()
                last = str(row[1] or "").strip()
                sheet_row = offset + 2
                cur = conn.execute(
                    """
                    INSERT INTO players (season_id, first_name, last_name, sheet_row)
                    VALUES (?, ?, ?, ?)
                    """,
                    (season_id, first, last, sheet_row),
                )
                player_id = int(cur.lastrowid)
                players_imported += 1
                for col_index, session_id in session_ids.items():
                    if col_index >= len(row):
                        continue
                    if str(row[col_index] or "").strip().upper() == "X":
                        conn.execute(
                            """
                            INSERT INTO attendance_marks (player_id, session_column_id, present)
                            VALUES (?, ?, 1)
                            """,
                            (player_id, session_id),
                        )
                        marks_imported += 1

        return {
            "players": players_imported,
            "sessions": len(session_specs),
            "marks": marks_imported,
            "season_id": season_id,
        }

    def export_grid_rows(self, season_name: str = DEFAULT_SEASON) -> list[list[str]]:
        season_id = self.ensure_season(season_name)
        with self.connect() as conn:
            season = conn.execute(
                "SELECT ironman_threshold_rate FROM seasons WHERE id = ?", (season_id,)
            ).fetchone()
            sessions = conn.execute(
                """
                SELECT id, col_index, header_label
                FROM session_columns
                WHERE season_id = ?
                ORDER BY col_index
                """,
                (season_id,),
            ).fetchall()
            players = conn.execute(
                """
                SELECT id, first_name, last_name, sheet_row
                FROM players
                WHERE season_id = ? AND active = 1
                ORDER BY sheet_row
                """,
                (season_id,),
            ).fetchall()
            marks = conn.execute(
                """
                SELECT m.player_id, m.session_column_id, m.present
                FROM attendance_marks m
                JOIN players p ON p.id = m.player_id
                WHERE p.season_id = ? AND m.present = 1
                """,
                (season_id,),
            ).fetchall()

        mark_map = {
            (int(row["player_id"]), int(row["session_column_id"])): True for row in marks
        }
        header = ["First name", "Last name"]
        max_col = max((int(s["col_index"]) for s in sessions), default=ATTENDANCE_START_IDX - 1)
        for col_index in range(ATTENDANCE_START_IDX, max_col + 1):
            label = next(
                (str(s["header_label"]) for s in sessions if int(s["col_index"]) == col_index),
                "",
            )
            header.append(label)

        pct = round(float(season["ironman_threshold_rate"]) * 100, 2)
        header.extend(
            [
                "Current Total",
                "Ironman %",
                "# of sessions this summer",
                "% required for ironman",
            ]
        )

        body: list[list[str]] = [header]
        for player in players:
            row = [str(player["first_name"]), str(player["last_name"])]
            for col_index in range(ATTENDANCE_START_IDX, max_col + 1):
                session = next(
                    (s for s in sessions if int(s["col_index"]) == col_index), None
                )
                if not session:
                    row.append("")
                    continue
                key = (int(player["id"]), int(session["id"]))
                row.append("X" if mark_map.get(key) else "")
            row.extend(["", "", str(len(sessions)), f"{pct:g}%"])
            body.append(row)
        return body

    def get_check_in_data(
        self, session_type: str, season_name: str = DEFAULT_SEASON
    ) -> dict[str, Any]:
        session_type = (session_type or "weightroom").lower()
        label = today_label()
        season_id = self.ensure_season(season_name)

        try:
            session = self._ensure_today_session(session_type, season_id)
        except ValueError as err:
            has_wr = self._has_today_session(season_id, "weightroom")
            return {
                "ok": False,
                "error": str(err)
                if str(err)
                else session_not_scheduled_message(
                    session_type, label, has_wr_col=has_wr
                ),
                "sessionType": session_type,
                "todayLabel": label,
            }

        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT p.sheet_row, p.first_name, p.last_name,
                       COALESCE(m.present, 0) AS present
                FROM players p
                LEFT JOIN attendance_marks m
                  ON m.player_id = p.id AND m.session_column_id = ?
                WHERE p.season_id = ? AND p.active = 1
                ORDER BY p.sheet_row
                """,
                (int(session["id"]), season_id),
            ).fetchall()

        players = [
            {
                "sheetRow": int(row["sheet_row"]),
                "name": f"{row['first_name']} {row['last_name']}".strip(),
                "checked": bool(row["present"]),
            }
            for row in rows
        ]
        checked_count = sum(1 for p in players if p["checked"])
        return {
            "ok": True,
            "sessionType": session_type,
            "todayLabel": label,
            "sessionCol": int(session["sheet_col"]),
            "players": players,
            "checkedCount": checked_count,
            "total": len(players),
            "source": "db",
        }

    def set_check_in(
        self,
        sheet_row: int,
        session_type: str,
        checked: bool | None = None,
        season_name: str = DEFAULT_SEASON,
    ) -> dict[str, Any]:
        session_type = (session_type or "weightroom").lower()
        season_id = self.ensure_season(season_name)

        try:
            session = self._ensure_today_session(session_type, season_id)
        except ValueError as err:
            raise ValueError(str(err)) from err

        with self.connect() as conn:
            player = conn.execute(
                """
                SELECT id FROM players
                WHERE season_id = ? AND sheet_row = ? AND active = 1
                """,
                (season_id, sheet_row),
            ).fetchone()
            if not player:
                raise ValueError("Invalid player row.")

            existing = conn.execute(
                """
                SELECT present FROM attendance_marks
                WHERE player_id = ? AND session_column_id = ?
                """,
                (int(player["id"]), int(session["id"])),
            ).fetchone()
            current = bool(existing["present"]) if existing else False
            next_checked = (not current) if checked is None else bool(checked)

            conn.execute(
                """
                INSERT INTO attendance_marks (player_id, session_column_id, present, updated_at)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(player_id, session_column_id) DO UPDATE SET
                    present = excluded.present,
                    updated_at = excluded.updated_at
                """,
                (int(player["id"]), int(session["id"]), 1 if next_checked else 0),
            )
            conn.execute(
                """
                INSERT INTO sheet_sync_outbox (player_id, session_column_id, present)
                VALUES (?, ?, ?)
                """,
                (int(player["id"]), int(session["id"]), 1 if next_checked else 0),
            )

        return {
            "ok": True,
            "sheetRow": sheet_row,
            "checked": next_checked,
            "source": "db",
        }

    def pending_sync_jobs(self, limit: int = 25) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT o.id, p.sheet_row, s.session_type, o.present
                FROM sheet_sync_outbox o
                JOIN players p ON p.id = o.player_id
                JOIN session_columns s ON s.id = o.session_column_id
                WHERE o.synced_at IS NULL
                ORDER BY o.id
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def mark_synced(self, outbox_id: int, error: str | None = None) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE sheet_sync_outbox
                SET synced_at = datetime('now'), error = ?
                WHERE id = ?
                """,
                (error, outbox_id),
            )

    def _has_today_session(self, season_id: int, session_type: str) -> bool:
        today = date.today().isoformat()
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT 1 FROM session_columns
                WHERE season_id = ? AND session_type = ? AND session_date = ?
                LIMIT 1
                """,
                (season_id, session_type, today),
            ).fetchone()
        return bool(row)

    def _ensure_today_session(self, session_type: str, season_id: int) -> dict[str, Any]:
        session_type = session_type.lower()
        today = date.today()
        today_iso = today.isoformat()
        label = today_label()

        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT id, header_label, sheet_col
                FROM session_columns
                WHERE season_id = ? AND session_type = ? AND session_date = ?
                """,
                (season_id, session_type, today_iso),
            ).fetchone()
            if row:
                return dict(row)

            if session_type == "conditioning":
                wr = conn.execute(
                    """
                    SELECT col_index FROM session_columns
                    WHERE season_id = ? AND session_type = 'weightroom' AND session_date = ?
                    """,
                    (season_id, today_iso),
                ).fetchone()
                if not wr:
                    raise ValueError(
                        session_not_scheduled_message("conditioning", label, has_wr_col=False)
                    )
                col_index = int(wr["col_index"]) + 1
                header_label = "C"
            elif session_type == "practice":
                col_index = self._next_col_index(conn, season_id)
                header_label = f"P {label}"
            elif session_type == "weightroom":
                col_index = self._next_col_index(conn, season_id)
                header_label = label
            else:
                raise ValueError(f"Unknown session type: {session_type}")

            cur = conn.execute(
                """
                INSERT INTO session_columns
                    (season_id, col_index, header_label, session_type, session_date, sheet_col)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    season_id,
                    col_index,
                    header_label,
                    session_type,
                    today_iso,
                    col_index + 1,
                ),
            )
            return {
                "id": int(cur.lastrowid),
                "header_label": header_label,
                "sheet_col": col_index + 1,
            }

    def _next_col_index(self, conn: sqlite3.Connection, season_id: int) -> int:
        row = conn.execute(
            "SELECT MAX(col_index) AS max_idx FROM session_columns WHERE season_id = ?",
            (season_id,),
        ).fetchone()
        max_idx = row["max_idx"]
        if max_idx is None:
            return ATTENDANCE_START_IDX
        return int(max_idx) + 1

    def _ironman_rate_from_rows(
        self, header_row: list[str], data_rows: list[list[str]]
    ) -> float:
        try:
            idx = header_row.index("% required for ironman")
        except ValueError:
            return DEFAULT_IRONMAN_RATE
        sample = data_rows[0] if data_rows else []
        if idx >= len(sample):
            return DEFAULT_IRONMAN_RATE
        raw = str(sample[idx] or "").strip().replace("%", "")
        try:
            return float(raw) / 100.0
        except ValueError:
            return DEFAULT_IRONMAN_RATE

    def _session_specs_from_header(self, header_row: list[str]) -> list[dict[str, Any]]:
        specs: list[dict[str, Any]] = []
        col = ATTENDANCE_START_IDX
        while col < len(header_row):
            header = str(header_row[col] or "").strip()
            if not header or header in SUMMARY_HEADERS:
                break
            kind = get_column_kind(header)
            session_date = None
            if kind == "weightroom":
                session_date = parse_header_date(header)
            elif kind == "conditioning":
                session_date = None
                for back in range(col - 1, ATTENDANCE_START_IDX - 1, -1):
                    prev_kind = get_column_kind(header_row[back])
                    if prev_kind == "weightroom":
                        session_date = parse_header_date(header_row[back])
                        break
            elif kind == "practice":
                session_date = parse_practice_header_date(header)
            if kind in {"weightroom", "conditioning", "practice"} and session_date:
                specs.append(
                    {
                        "col_index": col,
                        "header_label": header,
                        "session_type": kind,
                        "session_date": session_date,
                        "sheet_col": col + 1,
                    }
                )
            col += 1
        return specs

    def _data_rows(self, rows: list[list[str]]) -> list[list[str]]:
        body = rows[1:]
        end = len(body)
        while end > 0:
            row = body[end - 1]
            name = f"{str(row[0] or '').strip()} {str(row[1] or '').strip()}".strip()
            first_col = str(row[0] or "").strip()
            if name or first_col:
                break
            end -= 1
        filtered = []
        for row in body[:end]:
            name = f"{str(row[0] or '').strip()} {str(row[1] or '').strip()}".strip()
            if not name:
                continue
            if re.match(r"^first\s*name$", str(row[0] or "").strip(), re.I):
                continue
            filtered.append(row)
        return filtered
