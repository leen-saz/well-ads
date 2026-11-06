import contextlib, copy, io, json, os, sys, tempfile, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import validate_dash as v  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
