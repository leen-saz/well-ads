"""CRM leads → the dashboard: each lead is matched to the ad it came from (same keys as data['ads']).

data['crm'] = {
  'rows': [[ad_key, lead_day, paid_day, paid, paid_sar], ...]   # one per matched lead; days in Riyadh; paid = 1 when paid
  'unmatched': n, 'total': n, 'synced': iso, 'caveats': [...]
}
The dashboard sums them in its date range and filters, next to spend: closings, cost per closing, revenue, ROAS.
"""
import os, sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import supabase_store  # noqa: E402

RIYADH = timezone(timedelta(hours=3))
PREFIX = {"meta_form": "m", "meta_ctwa": "m", "whatsapp_ad_prefill": "m", "snapchat_form": "s", "tiktok_form": "t"}
COLUMNS = "lead_id,customer_id,created_at,platform_created_at,source_platform,ad_id,ad_id_quality,ad_name,status,booked_at,amount_paid_sar,booking_value_sar,paid_at,payment_status"
CAVEATS = ["الاقفالة = ليد دفع، وقيمتها = المبلغ المدفوع", "الدفع من ميسّر بس (تابي والكاش ما يطلعون للحين)",
           "اقفالة بدون إعلان (يدوي، واتساب عضوي…) تنحسب لآخر إعلان جاب نفس العميل خلال 90 يوم قبلها"]
LOOKBACK_DAYS = 90


def day_of(row):
    """The lead's day in Riyadh. Late imports carry the platform's own submit time."""
    ts = row.get("platform_created_at") if row.get("source_platform") == "late_import" else row.get("created_at")
    ts = ts or row.get("created_at")
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(RIYADH).strftime("%Y-%m-%d")


def riyadh_day(ts):
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(RIYADH).strftime("%Y-%m-%d") if ts else ""


def index(ads):
    """ad id → dashboard key, per family prefix; TikTok also by ad name (ids damaged by the CRM import)."""
    by_id, tt_names = {}, {}
    for key, ad in (ads or {}).items():
        if not key:
            continue
        base = key.split("|", 1)[0]
        if key == base:
            by_id[base] = key
        else:
            by_id.setdefault(base, key)
        if key[0] == "t" and isinstance(ad, dict) and ad.get("name"):
            tt_names.setdefault(ad["name"].strip(), key)
    return by_id, tt_names


def match(row, by_id, tt_names):
    prefix = PREFIX.get(row.get("source_platform") or "")
    if not prefix:
        return None
    ad_id = str(row.get("ad_id") or "").strip()
    if ad_id and row.get("ad_id_quality") != "broken_by_import":
        key = by_id.get(prefix + ad_id)
        if key:
            return key
    if prefix == "t" and row.get("ad_name"):
        return tt_names.get(str(row["ad_name"]).strip())
    return None


def stats(leads, matched_ids):
    """Counts for the run log, to compare with the CRM: by source, matched or not, and closings by month."""
    by_src, by_month = {}, {}
    for r in leads:
        src = r.get("source_platform") or "?"
        s = by_src.setdefault(src, [0, 0, 0])  # leads, matched, closings
        s[0] += 1
        s[1] += 1 if r.get("lead_id") in matched_ids else 0
        if is_paid(r):
            s[2] += 1
            m = riyadh_day(r.get("paid_at"))[:7] or "?"
            by_month[m] = by_month.get(m, 0) + 1
    status = {}
    for r in leads:
        status[r.get("status") or "?"] = status.get(r.get("status") or "?", 0) + 1
    return {"by_source": by_src, "closings_by_paid_month": dict(sorted(by_month.items())), "status": status}


def is_paid(r):
    """A closing is a payment (Leen): payment_status paid with an amount."""
    return r.get("payment_status") == "paid" and float(r.get("amount_paid_sar") or 0) > 0


def paid_all(leads):
    """Every paid lead, with or without an ad: [lead_day, paid_day, amount, source], by payment day."""
    out = [[day_of(r), riyadh_day(r.get("paid_at")), float(r["amount_paid_sar"]), r.get("source_platform") or "?"]
           for r in leads if is_paid(r)]
    return sorted(out, key=lambda x: x[1])


