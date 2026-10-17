-- 題名・曲名の部分一致検索に索引を足す（Hop 決定 2026-10-17）。
-- クロスワードの作る画面の「台帳から動画を探す」（youtube_videos.title の ilike '%語%'）は、
-- 珍しい語だと1万本を全部なめて 0.8 秒、混んでいる時は anon の上限 3 秒に当たって打ち切られていた（2026-10-17 15:00 台に27回）。
-- pg_trgm の3文字断片の索引で、全部なめる形をやめる。日本語でも断片が取れるのは棚で確認済み（show_trgm('初恋サンライズ') が8個）。
-- 表の中身は触らない。索引を作る間（26MB・1秒未満）だけ、その表への書き込みが待たされる。
create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_youtube_videos_title_trgm
  on public.youtube_videos using gin (title extensions.gin_trgm_ops);

create index if not exists idx_video_chapters_song_title_trgm
  on public.video_chapters using gin (song_title extensions.gin_trgm_ops);

comment on index public.idx_youtube_videos_title_trgm is '題名の部分一致（ilike）用。クロスワードの台帳検索と /youtube の検索';
comment on index public.idx_video_chapters_song_title_trgm is '曲名の部分一致（ilike）用。クロスワードの区切り検索';
