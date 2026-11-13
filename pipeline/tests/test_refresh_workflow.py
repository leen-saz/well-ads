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


if __name__ == "__main__":
    unittest.main()
