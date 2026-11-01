#!/usr/bin/env python3
"""TikTok for Business through its official MCP server, inside the hourly refresh (no Grok, no TikTok API app).

Keys come from the Connectors page (Vault): TIKTOK_MCP_CLIENT_ID and TIKTOK_MCP_REFRESH_TOKEN.
Each run trades the refresh token for an access token. When TikTok hands back a new refresh token,
it is written back to the Vault at once (connector_put), so the next run still works.

Then it pulls, read-only, the same data Grok used to push to the tiktok-data branch: ad_get (all statuses),
campaign_get (objectives), report_integrated_get (AUCTION_AD, ad_id × stat_time_day) and the video covers,
and rewrites pipeline/tiktok-data/tiktok.json through tiktok/merge.py, so fetch_data.py reads it as before.
Only get/list tools are called. No token, key or account value is printed.
"""
import json, os, subprocess, sys, tempfile, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

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


RIYADH = timezone(timedelta(hours=3))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SNAPSHOT = os.path.join(HERE, "tiktok-data", "tiktok.json")
READ_ONLY = ("_get", "_list")
AD_FIELDS = ["ad_id", "ad_name", "campaign_id", "campaign_name", "adgroup_id", "adgroup_name", "operation_status",
             "secondary_status", "tiktok_item_id", "ad_text", "advertiser_id", "video_id", "image_ids"]
METRICS = ["spend", "impressions", "clicks", "conversion"]


def tool(m, name, args):
    """One read-only TikTok tool call; returns the API's data block (list, page_info...)."""
    if not name.endswith(READ_ONLY):
        raise RuntimeError(f"refused non-read tool {name}")
    r = m.call("tools/call", {"name": name, "arguments": args})
    if r.get("isError"):
        raise RuntimeError(f"{name}: " + " ".join(c.get("text", "") for c in r.get("content") or [])[:200])
    d = r.get("structuredContent")
    if d is None:
        text = "".join(c.get("text", "") for c in r.get("content") or [] if c.get("type") == "text")
        d = json.loads(text) if text.strip().startswith(("{", "[")) else {}
    if isinstance(d, dict) and d.get("code") not in (None, 0):
        raise RuntimeError(f"{name}: TikTok {d.get('code')} {str(d.get('message'))[:120]}")
    return d.get("data", d) if isinstance(d, dict) else {"list": d}


def pages(m, name, args, size=1000):
    out, page = [], 1
    while True:
        d = tool(m, name, {**args, "page": page, "page_size": size})
        out += d.get("list") or []
        info = d.get("page_info") or {}
        if page >= int(info.get("total_page") or 1):
            return out
        page += 1


def windows(start, end, step=30):
    """report_integrated_get takes at most 30 days per call."""
    d = start
    while d <= end:
        e = min(d + timedelta(days=step - 1), end)
        yield d, e
        d = e + timedelta(days=1)


def snapshot():
    try:
        return json.load(open(SNAPSHOT, encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def pull(m, today=None):
    """Read-only pull into tiktok.json (same format as the branch). Returns a one-line summary."""
    snap = snapshot()
    adv = str(os.environ.get("TIKTOK_ADVERTISER_ID") or snap.get("advertiser_id") or "").strip()
    if not adv:
        raise RuntimeError("no advertiser id (tiktok.json has none and TIKTOK_ADVERTISER_ID is empty)")
    today = today or datetime.now(RIYADH).date()
    last = max((r[1] for r in snap.get("rows") or []), default="")
    start = (datetime.fromisoformat(last).date() - timedelta(days=3)) if last else today - timedelta(days=90)
    start = max(start, today - timedelta(days=120))
    ads = pages(m, "ad_get", {"advertiser_id": adv, "fields": AD_FIELDS, "filtering": {"primary_status": "STATUS_ALL"}})
    camps = pages(m, "campaign_get", {"advertiser_id": adv, "fields": ["campaign_id", "objective_type"], "filtering": {"primary_status": "STATUS_ALL"}})
    reports = []
    for a, b in windows(start, today):
        rows = pages(m, "report_integrated_get", {"advertiser_id": adv, "report_type": "BASIC", "data_level": "AUCTION_AD",
                                                  "dimensions": ["ad_id", "stat_time_day"], "metrics": METRICS,
                                                  "start_date": a.isoformat(), "end_date": b.isoformat()})
        reports.append({"list": rows, "page_info": {"total_page": 1}})
    vids = sorted({str(x["video_id"]) for x in ads if x.get("video_id")})
    covers = []
    for i in range(0, len(vids), 60):
        try:
            covers.append({"list": tool(m, "file_video_ad_info_get", {"advertiser_id": adv, "video_ids": vids[i:i + 60]}).get("list") or []})
        except Exception as ex:  # noqa: BLE001 - covers are optional
            print("tiktok-mcp: covers skipped —", str(ex)[:120])
            break
    tmp = tempfile.mkdtemp()
    def put(name, obj):
        path = os.path.join(tmp, name)
        json.dump(obj, open(path, "w", encoding="utf-8"), ensure_ascii=False)
        return path
    objectives = {str(c["campaign_id"]): c.get("objective_type") for c in camps if c.get("campaign_id")}
    os.makedirs(os.path.dirname(SNAPSHOT), exist_ok=True)
    cmd = [sys.executable, os.path.join(HERE, "tiktok", "merge.py"), SNAPSHOT, "--ads", put("ads.json", {"list": ads}),
           "--days", *[put(f"r{i}.json", r) for i, r in enumerate(reports)], "--objectives", put("obj.json", objectives),
           "--advertiser-id", adv, "--advertiser-name", str(snap.get("advertiser_name") or "")]
    if covers:
        cmd += ["--covers", *[put(f"c{i}.json", c) for i, c in enumerate(covers)]]
    out = subprocess.run(cmd, cwd=HERE, capture_output=True, text=True, timeout=600)
    if out.returncode:
        raise RuntimeError("merge: " + (out.stderr or out.stdout)[-300:])
    blob = json.load(open(SNAPSHOT, encoding="utf-8"))
    blob["source"] = "TikTok for Business MCP (hourly refresh)"
    json.dump(blob, open(SNAPSHOT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    return (f"{len(ads)} ads, {sum(len(r['list']) for r in reports)} report rows {start}→{today}, "
            f"{len(vids)} videos | " + out.stdout.strip().splitlines()[-1][:200])


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
    if os.environ.get("TIKTOK_MCP_LIST_TOOLS"):
        for line in describe(m.tools()):
            print(line)
    print("tiktok-mcp: " + pull(m))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as ex:  # noqa: BLE001 - the refresh must go on; the message never holds a token
        print("tiktok-mcp: failed —", str(ex)[:200])
        sys.exit(0)
