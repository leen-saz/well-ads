"""تاريخ اليوم بتوقيت الرياض (UTC+3 بدون توقيت صيفي). المشغّل يشتغل بـ UTC، فـ date.today() يتأخر يوم بين 00:00 و03:00 بالرياض."""
from datetime import date, datetime, timedelta, timezone

RIYADH = timezone(timedelta(hours=3))


def riyadh_today(now=None):
    return (now or datetime.now(RIYADH)).astimezone(RIYADH).date()
