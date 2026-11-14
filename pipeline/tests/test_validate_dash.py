import contextlib, copy, io, json, os, subprocess, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import validate_dash as v  # noqa: E402
from dash_split import rows_cols, split  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def good():
    """Synthetic dash.json: 5 ads, 40 days of rows."""
    ads = {f"m{i}|x": {"name": f"ad {i}", "platform": "meta"} for i in range(5)}
    rows = [[f"m{i}|x", f"2026-10-{d:02d}", 10.5 + d, 100, 5, 1, 0] for i in range(5) for d in range(1, 9)]
    return {"range": {"start": "2026-10-01", "end": "2026-10-08", "today": "2026-10-09"}, "ads": ads, "rows": rows,
            "crm": {"rows": [["m0|x", "2026-10-01", "2026-10-03", 1, 500.0]], "paid_all": [["2026-10-01", "2026-10-03", 500.0, "meta_form"]], "total": 1, "unmatched": 0},
            "organic": {}, "channels": {}, "departments": {}}


class ValidateTests(unittest.TestCase):
    def test_a_good_file_passes(self):
        self.assertEqual(v.validate(good()), [])

    def test_missing_and_wrong_types(self):
        d = good(); del d["rows"]
        self.assertEqual(v.validate(d), ["missing required key 'rows'"])
        d = good(); d["ads"] = []
        self.assertIn("'ads' has the wrong type", v.validate(d))
        self.assertEqual(v.validate([]), ["the file is not a JSON object"])

    def test_too_small_to_be_real(self):
        d = good(); d["rows"] = d["rows"][:3]
        self.assertIn("too few daily rows for a real build", v.validate(d))
        d = good(); d["ads"] = {"m0|x": {}}
        self.assertIn("too few ads for a real build", v.validate(d))

    def test_negative_spend_and_bad_days(self):
        d = good(); d["rows"][0][2] = -1
        self.assertIn("some rows have a negative spend or metric", v.validate(d))
        d = good(); d["rows"][1][1] = "2027-01-01"
        self.assertIn("some rows have a day that is invalid or outside the range", v.validate(d))
        d = good(); d["rows"][2][1] = "2026-13-45"
        self.assertIn("some rows have a day that is invalid or outside the range", v.validate(d))
        d = good(); d["range"]["start"] = "2026-11-01"
        self.assertIn("range is out of order (start, end, today)", v.validate(d))

    def test_malformed_rows_and_ads(self):
        d = good(); d["rows"][0] = ["m0|x", "2026-10-01", "10"]
        self.assertIn("some rows are malformed (expected [ad, day, spend, ...numbers])", v.validate(d))
        d = good(); d["rows"][0][2] = float("nan")
        self.assertIn("some rows are malformed (expected [ad, day, spend, ...numbers])", v.validate(d))
        d = good(); d["ads"]["zzz"] = {}
        self.assertIn("some ads are malformed (key prefix or type)", v.validate(d))

    def test_both_shapes_of_dash_json(self):
        """Inline (aud on each ad, organic in the file) and split (no aud, no organic, extra lists what moved out)."""
        inline = good(); inline["organic"] = {"facebook": []}
        for ad in inline["ads"].values():
            ad["aud"] = {"age": [1, 2]}
        self.assertEqual(v.validate(inline), [])
        split = good(); del split["organic"]; split["extra"] = ["aud", "organic"]
        self.assertEqual(v.validate(split), [])
        split["extra"] = "aud"
        self.assertIn("'extra' must be a list of names", v.validate(split))

    def test_column_wise_rows_pass_and_keep_every_row_rule(self):
        """The main dash.json as dash_split.py writes it: rows_cols instead of rows. The same rules apply after decoding."""
        main, _, _ = split(good())
        self.assertNotIn("rows", main)
        self.assertEqual(v.validate(main), [])
        def cols(change):
            d = good(); change(d["rows"]); m, _, _ = split(d); return v.validate(m)
        self.assertIn("too few daily rows for a real build", cols(lambda r: r.__delitem__(slice(3, None))))
        self.assertIn("some rows have a negative spend or metric", cols(lambda r: r[0].__setitem__(2, -1)))
        self.assertIn("some rows have a day that is invalid or outside the range", cols(lambda r: r[1].__setitem__(1, "2027-01-01")))
        self.assertIn("some rows are malformed (expected [ad, day, spend, ...numbers])", cols(lambda r: r[2].__setitem__(3, "100")))

    def test_malformed_column_wise_rows(self):
        def bad(change):
            m, _, _ = split(good()); change(m["rows_cols"]); return v.validate(m)
        cols_msg = "'rows_cols' is malformed (expected k, d and seven columns of the same length)"
        index_msg = "'rows_cols' has an ad or day index outside its list"
        self.assertEqual(bad(lambda rc: rc["c"].pop()), [cols_msg])
        self.assertEqual(bad(lambda rc: rc["c"][4].pop()), [cols_msg])
        self.assertEqual(bad(lambda rc: rc.__setitem__("k", "m0|x")), [cols_msg])
        self.assertEqual(bad(lambda rc: rc["c"][0].__setitem__(0, 99)), [index_msg])
        self.assertEqual(bad(lambda rc: rc["c"][1].__setitem__(0, -1)), [index_msg])
        self.assertEqual(bad(lambda rc: rc["c"][0].__setitem__(0, True)), [index_msg])
        m, _, _ = split(good()); m["rows_cols"] = []
        self.assertEqual(v.validate(m), [cols_msg])
        m, _, _ = split(good()); del m["rows_cols"]
        self.assertEqual(v.validate(m), ["missing required key 'rows'"])

    def test_missing_crm_block_warns_but_does_not_fail(self):
        d = good(); self.assertEqual(v.warnings(d), [])
        del d["crm"]
        self.assertEqual(v.validate(d), [])
        self.assertEqual(len(v.warnings(d)), 1)
        self.assertEqual(len(v.warnings({**d, "crm": {}})), 1)

    def test_crm_block(self):
        d = good(); d["crm"]["rows"][0][4] = -5
        self.assertIn("some crm rows are malformed or have a negative amount", v.validate(d))
        d = good(); d["crm"]["paid_all"][0][2] = -5
        self.assertIn("some crm payments are malformed or negative", v.validate(d))
        d = good(); d["crm"] = {"rows": 3}
        self.assertIn("crm needs 'rows' and 'paid_all' lists", v.validate(d))
        d = good(); d["crm"] = {}
        self.assertEqual(v.validate(d), [])  # no CRM yet is fine

    def test_messages_carry_no_figures(self):
        d = good(); d["rows"][0][2] = -123456.78
        d["crm"]["rows"][0][4] = -987654.32
        text = " ".join(v.validate(d))
        for figure in ("123456", "987654", "5 ads", "40"):
            self.assertNotIn(figure, text)


