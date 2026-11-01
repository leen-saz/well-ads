#!/usr/bin/env python3
"""Read-only export of data.json from Supabase for the new site (phase 3.2).

The old site's hourly pipeline stays the only writer to Supabase until cutover (phase 7).
This script only reads (ads, ad_metrics, dashboard_state) through supabase_store.load_bundle
and writes data.json plus the cover images (thumbs/), which the workflow uploads to R2. It never calls the ad platforms
and never writes to the database.
"""
import base64, hashlib, json, os, re, sys

import supabase_store
from media import organic_posts

HERE = os.path.dirname(os.path.abspath(__file__))


def normalize_url(url):
    """Project URL without trailing slashes or a pasted /rest/v1 suffix."""
    return re.sub(r"(/rest/v1)?/*$", "", (url or "").strip())


_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}


def externalize(item, thumbs_dir):
    """Same rule as build.py: an inline data:image thumb becomes /thumbs/<sha1[:20]>.<ext>."""
    t = item.get("thumb") if isinstance(item, dict) else None
    if not (isinstance(t, str) and t.startswith("data:image") and "," in t):
        return
    head, b64 = t.split(",", 1)
    try:
        raw = base64.b64decode(b64)
    except Exception:  # noqa: BLE001 - a broken thumb stays inline, as in build.py
        return
    name = hashlib.sha1(raw).hexdigest()[:20] + "." + _EXT.get(head[5:].split(";")[0], "jpg")
    path = os.path.join(thumbs_dir, name)
    if not os.path.exists(path):
        with open(path, "wb") as fh:
            fh.write(raw)
    item["thumb"] = "/thumbs/" + name


def export(out_path, transport=None, thumbs_dir=None):
    data = supabase_store.load_bundle(transport=transport)
    if not data or not data.get("ads") or not data.get("rows"):
        raise RuntimeError("supabase has no dashboard data (ads/rows empty)")
    if thumbs_dir:
        os.makedirs(thumbs_dir, exist_ok=True)
        for ad in data["ads"].values():
            externalize(ad, thumbs_dir)
        for post in organic_posts(data):
            externalize(post, thumbs_dir)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out_path)
    return data


def main():
    if os.environ.get("SUPABASE_URL"):
        os.environ["SUPABASE_URL"] = normalize_url(os.environ["SUPABASE_URL"])
    if not supabase_store.enabled():
        print("export: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing", file=sys.stderr)
        return 1
    out = os.environ.get("DATA_OUT") or os.path.join(HERE, "data.json")
    thumbs = os.environ.get("THUMBS_OUT") or os.path.join(HERE, "thumbs")
    data = export(out, thumbs_dir=thumbs)
    print(f"export: generated_at {data.get('generated_at')} | {len(data['ads'])} ads | "
          f"{len(data['rows'])} rows | {len(os.listdir(thumbs))} thumbs | {os.path.getsize(out) // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
