#!/usr/bin/env python3
"""TikTok for Business through its official MCP server, inside the hourly refresh (no Grok, no TikTok API app).

Keys come from the Connectors page (Vault): TIKTOK_MCP_CLIENT_ID and TIKTOK_MCP_REFRESH_TOKEN.
Each run trades the refresh token for an access token. When TikTok hands back a new refresh token,
it is written back to the Vault at once (connector_put), so the next run still works.

This first version discovers the server: it lists the tools and the input schema of each one, and logs
names and schemas only. No token, key or account value is printed. Read-only: no tool is called that
changes anything on TikTok.
"""
import json, os, sys, urllib.error, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

RESOURCE = "https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat"
TOKEN = RESOURCE + "/oauth/token"
PROTOCOL = "2025-06-18"


def http(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method or ("POST" if data is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as ex:
        return ex.code, dict(ex.headers or {}), ex.read().decode("utf-8", "replace")


def access_token(client_id, refresh, post=http):
    """refresh_token grant (public client, PKCE sign-in already done). Returns (access, new_refresh_or_None)."""
    body = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": refresh, "client_id": client_id, "resource": RESOURCE}).encode()
    code, _, text = post(TOKEN, body, {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
    try:
        d = json.loads(text)
    except ValueError:
        d = {}
    if code != 200 or not d.get("access_token"):
        raise RuntimeError(f"token {code} {str(d.get('error') or '')[:60]}")
    new = d.get("refresh_token")
    return d["access_token"], (new if new and new != refresh else None)


def save_refresh(new):
    """The new refresh token goes back to the Vault before anything else, so a failed run never strands the sign-in."""
    from modules.core.supa import Supa
    db = Supa.from_env()
    if not db:
        raise RuntimeError("no Supabase to store the rotated refresh token")
    db.req("/rest/v1/rpc/connector_put", "POST", {"p_name": "TIKTOK_MCP_REFRESH_TOKEN", "p_value": new})


def sse_or_json(text):
    """Streamable HTTP answers as JSON or as server-sent events; return the JSON-RPC message."""
    t = text.strip()
    if t.startswith("{"):
        return json.loads(t)
    msgs = [json.loads(l[5:].strip()) for l in t.splitlines() if l.startswith("data:") and l[5:].strip().startswith("{")]
    return msgs[-1] if msgs else {}


class Mcp:
    def __init__(self, token, post=http):
        self.token, self.post, self.session, self.n = token, post, None, 0

    def call(self, method, params=None, notify=False):
        msg = {"jsonrpc": "2.0", "method": method, **({"params": params} if params is not None else {})}
        if not notify:
            self.n += 1
            msg["id"] = self.n
        h = {"Authorization": "Bearer " + self.token, "Content-Type": "application/json",
             "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL}
        if self.session:
            h["Mcp-Session-Id"] = self.session
        code, headers, text = self.post(RESOURCE, json.dumps(msg).encode(), h)
        sid = {k.lower(): v for k, v in headers.items()}.get("mcp-session-id")
        if sid:
            self.session = sid
        if notify:
            return None
        if code >= 400:
            raise RuntimeError(f"mcp {method} {code}")
        d = sse_or_json(text)
        if d.get("error"):
            raise RuntimeError(f"mcp {method} error {str(d['error'].get('message', ''))[:120]}")
        return d.get("result") or {}

    def start(self):
        r = self.call("initialize", {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": {"name": "well-ads-refresh", "version": "1"}})
        self.call("notifications/initialized", notify=True)
        return r

    def tools(self):
        out, cursor = [], None
        while True:
            r = self.call("tools/list", {"cursor": cursor} if cursor else {})
            out += r.get("tools") or []
            cursor = r.get("nextCursor")
            if not cursor:
                return out


def describe(tools):
    """Names, descriptions and argument schemas only: safe for the run log."""
    lines = []
    for t in tools:
        props = ((t.get("inputSchema") or {}).get("properties") or {})
        req = (t.get("inputSchema") or {}).get("required") or []
        args = ", ".join(f"{k}{'*' if k in req else ''}:{(v or {}).get('type', '?')}" for k, v in props.items())
        lines.append(f"- {t.get('name')}({args}) — {str(t.get('description') or '').strip().splitlines()[0][:160] if t.get('description') else ''}")
    return lines


def main():
    cid = (os.environ.get("TIKTOK_MCP_CLIENT_ID") or "").strip()
    refresh = (os.environ.get("TIKTOK_MCP_REFRESH_TOKEN") or "").strip()
    if not cid or not refresh:
        print("tiktok-mcp: not connected yet (Connectors page → TikTok → Connect)")
        return 0
    token, new = access_token(cid, refresh)
    print(f"::add-mask::{token}")
    if new:
        print(f"::add-mask::{new}")
        save_refresh(new)
        print("tiktok-mcp: refresh token rotated and saved")
    m = Mcp(token)
    info = m.start()
    srv = info.get("serverInfo") or {}
    print(f"tiktok-mcp: connected to {srv.get('name', '?')} {srv.get('version', '')} (protocol {info.get('protocolVersion', '?')})")
    tools = m.tools()
    print(f"tiktok-mcp: {len(tools)} tools")
    for line in describe(tools):
        print(line)
    for t in tools:
        if t.get("name") in ("tool_execute", "tool_search", "tool_list", "tools_search"):
            print(f"schema {t['name']}: " + json.dumps(t.get("inputSchema") or {}, ensure_ascii=False)[:1500])
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as ex:  # noqa: BLE001 - the refresh must go on; the message never holds a token
        print("tiktok-mcp: failed —", str(ex)[:200])
        sys.exit(0)
