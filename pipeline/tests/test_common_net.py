import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common


class ErrorCodes(unittest.TestCase):
    def test_short_codes_never_carry_the_upstream_text(self):
        cases = {
            "HTTP 429: {act_123 quota}": "rate_limit",
            "HTTP 503: down": "http_5xx",
            "HTTP 0: network URLError": "network",
            "HTTP 401: nope": "auth",
            'HTTP 400: {"error":{"code":190,"message":"x"}}': "auth",
            "HTTP 404: missing": "http_4xx",
            "boom": "error",
        }
        for msg, code in cases.items():
            self.assertEqual(common.error_code(RuntimeError(msg)), code, msg)

    def test_transient_covers_5xx_network_and_meta_throttles(self):
        for msg in ("HTTP 500: x", "HTTP 502: x", "HTTP 0: network timeout", "HTTP 429: x",
                    'HTTP 400: {"error":{"message":"m","code":80004,"error_subcode":1}}',
                    'HTTP 400: {"error": {"code": 17, "x": 1}}'):
            self.assertTrue(common.is_transient(RuntimeError(msg)), msg)
        for msg in ("HTTP 400: bad request", "HTTP 403: forbidden", "HTTP 401: x"):
            self.assertFalse(common.is_transient(RuntimeError(msg)), msg)


class Retry(unittest.TestCase):
    def test_retries_a_5xx_then_succeeds(self):
        calls, slept = [], []

        def fn():
            calls.append(1)
            if len(calls) < 3:
                raise RuntimeError("HTTP 502: bad gateway")
            return "ok"
        out = common.retry_call(fn, sleep=slept.append, budget=common.RetryBudget(1000))
        self.assertEqual(out, "ok")
        self.assertEqual(len(slept), 2)

    def test_a_definite_error_is_not_retried(self):
        calls = []

        def fn():
            calls.append(1)
            raise RuntimeError("HTTP 400: bad")
        with self.assertRaises(RuntimeError):
            common.retry_call(fn, sleep=lambda s: None, budget=common.RetryBudget(1000))
        self.assertEqual(len(calls), 1)

    def test_the_time_budget_stops_the_retries(self):
        calls = []

        def fn():
            calls.append(1)
            raise RuntimeError("HTTP 429: slow down")
        with self.assertRaises(RuntimeError):
            common.retry_call(fn, tries=6, sleep=lambda s: None, budget=common.RetryBudget(10))
        self.assertEqual(len(calls), 1)     # the first pause (about 30s) already exceeds the 10s budget


class Currency(unittest.TestCase):
    def test_factors(self):
        self.assertEqual(common.sar_factor("SAR", "USD"), 1.0)
        self.assertEqual(common.sar_factor("USD", "SAR"), 3.75)
        self.assertEqual(common.sar_factor(None, "USD"), 3.75)     # lookup failed: the old assumption stays
        self.assertEqual(common.sar_factor(None, "SAR"), 1.0)

    def test_other_currency_fails_the_platform(self):
        with self.assertRaises(RuntimeError) as cm:
            common.sar_factor("EUR", "USD")
        self.assertIn("currency mismatch", str(cm.exception))


class GoogleSearch(unittest.TestCase):
    def test_follows_next_page_token(self):
        pages = [{"results": [1, 2], "nextPageToken": "t1"}, {"results": [3], "nextPageToken": "t2"}, {"results": [4]}]
        seen = []

        def request(url, data=None, method=None, headers=None):
            import json
            seen.append(json.loads(data).get("pageToken"))
            return pages[len(seen) - 1]
        out = common.google_search_all("123", {}, "SELECT 1", request=request)
        self.assertEqual(out, [1, 2, 3, 4])
        self.assertEqual(seen, [None, "t1", "t2"])


if __name__ == "__main__":
    unittest.main()
