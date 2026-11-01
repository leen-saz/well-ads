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
