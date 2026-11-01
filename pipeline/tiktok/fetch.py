#!/usr/bin/env python3
"""يسحب إعلانات تيك توك من Marketing API (Business API v1.3).

الأسرار من البيئة فقط: TIKTOK_ACCESS_TOKEN و TIKTOK_ADVERTISER_IDS (مفصولة بفاصلة).
حساب Spring Rose0406 مستبعد كما في merge.py ولا يُطلب أصلاً.
الصرف يُحوَّل للريال بنفس معامل الدولار المستخدم لميتا. أيام بلا أي رقم لا تُكتب.
إذا غابت الأسرار أو فشل الطلب تُستخدم لقطة فرع tiktok-data، وإن كانت أقدم من البيانات
المحفوظة تبقى المحفوظة. لا يُطبع التوكن.
"""
import json, os, re, sys, time, urllib.parse
from datetime import datetime, timedelta

from tiktok.merge import (
    EXCLUDED_ADVERTISER_IDS, GOAL, STATUS, is_spring_rose_account, is_spring_rose_ad,
    tiktok_live, without_spring_rose,
)

BASE = "https://business-api.tiktok.com/open_api/v1.3/"
# نفس معامل الدولار في fetch_data.py. حساب الريال يبقى كما هو.
USD_SAR = 3.75
RIYADH_TZ = {"Asia/Riyadh", "Asia/Kuwait", "Asia/Qatar", "Asia/Bahrain", "Asia/Aden", "Etc/GMT-3"}
CORE_METRICS = ["spend", "impressions", "clicks", "conversion"]
OPTIONAL_METRICS = [
    "ad_name", "campaign_name", "adgroup_name", "campaign_id",
    "messaging_total_conversation_tiktok_direct_message",
    "messaging_total_conversation_instant_messaging_app",
]
CONV_KEYS = (
    "messaging_total_conversation_tiktok_direct_message",
    "messaging_total_conversation_instant_messaging_app",
)
RATE_CODES = {40100, 40133, 50000, 50002}
AD_FIELDS = [
    "ad_id", "ad_name", "campaign_id", "campaign_name", "adgroup_id", "adgroup_name",
    "operation_status", "secondary_status", "tiktok_item_id", "ad_text", "advertiser_id",
]
REPORT_FILTER = [{"field_name": "ad_status", "filter_type": "IN", "filter_value": '["STATUS_ALL"]'}]


def scrub(msg, token=""):
    """يحذف التوكن من أي رسالة قبل الطباعة أو حفظها في data.json."""
    text = str(msg or "")
    if token:
        text = text.replace(token, "…")
    text = re.sub(r"(?i)(access[-_ ]?token[\"']?\s*[:=]\s*)[^\s,}&]+", r"\1…", text)
    return text[:300]


def parse_advertiser_ids(raw):
    ids = []
    for part in str(raw or "").split(","):
        item = part.strip().strip("\"'")
        if item and item not in ids:
            ids.append(item)
    return ids


def secrets_ready(env):
    env = env or {}
    token = str(env.get("TIKTOK_ACCESS_TOKEN") or "").strip()
    ids = [i for i in parse_advertiser_ids(env.get("TIKTOK_ADVERTISER_IDS")) if not is_spring_rose_account(i, "")]
    return bool(token and ids)


def spend_sar(raw, currency):
    """الصرف بعملة الحساب. الدولار × 3.75، والريال كما هو. غير ذلك يوقف السحب ولا يُخمّن."""
    cur = str(currency or "").strip().upper()
    amount = float(raw or 0)
    if cur == "SAR":
        return round(amount, 2)
    if cur == "USD":
        return round(amount * USD_SAR, 2)
    raise RuntimeError("عملة تيك توك غير مدعومة: " + (cur or "فارغة"))


def file_coverage_end(synced_at, dates):
    """آخر يوم يغطيه ملف الفرع: تاريخ السحب، أو آخر صف إذا كان أحدث."""
    synced = synced_at or ""
    synced_day = synced[:10] if len(synced) >= 10 and synced[4:5] == "-" else ""
    row_end = max((d for d in dates if d), default="")
    end = max(synced_day, row_end)
    return end if len(end) == 10 and end[4] == "-" else ""


