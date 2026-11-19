// complaint-board API — Cloudflare Workers + KV version (2026-11-19 migration from Netlify).
// Storage layout in KV namespace (binding BOARD):
//   "posts:all"   -> JSON array of all posts (single key: quota-light, consistent)
//   "files/<id>"  -> attachment binary for post <id>
//   "import:used" -> "1" once the one-time data import has been finalized
// Endpoints (same contract as the old Netlify function):
//   GET    /posts            -> { posts: [...] }   (?repo= filter optional)
//   POST   /posts            -> 201 { ok, post }   (file attachable as base64 file_data)
//   POST   /posts/:id        -> { ok, post }       ({status} / {repo} / {kind} updates)
//   DELETE /posts/:id        -> { ok: true }       (post + attached file)
//   GET    /posts/:id/file   -> attachment download
//   POST   /import           -> one-time migration import (header x-import-key, self-disables)

const STATUSES = ["未対応", "対応中", "対応済み"];
const KINDS = ["complaint", "proposal", "research"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Import-Key"
};

function json(data, status) {
  const s = status || 200;
  return new Response(s === 204 ? null : JSON.stringify(data), {
    status: s,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS)
  });
}

async function loadPosts(env) {
  const raw = await env.BOARD.get("posts:all");
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

async function savePosts(env, posts) {
  await env.BOARD.put("posts:all", JSON.stringify(posts));
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return json({}, 204);
    const url = new URL(req.url);
    const seg = url.pathname.split("/").filter(Boolean);
    try {
      if (seg.length === 0) return json({ ok: true, service: "complaint-board-api", storage: "cloudflare-kv" });

      // One-time migration import
      if (req.method === "POST" && seg.length === 1 && seg[0] === "import") {
        if (!env.IMPORT_KEY) return json({ error: "import disabled" }, 403);
        if (req.headers.get("x-import-key") !== env.IMPORT_KEY) return json({ error: "bad import key" }, 403);
        const used = await env.BOARD.get("import:used");
        if (used === "1") return json({ error: "import already finalized" }, 410);
        const d = await req.json();
        const incoming = Array.isArray(d.posts) ? d.posts : [];
        const posts = await loadPosts(env);
        const byId = new Map(posts.map((p) => [p.id, p]));
        for (const p of incoming) {
          if (p && typeof p.id === "string" && p.id) byId.set(p.id, p);
        }
        const merged = Array.from(byId.values());
        await savePosts(env, merged);
        if (d.final === true) await env.BOARD.put("import:used", "1");
        return json({ ok: true, imported: incoming.length, total: merged.length, finalized: d.final === true });
      }

      if (seg[0] !== "posts") return json({ error: "not found" }, 404);
      const rest = seg.slice(1);

      // GET /posts/:id/file
      if (req.method === "GET" && rest.length === 2 && rest[1] === "file") {
        const buf = await env.BOARD.get("files/" + rest[0], { type: "arrayBuffer" });
        if (!buf) return json({ error: "file not found" }, 404);
        const posts = await loadPosts(env);
        const post = posts.find((p) => p.id === rest[0]);
        const name = (post && post.file && post.file.name) || "file";
        const type = (post && post.file && post.file.type) || "application/octet-stream";
        return new Response(buf, {
          status: 200,
          headers: Object.assign({
            "Content-Type": type,
            "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(name)
          }, CORS)
        });
      }

      // GET /posts
      if (req.method === "GET" && rest.length === 0) {
        const repoFilter = url.searchParams.get("repo");
        let posts = await loadPosts(env);
        if (repoFilter) posts = posts.filter((p) => p.repo === repoFilter);
        posts.sort((a, b) => b.created_at - a.created_at);
        return json({ posts: posts });
      }

      // POST /posts (create; no length caps; file attachable as base64)
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
          await env.BOARD.put("files/" + id, bytes);
          post.file = {
            name: (typeof d.file_name === "string" && d.file_name) ? d.file_name : "file",
            type: (typeof d.file_type === "string" && d.file_type) ? d.file_type : "application/octet-stream",
            size: bytes.length
          };
        }
        const posts = await loadPosts(env);
        posts.push(post);
        await savePosts(env, posts);
        return json({ ok: true, post: post }, 201);
      }

      // POST /posts/:id (status / repo / kind update)
      if (req.method === "POST" && rest.length === 1) {
        const d = await req.json();
        const posts = await loadPosts(env);
        const post = posts.find((p) => p.id === rest[0]);
        if (!post) return json({ error: "not found" }, 404);
        if (STATUSES.includes(d.status)) post.status = d.status;
        if (typeof d.repo === "string" && d.repo.trim()) post.repo = d.repo.trim();
        if (KINDS.includes(d.kind)) post.kind = d.kind;
        await savePosts(env, posts);
        return json({ ok: true, post: post });
      }

      // DELETE /posts/:id
      if (req.method === "DELETE" && rest.length === 1) {
        const posts = await loadPosts(env);
        await savePosts(env, posts.filter((p) => p.id !== rest[0]));
        await env.BOARD.delete("files/" + rest[0]);
        return json({ ok: true });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  }
};
