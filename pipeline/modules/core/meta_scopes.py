"""يطبع أسماء صلاحيات مفتاح Meta بس (مثل ads_management) عشان نعرف إذا يقدر يعدّل. ما يطبع المفتاح."""
import json, os, urllib.request

tok = os.environ.get("META_ACCESS_TOKEN", "")
if not tok:
    print("meta scopes: ما فيه مفتاح")
else:
    try:
        with urllib.request.urlopen("https://graph.facebook.com/v23.0/me/permissions?access_token=" + tok, timeout=20) as r:
            perms = [p["permission"] for p in json.load(r).get("data", []) if p.get("status") == "granted"]
        print("meta scopes:", ", ".join(sorted(perms)) or "—")
        print("meta write:", "نعم (ads_management)" if "ads_management" in perms else "لا — المفتاح للقراءة بس")
    except Exception as ex:
        print("meta scopes: ما قدرت أقرأ —", str(ex)[:120].replace(tok, "***"))