def api_coverage_end(window_start, window_end, older_dates, full):
    """نهاية التغطية المتصلة. فجوة قبل النافذة تُبقي النهاية عند آخر يوم قديم حتى لا تُحسب صفراً."""
    if full or not older_dates:
        return window_end
    old_end = max(older_dates)
    day_before = (datetime.strptime(window_start, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    if old_end >= day_before:
        return window_end
    return old_end


def _series_end(rows):
    days = [r[1] for r in rows or [] if r and len(r) > 1 and r[1]]
    return max(days) if days else ""


def _norm_row(row):
    padded = list(row) + [0, 0, 0, 0, 0, 0, 0]
    return padded[:7]


def _tiktok_rows(rows, today_s):
    out = []
    for row in rows or []:
        if not row or not row[0] or str(row[0])[0] != "t":
            continue
        if today_s and row[1] > today_s:
            continue
        out.append(_norm_row(row))
    return out


def _log(msg):
    print(msg, file=sys.stderr, flush=True)


def _get(transport, token, path, params, tries=6):
    query = []
    for key, value in params.items():
        if isinstance(value, (list, dict)):
            value = json.dumps(value, separators=(",", ":"), ensure_ascii=False)
        query.append((key, str(value)))
    url = BASE + path.lstrip("/") + "?" + urllib.parse.urlencode(query)
    wait = 2
    for attempt in range(tries):
        try:
            body = transport(url, headers={"Access-Token": token})
        except Exception as ex:
            limited = "HTTP 429" in str(ex)
            if not limited or attempt == tries - 1:
                raise RuntimeError(scrub(ex, token)) from None
            time.sleep(wait)
            wait = min(wait * 2, 60)
            continue
        if not isinstance(body, dict):
            raise RuntimeError("TikTok: رد غير مفهوم")
        code = body.get("code")
        if code in (0, None):
            return body.get("data") or {}
        message = str(body.get("message") or "")
        if code in RATE_CODES and attempt != tries - 1:
            time.sleep(wait)
            wait = min(wait * 2, 60)
            continue
        raise RuntimeError(scrub(f"TikTok {code}: {message}", token))
    raise RuntimeError("TikTok: انتهت المحاولات")


def _pages(transport, token, path, params):
    page = 1
    while page <= 200:
        data = _get(transport, token, path, {**params, "page": page, "page_size": 1000})
        for item in data.get("list") or []:
            yield item
        total = int((data.get("page_info") or {}).get("total_page") or 1)
        if page >= total:
            return
        page += 1
    raise RuntimeError("TikTok: صفحات أكثر من المتوقع")


def _windows(start, end, size=30):
    """قطع لا تتجاوز 30 يوماً لأن stat_time_day في تيك توك يرفض أطول من ذلك."""
    cursor = start
    while cursor <= end:
        stop = min(cursor + timedelta(days=size - 1), end)
        yield cursor, stop
        cursor = stop + timedelta(days=1)


def _day(value):
    return value.strftime("%Y-%m-%d") if not isinstance(value, str) else value


def _optional_metric_error(ex):
    msg = str(ex).lower()
    if any(flag in msg for flag in ("40105", "access token", "permission", "no permission")):
        return False
    if "metric" in msg:
        return True
    return any(name.lower() in msg for name in OPTIONAL_METRICS)


def _conversations(metrics):
    total, seen = 0.0, False
    for key in CONV_KEYS:
        if key in (metrics or {}) and metrics.get(key) not in (None, ""):
            seen = True
            total += float(metrics.get(key) or 0)
    if not seen:
        return 0
    return int(round(total))


def _describe(item, objectives, camp_on, group_on):
    ad = dict(item)
    cid = str(ad.get("campaign_id") or "")
    gid = str(ad.get("adgroup_id") or "")
    if cid in camp_on:
        ad["campaign_operation_status"] = camp_on[cid]
    if gid in group_on:
        ad["adgroup_operation_status"] = group_on[gid]
    secondary = ad.get("secondary_status") or ""
    live = tiktok_live(ad)
    word = "نشط" if live else STATUS.get(secondary, "متوقف")
    if not live and word == "نشط":
        word = "متوقف"
    item_id = ad.get("tiktok_item_id")
    link = f"https://www.tiktok.com/embed/v2/{item_id}" if item_id else None
    return dict(
        platform="tiktok", family="tiktok",
        name=(ad.get("ad_name") or str(ad.get("ad_id") or "")).strip("‎ "),
        campaign=(ad.get("campaign_name") or "").strip(),
        group=(ad.get("adgroup_name") or "").strip(),
        format="فيديو", status=word, live=bool(live),
        text=(ad.get("ad_text") or "").strip(),
        thumb=None, link=link,
        goal=GOAL.get(objectives.get(cid, ""), "other"),
    )


def pull(env, start, end, transport):
    """يسحب الإعلانات والصفوف داخل [start, end] فقط. يرمي عند الفشل ولا يرجّع أصفاراً."""
    token = str((env or {}).get("TIKTOK_ACCESS_TOKEN") or "").strip()
    ids = [i for i in parse_advertiser_ids((env or {}).get("TIKTOK_ADVERTISER_IDS")) if not is_spring_rose_account(i, "")]
    if not token or not ids:
        raise RuntimeError("أسرار تيك توك غير مكتملة")
    start_s, end_s = _day(start), _day(end)
    info = _get(transport, token, "advertiser/info/", {"advertiser_ids": ids})
    accounts = []
    for account in info.get("list") or []:
        aid = str(account.get("advertiser_id") or "")
        name = account.get("name") or account.get("advertiser_name") or ""
        if is_spring_rose_account(aid, name):
            _log("tiktok: تخطي حساب مستبعد (Spring Rose0406)")
            continue
        if not aid:
            continue
        accounts.append(account)
    if not accounts:
        raise RuntimeError("لا يوجد حساب تيك توك مسموح بعد استبعاد Spring Rose0406")

    ads, rows, names = {}, [], {}
    all_objectives = {}
    skipped = set()
    metrics = list(CORE_METRICS + OPTIONAL_METRICS)
    for account in accounts:
        aid = str(account["advertiser_id"])
        currency = account.get("currency")
        timezone_name = account.get("timezone") or account.get("display_timezone") or ""
        if timezone_name and timezone_name not in RIYADH_TZ:
            _log("tiktok: منطقة الحساب " + str(timezone_name) + " وليست الرياض. اليوم هو يوم الحساب كما ترجعه الواجهة")
        # عملة غير معروفة تُوقف هذا السحب قبل كتابة أي صف.
        spend_sar(0, currency)
        campaigns = list(_pages(transport, token, "campaign/get/", {
            "advertiser_id": aid,
            "filtering": {"primary_status": "STATUS_ALL"},
            "fields": ["campaign_id", "objective_type", "operation_status", "campaign_name"],
        }))
        groups = list(_pages(transport, token, "adgroup/get/", {
            "advertiser_id": aid,
            "filtering": {"primary_status": "STATUS_ALL"},
            "fields": ["adgroup_id", "operation_status"],
        }))
        ad_items = list(_pages(transport, token, "ad/get/", {
            "advertiser_id": aid,
            "filtering": {"primary_status": "STATUS_ALL"},
            "fields": AD_FIELDS,
        }))
        objectives = {str(c.get("campaign_id")): c.get("objective_type") or "" for c in campaigns}
        all_objectives.update(objectives)
        camp_on = {str(c.get("campaign_id")): c.get("operation_status") for c in campaigns}
        group_on = {str(g.get("adgroup_id")): g.get("operation_status") for g in groups}
        for item in ad_items:
            if is_spring_rose_ad(item) or is_spring_rose_account(item.get("advertiser_id"), item.get("advertiser_name")):
                skipped.add(str(item.get("ad_id") or ""))
                continue
            ad_id = str(item.get("ad_id") or "")
            if not ad_id:
                continue
            ads["t" + ad_id] = _describe(item, objectives, camp_on, group_on)

        for win_start, win_end in _windows(start, end, 30):
            report_params = {
                "advertiser_id": aid,
                "service_type": "AUCTION",
                "report_type": "BASIC",
                "data_level": "AUCTION_AD",
                "dimensions": ["ad_id", "stat_time_day"],
                "metrics": metrics,
                "start_date": _day(win_start),
                "end_date": _day(win_end),
                "filtering": REPORT_FILTER,
            }
            try:
                report_rows = list(_pages(transport, token, "report/integrated/get/", report_params))
            except RuntimeError as ex:
                if metrics == CORE_METRICS or not _optional_metric_error(ex):
                    raise
                _log("tiktok: مقاييس الاسم أو المحادثات غير متاحة، نعيد الطلب بالصرف والظهور والنقرات والتحويل")
                metrics = list(CORE_METRICS)
                report_params["metrics"] = metrics
                report_rows = list(_pages(transport, token, "report/integrated/get/", report_params))
            for record in report_rows:
                dims = record.get("dimensions") or {}
                met = record.get("metrics") or {}
                ad_id = str(dims.get("ad_id") or "")
                day = str(dims.get("stat_time_day") or "")[:10]
                if not ad_id or ad_id in skipped or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
                    continue
                if day < start_s or day > end_s:
                    continue
                if is_spring_rose_ad(met):
                    skipped.add(ad_id)
                    ads.pop("t" + ad_id, None)
                    continue
                spend = spend_sar(met.get("spend"), currency)
                impr = int(float(met.get("impressions") or 0))
                clicks = int(float(met.get("clicks") or 0))
                leads = round(float(met.get("conversion") or 0), 2)
                conv = _conversations(met)
                if not (spend or impr or clicks or leads or conv):
                    continue
                remembered = names.setdefault(ad_id, {})
                for key in ("ad_name", "campaign_name", "adgroup_name", "campaign_id"):
                    if met.get(key):
                        remembered[key] = met.get(key)
                rows.append(["t" + ad_id, day, spend, impr, clicks, leads, conv])

    for ad_id, meta in names.items():
        key = "t" + ad_id
        if key in ads or ad_id in skipped or is_spring_rose_ad(meta):
            continue
        cid = str(meta.get("campaign_id") or "")
        ads[key] = dict(
            platform="tiktok", family="tiktok",
            name=(meta.get("ad_name") or "إعلان محذوف").strip("‎ "),
            campaign=(meta.get("campaign_name") or "—").strip() or "—",
            group=(meta.get("adgroup_name") or "—").strip() or "—",
            format="فيديو", status="محذوف", live=False,
            text="", thumb=None, link=None,
            goal=GOAL.get(all_objectives.get(cid, ""), "other"),
        )

    # صفان لنفس الإعلان واليوم (تداخل صفحات) يبقيان آخر قيمة ولا يُجمعان مرتين.
    deduped = {}
    for row in rows:
        if str(row[0])[1:] in skipped:
            continue
        deduped[(row[0], row[1])] = row
    rows = [deduped[k] for k in sorted(deduped)]
    # إعلان بلا تفاصيل يبقى ليُكمَل لاحقاً باسم «إعلان محذوف» إن لم يصل اسمه.
    cleaned = without_spring_rose({"ads": ads, "rows": rows})
    return cleaned["ads"], cleaned["rows"]


def _read_branch(path):
    if not path or not os.path.exists(path):
        return None, ""
    try:
        with open(path, encoding="utf-8") as handle:
            blob = without_spring_rose(json.load(handle))
    except Exception as ex:
        return None, scrub(ex)
    if not isinstance(blob, dict):
        return None, "ملف تيك توك غير مفهوم"
    return blob, ""


def _branch_parts(blob, today_s):
    ads = {}
    for key, ad in (blob.get("ads") or {}).items():
        if not isinstance(ad, dict):
            continue
        ad = dict(ad)
        ad.setdefault("family", "tiktok")
        ad.setdefault("platform", "tiktok")
        ads[key] = ad
    rows = _tiktok_rows(blob.get("rows"), today_s)
    return ads, rows


def _prev_parts(prev, today_s):
    prev = prev or {}
    ads = {}
    for key, ad in (prev.get("ads") or {}).items():
        if key and str(key)[0] == "t" and isinstance(ad, dict):
            ads[key] = ad
    rows = _tiktok_rows(prev.get("rows"), today_s)
    info = (prev.get("platforms") or {}).get("tiktok") or {}
    if not isinstance(info, dict):
        info = {}
    return ads, rows, info


def _file_status(blob, rows):
    synced = blob.get("generated_at") or ""
    status = {"ok": True, "synced_at": synced, "source": "mcp"}
    end = file_coverage_end(synced, [r[1] for r in rows])
    if end:
        status["coverage_end"] = end
    return status


def _stale_status(info, prev, reason):
    info = info or {}
    synced = info.get("synced_at") or ""
    status = {
        "ok": False,
        "error": scrub(reason)[:300],
        "stale_from": info.get("stale_from") or synced or (prev or {}).get("generated_at"),
        "synced_at": synced,
        "source": info.get("source") or "mcp",
    }
    if info.get("coverage_end"):
        status["coverage_end"] = info["coverage_end"]
    elif synced:
        end = file_coverage_end(synced, [])
        if end:
            status["coverage_end"] = end
    return status


def _older_rows(rows, start_s):
    return [r for r in rows if r[1] < start_s]


def assemble(prev, fresh_ads, fresh_rows, recent, start_s, today_s, carry, branch_ads, branch_rows):
    """يبقي الأيام الأقدم من النافذة. داخل النافذة تبقى صفوف الواجهة فقط، واليوم الفارغ لا يُملأ بصفر."""
    ads = {}
    if recent:
        carried = carry((prev or {}).get("ads") or {}, fresh_ads) if carry else {}
        for key, ad in (carried or {}).items():
            if key and str(key)[0] == "t" and key not in fresh_ads and isinstance(ad, dict):
                ads[key] = ad
    for key, ad in (fresh_ads or {}).items():
        if isinstance(ad, dict):
            ad.setdefault("family", "tiktok")
            ad.setdefault("platform", "tiktok")
        ads[key] = ad
    for ad in ads.values():
        if isinstance(ad, dict):
            ad.setdefault("family", "tiktok")
    if recent:
        prev_rows = _tiktok_rows((prev or {}).get("rows"), today_s)
        older = _older_rows(prev_rows, start_s)
        if not older:
            older = _older_rows(branch_rows or [], start_s)
            for row in older:
                key = row[0]
                ad = (branch_ads or {}).get(key)
                if key not in ads and isinstance(ad, dict):
                    ads[key] = ad
    else:
        older = []
    fresh = [r for r in fresh_rows or [] if r[1] <= today_s]
    combined = {}
    for row in older + fresh:
        combined[(row[0], row[1])] = row
    rows = [combined[k] for k in sorted(combined)]
    cleaned = without_spring_rose({"ads": ads, "rows": rows})
    return cleaned["ads"], cleaned["rows"]


def ingest_tiktok(env, prev, recent, start, end, today_s, path, transport, now, carry):
    """يرجع ads و rows و status و organic_blob و pending.

    pending=True يعني تبقى جملة «بيانات تيك توك غير متوفرة».
    """
    env = env or {}
    token = str(env.get("TIKTOK_ACCESS_TOKEN") or "").strip()
    branch, branch_err = _read_branch(path)
    organic = branch
    branch_ads, branch_rows = _branch_parts(branch, today_s) if branch else ({}, [])
    start_s = _day(start)
    end_s = _day(end)
    attempted = False
    failure = ""

    if secrets_ready(env):
        attempted = True
        try:
            fresh_ads, fresh_rows = pull(env, start, end, transport)
            ads, rows = assemble(
                prev, fresh_ads, fresh_rows, bool(recent), start_s, today_s, carry, branch_ads, branch_rows,
            )
            older_dates = [r[1] for r in rows if r[1] < start_s]
            coverage = api_coverage_end(start_s, end_s, older_dates, not recent)
            status = {
                "ok": True,
                "synced_at": now.isoformat(timespec="minutes"),
                "source": "api",
            }
            if coverage:
                status["coverage_end"] = coverage
            return {"ads": ads, "rows": rows, "status": status, "organic_blob": organic, "pending": False}
        except Exception as ex:
            failure = scrub(ex, token)
            _log("tiktok: فشل السحب من الواجهة — " + failure)
    else:
        _log("tiktok: لا توجد أسرار TIKTOK_ACCESS_TOKEN و TIKTOK_ADVERTISER_IDS، نستخدم فرع tiktok-data إن وُجد")

    prev_ads, prev_rows, prev_info = _prev_parts(prev, today_s)
    if branch and (not attempted or _series_end(branch_rows) >= _series_end(prev_rows)):
        _log("tiktok: نستخدم فرع tiktok-data")
        return {
            "ads": branch_ads, "rows": branch_rows, "status": _file_status(branch, branch_rows),
            "organic_blob": organic, "pending": False,
        }
    if prev_rows or prev_ads:
        if attempted and branch:
            _log("tiktok: فرع tiktok-data أقدم من البيانات السابقة، نبقي السابقة")
        elif branch_err:
            _log("tiktok: تعذر قراءة فرع tiktok-data — " + branch_err)
        else:
            _log("tiktok: فرع tiktok-data غير موجود، نبقي البيانات السابقة")
        reason = failure or branch_err or "بيانات تيك توك غير متوفرة"
        return {
            "ads": prev_ads, "rows": prev_rows,
            "status": _stale_status(prev_info, prev, reason),
            "organic_blob": organic, "pending": False,
        }
    if branch_err or failure:
        return {
            "ads": {}, "rows": [],
            "status": {"ok": False, "error": (failure or branch_err)[:300]},
            "organic_blob": None, "pending": True,
        }
    return {"ads": {}, "rows": [], "status": None, "organic_blob": None, "pending": True}
