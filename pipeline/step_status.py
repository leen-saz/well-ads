#!/usr/bin/env python3
"""Makes the failure of a non-blocking pipeline step visible (system review 1.2).

refresh.yml runs the TikTok, CRM, suggest, learn, critic and execute steps with continue-on-error, so a failure
never stopped the run and nobody saw it. Now each is wrapped:

    python step_status.py run crm -- python -m crm.fetch      writes {crm: {ok, at}} to step-status.json, keeps the exit code
    python step_status.py merge --steps step-status.json --prev old.json --dash dash.json --out data-status.json

`merge` builds site/data-status.json: the old fields (built_at, crm_present, crm_synced) plus `steps`:
{name: {ok, at, last_ok}}. last_ok survives across runs through the previous data-status.json read back from R2.
Only a step name, true/false and timestamps are recorded: no output, no figures (the repo and its logs are public).
"""
import json, os, subprocess, sys
from datetime import datetime, timezone

STEPS = ("tiktok", "crm", "suggest", "learn", "critic", "execute")
DEFAULT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "step-status.json")


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def record(step, ok, path=DEFAULT_FILE, at=None):
    if step not in STEPS:
        raise ValueError("unknown step")
    data = load(path)
    data[step] = {"ok": bool(ok), "at": at or now()}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def run(step, cmd, path=DEFAULT_FILE):
    """Runs the command with its output untouched, records ok/failed, returns its exit code."""
    code = subprocess.run(cmd).returncode
    record(step, code == 0, path)
    return code


def merge(steps_path, prev_path, dash_path, out_path):
    """The new data-status.json. A step that did not run this time (an earlier step stopped the job) keeps its previous entry."""
    cur, prev = load(steps_path), (load(prev_path).get("steps") or {})
    dash = load(dash_path)
    crm = dash.get("crm") or {}
    out = {"built_at": dash.get("generated_at"), "crm_present": bool(crm), "crm_synced": crm.get("synced"), "steps": {}}
    for name in STEPS:
        old = prev.get(name) if isinstance(prev.get(name), dict) else {}
        c = cur.get(name)
        if isinstance(c, dict) and "ok" in c:
            out["steps"][name] = {"ok": bool(c["ok"]), "at": c.get("at"), "last_ok": c.get("at") if c["ok"] else old.get("last_ok")}
        elif old:
            out["steps"][name] = {"ok": old.get("ok"), "at": old.get("at"), "last_ok": old.get("last_ok"), "skipped": True}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    return out


def main(argv):
    if len(argv) >= 4 and argv[1] == "run" and "--" in argv:
        i = argv.index("--")
        return run(argv[2], argv[i + 1:])
    if len(argv) >= 2 and argv[1] == "merge":
        a = dict(zip(argv[2::2], argv[3::2]))
        merge(a.get("--steps", DEFAULT_FILE), a.get("--prev", ""), a.get("--dash", ""), a.get("--out", "data-status.json"))
        return 0
    print("usage: step_status.py run STEP -- CMD...  |  merge --steps F --prev F --dash F --out F")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
