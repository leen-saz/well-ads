"""المرحلة B: ينفّذ القرارات اللي وافقت عليها لوحة القرارات. Meta بس، وإيقاف إعلان أو مجموعة إعلانية (وتراجعه).

ما يلمس شي إلا إذا:
- زر الطوارئ طافي، وفيه حملات تجربة (canary) اختارتها لين. القائمة الفاضية = ما ينفّذ شي.
- الاقتراح موافق عليه خلال آخر 48 ساعة، والمراجع قبله، وبصمته ما تغيّرت.
- الإعلان فعلاً في حملة تجربة (نتأكد من Meta نفسها، مو من اسمنا).
بعد كل تعديل يقرا الحالة من Meta ويحفظ إيصال في suggestions.result وسطر في السجل.

إعلانات واتساب: Meta يرفض إيقاف الإعلان نفسه بمفتاح ما عنده صلاحية واتساب (subcode 2446880)،
بس يقبل إيقاف المجموعة. فإذا الإعلان هو الوحيد الشغّال في مجموعته نوقف المجموعة (نفس الأثر)،
وإلا يفشل برسالة واضحة وينفّذه الفريق يدوي.
"""
import json, os, sys, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

from modules.core import enabled
from modules.core.supa import Supa
from modules.suggest.run import digest

GRAPH = "https://graph.facebook.com/v23.0/"
WHATSAPP = "subcode 2446880"
LEVELS = ("ad", "adset")
MAX_PER_RUN = 10
FRESH_HOURS = 48


class Meta:
    def __init__(self, token):
        self.token = token

    def _call(self, path, method="GET", **q):
        q["access_token"] = self.token
        data = urllib.parse.urlencode(q).encode() if method == "POST" else None
        url = GRAPH + path + ("" if data else "?" + urllib.parse.urlencode(q))
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method), timeout=30) as r:
                return json.loads(r.read().decode() or "{}")
        except urllib.error.HTTPError as ex:   # رسالة Meta نفسها (بدون التوكن)
            try:
                e = json.loads(ex.read().decode()).get("error") or {}
            except Exception:
                e = {}
            raise RuntimeError(f"Meta {ex.code}: {e.get('message', '')} (code {e.get('code')}, subcode {e.get('error_subcode')}) {e.get('error_user_msg', '')}".strip()) from None

    def ad(self, ad_id):
        return self._call(ad_id, fields="name,status,effective_status,campaign{id,name},adset{id,name}")

    def adset(self, adset_id):
        return self._call(adset_id, fields="name,status,effective_status,campaign{id,name}")

    def live_ads(self, adset_id):
        ads = self._call(f"{adset_id}/ads", fields="id,status", limit=200).get("data") or []
        return [a["id"] for a in ads if a.get("status") == "ACTIVE"]

    def set_status(self, ad_id, status):
        return self._call(ad_id, "POST", status=status)


def guard(db):
    rows = db.req("/rest/v1/control_settings?platform=eq.global&select=guardrails") or []
    g = (rows[0].get("guardrails") if rows else None) or {}
    return bool(g.get("kill")), [str(c).strip() for c in (g.get("canary") or []) if str(c).strip()]


def why_not(s, now):
    """سبب رفض التنفيذ قبل ما نكلّم Meta، أو None."""
    if s.get("platform") != "meta" or s.get("level") not in LEVELS or s.get("kind") not in ("pause", "resume"):
        return "نوع ما ينفّذ في المرحلة B"
    at = s.get("decided_at")
    if not at or datetime.fromisoformat(at.replace("Z", "+00:00")) < now - timedelta(hours=FRESH_HOURS):
        return "الموافقة أقدم من 48 ساعة"
    if s.get("kind") == "pause":
        if not (s.get("critic") or {}).get("ok"):
            return "المراجع ما قبله"
        if not s.get("digest") or digest(s) != s["digest"]:
            return "بصمة الاقتراح تغيّرت بعد الموافقة"
    return None


