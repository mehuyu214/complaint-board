#!/usr/bin/env python3
"""Import the 2026-11-19 15:13 board snapshot (469 posts) into Supabase PostgREST."""
import json
import subprocess
import sys

SB = "https://thcukgerrikyzkbjgghi.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoY3VrZ2VycmlreXprYmpnZ2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNzEyODgsImV4cCI6MjExMDY0NzI4OH0.v1719bgivQ82rLZNqDhpXZSFJxYNohJBY-1UN9dBocI"
SNAPSHOT = "/home/hatch/workspace/goals/github-complaint-and-proposal-board/hidden_files/posts-20261119-1513.json"
HEADERS = ["-H", f"apikey: {KEY}", "-H", f"Authorization: Bearer {KEY}"]


def to_row(p):
    row = {
        "id": p["id"],
        "repo": p.get("repo") or "その他",
        "kind": p.get("kind") or "complaint",
        "author": p.get("author") or "anonymous",
        "title": p.get("title") or "",
        "body": p.get("body") or "",
        "status": p.get("status") or "未対応",
        "created_at": int(p.get("created_at") or 0),
        "file_name": None,
        "file_type": None,
        "file_size": None,
        "file_data": None,
    }
    f = p.get("file")
    if isinstance(f, dict):
        row["file_name"] = f.get("name")
        row["file_type"] = f.get("type")
        row["file_size"] = f.get("size")
    return row


def main():
    with open(SNAPSHOT) as fh:
        d = json.load(fh)
    if isinstance(d, str):
        d = json.loads(d)
    posts = d["posts"] if isinstance(d, dict) else d
    rows = [to_row(p) for p in posts]
    print(f"importing {len(rows)} rows")
    batch = 10
    for i in range(0, len(rows), batch):
        chunk = rows[i:i + batch]
        payload = json.dumps(chunk, ensure_ascii=False)
        r = subprocess.run(
            ["curl", "-s", "-X", "POST", f"{SB}/rest/v1/posts",
             *HEADERS,
             "-H", "Content-Type: application/json",
             "-H", "Prefer: return=minimal, resolution=merge-duplicates",
             "--data-binary", "@-", "--max-time", "60",
             "-w", "\nHTTP %{http_code}"],
            input=payload, capture_output=True, text=True, timeout=90)
        tail = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "(no output)"
        print(f"batch {i // batch + 1}: rows {i + 1}-{i + len(chunk)} -> {tail}")
        if "HTTP 201" not in r.stdout and "HTTP 200" not in r.stdout:
            print(r.stdout[:2000])
            print(r.stderr[:500], file=sys.stderr)
            sys.exit(1)
    print("import done")


if __name__ == "__main__":
    main()
