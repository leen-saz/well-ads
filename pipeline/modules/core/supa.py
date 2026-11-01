"""عميل Supabase بسيط بمفتاح السيرفر. يرجع None إذا المفاتيح غايبة، والموديول يكمل بدون قاعدة."""
import json, os, urllib.request


class Supa:
    def __init__(self, url, key):
        self.url, self.key = url.rstrip("/"), key

    @classmethod
    def from_env(cls):
        url = (os.environ.get("SUPABASE_URL") or "").strip()
        key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
        return cls(url, key) if url and key else None

    def req(self, path, method="GET", body=None, prefer=None):
        h = {"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        if prefer:
            h["Prefer"] = prefer
        r = urllib.request.Request(self.url + path, data=json.dumps(body).encode() if body is not None else None, method=method, headers=h)
        with urllib.request.urlopen(r, timeout=30) as res:
            t = res.read().decode()
            return json.loads(t) if t else None

    def audit(self, action, **fields):
        """سطر في audit_log باسم الموديول (للإضافة بس)."""
        try:
            self.req("/rest/v1/audit_log", "POST", {"email": "system", "action": action, **fields}, "return=minimal")
        except Exception:
            pass
