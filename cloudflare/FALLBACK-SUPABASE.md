# Fallback plan B: Supabase backend (prepared 2026-11-19, only if Cloudflare login stays blocked)

Why: Supabase signs in with GitHub OAuth (works in the cloud browser), needs no
phone/card, and its anon key + Row Level Security is designed to be embedded in
public frontends. Free project stays awake because the 10-min patrol cron hits it.

## Setup (browser, supabase.com → Continue with GitHub)
1. New project: name `complaint-board`, region Northeast Asia (Tokyo). Let
   Supabase auto-generate the database password (not needed for REST use).
2. SQL Editor → run the schema below.
3. Settings → API: copy the Project URL and the anon public key. Both are
   public-safe by design (RLS guards the data); report them back for wiring.

## Schema
```sql
create table if not exists public.posts (
  id text primary key,
  repo text not null default 'その他',
  kind text not null default 'complaint',
  author text not null default 'anonymous',
  title text not null default '',
  body text not null default '',
  status text not null default '未対応',
  created_at bigint not null,
  file_name text,
  file_type text,
  file_size integer,
  file_data text
);
alter table public.posts enable row level security;
create policy "anon read"   on public.posts for select to anon using (true);
create policy "anon insert" on public.posts for insert to anon with check (true);
create policy "anon update" on public.posts for update to anon using (true) with check (true);
create policy "anon delete" on public.posts for delete to anon using (true);
```

## API mapping (PostgREST, headers: apikey + Authorization: Bearer <anon key>)
- GET    {url}/rest/v1/posts?select=*&order=created_at.desc        (site list + cron fetch)
- POST   {url}/rest/v1/posts  (create; Prefer: return=representation)
- PATCH  {url}/rest/v1/posts?id=eq.<id>  {status|repo|kind}        (cron flip)
- DELETE {url}/rest/v1/posts?id=eq.<id>
- Attachment download: select file_data for the id, decode base64 in the page.

## Wiring changes needed if this plan is used
- index.html: replace the fetch layer with the PostgREST calls above
  (response shape differs: array directly, not {posts:[...]}).
- board-resolve-10min cron body: new base URL + PATCH semantics.
- backup_board.py: GET the REST endpoint with the two headers.
- Import: POST the 469 snapshot rows in batches of 50 from exec with the anon
  key (file_data stays null; the 73 attachment binaries remain Netlify-only
  until Netlify recovers).
