import { getStore } from "@netlify/blobs";

const REPOS = ["win32-env", "win32-compat", "win32-perf", "dmm-trials", "game-panel", "task-manager", "muse-custom-skills", "vn-games", "hoshi-library", "vn-games-preview"];
const STATUSES = ["未対応", "対応中", "対応済み"];
const KINDS = ["complaint", "proposal", "research"];

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

async function listAllKeys(store, prefix) {
  const keys = [];
  let cursor = undefined;
  do {
    const page = await store.list({ prefix: prefix, cursor: cursor });
    for (const b of page.blobs) keys.push(b.key);
    cursor = page.cursor;
  } while (cursor);
  return keys;
}

export default async (req) => {
  if (req.method === "OPTIONS") return json({}, 204);
  const store = getStore({ name: "board", consistency: "strong" });
  const url = new URL(req.url);
  const seg = url.pathname.split("/").filter(Boolean);
  const postsIdx = seg.indexOf("posts");
  const rest = postsIdx >= 0 ? seg.slice(postsIdx + 1) : [];
  try {
    // GET /posts/:id/file  (attachment download)
    if (req.method === "GET" && rest.length === 2 && rest[1] === "file") {
      const buf = await store.get("files/" + rest[0], { type: "arrayBuffer" });
      if (!buf) return json({ error: "file not found" }, 404);
      const post = await store.get("post-" + rest[0], { type: "json" });
      const name = (post && post.file && post.file.name) || "file";
      const type = (post && post.file && post.file.type) || "application/octet-stream";
      return new Response(buf, {
        status: 200,
        headers: {
          "Content-Type": type,
          "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(name),
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
    // GET /posts  (all posts, no count limit; ?repo= filter optional)
    if (req.method === "GET" && rest.length === 0) {
      const repoFilter = url.searchParams.get("repo");
      const keys = await listAllKeys(store, "post-");
      const posts = [];
      for (const k of keys) {
        const p = await store.get(k, { type: "json" });
        if (p && (!repoFilter || p.repo === repoFilter)) posts.push(p);
      }
      posts.sort((a, b) => b.created_at - a.created_at);
      return json({ posts: posts });
    }
    // POST /posts  (create; no length caps; file attachable as base64)
    if (req.method === "POST" && rest.length === 0) {
      const d = await req.json();
      const repo = (typeof d.repo === "string" && d.repo.trim()) ? d.repo.trim() : "その他";
      const kind = KINDS.includes(d.kind) ? d.kind : "complaint";
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const post = {
        id: id,
        repo: repo,
        kind: kind,
        author: (typeof d.author === "string" && d.author) ? d.author : "anonymous",
        title: typeof d.title === "string" ? d.title : "",
        body: typeof d.body === "string" ? d.body : "",
        status: "未対応",
        created_at: Date.now()
      };
      if (typeof d.file_data === "string" && d.file_data.length > 0) {
        const bin = atob(d.file_data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        await store.set("files/" + id, bytes);
        post.file = {
          name: (typeof d.file_name === "string" && d.file_name) ? d.file_name : "file",
          type: (typeof d.file_type === "string" && d.file_type) ? d.file_type : "application/octet-stream",
          size: bytes.length
        };
      }
      await store.setJSON("post-" + id, post);
      return json({ ok: true, post: post }, 201);
    }
    // POST /posts/:id  (status / repo / kind update)
    if (req.method === "POST" && rest.length === 1) {
      const d = await req.json();
      const post = await store.get("post-" + rest[0], { type: "json" });
      if (!post) return json({ error: "not found" }, 404);
      if (STATUSES.includes(d.status)) post.status = d.status;
      if (typeof d.repo === "string" && d.repo.trim()) post.repo = d.repo.trim();
      if (KINDS.includes(d.kind)) post.kind = d.kind;
      await store.setJSON("post-" + rest[0], post);
      return json({ ok: true, post: post });
    }
    // DELETE /posts/:id  (post + attached file)
    if (req.method === "DELETE" && rest.length === 1) {
      await store.delete("post-" + rest[0]);
      await store.delete("files/" + rest[0]);
      return json({ ok: true });
    }
    return json({ error: "not found", known_repos: REPOS }, 404);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
};
