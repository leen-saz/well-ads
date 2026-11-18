import io, os, re, sys, unittest
from contextlib import redirect_stdout

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from crm import join  # noqa: E402

ADS = {"m111|fb": {"name": "A"}, "m111|ig": {"name": "A"}, "s222": {"name": "Snap"}, "t333": {"name": "Doula video v2"}, "m444": {"name": "B"}}


def lead(**kw):
    base = {"lead_id": "L-1", "created_at": "2026-10-21T22:30:00Z", "platform_created_at": None, "source_platform": "meta_form",
            "ad_id": "111", "ad_id_quality": "ok", "ad_name": None, "status": "new", "booked_at": None, "amount_paid_sar": None, "booking_value_sar": None}
    base.update(kw)
    return base


class JoinTests(unittest.TestCase):
    def test_matches_each_platform_and_counts_unmatched(self):
        data = {"ads": ADS}
        crm = join.attach(data, [
            lead(),                                                            # meta → first placement key
            lead(ad_id="444", status="booked", booked_at="2026-10-23T15:30:00Z", amount_paid_sar=500, booking_value_sar=5000,
                 payment_status="paid", paid_at="2026-10-31T22:10:00Z"),
            lead(lead_id="L-9", ad_id="444", status="booked", booked_at="2026-10-23T15:30:00Z", booking_value_sar=800, payment_status="unpaid"),
            lead(source_platform="snapchat_form", ad_id="222"),
            lead(source_platform="tiktok_form", ad_id="1.87649E+15", ad_id_quality="broken_by_import", ad_name="Doula video v2"),
            lead(source_platform="whatsapp_organic", ad_id=None),             # no ad: unmatched
            lead(source_platform="cold_outreach", ad_id="111"),               # not marketing: unmatched
        ])
        keys = [r[0] for r in crm["rows"]]
        self.assertEqual(keys, ["m111|fb", "m444", "m444", "s222", "t333"])
        self.assertEqual(crm["unmatched"], 2)
        self.assertEqual(crm["total"], 7)
        self.assertEqual(crm["rows"][2][2:], ["", 0, 0.0])  # booked but unpaid: not a closing
        self.assertEqual(crm["stats"]["by_source"]["meta_form"][2], 1)
        self.assertEqual(crm["rows"][1][1:], ["2026-10-22", "2026-11-01", 1, 500.0])  # lead day, payment day (Riyadh)
        self.assertIs(data["crm"], crm)

    def test_payment_on_a_new_lead_is_credited_to_the_same_customers_ad(self):
        crm = join.attach({"ads": ADS}, [
            lead(lead_id="A", customer_id="c1", source_platform="snapchat_form", ad_id="222", created_at="2026-10-01T09:00:00Z"),
            lead(lead_id="B", customer_id="c1", source_platform="manual", ad_id=None, created_at="2026-10-20T09:00:00Z",
                 payment_status="paid", amount_paid_sar=900, paid_at="2026-10-21T09:00:00Z"),
            # another customer: paid, but their only ad lead is 120 days older (outside the window)
            lead(lead_id="C", customer_id="c2", source_platform="meta_form", ad_id="444", created_at="2026-06-01T09:00:00Z"),
            lead(lead_id="D", customer_id="c2", source_platform="whatsapp_organic", ad_id=None, created_at="2026-10-01T09:00:00Z",
                 payment_status="paid", amount_paid_sar=300, paid_at="2026-10-02T09:00:00Z"),
        ])
        self.assertEqual(crm["via_customer"], 1)
        snap = [r for r in crm["rows"] if r[0] == "s222"]
        self.assertEqual(snap, [["s222", "2026-10-01", "2026-10-21", 1, 900.0]])   # the ad lead is now a closing, counted once
        self.assertEqual([r for r in crm["rows"] if r[0] == "m444"][0][3], 0)       # too old: not credited

    def test_lead_day_is_riyadh_and_late_imports_use_platform_time(self):
        self.assertEqual(join.day_of(lead(created_at="2026-10-21T22:30:00Z")), "2026-10-22")
        self.assertEqual(join.day_of(lead(source_platform="late_import", created_at="2026-10-30T09:00:00Z",
                                          platform_created_at="2026-10-02T09:00:00Z")), "2026-10-02")

    def test_a_closing_is_a_payment(self):
        crm = join.attach({"ads": ADS}, [lead(status="booked", booking_value_sar=900), lead(payment_status="refunded", amount_paid_sar=300)])
        self.assertEqual([r[3] for r in crm["rows"]], [0, 0])

    def test_paid_all_keeps_leads_without_an_ad_and_sums_the_last_30_days(self):
        crm = join.attach({"ads": ADS}, [
            lead(source_platform="manual", ad_id=None, payment_status="paid", amount_paid_sar=700, paid_at="2026-10-20T10:00:00Z"),
            lead(payment_status="paid", amount_paid_sar=500, paid_at="2026-09-01T10:00:00Z"),
            lead(payment_status="unpaid", amount_paid_sar=0)])
        self.assertEqual([r[3] for r in crm["paid_all"]], ["meta_form", "manual"])
        self.assertEqual(join.last_days(crm["paid_all"], "2026-11-01"),
                         {"from": "2026-10-03", "to": "2026-11-01", "closings": 1, "paid_sar": 700.0})

    def test_the_build_log_has_no_business_figures_by_default(self):
        # The repo and its Actions logs are public: closings, amounts and breakdowns only with PIPELINE_DEBUG=1
        crm = join.attach({"ads": ADS}, [
            lead(ad_id="444", status="booked", payment_status="paid", amount_paid_sar=500, paid_at="2026-10-20T10:00:00Z"),
            lead(lead_id="L-2", source_platform="manual", ad_id=None, payment_status="paid", amount_paid_sar=700, paid_at="2026-10-21T10:00:00Z")])
        def out():
            buf = io.StringIO()
            with redirect_stdout(buf):
                join.report(crm, today="2026-11-01")
            return buf.getvalue()
        os.environ.pop("PIPELINE_DEBUG", None)
        quiet = out()
        self.assertEqual(quiet, "crm: ok, 2 rows\n")
        self.assertNotRegex(quiet, re.compile(r"crm by source.*\d", re.S))
        for figure in ("500", "700", "1200", "paid", "closings"):
            self.assertNotIn(figure, quiet)
        os.environ["PIPELINE_DEBUG"] = "1"
        try:
            loud = out()
        finally:
            del os.environ["PIPELINE_DEBUG"]
        self.assertIn("crm by source", loud)
        self.assertIn("1200", loud)