class CliTests(unittest.TestCase):
    def run_cli(self, data=None, raw=None):
        with tempfile.TemporaryDirectory() as t:
            path = os.path.join(t, "dash.json")
            if raw is not None:
                open(path, "w").write(raw)
            elif data is not None:
                json.dump(data, open(path, "w"))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = v.main(["validate_dash.py", path])
            return code, out.getvalue()

    def test_exit_codes(self):
        self.assertEqual(self.run_cli(good())[0], 0)
        bad = copy.deepcopy(good()); bad["rows"][0][2] = -9
        code, out = self.run_cli(bad)
        self.assertEqual(code, 1)
        self.assertIn("Nothing was uploaded", out)
        self.assertEqual(self.run_cli(raw="{not json")[0], 2)

    def test_audience_files(self):
        with tempfile.TemporaryDirectory() as t:
            os.makedirs(os.path.join(t, "dept"))
            json.dump({"ads": {}, "rows": []}, open(os.path.join(t, "full.json"), "w"))
            open(os.path.join(t, "dept", "iv.json"), "w").write("oops")
            self.assertEqual(v.check_audience_files(t), ["dept/iv.json: not valid JSON"])

    def test_audience_files_in_both_row_shapes(self):
        with tempfile.TemporaryDirectory() as t:
            os.makedirs(os.path.join(t, "dept"))
            json.dump({"ads": {}, "rows": []}, open(os.path.join(t, "full.json"), "w"))
            json.dump({"ads": {}, "rows_cols": rows_cols(good()["rows"])}, open(os.path.join(t, "creative.json"), "w"))
            self.assertEqual(v.check_audience_files(t), [])
            json.dump({"ads": {}, "rows_cols": {"k": [], "d": [], "c": [[0]]}}, open(os.path.join(t, "dept", "iv.json"), "w"))
            json.dump({"ads": {}}, open(os.path.join(t, "dept", "foot.json"), "w"))
            self.assertEqual(v.check_audience_files(t), ["dept/foot.json: needs 'ads' and 'rows'", "dept/iv.json: needs 'ads' and 'rows'"])

    def test_failure_output_carries_no_figures(self):
        m, _, _ = split(good()); m["rows_cols"]["c"][2][0] = -123456.78
        code, out = self.run_cli(m)
        self.assertEqual(code, 1)
        self.assertNotIn("123456", out)
        self.assertFalse(any(ch.isdigit() for ch in out), out)


