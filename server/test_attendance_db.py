#!/usr/bin/env python3
"""Unit tests for SQLite attendance store."""

from __future__ import annotations

import tempfile
import unittest
from datetime import date
from pathlib import Path

from attendance_db import AttendanceDB, get_column_kind, parse_header_date


SAMPLE_ROWS = [
    ["First name", "Last name", "6/1", "C", "P 6/2", "Current Total", "Ironman %", "# of sessions this summer", "% required for ironman"],
    ["Alex", "Smith", "X", "", "X", "", "", "3", "83.33%"],
    ["Jordan", "Lee", "", "X", "", "", "", "3", "83.33%"],
]


class AttendanceDbTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db = AttendanceDB(Path(self.tmp.name) / "test.db")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_import_and_export_round_trip(self) -> None:
        stats = self.db.import_csv_rows(SAMPLE_ROWS)
        self.assertEqual(stats["players"], 2)
        self.assertEqual(stats["sessions"], 3)
        self.assertEqual(stats["marks"], 3)

        grid = self.db.export_grid_rows()
        self.assertEqual(grid[0][0], "First name")
        self.assertEqual(grid[1][0], "Alex")
        self.assertEqual(grid[1][2], "X")
        self.assertEqual(grid[2][3], "X")

    def test_toggle_check_in(self) -> None:
        self.db.import_csv_rows(SAMPLE_ROWS)
        wr_col = self.db._ensure_today_session("weightroom", self.db.ensure_season())
        self.assertTrue(wr_col["header_label"])

        data = self.db.get_check_in_data("weightroom")
        self.assertTrue(data["ok"])
        self.assertEqual(data["total"], 2)

        result = self.db.set_check_in(2, "weightroom", checked=True)
        self.assertTrue(result["checked"])
        data = self.db.get_check_in_data("weightroom")
        alex = next(p for p in data["players"] if p["sheetRow"] == 2)
        self.assertTrue(alex["checked"])

    def test_header_parsing(self) -> None:
        self.assertEqual(get_column_kind("6/9"), "weightroom")
        self.assertEqual(get_column_kind("C"), "conditioning")
        self.assertEqual(get_column_kind("P 6/9"), "practice")
        parsed = parse_header_date("6/9/2026")
        self.assertEqual(parsed, date(2026, 6, 9))

    def test_export_compacts_sparse_column_indexes(self) -> None:
        season_id = self.db.ensure_season()
        with self.db.connect() as conn:
            cur = conn.execute(
                "INSERT INTO players (season_id, first_name, last_name, sheet_row) VALUES (?, ?, ?, ?)",
                (season_id, "Alex", "Smith", 2),
            )
            player_id = int(cur.lastrowid)
            for col_index, label, session_type, session_date in [
                (4, "6/1", "weightroom", "2026-06-01"),
                (5, "C", "conditioning", "2026-06-01"),
            ]:
                conn.execute(
                    """
                    INSERT INTO session_columns
                        (season_id, col_index, header_label, session_type, session_date, sheet_col)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (season_id, col_index, label, session_type, session_date, col_index + 1),
                )
            session_id = int(conn.execute("SELECT id FROM session_columns LIMIT 1").fetchone()[0])
            conn.execute(
                "INSERT INTO attendance_marks (player_id, session_column_id, present) VALUES (?, ?, 1)",
                (player_id, session_id),
            )

        grid = self.db.export_grid_rows()
        self.assertEqual(grid[0][:4], ["First name", "Last name", "6/1", "C"])
        self.assertEqual(grid[1][2], "X")


if __name__ == "__main__":
    unittest.main()
