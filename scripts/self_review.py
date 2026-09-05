#!/usr/bin/env python3
"""IntelliDeck 24h self-review Metrics + auto-tuner.

Safe-guarded:
- Writes only lib/server/topic-corroboration.ts and lib/server/topics-repository.ts
- Bounds all parameter changes to pre-defined safe ranges
- Logs every change to /Users/fong/SynologyDrive/projects/IntelliDeck/data/self_review.log
- Dry-run mode: set DRY_RUN=1 to only report, never write.
"""

import json, re, subprocess, sys, os
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path("/Users/fong/SynologyDrive/projects/IntelliDeck")
LOG = PROJECT / "data" / "self_review.log"
DRY = os.getenv("DRY_RUN") == "1"

SAFE_BOUNDS = {
    "SPECIFIC_DF_CAP": (8, 20),
    "MIN_OVERLAP_IDF": (5.0, 8.0),
    "TOPIC_WINDOW_HOURS": (12, 48),
}

def sh(cmd: str) -> str:
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=PROJECT)
    if p.returncode != 0:
        return ""
    return p.stdout.strip()

def log(msg: str):
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    with open(LOG, "a") as f:
        f.write(line + "\n")
    print(line, file=sys.stderr)

def read_constants():
    corro = (PROJECT / "lib/server/topic-corroboration.ts").read_text()
    topic = (PROJECT / "lib/server/topics-repository.ts").read_text()
    out = {}
    for pat, key in [
        (r"export const SPECIFIC_DF_CAP = (\d+);", "SPECIFIC_DF_CAP"),
        (r"export const MIN_OVERLAP_IDF = ([\d.]+);", "MIN_OVERLAP_IDF"),
        (r"export const TOPIC_WINDOW_HOURS = (\d+);", "TOPIC_WINDOW_HOURS"),
    ]:
        m = re.search(pat, corro if key != "TOPIC_WINDOW_HOURS" else topic)
        if m:
            out[key] = int(m.group(1)) if "." not in m.group(1) else float(m.group(1))
    return out

def write_constant(file_rel: str, key: str, new_val):
    path = PROJECT / file_rel
    txt = path.read_text()
    pat = re.compile(rf"export const {re.escape(key)} = [\w.\-]+;")
    repl = f"export const {key} = {new_val};"
    if not pat.search(txt):
        log(f"SKIP {key}: pattern not found in {file_rel}")
        return False
    new_txt = pat.sub(repl, txt)
    if DRY:
        log(f"DRY-RUN would set {key}={new_val} in {file_rel}")
        return True
    path.write_text(new_txt)
    log(f"SET {key}={new_val} in {file_rel}")
    return True

def sample_dedup(n=300):
    # Use the live endpoint if available.
    raw = sh(f"curl -s --max-time 8 http://localhost:3001/api/admin/dedup-distances?sample={n}")
    if not raw:
        log("METRIC dedup-distances: unavailable (server down?)")
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        log("METRIC dedup-distances: parse error")
        return {}
    dists = [float(x) for x in data.get("distances", []) if x is not None]
    if not dists:
        return {}
    dists.sort()
    def pct(p):
        i = int(len(dists) * p / 100)
        i = min(i, len(dists)-1)
        return dists[i]
    return {
        "count": len(dists),
        "min": dists[0],
        "p10": pct(10),
        "median": pct(50),
        "p90": pct(90),
        "max": dists[-1],
    }

def sample_topics():
    raw = sh("curl -s --max-time 8 http://localhost:3001/api/today")
    if not raw:
        log("METRIC topics: unavailable")
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    items = data.get("priorityItems", [])
    topics = data.get("topics", [])
    return {
        "priority_count": len(items),
        "topic_count": len(topics),
        "top_priority_score": items[0]["priorityScore"] if items else None,
        "top_urgency": items[0].get("urgency") if items else None,
    }

def check_logs():
    # Look for recent worker failure markers in the nohup/PM2/process output we can access.
    # We check the IntelliDeck data log path if present, otherwise skip.
    candidates = [
        PROJECT / "data" / "intellideck.log",
        PROJECT / "data" / "worker.log",
        PROJECT / "logs" / "intellideck.log",
    ]
    for c in candidates:
        if not c.exists():
            continue
        txt = c.read_text(errors="ignore")[-4000:]
        fails = len(re.findall(r"(generation failed|Ollama unavailable|circuit breaker|ECONNREFUSED|Error:|ERROR)", txt))
        return {"log_file": str(c), "recent_fail_count": fails}
    return {}

def decide_tuning(metrics, topics, logs):
    consts = read_constants()
    changes = []
    # Heuristic 1: if median NN distance is very tight, clusters are too aggressive -> raise df cap or overlap threshold
    med = metrics.get("median")
    if med is not None and med < 12.0:
        cap = consts.get("SPECIFIC_DF_CAP", 10)
        if cap > SAFE_BOUNDS["SPECIFIC_DF_CAP"][0]:
            new_cap = max(SAFE_BOUNDS["SPECIFIC_DF_CAP"][0], cap - 2)
            changes.append(("SPECIFIC_DF_CAP", new_cap, "tight NN median -> rarer entities only"))
        idf = consts.get("MIN_OVERLAP_IDF", 6.5)
        if idf < SAFE_BOUNDS["MIN_OVERLAP_IDF"][1]:
            new_idf = min(SAFE_BOUNDS["MIN_OVERLAP_IDF"][1], round(idf + 0.25, 2))
            changes.append(("MIN_OVERLAP_IDF", new_idf, "tight NN median -> stricter overlap"))
    # Heuristic 2: too many topics with tiny scores -> shorten window
    tc = topics.get("topic_count", 0)
    if tc > 80:
        window = consts.get("TOPIC_WINDOW_HOURS", 24)
        if window > SAFE_BOUNDS["TOPIC_WINDOW_HOURS"][0]:
            new_w = max(SAFE_BOUNDS["TOPIC_WINDOW_HOURS"][0], window - 6)
            changes.append(("TOPIC_WINDOW_HOURS", new_w, "topic count high -> shrink window"))
    # Heuristic 3: few priority items for current news volume -> loosen slightly
    pc = topics.get("priority_count", 0)
    if pc == 0:
        cap = consts.get("SPECIFIC_DF_CAP", 10)
        if cap < SAFE_BOUNDS["SPECIFIC_DF_CAP"][1]:
            new_cap = min(SAFE_BOUNDS["SPECIFIC_DF_CAP"][1], cap + 2)
            changes.append(("SPECIFIC_DF_CAP", new_cap, "zero priority items -> slightly looser"))
    return changes

def main():
    log("=== SELF-REVIEW START ===")
    metrics = sample_dedup()
    topics = sample_topics()
    logs = check_logs()

    log(f"METRIC dedup {json.dumps(metrics, ensure_ascii=False)}")
    log(f"METRIC topics {json.dumps(topics, ensure_ascii=False)}")
    log(f"METRIC logs {json.dumps(logs, ensure_ascii=False)}")

    changes = decide_tuning(metrics, topics, logs)
    if not changes:
        log("TUNE no changes warranted")
    for key, new_val, reason in changes:
        file_rel = "lib/server/topic-corroboration.ts" if key in ("SPECIFIC_DF_CAP", "MIN_OVERLAP_IDF") else "lib/server/topics-repository.ts"
        ok = write_constant(file_rel, key, new_val)
        log(f"TUNE {key}={new_val} reason={reason} ok={ok}")
    log("=== SELF-REVIEW END ===")

if __name__ == "__main__":
    main()
