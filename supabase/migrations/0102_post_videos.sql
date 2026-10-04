-- Video posts (Oct 2026): one short video on a post, up to 30 seconds.
--
-- The same shape as post photos (0088), so the same rules hold:
--
--   * a private bucket, `post-videos`. Objects are named `<post_id>/<uuid>.<ext>`
--     once posted, so the folder is the authorization key and the existing
--     post_image_post_id() parses it. Before posting they sit under
--     `pending/<member id>/`, which parses to null, so nobody can read them.
--   * a table, post_videos, that only the service role writes. Readers sign
--     the path on read, so a column of URLs never expires on a timer.
--   * reading either is can_view_post(): the post's audience, blocks, and
--     moderation, exactly as for its photos and comments.
--
-- HOW A VIDEO ARRIVES. A phone video is tens of megabytes, more than a
-- Vercel function will take in a request body (about 4.5 MB). So the website
-- hands the phone a signed upload URL for `pending/<uid>/<uuid>.<ext>`
-- (POST /api/app/posts/videos) and the phone uploads straight to Storage.
-- That signed URL is the only way in: there is no insert policy for
-- `authenticated` on this bucket. createPost then moves the file under the
-- post's id and writes the row, as it does for photos.
--
-- LIMITS. 50 MB a file (a 30-second 720p clip from the phone's own
-- compression is far smaller), MP4 or QuickTime only. One video per post;
-- a post has photos or a video, not both (feed-operations.ts).
--
-- Additive only: a new bucket, a new table, a new storage policy. Nothing
-- existing changes.
--
-- Rollback:
--   drop policy if exists "post viewers read post videos" on storage.objects;
--   drop table if exists public.post_videos;
--   delete from storage.buckets where id = 'post-videos';  -- once empty

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-videos',
  'post-videos',
  false,
  52428800,
  array['video/mp4', 'video/quicktime']
)
on conflict (id) do nothing;

create table if not exists public.post_videos (
  id bigint generated always as identity primary key,
  -- One per post.
  post_id bigint not null unique references public.posts (id) on delete cascade,
  path text not null unique check (char_length(path) <= 300),
  -- Up to 30 seconds, with a little slack for how phones round.
  duration_ms integer check (duration_ms between 1 and 31000),
  width integer check (width > 0),
  height integer check (height > 0),
  created_at timestamptz not null default now()
);

alter table public.post_videos enable row level security;
revoke insert, update, delete, truncate, references, trigger on public.post_videos from anon, authenticated;
revoke select on public.post_videos from anon;
grant select on public.post_videos to authenticated;

drop policy if exists "post viewers read post videos" on public.post_videos;
create policy "post viewers read post videos"
  on public.post_videos for select
  to authenticated
  using (public.can_view_post(post_id));

-- The file itself: readable (and so signable) by whoever can see the post.
-- post_image_post_id() reads the leading `<post_id>/` and returns null for
-- anything else (`pending/…`), which can_view_post() answers false.
drop policy if exists "post viewers read post videos" on storage.objects;
create policy "post viewers read post videos"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'post-videos'
    and public.can_view_post(public.post_image_post_id(name))
  );

-- No insert/update/delete policy for `authenticated` on this bucket: the
-- signed upload URL (service role) and createPost's move (service role) are
-- the only writes, as for post-images.
