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


if __name__ == "__main__":
    unittest.main()
