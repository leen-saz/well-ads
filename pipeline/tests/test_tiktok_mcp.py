import json, os, sys, unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tiktok import mcp  # noqa: E402


class Fake:
    def __init__(self, answers):
        self.answers, self.seen = answers, []

    def __call__(self, url, data=None, headers=None, method=None):
        self.seen.append((url, data, headers or {}))
        return self.answers.pop(0)


class McpTests(unittest.TestCase):
    def test_refresh_returns_access_and_only_a_changed_refresh(self):
        f = Fake([(200, {}, json.dumps({"access_token": "A", "refresh_token": "R2"})), (200, {}, json.dumps({"access_token": "B", "refresh_token": "R2"}))])
        self.assertEqual(mcp.access_token("c", "R1", post=f), ("A", "R2"))
        self.assertEqual(mcp.access_token("c", "R2", post=f), ("B", None))
        body = f.seen[0][1].decode()
        self.assertIn("grant_type=refresh_token", body)
        self.assertIn("resource=", body)

    def test_token_error_never_echoes_the_token(self):
        f = Fake([(400, {}, json.dumps({"error": "invalid_grant"}))])
        with self.assertRaises(RuntimeError) as cm:
            mcp.access_token("c", "SECRET-REFRESH", post=f)
        self.assertNotIn("SECRET", str(cm.exception))

    def test_session_header_and_sse_answers(self):
        f = Fake([
            (200, {"Mcp-Session-Id": "s1"}, 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"tt"},"protocolVersion":"2025-06-18"}}\n\n'),
            (202, {}, ""),
            (200, {}, json.dumps({"jsonrpc": "2.0", "id": 2, "result": {"tools": [{"name": "tool_execute", "description": "Run a tool", "inputSchema": {"properties": {"tool_name": {"type": "string"}}, "required": ["tool_name"]}}]}})),
        ])
        m = mcp.Mcp("T", post=f)
        self.assertEqual(m.start()["serverInfo"]["name"], "tt")
        tools = m.tools()
        self.assertEqual(f.seen[2][2]["Mcp-Session-Id"], "s1")
        self.assertEqual(f.seen[0][2]["Authorization"], "Bearer T")
        self.assertEqual(mcp.describe(tools), ["- tool_execute(tool_name*:string) — Run a tool"])


if __name__ == "__main__":
    unittest.main()


class PullTests(unittest.TestCase):
    def test_pull_writes_tiktok_json_from_read_only_tools(self):
        import tempfile
        from datetime import date
        calls = []

        class M:
            def call(self, method, params):
                name, args = params["name"], params["arguments"]
                calls.append(name)
                if name == "ad_get":
                    data = {"list": [{"ad_id": "1", "ad_name": "Doula", "campaign_id": "c1", "campaign_name": "C", "adgroup_name": "G",
                                      "secondary_status": "AD_STATUS_DELIVERY_OK", "operation_status": "ENABLE", "advertiser_id": "A"}],
                            "page_info": {"total_page": 1}}
                elif name == "campaign_get":
                    data = {"list": [{"campaign_id": "c1", "objective_type": "LEAD_GENERATION"}], "page_info": {"total_page": 1}}
                else:
                    data = {"list": [{"dimensions": {"ad_id": "1", "stat_time_day": args["end_date"] + " 00:00:00"},
                                      "metrics": {"spend": "10.5", "impressions": "100", "clicks": "4", "conversion": "2"}}],
                            "page_info": {"total_page": 1}}
                return {"content": [{"type": "text", "text": json.dumps({"code": 0, "data": data})}]}

        d = tempfile.mkdtemp()
        snap = os.path.join(d, "tiktok.json")
        json.dump({"advertiser_id": "A", "advertiser_name": "Well", "ads": {"t9": {"platform": "tiktok", "name": "Old", "live": False}}, "rows": [["t9", "2026-10-30", 1, 1, 0, 0, 0]], "objectives": {}}, open(snap, "w"))
        old = mcp.SNAPSHOT
        mcp.SNAPSHOT = snap
        try:
            line = mcp.pull(M(), today=date(2026, 11, 2))
        finally:
            mcp.SNAPSHOT = old
        out = json.load(open(snap))
        self.assertIn("t1", out["ads"])
        self.assertEqual(out["ads"]["t1"]["goal"], "lead")
        self.assertIn(["t1", "2026-11-02", 10.5, 100, 4, 2.0, 0], out["rows"])
        self.assertIn(["t9", "2026-10-30", 1, 1, 0, 0, 0], out["rows"])  # older day kept
        self.assertTrue(all(c.endswith(("_get", "_list")) for c in calls))
        self.assertIn("1 ads", line)

    def test_refuses_tools_that_change_things(self):
        with self.assertRaises(RuntimeError):
            mcp.tool(object(), "ad_update", {})
