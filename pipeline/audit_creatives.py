#!/usr/bin/env python3
"""تدقيق على مستوى الإعلان: مجموع آخر 30 يوم مكتمل في data.json مقابل تقرير المنصة لنفس الإعلان."""
import json, urllib.parse
from collections import defaultdict
from datetime import datetime, timedelta
from common import env, http
E = env(); D = json.load(open("data.json", encoding="utf-8"))
end = D["range"]["end"]; start = (datetime.strptime(end, "%Y-%m-%d") - timedelta(days=29)).strftime("%Y-%m-%d")
ours = defaultdict(lambda: [0.0, 0, 0, 0, 0])
for r in D["rows"]:
    k, d = r[0], r[1]
    if k[0] == "m" and "|" in k:
        k = k.split("|", 1)[0]   # مواضع فيسبوك/إنستغرام تُجمع لمقارنة تقرير الإعلان
    if start <= d <= end:
        o = ours[k]
        for i, v in enumerate(r[2:7]): o[i] += v
def report(p, truth, scale=1.0):
    keys = {k for k in set(truth) | {k for k in ours if k[0] == p[0]}}
    bad = []
    for k in keys:
        t = truth.get(k, [0, 0, 0, 0, 0]); o = ours.get(k, [0, 0, 0, 0, 0]); o = [o[0] / scale] + o[1:]
        diffs = [i for i in range(5) if (abs(o[i] - t[i]) > 0.05 if i == 0 else round(o[i]) != round(t[i]))]
        if diffs: bad.append((D["ads"].get(k, {}).get("name", k)[:28], diffs, [round(x, 2) for x in t], [round(x, 2) for x in o]))
    print(f"\n== {p}: {len(keys)} إعلان، فيها فرق: {len(bad)}  (الفترة {start} → {end})")
    for b in bad[:10]: print("   ", b)

# Meta: ad-level totals for the same window
T, A = E["META_ACCESS_TOKEN"], E["META_AD_ACCOUNT_ID"]
g = lambda p, **q: http(f"https://graph.facebook.com/v23.0/{p}?" + urllib.parse.urlencode({**q, "access_token": T}))
truth, r = {}, g(f"{A}/insights", level="ad", limit=500, time_range=json.dumps({"since": start, "until": end}),
                fields="ad_id,spend,impressions,inline_link_clicks,actions")
while True:
    for x in r["data"]:
        a = {y["action_type"]: int(y["value"]) for y in x.get("actions", [])}
        truth["m" + x["ad_id"]] = [float(x["spend"]), int(x["impressions"]), int(x.get("inline_link_clicks", 0)),
                                   a.get("lead", 0), a.get("onsite_conversion.messaging_conversation_started_7d", 0)]
    if not r.get("paging", {}).get("next"): break
    r = http(r["paging"]["next"])
report("meta", truth, scale=3.75)

# Snap: per-campaign TOTAL with ad breakdown for the same window
tok = http("https://accounts.snapchat.com/login/oauth2/access_token", data=urllib.parse.urlencode({
    "grant_type": "refresh_token", "client_id": E["SNAP_CLIENT_ID"], "client_secret": E["SNAP_CLIENT_SECRET"],
    "refresh_token": E["SNAP_REFRESH_TOKEN"]}).encode())["access_token"]
H = {"Authorization": f"Bearer {tok}"}
sg = lambda p, **q: http(f"https://adsapi.snapchat.com/v1/{p}?" + urllib.parse.urlencode(q), headers=H)
truth = {}
for c in sg(f"adaccounts/{E['SNAP_AD_ACCOUNT_ID']}/campaigns")["campaigns"]:
    st = sg(f"campaigns/{c['campaign']['id']}/stats", granularity="TOTAL", breakdown="ad", fields="spend,impressions,swipes,native_leads",
            start_time=start + "T00:00:00+03:00", end_time=(datetime.strptime(end, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00+03:00"))
    for b in st["total_stats"][0]["total_stat"].get("breakdown_stats", {}).get("ad", []):
        x = b["stats"]
        if x.get("spend") or x.get("impressions"):
            truth["s" + b["id"]] = [x.get("spend", 0) / 1e6, x.get("impressions", 0), x.get("swipes", 0), x.get("native_leads", 0), 0]
report("snap", truth)
