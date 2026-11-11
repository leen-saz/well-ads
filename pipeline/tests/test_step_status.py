import json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import step_status as s  # noqa: E402


class StepStatusTests(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.p = lambda n: os.path.join(self.t.name, n)

    def tearDown(self):
        self.t.cleanup()

    def test_run_keeps_the_exit_code_and_records_ok_or_failed(self):
        self.assertEqual(s.run("crm", [sys.executable, "-c", "pass"], self.p("s.json")), 0)
        self.assertEqual(s.run("suggest", [sys.executable, "-c", "raise SystemExit(3)"], self.p("s.json")), 3)
        d = json.load(open(self.p("s.json")))
        self.assertTrue(d["crm"]["ok"])
        self.assertFalse(d["suggest"]["ok"])

    def test_unknown_step_is_refused(self):
        with self.assertRaises(ValueError):
            s.record("rm -rf", True, self.p("s.json"))

    def test_merge_keeps_last_success_across_runs(self):
        json.dump({"crm": {"ok": True, "at": "2026-11-01T01:00:00Z"}, "critic": {"ok": True, "at": "2026-11-01T01:00:00Z"}}, open(self.p("prev_steps.json"), "w"))
        s.merge(self.p("prev_steps.json"), "", self.p("none.json"), self.p("run1.json"))
        # next run: crm fails, critic did not run at all, suggest is new and fine
        json.dump({"crm": {"ok": False, "at": "2026-11-01T02:00:00Z"}, "suggest": {"ok": True, "at": "2026-11-01T02:00:00Z"}}, open(self.p("cur.json"), "w"))
        json.dump({"generated_at": "g", "crm": {"synced": "x", "rows": []}}, open(self.p("dash.json"), "w"))
        out = s.merge(self.p("cur.json"), self.p("run1.json"), self.p("dash.json"), self.p("out.json"))
        self.assertEqual(out["steps"]["crm"], {"ok": False, "at": "2026-11-01T02:00:00Z", "last_ok": "2026-11-01T01:00:00Z"})
        self.assertEqual(out["steps"]["suggest"]["last_ok"], "2026-11-01T02:00:00Z")
        self.assertTrue(out["steps"]["critic"]["skipped"])
        self.assertEqual((out["built_at"], out["crm_present"], out["crm_synced"]), ("g", True, "x"))
        self.assertEqual(json.load(open(self.p("out.json"))), out)

    def test_merge_without_anything_is_safe(self):
        out = s.merge(self.p("missing.json"), self.p("missing2.json"), self.p("missing3.json"), self.p("o.json"))
        self.assertEqual(out, {"built_at": None, "crm_present": False, "crm_synced": None, "steps": {}})

    def test_the_file_holds_only_names_flags_and_times(self):
        s.record("crm", False, self.p("s.json"), at="2026-11-01T00:00:00Z")
        self.assertEqual(json.load(open(self.p("s.json"))), {"crm": {"ok": False, "at": "2026-11-01T00:00:00Z"}})


if __name__ == "__main__":
    unittest.main()
