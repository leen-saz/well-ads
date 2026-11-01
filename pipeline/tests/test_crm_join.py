import os, sys, unittest

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


if __name__ == "__main__":
    unittest.main()
