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


if __name__ == "__main__":
    unittest.main()
