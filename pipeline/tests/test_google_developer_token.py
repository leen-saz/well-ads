import os
import sys
import unittest
from datetime import datetime
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common  # noqa: E402
import fetch_data  # noqa: E402

BASE = {"GOOGLE_ADS_CLIENT_ID": "cid", "GOOGLE_ADS_CLIENT_SECRET": "sec", "GOOGLE_ADS_REFRESH_TOKEN": "rt",
        "GOOGLE_ADS_CUSTOMER_ID": "1111111111", "GOOGLE_ADS_LOGIN_CUSTOMER_ID": "2222222222"}


class Headers(unittest.TestCase):
    def test_developer_token_is_sent(self):
        h = common.google_ads_headers({**BASE, "GOOGLE_ADS_DEVELOPER_TOKEN": " dev-x "}, "acc")
        self.assertEqual(h["developer-token"], "dev-x")
        self.assertEqual(h["Authorization"], "Bearer acc")
        self.assertEqual(h["login-customer-id"], "2222222222")

    def test_missing_or_blank_token_fails_clearly(self):
        for e in (BASE, {**BASE, "GOOGLE_ADS_DEVELOPER_TOKEN": "  "}):
            with self.assertRaises(RuntimeError) as c:
                common.google_ads_headers(e, "acc")
            self.assertIn("GOOGLE_ADS_DEVELOPER_TOKEN", str(c.exception))


class GooglePull(unittest.TestCase):
    def run_google(self, env_extra):
        calls = []

        def fake_http(url, data=None, headers=None, method=None, timeout=60):
            calls.append((url, headers or {}))
            return {"access_token": "t"} if "oauth2" in url else {"results": []}

        P = fetch_data.Plat()
        day = datetime(2026, 11, 1)
        with mock.patch.dict(fetch_data.E, {**BASE, **env_extra}, clear=True), mock.patch.object(fetch_data, "http", fake_http), \
                mock.patch.object(fetch_data, "FROM", day), mock.patch.object(fetch_data, "TO", day), \
                mock.patch.object(fetch_data, "LAST_FULL", day, create=True):
            try:
                fetch_data.google(P)
                err = None
            except RuntimeError as ex:
                err = str(ex)
        return calls, err

    def test_every_search_call_carries_the_header(self):
        calls, err = self.run_google({"GOOGLE_ADS_DEVELOPER_TOKEN": "dev-x"})
        self.assertIsNone(err)
        searches = [h for u, h in calls if "googleAds:search" in u]
        self.assertTrue(searches)
        self.assertTrue(all(h.get("developer-token") == "dev-x" for h in searches))

    def test_missing_token_fails_google_before_any_network_call(self):
        calls, err = self.run_google({})
        self.assertIn("GOOGLE_ADS_DEVELOPER_TOKEN", err)
        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
