"""تفاصيل المشاهدين لكل إعلان: العمر والجنس، والمنطقة، والجهاز، والمنصة، وساعة المشاهدة.

كل منصة ترجع {key: {"age": [...], "gender": [...], ...}} وكل صف [الفئة، ظهور، نقرات، صرف بالريال، ليدز أو None].
الليدز None يعني المنصة ما تقسمها على الفئات (سناب)، مو صفر.
النافذة آخر 30 يوم لكل الأبعاد، والساعة آخر 7 أيام في سناب وتيك توك. الساعة بتوقيت الرياض.
قوقل يعطي العمر والجنس والمنطقة والساعة على مستوى المجموعة الإعلانية، فتنكتب "lvl": "group".
أي منصة تفشل ما توقف الباقي، والإعلان يحتفظ بآخر تفاصيل انسحبت له.
"""
import json, sys, urllib.parse
from datetime import datetime, timedelta

DAYS, HOUR_DAYS = 30, 7


def _log(msg):
    print(msg, file=sys.stderr, flush=True)


def _add(doc, dim, label, impr, clicks, spend, leads):
    """يجمع صف فئة في البعد. ليدز None تبقى None (ما تنحسب صفر)."""
    if not label and label != 0:
        return
    rows = doc.setdefault(dim, {})
    r = rows.setdefault(str(label), [0, 0, 0.0, None])
    r[0] += int(float(impr or 0)); r[1] += int(float(clicks or 0)); r[2] += float(spend or 0)
    if leads is not None:
        r[3] = (r[3] or 0) + float(leads)


def _finish(docs, lvl="ad"):
    """dict الفئات يصير قوائم مرتبة بالظهور، ويحذف الفئات اللي ما لها ظهور."""
    out = {}
    for key, doc in docs.items():
        d = {}
        for dim, rows in doc.items():
            lst = [[int(lab) if dim == "hour" else lab, r[0], r[1], round(r[2], 2), None if r[3] is None else round(r[3], 2)]
                   for lab, r in rows.items() if r[0] > 0]
            if lst:
                d[dim] = sorted(lst, key=lambda x: x[0] if dim == "hour" else -x[1])
        if d:
            d["lvl"] = lvl
            out[key] = d
    return out


# ---------------- Meta ----------------
def meta(E, get, act, usd_sar, now):
    """get(path, **params) يرجع صفحات insights. act(actions, type) يطلع قيمة الليدز."""
    A = E["META_AD_ACCOUNT_ID"]
    since, until = (now - timedelta(days=DAYS)).strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d")
    dims = {"age,gender": None, "region": "region", "impression_device": "device",
            "publisher_platform": "place", "hourly_stats_aggregated_by_audience_time_zone": "hour"}
    docs = {}
    for bd, dim in dims.items():
        for x in get(f"{A}/insights", level="ad", limit=500, breakdowns=bd,
                     time_range=json.dumps({"since": since, "until": until}),
                     fields="ad_id,impressions,inline_link_clicks,spend,actions"):
            doc = docs.setdefault(x["ad_id"], {})
            vals = (x.get("impressions"), x.get("inline_link_clicks"), float(x.get("spend") or 0) * usd_sar, act(x.get("actions"), "lead"))
            if dim is None:
                _add(doc, "age", x.get("age"), *vals)
                _add(doc, "gender", x.get("gender"), *vals)
            elif dim == "hour":
                _add(doc, "hour", int(str(x.get(bd, "0"))[:2]), *vals)
            else:
                _add(doc, dim, x.get(bd), *vals)
    return _finish(docs)


