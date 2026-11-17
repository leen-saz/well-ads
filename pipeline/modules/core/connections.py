"""يقرا مفاتيح المنصات من صفحة الربط (Supabase Vault) ويحطها لباقي خطوات التشغيل.

كل قيمة تنكتب في $GITHUB_ENV باسم V_<الاسم>، والـ workflow يقرا `env.V_X || secrets.X`:
اللي انربط من الصفحة يغلب، وإذا ما فيه يرجع لأسرار GitHub القديمة. القيم تنخفى من السجل قبل أي شي.
"""
import os, re, secrets, sys

from modules.core.supa import Supa

NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")


def lines(rows):
    """سطور $GITHUB_ENV لكل قيمة (القيم متعددة الأسطر بصيغة heredoc)."""
    out = []
    for r in rows:
        name, value = r.get("name") or "", r.get("value") or ""
        if not NAME.match(name) or not value:
            continue
        tag = "EOF_" + secrets.token_hex(8)
        out.append(f"V_{name}<<{tag}\n{value}\n{tag}\n")
    return out


MIN_MASK = 8


def mask_lines(value):
    """What to pass to ::add-mask:: for one secret. A single-line value is masked whole. A multi-line one (a service
    account JSON) is masked line by line, but only the lines long enough to be a secret: masking '{', '}' or '  ],' would
    garble the public log without protecting anything."""
    text = str(value or "")
    if "\n" not in text.strip():
        return [text.strip()] if text.strip() else []
    return [p.strip() for p in text.splitlines() if len(p.strip()) >= MIN_MASK]


def main():
    db = Supa.from_env()
    if not db:
        print("connections: بدون Supabase، السحب يستخدم أسرار GitHub")
        return
    try:
        rows = db.req("/rest/v1/rpc/connector_env", "POST", {}) or []
    except Exception as ex:   # الجدول أو الدوال ما انطبقت بعد: نكمل بأسرار GitHub
        print("connections: ما قدرت أقرا الخزنة —", str(ex)[:120])
        return
    for r in rows:
        for part in mask_lines(r.get("value") or ""):
            print(f"::add-mask::{part}")
    target = os.environ.get("GITHUB_ENV")
    out = lines(rows)
    if target and out:
        with open(target, "a", encoding="utf-8") as f:
            f.writelines(out)
    print(f"connections: {len(out)} قيمة من صفحة الربط: " + ", ".join(sorted(r["name"] for r in rows if r.get("value"))))


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        print("connections: ما اشتغل —", str(ex)[:200], file=sys.stderr)
