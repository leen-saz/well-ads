"""Restore test for the encrypted backup (db-restore-test.yml, monthly). Input: the folder the archive unpacks to.

Proves the file is a usable backup: the manifest is there and fresh, every table in supabase/backup.py TABLES has a file that
parses and holds exactly the rows the manifest says, the core tables are not empty, and the migrations came along. Exit 1 on any
problem. The messages carry table names only: the Actions log is public, so no row counts and no values.
A full restore into a scratch Supabase project is the quarterly drill in docs/runbook.md.
"""
import json, os, sys
from datetime import datetime, timedelta, timezone

# A backup with none of these is not a backup of this system
CORE = ("profiles", "companies", "ads", "ad_metrics")
MAX_AGE_DAYS = 9  # weekly backups: one missed week is tolerated, two are not


def tables_expected():
    """TABLES from supabase/backup.py, read as text so this file needs no network or Supabase client."""
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backup.py"), encoding="utf-8").read()
    block = src.split("TABLES = (", 1)[1].split(")", 1)[0]
    return [t.strip().strip('"') for t in block.replace("\n", " ").split(",") if t.strip().strip('"')]


def check(folder, now=None, expected=None):
    now = now or datetime.now(timezone.utc)
    problems = []
    try:
        man = json.load(open(os.path.join(folder, "manifest.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return ["manifest.json: missing or unreadable"]
    try:
        age = now - datetime.fromisoformat(man["taken_at"])
        if age > timedelta(days=MAX_AGE_DAYS):
            problems.append(f"backup is older than {MAX_AGE_DAYS} days")
    except (KeyError, ValueError):
        problems.append("manifest.json: no valid taken_at")
    if man.get("failed"):
        problems.append("tables that failed to dump: " + ", ".join(man["failed"]))
    counts = man.get("tables") or {}
    for t in (expected if expected is not None else tables_expected()) + ["auth_users"]:
        if t not in counts:
            problems.append(f"{t}: not in the manifest"); continue
        try:
            rows = json.load(open(os.path.join(folder, f"{t}.json"), encoding="utf-8"))
        except (OSError, ValueError):
            problems.append(f"{t}: file missing or not valid JSON"); continue
        if not isinstance(rows, list) or len(rows) != counts[t]:
            problems.append(f"{t}: does not match the manifest")
        elif t in CORE and not rows:
            problems.append(f"{t}: empty")
    if not os.path.isdir(os.path.join(folder, "migrations")):
        problems.append("migrations folder is missing")
    return problems


def main():
    problems = check(sys.argv[1] if len(sys.argv) > 1 else "backup")
    print("\n".join(f"restore-test ✗ {p}" for p in problems) if problems else "restore-test ✓ the backup opens and every table matches its manifest")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
