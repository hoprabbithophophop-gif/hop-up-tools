-- クロスワードの問題の棚。1問1行、盤・カギ・ヒントは body にまとめて入れる
create table public.crossword_puzzles (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{8}$'),
  title text not null check (char_length(title) between 1 and 60),
  genre text not null check (genre in ('hello', 'other')),
  tags text[] not null default '{}' check (cardinality(tags) <= 10),
  body jsonb not null check (octet_length(body::text) <= 51200),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.crossword_puzzles enable row level security;

-- 読めるのは隠されていない問題だけ。入れられるのは「隠さない」状態のものだけ。書き換え・削除の窓口は作らない
create policy "anyone can read visible puzzles" on public.crossword_puzzles
  for select to anon, authenticated using (is_hidden = false);

create policy "anyone can add visible puzzles" on public.crossword_puzzles
  for insert to anon, authenticated with check (is_hidden = false);
