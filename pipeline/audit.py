#!/usr/bin/env python3
"""تدقيق: يقارن data.json بإجماليات الحساب من كل منصة يوم بيوم. قراءة فقط."""
import json, sys, urllib.parse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from channels import family_of
from common import env, http
E = env(); D = json.load(open("data.json", encoding="utf-8"))
START, END = D["range"]["start"], D["range"]["end"]
ours = defaultdict(lambda: defaultdict(lambda: [0.0, 0, 0, 0]))   # plat -> date -> [spend, impr, clicks, leads]
for k, d, sp, im, cl, ld, *_ in D["rows"]:
    p = family_of(D["ads"][k].get("platform")) or D["ads"][k].get("platform"); o = ours[p][d]; o[0] += sp; o[1] += im; o[2] += cl; o[3] += ld
def cmp(p, truth, scale=1.0, label=""):
    bad, tot_o, tot_t = [], [0, 0, 0, 0], [0, 0, 0, 0]
    for d in sorted(set(truth) | set(ours[p])):
        if d < START or d > END: continue
        t, o = truth.get(d, [0, 0, 0, 0]), ours[p].get(d, [0, 0, 0, 0])
        o = [o[0] / scale, o[1], o[2], o[3]]
        for i in range(4): tot_o[i] += o[i]; tot_t[i] += t[i]
        if abs(o[0] - t[0]) > 0.05 or o[1] != t[1] or o[3] != t[3]:
            bad.append((d, [round(x, 2) for x in t], [round(x, 2) for x in o]))
    print(f"\n== {p} {label}")
    print(f"   الحساب: صرف {tot_t[0]:.2f} ظهور {tot_t[1]} نقرات {tot_t[2]} ليدز {tot_t[3]}")
    print(f"   الداشبورد: صرف {tot_o[0]:.2f} ظهور {tot_o[1]} نقرات {tot_o[2]} ليدز {tot_o[3]}")
    print(f"   أيام فيها فرق: {len(bad)}")
    for b in bad[:8]: print("   ", b[0], "حساب", b[1], "داشبورد", b[2])

# ---- Meta (account level, USD)
T, A = E["META_ACCESS_TOKEN"], E["META_AD_ACCOUNT_ID"]
g = lambda p, **q: http(f"https://graph.facebook.com/v23.0/{p}?" + urllib.parse.urlencode({**q, "access_token": T}))
acc = g(A, fields="currency,timezone_name,name")
print("Meta account:", acc["currency"], acc["timezone_name"])
truth, types = {}, defaultdict(int)
s = datetime.strptime(START, "%Y-%m-%d")
while s.strftime("%Y-%m-%d") <= END:
    e = min(s + timedelta(days=29), datetime.strptime(END, "%Y-%m-%d"))
    r = g(f"{A}/insights", level="account", time_increment=1, limit=100,
          time_range=json.dumps({"since": s.strftime("%Y-%m-%d"), "until": e.strftime("%Y-%m-%d")}),
          fields="spend,impressions,clicks,inline_link_clicks,actions")
    for x in r["data"]:
        acts = {a["action_type"]: int(a["value"]) for a in x.get("actions", [])}
        for k2, v in acts.items():
            if "lead" in k2: types[k2] += v
        truth[x["date_start"]] = [float(x["spend"]), int(x["impressions"]), int(x["clicks"]), acts.get("lead", 0)]
    s = e + timedelta(days=1)
cmp("meta", truth, scale=3.75, label="(بالدولار)")
print("   أنواع الليد في الحساب (90 يوم):", dict(types))

# ---- Google (customer level)
tok = http("https://oauth2.googleapis.com/token", data=urllib.parse.urlencode({
    "client_id": E["GOOGLE_ADS_CLIENT_ID"], "client_secret": E["GOOGLE_ADS_CLIENT_SECRET"],
    "refresh_token": E["GOOGLE_ADS_REFRESH_TOKEN"], "grant_type": "refresh_token"}).encode())["access_token"]
gq = lambda q: http(f"https://googleads.googleapis.com/v24/customers/{E['GOOGLE_ADS_CUSTOMER_ID']}/googleAds:search",
    data=json.dumps({"query": q}).encode(), method="POST",
    headers={"Authorization": f"Bearer {tok}", "login-customer-id": E["GOOGLE_ADS_LOGIN_CUSTOMER_ID"], "Content-Type": "application/json"}).get("results", [])
truth = {}
for r in gq(f"SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date BETWEEN '{START}' AND '{END}'"):
    m = r["metrics"]; truth[r["segments"]["date"]] = [int(m.get("costMicros", 0)) / 1e6, int(m.get("impressions", 0)), int(m.get("clicks", 0)), round(float(m.get("conversions", 0)))]
cmp("google", truth)
print("   أنواع الحملات:", {r["campaign"]["advertisingChannelType"] for r in gq(f"SELECT campaign.advertising_channel_type FROM campaign WHERE segments.date BETWEEN '{START}' AND '{END}' AND metrics.impressions > 0")})

# ---- Snap
tok = http("https://accounts.snapchat.com/login/oauth2/access_token", data=urllib.parse.urlencode({
    "grant_type": "refresh_token", "client_id": E["SNAP_CLIENT_ID"], "client_secret": E["SNAP_CLIENT_SECRET"],
    "refresh_token": E["SNAP_REFRESH_TOKEN"]}).encode())["access_token"]
H = {"Authorization": f"Bearer {tok}"}
sg = lambda p, **q: http(f"https://adsapi.snapchat.com/v1/{p}" + ("?" + urllib.parse.urlencode(q) if q else ""), headers=H)
SA = E["SNAP_AD_ACCOUNT_ID"]
aa = sg(f"adaccounts/{SA}")["adaccounts"][0]["adaccount"]
print("\nSnap account:", aa.get("currency"), aa.get("timezone"))
truth = defaultdict(lambda: [0.0, 0, 0, 0])
camps = sg(f"adaccounts/{SA}/campaigns")["campaigns"]
errs = 0
for c in camps:
    cid = c["campaign"]["id"]
    s = datetime.strptime(START, "%Y-%m-%d")
    while s.strftime("%Y-%m-%d") <= END:
        e = min(s + timedelta(days=29), datetime.strptime(END, "%Y-%m-%d"))
        try:
            st = sg(f"campaigns/{cid}/stats", granularity="DAY", fields="spend,impressions,swipes,native_leads",
                    start_time=s.strftime("%Y-%m-%dT00:00:00+03:00"), end_time=(e + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00+03:00"))
            for t in st["timeseries_stats"][0]["timeseries_stat"]["timeseries"]:
                x = t["stats"]; o = truth[t["start_time"][:10]]
                o[0] += x.get("spend", 0) / 1e6; o[1] += x.get("impressions", 0); o[2] += x.get("swipes", 0); o[3] += x.get("native_leads", 0)
        except RuntimeError as ex:
            errs += 1; print("   خطأ سناب:", c["campaign"]["name"], s.date(), str(ex)[:160])
        s = e + timedelta(days=1)
cmp("snap", dict(truth), label="(مجموع الحملات بدون تقسيم الإعلانات)")
print("   أخطاء سناب:", errs)
