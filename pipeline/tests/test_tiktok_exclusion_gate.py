import io, os, sys, unittest
from contextlib import redirect_stdout
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tiktok import merge, mcp


def env(**kw):
    base = {k: v for k, v in os.environ.items() if not k.startswith("TIKTOK_")}
    base.update(kw)
    return mock.patch.dict(os.environ, base, clear=True)


class Gate(unittest.TestCase):
    def test_states(self):
        with env():
            self.assertEqual(merge.exclusion_state(), "missing")
        with env(TIKTOK_EXCLUDED_ADVERTISER_IDS="1", TIKTOK_EXCLUDED_MARKERS="x"):
            self.assertEqual(merge.exclusion_state(), "configured")
        with env(TIKTOK_EXCLUSION_DISABLED="true"):
            self.assertEqual(merge.exclusion_state(), "disabled")
        with env(TIKTOK_EXCLUSION_DISABLED="false"):
            self.assertEqual(merge.exclusion_state(), "missing")
        with env(TIKTOK_EXCLUDED_ADVERTISER_IDS="1"):      # only one of the two secrets is not enough
            self.assertEqual(merge.exclusion_state(), "missing")

    def test_mcp_step_stops_and_fails_when_exclusion_is_missing(self):
        out = io.StringIO()
        with env(TIKTOK_MCP_CLIENT_ID="c", TIKTOK_MCP_REFRESH_TOKEN="r"), redirect_stdout(out), \
                mock.patch.object(mcp, "access_token", side_effect=AssertionError("must not call TikTok")):
            self.assertEqual(mcp.main(), 1)
        self.assertIn("skipped", out.getvalue())

    def test_mcp_step_runs_with_the_explicit_opt_out(self):
        with env(TIKTOK_MCP_CLIENT_ID="c", TIKTOK_MCP_REFRESH_TOKEN="r", TIKTOK_EXCLUSION_DISABLED="true"), \
                mock.patch.object(mcp, "access_token", side_effect=RuntimeError("reached")), redirect_stdout(io.StringIO()):
            with self.assertRaises(RuntimeError):
                mcp.main()


class Conversations(unittest.TestCase):
    def test_sums_both_messaging_metrics(self):
        m = {"messaging_total_conversation_tiktok_direct_message": "3", "messaging_total_conversation_instant_messaging_app": "2.4"}
        self.assertEqual(merge.conversations(m), 5)
        self.assertEqual(merge.conversations({"spend": "1"}), 0)
        self.assertEqual(merge.conversations(None), 0)


class RefreshTokenSave(unittest.TestCase):
    def fake_db(self, fails):
        calls = []

        class Db:
            def req(self, *a, **k):
                calls.append(1)
                if len(calls) <= fails:
                    raise RuntimeError("HTTP 502")
        return Db(), calls

    def test_retries_then_saves(self):
        db, calls = self.fake_db(2)
        with mock.patch("modules.core.supa.Supa.from_env", return_value=db):
            mcp.save_refresh("new", attempts=4, sleep=lambda s: None)
        self.assertEqual(len(calls), 3)

    def test_fails_loudly_after_the_last_try(self):
        db, calls = self.fake_db(99)
        with mock.patch("modules.core.supa.Supa.from_env", return_value=db):
            with self.assertRaises(RuntimeError) as cm:
                mcp.save_refresh("new", attempts=3, sleep=lambda s: None)
        self.assertEqual(len(calls), 3)
        self.assertIn("could not store", str(cm.exception))

    def test_main_does_not_pull_when_the_new_token_is_not_saved(self):
        with env(TIKTOK_MCP_CLIENT_ID="c", TIKTOK_MCP_REFRESH_TOKEN="r", TIKTOK_EXCLUSION_DISABLED="true"), \
                mock.patch.object(mcp, "access_token", return_value=("acc", "newrefresh")), \
                mock.patch.object(mcp, "save_refresh", side_effect=RuntimeError("down")), \
                mock.patch.object(mcp, "Mcp", side_effect=AssertionError("must not pull")), redirect_stdout(io.StringIO()):
            self.assertEqual(mcp.main(), 1)


if __name__ == "__main__":
    unittest.main()