def execute(s, meta, canary, now):
    """ينفّذ اقتراح واحد ويرجع (الحالة، الإيصال)."""
    reason = why_not(s, now)
    if reason:
        return "failed", {"error": reason}
    want = "PAUSED" if s["kind"] == "pause" else "ACTIVE"
    # تراجع عن إيقاف نزل على المجموعة: نشغّل المجموعة نفسها
    level, tid = ("adset", (s.get("params") or {}).get("adset")) if (s.get("params") or {}).get("adset") else (s["level"], s["target_id"])
    read = meta.ad if level == "ad" else meta.adset
    node = read(tid)
    camp = node.get("campaign") or {}
    if camp.get("id") not in canary and (camp.get("name") or "") not in canary:
        return None, None   # مو حملة تجربة: يبقى موافق عليه وما يتنفّذ
    before = node.get("status")
    if before == want:
        return "failed", {"error": "أصلاً بهالحالة", "before": before}
    if s["kind"] == "pause" and before != "ACTIVE":
        return "failed", {"error": f"مو شغّال ({before})", "before": before}
    via = None
    try:
        res = meta.set_status(tid, want)
    except RuntimeError as ex:
        if level != "ad" or WHATSAPP not in str(ex):
            raise
        group = (node.get("adset") or {}).get("id")
        if not group or [a for a in meta.live_ads(group) if a != tid]:
            return "failed", {"error": "إعلان واتساب: مفتاح الداشبورد ما عنده صلاحية واتساب، وفي مجموعته إعلانات ثانية شغّالة. نفّذه يدوي من Ads Manager", "before": before}
        via, read = group, meta.adset   # الإعلان الوحيد الشغّال في مجموعته: إيقاف المجموعة نفس الأثر
        res = meta.set_status(group, want)
    after = read(via or tid).get("status")
    receipt = {"before": before, "after": after, "asked": want, "meta": res, "campaign": camp, "at": now.isoformat(), "by": "execute"}
    if via:
        receipt["via_adset"] = via
    if level == "adset" and tid != s["target_id"]:
        receipt["via_adset"] = tid
    return ("executed" if after == want else "failed"), receipt


def main():
    if not enabled("execute"):
        print("execute: مقفل في config/modules.json")
        return
    db, token = Supa.from_env(), (os.environ.get("META_ACCESS_TOKEN") or "").strip()
    if not db or not token:
        print("execute: بدون Supabase أو مفتاح Meta")
        return
    kill, canary = guard(db)
    if kill:
        print("execute: زر الطوارئ شغّال، ما ينفّذ شي")
        return
    if not canary:
        print("execute: ما فيه حملات تجربة، ما ينفّذ شي")
        return
    now = datetime.now(timezone.utc)
    # الباقي (ميزانية، سناب، تيك توك…) يبقى موافق عليه وينفّذه الميديا باير بيده
    rows = db.req("/rest/v1/suggestions?select=*&status=eq.approved&platform=eq.meta&level=in.(ad,adset)&kind=in.(pause,resume)&order=decided_at.asc&limit=50") or []
    meta, done = Meta(token), 0
    for s in rows:
        if done >= MAX_PER_RUN:
            break
        try:
            status, receipt = execute(s, meta, canary, now)
        except Exception as ex:
            status, receipt = "failed", {"error": str(ex)[:300], "at": now.isoformat()}
        if not status:
            continue
        db.req(f"/rest/v1/suggestions?id=eq.{s['id']}&status=eq.approved", "PATCH", {"status": status, "result": receipt}, "return=minimal")
        db.audit(f"execute_{status}", target={"id": s["id"], "platform": "meta", "kind": s["kind"], "level": s["level"], "via_adset": receipt.get("via_adset"), "target_id": s["target_id"], "target_name": s.get("target_name")},
                 before={"status": receipt.get("before")}, after={"status": receipt.get("after")}, note=receipt.get("error"))
        done += 1
        print(f"execute: #{s['id']} {s['kind']} {s.get('target_name')} ← {status}")
    print(f"execute: {done} قرار من {len(rows)} موافق عليه (حملات التجربة: {len(canary)})")


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        print("execute: ما اشتغل —", str(ex)[:200], file=sys.stderr)
