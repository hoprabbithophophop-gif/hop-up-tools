-- 遊ばれた回数の「同じ回線・同じ問題は24時間に1回」の印（Hop 決定 2026-10-04）。
-- rate_limit_log はサイト全体の片付け（15分ごとに5分より古い物を消す）があるため24時間もたない。クロスワードの回数の印だけをここに置く。
-- ip_hash は接続元・問題・秘密の値を混ぜた sha256（復元できない形）。24時間より古い物は受付係（/api/crossword-play）が片付ける。
-- 書くのは受付係だけ。RLS を有効にしてポリシーを作らない
create table public.crossword_play_counts (
  puzzle_id text not null references public.crossword_puzzles(id) on delete cascade,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (puzzle_id, ip_hash)
);
alter table public.crossword_play_counts enable row level security;
create index crossword_play_counts_created_at_idx on public.crossword_play_counts (created_at);
