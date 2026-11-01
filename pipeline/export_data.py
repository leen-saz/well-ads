#!/usr/bin/env python3
"""Read-only export of data.json from Supabase for the new site (phase 3.2).

The old site's hourly pipeline stays the only writer to Supabase until cutover (phase 7).
This script only reads (ads, ad_metrics, dashboard_state) through supabase_store.load_bundle
and writes data.json, which the workflow uploads to R2. It never calls the ad platforms
and never writes to the database.
"""
import json, os, re, sys

import supabase_store

HERE = os.path.dirname(os.path.abspath(__file__))


def normalize_url(url):
    """Project URL without trailing slashes or a pasted /rest/v1 suffix."""
    return re.sub(r"(/rest/v1)?/*$", "", (url or "").strip())


def export(out_path, transport=None):
    data = supabase_store.load_bundle(transport=transport)
    if not data or not data.get("ads") or not data.get("rows"):
        raise RuntimeError("supabase has no dashboard data (ads/rows empty)")
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
    data = export(out)
    print(f"export: generated_at {data.get('generated_at')} | {len(data['ads'])} ads | "
          f"{len(data['rows'])} rows | {os.path.getsize(out) // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
