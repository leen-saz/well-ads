import os
import unittest

from common import env
from modules.core.connections import lines

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Lines(unittest.TestCase):
    def test_writes_prefixed_heredoc_and_skips_bad_names_or_empty(self):
        out = lines([{"name": "META_ACCESS_TOKEN", "value": "abc"}, {"name": "bad name", "value": "x"},
                     {"name": "GA4_SERVICE_ACCOUNT_JSON", "value": '{\n "a": 1\n}'}, {"name": "SNAP_REFRESH_TOKEN", "value": ""}])
        self.assertEqual(len(out), 2)
        name, rest = out[0].split("<<", 1)
        tag = rest.split("\n", 1)[0]
        self.assertEqual(name, "V_META_ACCESS_TOKEN")
        self.assertEqual(out[0], f"V_META_ACCESS_TOKEN<<{tag}\nabc\n{tag}\n")
        self.assertIn('\n "a": 1\n', out[1])

    def test_tiktok_vault_row_is_what_refresh_passes_to_the_job(self):
        token = "vault-tiktok-token"
        ids = "7532842350553514000"
        out = "".join(lines([
            {"name": "TIKTOK_ACCESS_TOKEN", "value": token},
            {"name": "TIKTOK_ADVERTISER_IDS", "value": ids},
            {"name": "TIKTOK_ACCESS_TOKEN_EMPTY", "value": ""},
        ]))
        self.assertIn("V_TIKTOK_ACCESS_TOKEN<<", out)
        self.assertIn(token, out)
        self.assertIn("V_TIKTOK_ADVERTISER_IDS<<", out)
        self.assertIn(ids, out)
        self.assertNotIn("TIKTOK_ACCESS_TOKEN_EMPTY", out)
        with open(os.path.join(ROOT, ".github", "workflows", "refresh.yml"), encoding="utf-8") as handle:
            yml = handle.read()
        # TikTok stays on MCP (Leen's decision): the refresh job is never given a TikTok API token
        self.assertNotIn("TIKTOK_ACCESS_TOKEN:", yml)
        self.assertNotIn("TIKTOK_ADVERTISER_IDS:", yml)

    def test_env_never_takes_a_tiktok_token_from_the_vault(self):
        keys = ("TIKTOK_ACCESS_TOKEN", "V_TIKTOK_ACCESS_TOKEN", "TIKTOK_ADVERTISER_IDS", "V_TIKTOK_ADVERTISER_IDS")
        old = {k: os.environ.get(k) for k in keys}
        try:
            os.environ["TIKTOK_ACCESS_TOKEN"] = "github-tiktok-token"
            os.environ["V_TIKTOK_ACCESS_TOKEN"] = "vault-tiktok-token"
            os.environ["TIKTOK_ADVERTISER_IDS"] = "6948010864247046146"
            os.environ["V_TIKTOK_ADVERTISER_IDS"] = "7532842350553514000"
            got = env()
            self.assertEqual(got["TIKTOK_ACCESS_TOKEN"], "github-tiktok-token")
            self.assertEqual(got["TIKTOK_ADVERTISER_IDS"], "6948010864247046146")
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
