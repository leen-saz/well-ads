"""يراقب حركات الميديا باير داخل المنصات نفسها (مو بس في اللوحة)، عشان يتعلّم منها الإيجنت.

قراءة فقط:
- Meta: سجل نشاط الحساب (act_<id>/activities): تغيير ميزانية، إيقاف أو تشغيل، إنشاء حملة، تعديل استهداف...
- Google: change_event (آخر 7 أيام).
- Snap وTikTok ما يعطون سجل نشاط بالـAPI حالياً.
يكتب في platform_activity، والتكرار ينتجاهل (platform + event_id).
"""
import hashlib, json, sys, urllib.parse
from datetime import datetime, timedelta, timezone

from common import env, http
from modules.core.supa import Supa

KEEP_META = ("budget", "status", "create", "bid", "target", "schedule", "creative", "delete", "run_status")


def eid(*parts):
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:24]


def meta_rows(E, since):
    act = E["META_AD_ACCOUNT_ID"]
    url = f"https://graph.facebook.com/v23.0/{act}/activities?" + urllib.parse.urlencode({
        "since": int(since.timestamp()), "limit": 200, "access_token": E["META_ACCESS_TOKEN"],
        "fields": "event_time,event_type,translated_event_type,actor_name,object_id,object_name,object_type,extra_data"})
    out = []
    while url and len(out) < 2000:
        r = http(url)
        for x in r.get("data", []):
            et = x.get("event_type") or ""
            if not any(k in et for k in KEEP_META):
                continue
            try:
                extra = json.loads(x.get("extra_data") or "{}")
            except ValueError:
                extra = {"raw": str(x.get("extra_data"))[:300]}
            out.append({"platform": "meta", "event_id": eid(x.get("event_time"), et, x.get("object_id")), "at": x.get("event_time"),
                        "actor": x.get("actor_name"), "event": et, "object_type": x.get("object_type"), "object_id": str(x.get("object_id") or ""),
                        "object_name": x.get("object_name"), "detail": {"label": x.get("translated_event_type"), **({k: extra[k] for k in ("old_value", "new_value") if k in extra})}})
        url = (r.get("paging") or {}).get("next")
    return out


def google_rows(E, since, now):
    tok = http("https://oauth2.googleapis.com/token", data=urllib.parse.urlencode({
        "client_id": E["GOOGLE_ADS_CLIENT_ID"], "client_secret": E["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": E["GOOGLE_ADS_REFRESH_TOKEN"], "grant_type": "refresh_token"}).encode())["access_token"]
    q = ("SELECT change_event.change_date_time, change_event.user_email, change_event.change_resource_type, "
         "change_event.resource_change_operation, change_event.changed_fields, change_event.campaign "
         f"FROM change_event WHERE change_event.change_date_time >= '{since:%Y-%m-%d %H:%M:%S}' "
         f"AND change_event.change_date_time <= '{now:%Y-%m-%d %H:%M:%S}' LIMIT 1000")
    r = http(f"https://googleads.googleapis.com/v24/customers/{E['GOOGLE_ADS_CUSTOMER_ID']}/googleAds:search",
             data=json.dumps({"query": q}).encode(), method="POST",
             headers={"Authorization": f"Bearer {tok}", "login-customer-id": E["GOOGLE_ADS_LOGIN_CUSTOMER_ID"], "Content-Type": "application/json"})
    out = []
    for x in r.get("results", []):
        c = x.get("changeEvent", {})
        ev = f"{c.get('resourceChangeOperation', '')}_{c.get('changeResourceType', '')}".lower()
        out.append({"platform": "google", "event_id": eid(c.get("changeDateTime"), ev, c.get("campaign"), c.get("changedFields")),
                    "at": c.get("changeDateTime"), "actor": c.get("userEmail"), "event": ev, "object_type": c.get("changeResourceType"),
                    "object_id": c.get("campaign"), "object_name": None, "detail": {"fields": c.get("changedFields")}})
    return out


def main():
    db = Supa.from_env()
    if not db:
        print("observe: بدون Supabase")
        return
    E, now = env(), datetime.now(timezone.utc)
    since = now - timedelta(days=3)
    total = 0
    for name, fn in (("meta", lambda: meta_rows(E, since)), ("google", lambda: google_rows(E, since, now))):
        try:
            rows = fn()
            if rows:
                db.req("/rest/v1/platform_activity?on_conflict=platform,event_id", "POST", rows, "return=minimal,resolution=ignore-duplicates")
            total += len(rows)
            print(f"observe {name}: {len(rows)} حركة")
        except Exception as ex:
            print(f"observe {name}: ما انقرا — {str(ex)[:160]}", file=sys.stderr)
    db.audit("observe_run", target={"events": total})


if __name__ == "__main__":
    main()
