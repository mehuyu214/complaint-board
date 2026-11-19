#!/usr/bin/env python3
"""Complaint-board daily Markdown backup.

Fetches all posts from the board API and writes a dated Markdown archive
to ~/workspace/complaint-board/backups/board-YYYY-MM-DD.md (JST date).
Each post entry includes id, datetime, author, status, repo, kind, title, body.
"""
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone

SB = "https://thcukgerrikyzkbjgghi.supabase.co"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoY3VrZ2VycmlreXprYmpnZ2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNzEyODgsImV4cCI6MjExMDY0NzI4OH0.v1719bgivQ82rLZNqDhpXZSFJxYNohJBY-1UN9dBocI"
JST = timezone(timedelta(hours=9))
OUT_DIR = os.path.expanduser("~/workspace/complaint-board/backups")


def fetch() -> list:
    posts = []
    offset = 0
    while True:
        url = (f"{SB}/rest/v1/posts?select=id,repo,kind,author,title,body,status,"
               f"created_at,file_name,file_type,file_size&order=created_at.asc"
               f"&limit=1000&offset={offset}")
        out = subprocess.run(
            ["curl", "-s", "--retry", "3", "--max-time", "60", url,
             "-H", f"apikey: {KEY}", "-H", f"Authorization: Bearer {KEY}"],
            capture_output=True, check=True,
        )
        page = json.loads(out.stdout.decode("utf-8"))
        posts.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
    return posts


def main() -> None:
    data = fetch()
    posts = data["posts"] if isinstance(data, dict) else data
    posts.sort(key=lambda p: p.get("created_at", 0))
    now = datetime.now(JST)
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, f"board-{now:%Y-%m-%d}.md")
    lines = [
        f"# 文句ボード バックアップ {now:%Y-%m-%d}",
        "",
        f"- 書き出し日時: {now:%Y-%m-%d %H:%M:%S} JST",
        f"- 投稿総数: {len(posts)}",
        "",
    ]
    for p in posts:
        dt = datetime.fromtimestamp(p["created_at"] / 1000, JST)
        lines += [
            f"## [{p.get('status')}] {p.get('title')}",
            "",
            f"- ID: {p['id']}",
            f"- 日時: {dt:%Y-%m-%d %H:%M:%S} JST",
            f"- 投稿者: {p.get('author')}",
            f"- 状態: {p.get('status')}",
            f"- テーマ(repo): {p.get('repo')}",
            f"- 種別: {p.get('kind')}",
            "",
            str(p.get("body") or ""),
            "",
        ]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"wrote {path} ({len(posts)} posts)")


if __name__ == "__main__":
    main()
