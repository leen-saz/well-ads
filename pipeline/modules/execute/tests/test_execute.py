import unittest
from datetime import datetime, timedelta, timezone

from modules.execute.run import execute
from modules.suggest.run import plan

NOW = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)


class FakeMeta:
    def __init__(self, status="ACTIVE", camp=("c1", "Trial camp"), sticks=True, whatsapp=False, siblings=()):
        self.status, self.camp, self.sticks, self.writes = status, camp, sticks, []
        self.group, self.whatsapp, self.siblings = "ACTIVE", whatsapp, list(siblings)

    def ad(self, ad_id):
        return {"status": self.status, "campaign": {"id": self.camp[0], "name": self.camp[1]}, "adset": {"id": "g1"}}

    def adset(self, adset_id):
        return {"status": self.group, "campaign": {"id": self.camp[0], "name": self.camp[1]}}

    def live_ads(self, adset_id):
        return ["123"] + self.siblings

    def set_status(self, obj_id, status):
        if obj_id != "g1" and self.whatsapp:
            raise RuntimeError("Meta 400: Invalid parameter (code 100, subcode 2446880)")
        self.writes.append((obj_id, status))
        if self.sticks:
            if obj_id == "g1":
                self.group = status
            else:
                self.status = status
        return {"success": True}


def approved(level="ad", target_id="123", **kw):
    s = plan({"platform": "meta", "level": level, "target_id": target_id, "kind": "pause", "params": {}, "evidence": {"spend": 80}})
    s.update({"id": 1, "status": "approved", "decided_at": (NOW - timedelta(hours=1)).isoformat(), "critic": {"ok": True}})
    s.update(kw)
    return s


class Execute(unittest.TestCase):
    def test_pauses_inside_canary_and_reads_back(self):
        m = FakeMeta()
        status, r = execute(approved(), m, ["c1"], NOW)
        self.assertEqual((status, r["before"], r["after"]), ("executed", "ACTIVE", "PAUSED"))
        self.assertEqual(m.writes, [("123", "PAUSED")])

    def test_canary_by_campaign_name(self):
        self.assertEqual(execute(approved(), FakeMeta(), ["Trial camp"], NOW)[0], "executed")

    def test_outside_canary_is_left_alone(self):
        m = FakeMeta(camp=("c9", "Other"))
        self.assertEqual(execute(approved(), m, ["c1"], NOW), (None, None))
        self.assertEqual(m.writes, [])

    def test_blocked_without_critic_or_with_changed_digest_or_stale(self):
        for s in (approved(critic={"ok": False}), approved(params={"pct": 50}), approved(decided_at=(NOW - timedelta(hours=49)).isoformat())):
            m = FakeMeta()
            self.assertEqual(execute(s, m, ["c1"], NOW)[0], "failed")
            self.assertEqual(m.writes, [])

    def test_only_meta_ad_pause_or_resume(self):
        for s in (approved(platform="snap"), approved(kind="budget_up"), approved(level="campaign")):
            self.assertEqual(execute(s, FakeMeta(), ["c1"], NOW)[0], "failed")

    def test_already_paused_and_failed_read_back(self):
        self.assertEqual(execute(approved(), FakeMeta(status="PAUSED"), ["c1"], NOW)[0], "failed")
        status, r = execute(approved(), FakeMeta(sticks=False), ["c1"], NOW)
        self.assertEqual((status, r["after"]), ("failed", "ACTIVE"))

    def test_resume_turns_it_back_on(self):
        s = {"id": 2, "platform": "meta", "level": "ad", "target_id": "123", "kind": "resume", "decided_at": NOW.isoformat()}
        m = FakeMeta(status="PAUSED")
        self.assertEqual(execute(s, m, ["c1"], NOW)[0], "executed")
        self.assertEqual(m.writes, [("123", "ACTIVE")])

    def test_adset_level_pause(self):
        m = FakeMeta()
        status, r = execute(approved(level="adset", target_id="g1"), m, ["c1"], NOW)
        self.assertEqual((status, r["after"]), ("executed", "PAUSED"))
        self.assertEqual(m.writes, [("g1", "PAUSED")])

    def test_whatsapp_ad_alone_in_its_adset_pauses_the_adset(self):
        m = FakeMeta(whatsapp=True)
        status, r = execute(approved(), m, ["c1"], NOW)
        self.assertEqual((status, r["after"], r["via_adset"]), ("executed", "PAUSED", "g1"))
        self.assertEqual(m.writes, [("g1", "PAUSED")])

    def test_whatsapp_ad_with_live_siblings_is_left_for_manual(self):
        m = FakeMeta(whatsapp=True, siblings=["456"])
        status, r = execute(approved(), m, ["c1"], NOW)
        self.assertEqual(status, "failed")
        self.assertIn("يدوي", r["error"])
        self.assertEqual(m.writes, [])

    def test_revert_of_adset_pause_resumes_the_adset(self):
        m = FakeMeta()
        m.group = "PAUSED"
        s = {"id": 3, "platform": "meta", "level": "ad", "target_id": "123", "kind": "resume", "params": {"of": 1, "adset": "g1"}, "decided_at": NOW.isoformat()}
        self.assertEqual(execute(s, m, ["c1"], NOW)[0], "executed")
        self.assertEqual(m.writes, [("g1", "ACTIVE")])


if __name__ == "__main__":
    unittest.main()
