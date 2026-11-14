import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tiktok import history_check as hc


def blob(days, extra=None):
    rows = [["t1", d, 1.0, 10, 1, 0, 0] for d in days] + (extra or [])
    return {"ads": {"t1": {}}, "rows": rows}


DAYS = [f"2026-10-{d:02d}" for d in range(1, 21)]


class Check(unittest.TestCase):
    def test_same_size_valid_file_is_fine_and_a_longer_one_too(self):
        self.assertEqual(hc.problems(blob(DAYS), blob(DAYS)), [])
        self.assertEqual(hc.problems(blob(DAYS), blob(DAYS + ["2026-10-21"])), [])

    def test_fewer_rows_are_allowed_when_coverage_is_kept_and_the_loss_is_small(self):
        stored = blob(DAYS * 5)
        merged = blob(DAYS * 5)
        merged["rows"] = merged["rows"][:-3]          # 3 of 100 rows (3%) dropped, e.g. excluded ads
        self.assertEqual(hc.problems(stored, merged), [])

    def test_big_loss_or_lost_days_are_refused(self):
        self.assertTrue(hc.problems(blob(DAYS), blob(DAYS[5:])))               # starts later
        self.assertTrue(hc.problems(blob(DAYS), blob(DAYS[:-5])))              # ends earlier
        stored = blob(DAYS * 5)
        merged = blob(DAYS * 5)
        merged["rows"] = merged["rows"][:60]
        self.assertTrue(hc.problems(stored, merged))                           # lost 40%

    def test_corrupt_files_are_refused_even_at_the_same_size(self):
        merged = blob(DAYS)
        merged["rows"][3] = ["t1", "not-a-day", 1, 1, 1, 0, 0]
        self.assertTrue(hc.problems(blob(DAYS), merged))
        self.assertTrue(hc.problems(blob(DAYS), {"rows": "x"}))

    def test_no_stored_file_means_any_valid_file_is_saved(self):
        self.assertEqual(hc.problems(None, blob(DAYS)), [])

    def test_cli_exit_codes(self):
        with tempfile.TemporaryDirectory() as d:
            a, b, c = (os.path.join(d, n) for n in ("a.json", "b.json", "c.json"))
            json.dump(blob(DAYS), open(a, "w")); json.dump(blob(DAYS), open(b, "w")); open(c, "w").write("{broken")
            self.assertEqual(hc.main(["x", a, b]), 0)
            self.assertEqual(hc.main(["x", a, c]), 1)
            self.assertEqual(hc.main(["x", os.path.join(d, "missing.json"), b]), 0)


if __name__ == "__main__":
    unittest.main()