# ---------------- Snap ----------------
def snap(g, campaign_ids, now):
    """g(path, **params) طلب واجهة سناب. الليدز ما تنقسم على الفئات في سناب، فتطلع None."""
    end = (now + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00+03:00")
    start = (now - timedelta(days=DAYS)).strftime("%Y-%m-%dT00:00:00+03:00")
    hour_start = (now - timedelta(days=HOUR_DAYS - 1)).strftime("%Y-%m-%dT00:00:00+03:00")
    names = {"age": ("age", "age_bucket"), "gender": ("gender", "gender"), "region": ("region", "region"), "os": ("device", "operating_system")}
    docs = {}
    for cid in campaign_ids:
        for rd, (dim, field) in names.items():
            st = g(f"campaigns/{cid}/stats", granularity="TOTAL", breakdown="ad", report_dimension=rd,
                   fields="impressions,swipes,spend", start_time=start, end_time=end)
            for b in st["total_stats"][0]["total_stat"].get("breakdown_stats", {}).get("ad", []):
                doc = docs.setdefault(b["id"], {})
                for x in b.get("dimension_stats", []):
                    label = x.get(field)
                    if dim == "region" and isinstance(label, str) and "/" in label:
                        label = label.split("/", 1)[1]
                    _add(doc, dim, label, x.get("impressions"), x.get("swipes"), (x.get("spend") or 0) / 1e6, None)
        st = g(f"campaigns/{cid}/stats", granularity="HOUR", breakdown="ad", fields="impressions,swipes,spend",
               start_time=hour_start, end_time=end)
        for b in st["timeseries_stats"][0]["timeseries_stat"].get("breakdown_stats", {}).get("ad", []):
            doc = docs.setdefault(b["id"], {})
            for t in b.get("timeseries", []):
                x = t.get("stats", {})
                if x.get("impressions"):
                    h = datetime.fromisoformat(t["start_time"].replace("Z", "+00:00")).astimezone(now.tzinfo).hour
                    _add(doc, "hour", h, x.get("impressions"), x.get("swipes"), (x.get("spend") or 0) / 1e6, None)
    return _finish(docs)


# ---------------- Google ----------------
GOOGLE_AGE = {"AGE_RANGE_18_24": "18-24", "AGE_RANGE_25_34": "25-34", "AGE_RANGE_35_44": "35-44", "AGE_RANGE_45_54": "45-54",
              "AGE_RANGE_55_64": "55-64", "AGE_RANGE_65_UP": "65+", "AGE_RANGE_UNDETERMINED": "unknown"}
GOOGLE_GENDER = {"MALE": "male", "FEMALE": "female", "UNDETERMINED": "unknown"}


def google(q, now):
    """q(query) استعلام GAQL. الجهاز لكل إعلان، والباقي لكل مجموعة ينكتب لكل إعلاناتها."""
    w = f"segments.date BETWEEN '{(now - timedelta(days=DAYS)).strftime('%Y-%m-%d')}' AND '{now.strftime('%Y-%m-%d')}'"
    m = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions"
    val = lambda r: (r["metrics"].get("impressions"), r["metrics"].get("clicks"),
                     float(r["metrics"].get("costMicros") or 0) / 1e6, r["metrics"].get("conversions") or 0)
    ads, groups = {}, {}
    for r in q(f"SELECT ad_group_ad.ad.id, ad_group.id, segments.device, {m} FROM ad_group_ad WHERE {w}"):
        gid, aid = r["adGroup"]["id"], r["adGroupAd"]["ad"]["id"]
        groups.setdefault(gid, set()).add(aid)
        _add(ads.setdefault(aid, {}), "device", r["segments"].get("device", "").lower(), *val(r))
    by_group = {}
    for r in q(f"SELECT ad_group.id, ad_group_criterion.age_range.type, {m} FROM age_range_view WHERE {w}"):
        _add(by_group.setdefault(r["adGroup"]["id"], {}), "age", GOOGLE_AGE.get(r["adGroupCriterion"]["ageRange"]["type"], "unknown"), *val(r))
    for r in q(f"SELECT ad_group.id, ad_group_criterion.gender.type, {m} FROM gender_view WHERE {w}"):
        _add(by_group.setdefault(r["adGroup"]["id"], {}), "gender", GOOGLE_GENDER.get(r["adGroupCriterion"]["gender"]["type"], "unknown"), *val(r))
    for r in q(f"SELECT ad_group.id, segments.hour, {m} FROM ad_group WHERE {w}"):
        _add(by_group.setdefault(r["adGroup"]["id"], {}), "hour", int(r["segments"].get("hour", 0)), *val(r))
    region_rows = q(f"SELECT ad_group.id, segments.geo_target_region, {m} FROM user_location_view WHERE {w}")
    ids = sorted({r["segments"]["geoTargetRegion"] for r in region_rows if r.get("segments", {}).get("geoTargetRegion")})
    names = {}
    for i in range(0, len(ids), 200):
        quoted = ",".join(f"'{x}'" for x in ids[i:i + 200])
        for r in q(f"SELECT geo_target_constant.resource_name, geo_target_constant.name FROM geo_target_constant WHERE geo_target_constant.resource_name IN ({quoted})"):
            names[r["geoTargetConstant"]["resourceName"]] = r["geoTargetConstant"]["name"]
    for r in region_rows:
        rn = r.get("segments", {}).get("geoTargetRegion")
        if rn:
            _add(by_group.setdefault(r["adGroup"]["id"], {}), "region", names.get(rn, "unknown"), *val(r))
    out = _finish(ads)
    group_docs = _finish(by_group, lvl="group")
    for gid, doc in group_docs.items():
        for aid in groups.get(gid, ()):
            own = out.setdefault(aid, {})
            own.update({dim: rows for dim, rows in doc.items() if dim != "lvl"})
            own["lvl"] = "group"   # الجهاز للإعلان نفسه، والباقي للمجموعة
    return out


# ---------------- TikTok ----------------
def tiktok(get, pages, accounts, spend_sar, now):
    """get/pages من tiktok.fetch. accounts [(advertiser_id, currency)]."""
    since, until = (now - timedelta(days=DAYS)).strftime("%Y-%m-%d"), now.strftime("%Y-%m-%d")
    metrics = ["spend", "impressions", "clicks", "conversion"]
    docs = {}
    for aid, currency in accounts:
        val = lambda x: ((x.get("metrics") or {}).get("impressions"), (x.get("metrics") or {}).get("clicks"),
                         spend_sar((x.get("metrics") or {}).get("spend"), currency), (x.get("metrics") or {}).get("conversion") or 0)
        for dim, field in (("age", "age"), ("gender", "gender"), ("place", "platform")):
            for x in pages("report/integrated/get/", {
                    "advertiser_id": aid, "report_type": "AUDIENCE", "data_level": "AUCTION_AD",
                    "dimensions": ["ad_id", field], "metrics": metrics, "start_date": since, "end_date": until}):
                d = x.get("dimensions") or {}
                label = str(d.get(field) or "")
                if dim == "age":
                    label = label.replace("AGE_", "").replace("_", "-").replace("-MORE", "+")
                _add(docs.setdefault(str(d.get("ad_id")), {}), dim, label.lower() if dim != "age" else label, *val(x))
        for back in range(HOUR_DAYS):
            day = (now - timedelta(days=back)).strftime("%Y-%m-%d")
            for x in pages("report/integrated/get/", {
                    "advertiser_id": aid, "report_type": "BASIC", "data_level": "AUCTION_AD",
                    "dimensions": ["ad_id", "stat_time_hour"], "metrics": metrics, "start_date": day, "end_date": day}):
                d = x.get("dimensions") or {}
                h = str(d.get("stat_time_hour") or "")[11:13]
                if h.isdigit():
                    _add(docs.setdefault(str(d.get("ad_id")), {}), "hour", int(h), *val(x))
    return _finish(docs)


def attach(ads, prefix, docs):
    """يحط التفاصيل على كل مفاتيح الإعلان (ميتا يقسم الإعلان الواحد على أكثر من مفتاح حسب المنصة)."""
    got = 0
    for key, ad in ads.items():
        if not key or key[0] != prefix:
            continue
        doc = docs.get(key[1:].split("|", 1)[0])
        if doc:
            ad["aud"] = doc
            got += 1
    return got
