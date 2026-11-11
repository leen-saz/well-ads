"""Restore-test checks for the encrypted backup. No network, files in a temp folder."""
import json, os, sys, tempfile, unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "supabase"))
import backup_check

NOW = datetime(2026, 11, 12, tzinfo=timezone.utc)
TABLES = ["profiles", "companies", "ads", "ad_metrics", "audit_log"]


def make(counts=None, taken=NOW - timedelta(days=2), failed=(), drop=(), migrations=True, rows=None):
    d = tempfile.mkdtemp()
    counts = counts or {t: 2 for t in TABLES + ["auth_users"]}
    for t, n in counts.items():
        if t not in drop:
            json.dump(rows.get(t, [{}] * n) if rows else [{}] * n, open(os.path.join(d, f"{t}.json"), "w"))
    json.dump({"taken_at": taken.isoformat(), "tables": counts, "failed": list(failed)}, open(os.path.join(d, "manifest.json"), "w"))
    if migrations:
        os.makedirs(os.path.join(d, "migrations"))
    return d


class BackupCheck(unittest.TestCase):
    def test_a_good_backup_passes(self):
        self.assertEqual(backup_check.check(make(), NOW, TABLES), [])

    def test_too_old(self):
        self.assertTrue(any("older" in p for p in backup_check.check(make(taken=NOW - timedelta(days=12)), NOW, TABLES)))

    def test_missing_table_file_and_manifest_mismatch(self):
        self.assertTrue(any("audit_log" in p for p in backup_check.check(make(drop=("audit_log",)), NOW, TABLES)))
        self.assertTrue(any("ads" in p and "manifest" in p for p in backup_check.check(make(rows={"ads": [{}]}), NOW, TABLES)))

    def test_core_table_empty_and_failed_dump(self):
        c = {t: 2 for t in TABLES + ["auth_users"]}; c["ads"] = 0
        self.assertTrue(any("ads: empty" in p for p in backup_check.check(make(counts=c), NOW, TABLES)))
        self.assertTrue(any("failed" in p for p in backup_check.check(make(failed=("ads",)), NOW, TABLES)))

    def test_no_manifest_or_migrations(self):
        self.assertEqual(len(backup_check.check(tempfile.mkdtemp(), NOW, TABLES)), 1)
        self.assertIn("migrations folder is missing", backup_check.check(make(migrations=False), NOW, TABLES))

    def test_messages_carry_no_numbers_from_the_data(self):
        for p in backup_check.check(make(rows={"ads": [{}]}), NOW, TABLES):
            self.assertNotRegex(p, r"\d")

    def test_reads_the_real_table_list(self):
        t = backup_check.tables_expected()
        self.assertIn("ad_metrics", t); self.assertGreater(len(t), 20)


if __name__ == "__main__":
    unittest.main()
