import { getStore } from "@netlify/blobs";

const REPOS = ["win32-env","win32-compat","win32-perf","dmm-trials","game-panel","task-manager","muse-custom-skills","vn-games","hoshi-library","vn-games-preview"];
const STATUSES = ["未対応","対応中","対応済み"];
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
function json(obj, code) { return new Response(JSON.stringify(obj), { status: code || 200, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } }); }

export default async (req) => {
  if (req.method === "OPTIONS") return json({}, 204);
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const tail = parts.slice(3);
  if (tail[0] !== "posts") return json({ error: "not found", usage: "GET /posts | POST /posts | POST /posts/:id {status} | DELETE /posts/:id" }, 404);
  const store = getStore({ name: "board", consistency: "strong" });
  if (req.method === "GET" && tail.length === 1) {
    const repo = url.searchParams.get("repo");
    const { blobs } = await store.list({ prefix: "post:" });
    let posts = [];
    for (const b of blobs) {
      const p = await store.get(b.key, { type: "json" });
      if (p) posts.push(p);
    }
    if (repo) posts = posts.filter(function(p){ return p.repo === repo; });
    posts.sort(function(a, b){ return b.created_at - a.created_at; });
    return json({ posts: posts });
  }
  if (req.method === "POST" && tail.length === 1) {
    let d;
    try { d = await req.json(); } catch (e) { return json({ error: "invalid json" }, 400); }
    const repo = typeof d.repo === "string" ? d.repo.trim() : "";
    if (!repo || repo.length > 80) return json({ error: "repo (target repo name or new topic) required, max 80 chars", known_repos: REPOS }, 400);
    if (!["complaint", "proposal", "research"].includes(d.kind)) return json({ error: "kind must be complaint, proposal or research" }, 400);
    if (!d.title || !d.body) return json({ error: "title and body required" }, 400);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const post = { id: id, repo: repo, kind: d.kind, author: String(d.author || "anonymous").slice(0, 60), title: String(d.title).slice(0, 200), body: String(d.body).slice(0, 4000), status: STATUSES[0], created_at: Date.now() };
    await store.setJSON("post:" + id, post);
    return json({ ok: true, post: post }, 201);
  }
  if (tail.length === 2) {
    const key = "post:" + tail[1];
    const post = await store.get(key, { type: "json" });
    if (!post) return json({ error: "not found" }, 404);
    if (req.method === "DELETE") { await store.delete(key); return json({ ok: true }); }
    if (req.method === "POST") {
      let d;
      try { d = await req.json(); } catch (e) { return json({ error: "invalid json" }, 400); }
      if (!STATUSES.includes(d.status)) return json({ error: "bad status", statuses: STATUSES }, 400);
      post.status = d.status;
      await store.setJSON(key, post);
      return json({ ok: true, post: post });
    }
  }
  return json({ error: "not found" }, 404);
};
