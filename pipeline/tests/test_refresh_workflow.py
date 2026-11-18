import os, unittest

WF = os.path.join(os.path.dirname(__file__), "..", "..", ".github", "workflows", "refresh.yml")


class RefreshWorkflowTikTok(unittest.TestCase):
    def setUp(self):
        self.text = open(WF, encoding="utf-8").read()

    def test_no_checkout_of_public_tiktok_branch(self):
        self.assertNotIn("ref: tiktok-data", self.text)

    def test_history_lives_in_private_bucket_and_precedes_mcp_step(self):
        restore = self.text.index("Restore TikTok history (private R2)")
        mcp = self.text.index("name: TikTok via MCP")
        save = self.text.index("Save TikTok history (private R2)")
        self.assertLess(restore, mcp)
        self.assertLess(mcp, save)
        self.assertNotIn("site/tiktok", self.text)

    def test_wrangler_installed_before_restore(self):
        self.assertLess(self.text.index("- run: npm ci"), self.text.index("Restore TikTok history (private R2)"))
        self.assertEqual(self.text.count("- run: npm ci"), 1)

    def test_npm_scripts_are_off(self):
        self.assertIn("- run: npm ci --ignore-scripts", self.text)

    def test_cloudflare_token_is_only_on_wrangler_steps(self):
        job_env = self.text[self.text.index("    env:\n"):self.text.index("    steps:")]
        self.assertNotIn("CLOUDFLARE_API_TOKEN", job_env)
        for name in ("Restore TikTok history (private R2)", "Save TikTok history (private R2)", "Upload covers, dashboards and data.json to R2"):
            step = self.text[self.text.index(name):]
            step = step[:step.index("\n      - ", 10)] if "\n      - " in step[10:] else step
            self.assertIn("CLOUDFLARE_API_TOKEN", step, name)
        for name in ("Fetch ads data", "name: TikTok via MCP", "CRM leads"):
            step = self.text[self.text.index(name):]
            step = step[:step.index("\n      - ", 10)]
            self.assertNotIn("CLOUDFLARE_API_TOKEN", step, name)


class RefreshWorkflowExclusion(unittest.TestCase):
    def setUp(self):
        self.text = open(WF, encoding="utf-8").read()

    def test_gate_exists_and_every_tiktok_step_is_skipped_when_missing(self):
        self.assertIn("id: tt_gate", self.text)
        self.assertIn("TIKTOK_EXCLUSION_DISABLED: ${{ vars.TIKTOK_EXCLUSION_DISABLED }}", self.text)
        for name in ("Restore TikTok history (private R2)", "name: TikTok via MCP"):
            step = self.text[self.text.index(name):]
            step = step[:step.index("\n      - ", 10)]
            self.assertIn("steps.tt_gate.outputs.state != 'missing'", step, name)

    def test_the_whole_refresh_does_not_fail_when_it_is_missing(self):
        gate = self.text[self.text.index("id: tt_gate"):self.text.index("- uses: actions/checkout")]
        self.assertNotIn("exit 1", gate)


class RefreshWorkflowUpload(unittest.TestCase):
    def setUp(self):
        self.text = open(WF, encoding="utf-8").read()

    def test_dash_json_goes_up_after_the_files_it_is_read_with(self):
        up = self.text[self.text.index("Upload covers, dashboards and data.json to R2"):]
        for earlier in ("dash-aud.json", "dash-organic.json", 'public/data/*.json', "r2put data.json", 'public/index.html'):
            self.assertLess(up.index(earlier), up.index("put dash.json public/dash.json"), earlier)
        self.assertLess(up.index("put dash.json public/dash.json"), up.index("put data-status.json"))

    def test_uploads_retry(self):
        up = self.text[self.text.index("Upload covers, dashboards and data.json to R2"):]
        self.assertIn("for n in 1 2 3", up)
        self.assertNotIn("npx wrangler r2 object put", up.replace('npx wrangler r2 object put "$BUCKET/$1"', ""))

    def test_history_is_saved_only_after_the_coverage_check(self):
        save = self.text[self.text.index("Save TikTok history (private R2)"):]
        self.assertLess(save.index("history_check.py"), save.index("r2 object put"))


if __name__ == "__main__":
    unittest.main()