class AttributionRuleTests(unittest.TestCase):
    """Before: only five exact source names matched, and only TikTok matched by ad name. After: any source that says its
    platform matches by id; any family also matches by an unambiguous ad name; the data explains every unmatched closing."""
    ADS2 = {"m111|fb": {"name": "Hair tonic"}, "m111|ig": {"name": "Hair tonic"}, "m555": {"name": "Shared"}, "m556": {"name": "Shared"},
            "s222": {"name": "Snap"}, "g777": {"name": "Search"}}

    def test_family_of_a_source(self):
        f = join.family
        self.assertEqual([f("meta_form"), f("meta_ctwa"), f("whatsapp_ad_prefill"), f("snapchat_form"), f("tiktok_form")], list("mmmst"))
        # new: sources that name their platform but were not in the old exact list
        self.assertEqual([f("facebook_lead_ads"), f("instagram_form"), f("snapchat_ctwa"), f("tiktok_ctwa"), f("google_form")], list("mmstg"))
        # still nothing: organic, manual and imports, even when they mention a platform
        for src in ("whatsapp_organic", "instagram_dm", "manual", "late_import", "cold_outreach", None, ""):
            self.assertIsNone(f(src), src)

    def test_before_after_matching(self):
        rows = [lead(lead_id="1", source_platform="instagram_form", ad_id="111"),                 # before: unmatched (source name)
                lead(lead_id="2", source_platform="meta_form", ad_id="999", ad_name="Hair tonic"),  # before: unmatched (id not pulled)
                lead(lead_id="3", source_platform="meta_form", ad_id="999", ad_name="Shared"),      # ambiguous name: stays unmatched
                lead(lead_id="4", source_platform="google_form", ad_id="777")]                      # before: unmatched (no google)
        crm = join.attach({"ads": self.ADS2}, rows)
        self.assertEqual([r[0] for r in crm["rows"]], ["m111|fb", "m111|fb", "g777"])
        self.assertEqual(crm["unmatched"], 1)

    def test_every_paid_closing_is_explained(self):
        paid = dict(payment_status="paid", amount_paid_sar=500, paid_at="2026-10-22T09:00:00Z")
        rows = [lead(lead_id="a", ad_id="111", **paid),
                lead(lead_id="b", source_platform="meta_form", ad_id="999", ad_name="Hair tonic", **paid),
                lead(lead_id="c", customer_id="c9", source_platform="snapchat_form", ad_id="222", created_at="2026-10-01T09:00:00Z"),
                lead(lead_id="d", customer_id="c9", source_platform="manual", ad_id=None, **paid),
                lead(lead_id="e", source_platform="whatsapp_organic", ad_id=None, **paid),
                lead(lead_id="f", source_platform="meta_form", ad_id=None, **paid),
                lead(lead_id="g", source_platform="meta_form", ad_id="999", **paid),
                lead(lead_id="h", source_platform="tiktok_form", ad_id="1.8E+15", ad_id_quality="broken_by_import", **paid),
                lead(lead_id="i", source_platform="meta_form", ad_id="111", payment_status="unpaid")]
        att = join.attach({"ads": self.ADS2}, rows)["attribution"]
        self.assertEqual(att["paid"], 7)
        self.assertEqual(att["why"], {"id": 1, "utm": 0, "name": 1, "via_customer": 1, "source": 1, "no_id": 1, "broken_id": 1, "not_in_ads": 1})
        self.assertEqual(att["unmatched_sources"], {"whatsapp_organic": 1})
        self.assertEqual(sum(att["why"].values()), att["paid"])

    def test_attribution_block_has_counts_only(self):
        crm = join.attach({"ads": self.ADS2}, [lead(lead_id="SECRET-ID", customer_id="C-SECRET", ad_name="Private Name", source_platform="odd source!", ad_id=None,
                                              payment_status="paid", amount_paid_sar=123, paid_at="2026-10-22T09:00:00Z")])
        text = str(crm["attribution"])
        for s in ("SECRET", "Private", "123"):
            self.assertNotIn(s, text)
        self.assertEqual(crm["attribution"]["unmatched_sources"], {"oddsource": 1})