def last_days(rows, today, days=30):
    """Closings and amount paid in the last `days` days up to `today` (Riyadh), by payment day."""
    start = (datetime.fromisoformat(today) - timedelta(days=days - 1)).strftime("%Y-%m-%d")
    got = [r for r in rows if r[1] and start <= r[1] <= today]
    return {"from": start, "to": today, "closings": len(got), "paid_sar": round(sum(r[2] for r in got), 2)}


def by_customer(r, ad_leads):
    """The same customer's last ad lead in the LOOKBACK_DAYS before this one (its row), or None.
    In the CRM a customer who came from an ad is often booked on a new manual / organic-WhatsApp lead,
    so the payment loses its ad. customer_id ties the two back together (last ad touch wins)."""
    cid, day = r.get("customer_id"), day_of(r)
    if not cid:
        return None
    start = (datetime.fromisoformat(day) - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%d")
    seen = [x for x in ad_leads.get(cid, []) if start <= x[1] <= day]
    return max(seen, key=lambda x: x[1]) if seen else None


def attach(data, leads):
    by_id, tt_names = index(data.get("ads"))
    out, unmatched, matched_ids, ad_leads, later = [], 0, set(), {}, []
    for r in leads:
        key = match(r, by_id, tt_names)
        if not key:
            unmatched += 1
            if is_paid(r):
                later.append(r)
            continue
        matched_ids.add(r.get("lead_id"))
        # A closing is a payment (Leen): payment_status paid with an amount; its value is the amount paid
        amount = float(r.get("amount_paid_sar") or 0)
        paid = 1 if is_paid(r) else 0
        row = [key, day_of(r), riyadh_day(r.get("paid_at")) if paid else "", paid, amount if paid else 0.0]
        out.append(row)
        if r.get("customer_id"):
            ad_leads.setdefault(r["customer_id"], []).append(row)
    # Paid leads with no ad of their own: credit the customer's last ad lead (the lead stays counted once)
    via_customer = 0
    for r in later:
        row = by_customer(r, ad_leads)
        if not row:
            continue
        via_customer += 1
        amount, paid_day = float(r.get("amount_paid_sar") or 0), riyadh_day(r.get("paid_at"))
        if row[3]:  # that ad lead already paid once: a second payment is its own closing
            out.append([row[0], row[1], paid_day, 1, amount])
        else:
            row[2], row[3], row[4] = paid_day, 1, amount
    data["crm"] = {"rows": out, "paid_all": paid_all(leads), "unmatched": unmatched, "total": len(leads), "stats": stats(leads, matched_ids),
                   "via_customer": via_customer,
                   "synced": datetime.now(RIYADH).isoformat(timespec="minutes"), "caveats": CAVEATS}
    return data["crm"]


def load(transport=None):
    rows, start = [], 0
    while True:
        got = supabase_store._request(
            "GET", f"/rest/v1/crm_leads?select={COLUMNS}&order=lead_id.asc",
            extra_headers={"Range-Unit": "items", "Range": f"{start}-{start + 999}"}, transport=transport) or []
        rows.extend(got)
        if len(got) < 1000:
            return rows
        start += 1000


def attach_from_db(data):
    """Used by build.py. No Supabase or no table yet: the dashboard simply has no CRM block."""
    if not supabase_store.enabled():
        return None
    try:
        crm = attach(data, load())
        print(f"crm: {len(crm['rows'])} leads matched to ads | {crm['unmatched']} without an ad | {crm['via_customer']} paid leads credited to the same customer's ad")
        st = crm["stats"]
        print("crm status:", st["status"])
        print("crm by source [leads, matched to an ad, closings]:", st["by_source"])
        print("crm closings (paid) by payment month:", st["closings_by_paid_month"])
        print("crm last 30 days, all sources, by payment day:", last_days(crm["paid_all"], datetime.now(RIYADH).strftime("%Y-%m-%d")))
        return crm
    except Exception as ex:  # noqa: BLE001 - the dashboard must still build
        print("crm: skipped —", str(ex)[:160])
        return None
