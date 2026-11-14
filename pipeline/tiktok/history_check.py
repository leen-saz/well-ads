#!/usr/bin/env python3
"""Decides whether the merged TikTok history file may replace the stored one in the private bucket.

Usage: python tiktok/history_check.py STORED.json MERGED.json   (exit 0 = save, 1 = do not save)

The old check compared row counts, so a bug that dropped rows could never be undone (the file could not shrink back)
and a same-size corrupt file passed. This one checks the shape and the COVERAGE: the merged file must be valid, must
not start later or end earlier than the stored one, and must not lose more than a small share of its rows.
Messages carry no figures. The stored file may be missing: then any valid merged file is fine.
"""
import json, os, re, sys

DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_LOSS = 0.05     # a merge may drop at most 5% of the stored rows (excluded ads, merged duplicates)


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def coverage(blob):
    days = [r[1] for r in blob["rows"] if isinstance(r, list) and len(r) > 2 and isinstance(r[1], str) and DAY.match(r[1])]
    return (min(days), max(days)) if days else None


def problems(stored, merged):
    errs = []
    if not isinstance(merged, dict) or not isinstance(merged.get("rows"), list) or not isinstance(merged.get("ads"), dict):
        return ["the merged file has no 'rows' list and 'ads' object"]
    bad = [r for r in merged["rows"] if not (isinstance(r, list) and len(r) >= 6 and isinstance(r[0], str)
                                             and isinstance(r[1], str) and DAY.match(r[1]))]
    if bad:
        errs.append("some rows are malformed (expected [ad, day, spend, ...numbers])")
    if not merged["rows"]:
        errs.append("the merged file has no rows")
        return errs
    if not isinstance(stored, dict) or not isinstance(stored.get("rows"), list) or not stored["rows"]:
        return errs
    old, new = coverage(stored), coverage(merged)
    if new is None:
        errs.append("the merged rows have no valid days")
    elif old:
        if new[0] > old[0]:
            errs.append("the merged file starts later than the stored one (history lost)")
        if new[1] < old[1]:
            errs.append("the merged file ends earlier than the stored one")
    if len(merged["rows"]) < len(stored["rows"]) * (1 - MAX_LOSS):
        errs.append("the merged file lost more than 5% of the stored rows")
    return errs


def main(argv):
    if len(argv) < 3:
        print("usage: history_check.py STORED.json MERGED.json")
        return 2
    try:
        merged = load(argv[2])
    except (OSError, ValueError):
        print("TikTok history check: the merged file is missing or not valid JSON, not saved")
        return 1
    try:
        stored = load(argv[1]) if os.path.exists(argv[1]) else None
    except (OSError, ValueError):
        stored = None
    errs = problems(stored, merged)
    for e in errs:
        print(" -", e)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