class BuildOutputTests(unittest.TestCase):
    """build.py on synthetic data, then the validator exactly as the workflows run it (refresh.yml, pipeline.yml)."""

    def test_the_validator_passes_what_build_writes(self):
        data_path = os.path.join(ROOT, "data.json")
        previous = open(data_path, encoding="utf-8").read() if os.path.exists(data_path) else None
        try:
            payload = good()
            payload.update({"generated_at": "2026-10-09T09:00+03:00", "schema": 2, "goals": {"lead": "ليدز"},
                            "platforms": {"meta": {"ok": True, "currency": "SAR"}}})
            del payload["crm"]
            for ad in payload["ads"].values():
                ad.update({"campaign": "c", "group": "g", "goal": "lead", "status": "ACTIVE", "text": "", "live": True,
                           "aud": {"gender": [["female", 100, 5, 10.0, 1]]}})
            json.dump(payload, open(data_path, "w", encoding="utf-8"))
            subprocess.check_call([sys.executable, os.path.join(ROOT, "build.py")], cwd=ROOT, stdout=subprocess.DEVNULL)
            public = os.path.join(ROOT, "web", "public")
            dash = json.load(open(os.path.join(public, "dash.json"), encoding="utf-8"))
            self.assertIn("rows_cols", dash)      # the shape that broke the hourly refresh
            self.assertNotIn("rows", dash)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = v.main(["validate_dash.py", os.path.join(public, "dash.json"), os.path.join(public, "data")])
            self.assertEqual(code, 0, out.getvalue())
        finally:
            if previous is None:
                os.remove(data_path)
            else:
                open(data_path, "w", encoding="utf-8").write(previous)


if __name__ == "__main__":
    unittest.main()


class VanishedPlatforms(unittest.TestCase):
    def build(self, rows, ads, ok=True):
        return {"range": {"start": "2026-06-30", "end": "2026-11-12", "today": "2026-11-13"}, "ads": ads, "rows": rows,
                "platforms": {"meta": {"ok": ok}, "google": {"ok": ok}}}

    def test_empty_ok_platform_is_flagged(self):
        prev = self.build([["g1", "2026-11-12", 50, 10, 1, 0, 0], ["m1", "2026-11-12", 20, 10, 1, 0, 0]], {"g1": {}, "m1": {}})
        now = self.build([["m1", "2026-11-12", 20, 10, 1, 0, 0]], {"m1": {}})
        self.assertEqual(v.vanished_platforms(now, prev), ["g"])

    def test_paused_platform_that_still_lists_its_ads_is_not_flagged(self):
        prev = self.build([["g1", "2026-11-12", 50, 10, 1, 0, 0]], {"g1": {}})
        now = self.build([], {"g1": {}})
        self.assertEqual(v.vanished_platforms(now, prev), [])

    def test_failed_platform_is_not_flagged(self):
        prev = self.build([["g1", "2026-11-12", 50, 10, 1, 0, 0]], {"g1": {}})
        now = self.build([], {}, ok=False)
        self.assertEqual(v.vanished_platforms(now, prev), [])