class CrmNewFieldsTests(unittest.TestCase):
    """Fields the CRM owner may add (ad id, UTM) work as soon as they arrive, and nothing changes while they are absent."""
    ADS = {"m1202345678901|fb": {"name": "A"}, "s6f3a9c2e-1111": {"name": "S"}, "t1730000000000": {"name": "T"}}

    def test_absent_fields_change_nothing(self):
        before = join.attach({"ads": self.ADS}, [lead(ad_id="1202345678901")])
        self.assertEqual([r[0] for r in before["rows"]], ["m1202345678901|fb"])
        self.assertEqual(before["attribution"]["why"]["utm"], 0)

    def test_a_utm_id_names_the_ad_when_ad_id_is_missing(self):
        paid = dict(payment_status="paid", amount_paid_sar=400, paid_at="2026-10-22T09:00:00Z")
        crm = join.attach({"ads": self.ADS}, [
            lead(lead_id="a", ad_id=None, utm_content="1202345678901", **paid),                                   # Meta lead, id only in utm_content
            lead(lead_id="b", source_platform="whatsapp_organic", ad_id=None, utm_source="snapchat", utm_id="6f3a9c2e-1111"),  # source says nothing, utm_source does
            lead(lead_id="c", ad_id=None, doc_ad_id="999999999999"),                                              # id that is not one of our ads
            lead(lead_id="d", source_platform="manual", ad_id=None, utm_source="", utm_content="1202345678901"),  # no platform anywhere: stays unmatched
        ])
        self.assertEqual([r[0] for r in crm["rows"]], ["m1202345678901|fb", "s6f3a9c2e-1111"])
        self.assertEqual(crm["attribution"]["why"]["utm"], 1)       # only the paid one is counted in the reasons
        self.assertEqual(crm["unmatched"], 2)

    def test_ad_id_still_wins_and_garbage_is_ignored(self):
        crm = join.attach({"ads": self.ADS}, [lead(ad_id="1202345678901", utm_content="t1730000000000"), lead(ad_id=None, utm_content="x y; drop table", utm_id="12")])
        self.assertEqual([r[0] for r in crm["rows"]], ["m1202345678901|fb"])

    def test_the_columns_read_the_new_fields_from_doc_without_a_migration(self):
        for f in ("doc_ad_id:doc->>ad_id", "utm_id:doc->>utm_id", "utm_content:doc->>utm_content", "utm_source:doc->>utm_source"):
            self.assertIn(f, join.COLUMNS)


if __name__ == "__main__":
    unittest.main()


class AmbiguousTikTokNames(unittest.TestCase):
    def test_two_tiktok_ads_with_one_name_get_no_closing_by_name(self):
        ads = {"t901": {"name": "Same name"}, "t902": {"name": "Same name"}, "t903": {"name": "Unique name"}}
        _by_id, names = join.index(ads)
        self.assertNotIn("Same name", names)
        self.assertEqual(names["Unique name"], "t903")
