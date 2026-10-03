-- クロスワード段階2b: 初めての人向けの印・グループ・タイムの棚・シェア画像の置き場

-- 1. 問題の棚に印とグループ。どちらも保存の受付係だけが書く（直接の insert は段階2aで閉じてある）
alter table public.crossword_puzzles
  add column is_beginner boolean not null default false,
  add column group_tags text[] not null default '{}' check (cardinality(group_tags) <= 20);

-- 2. タイムの棚。1つの問題につき、同じ人（端末で作った見分け用の番号の sha256）のベストタイム1つ
create table public.crossword_scores (
  id bigint generated always as identity primary key,
  puzzle_id text not null references public.crossword_puzzles(id) on delete cascade,
  player_hash text not null check (player_hash ~ '^[0-9a-f]{64}$'),
  display_name text not null check (char_length(display_name) between 1 and 20),
  time_seconds integer not null check (time_seconds between 1 and 86400),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (puzzle_id, player_hash)
);
alter table public.crossword_scores enable row level security;

-- 読めるのは、隠されていない記録で、問題も隠されていないものだけ。書き込みは受付係だけ（ポリシーを作らない）
create policy "anyone can read visible scores" on public.crossword_scores
  for select to anon, authenticated
  using (not is_hidden and exists (
    select 1 from public.crossword_puzzles p where p.id = puzzle_id and not p.is_hidden
  ));

-- 3. シェア画像の置き場。誰でも公開の住所で見られる。書けるのは秘密の鍵を持つ受付係だけ（fc-ics と同じ形）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('crossword-ogp', 'crossword-ogp', true, 307200, array['image/png']);
