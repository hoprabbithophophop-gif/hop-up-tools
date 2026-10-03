-- クロスワードの答えをブラウザに渡さない作り（Hop 決定 2026-10-04）。
-- 1. 答えだけを置く棚。受付係（秘密の鍵）しか読めない（RLS を有効にしてポリシーを作らない）
-- 2. 遊んでいる回の棚。始めた時刻・見たマス・ミス・解けた時刻を受付係だけが書く。同じくポリシー無し
-- 3. 今ある問題の答えを 1 へ移し、誰でも読める問題の棚からは答えを消して文字数だけを残す
--    （移した件数と中身が合うのを確かめてから消す。合わなければ全部取り消す）
create table public.crossword_answers (
  puzzle_id text primary key references public.crossword_puzzles(id) on delete cascade,
  answers jsonb not null check (jsonb_typeof(answers) = 'array')
);
alter table public.crossword_answers enable row level security;

create table public.crossword_plays (
  id uuid primary key default gen_random_uuid(),
  puzzle_id text not null references public.crossword_puzzles(id) on delete cascade,
  started_at timestamptz not null default now(),
  revealed jsonb not null default '[]'::jsonb check (jsonb_typeof(revealed) = 'array'),
  misses integer not null default 0 check (misses between 0 and 10000),
  last_wrong boolean not null default false,
  checks integer not null default 0 check (checks >= 0),
  solved_at timestamptz,
  scored boolean not null default false
);
alter table public.crossword_plays enable row level security;
create index crossword_plays_started_at_idx on public.crossword_plays (started_at);

insert into public.crossword_answers (puzzle_id, answers)
select p.id, (
  select jsonb_agg(c->'answer' order by ord)
  from jsonb_array_elements(p.body->'clues') with ordinality as t(c, ord)
)
from public.crossword_puzzles p;

do $$
declare bad int;
begin
  select count(*) into bad
  from public.crossword_puzzles p
  left join public.crossword_answers a on a.puzzle_id = p.id
  where a.puzzle_id is null
     or jsonb_array_length(a.answers) <> jsonb_array_length(p.body->'clues')
     or exists (
       select 1 from jsonb_array_elements(p.body->'clues') with ordinality as t(c, ord)
       where a.answers->(ord::int - 1) is distinct from c->'answer'
     );
  if bad > 0 then
    raise exception 'answers copy mismatch: % puzzles', bad;
  end if;
end $$;

update public.crossword_puzzles p
set body = jsonb_set(p.body, '{clues}', (
  select jsonb_agg((c - 'answer') || jsonb_build_object('length', jsonb_array_length(c->'answer')) order by ord)
  from jsonb_array_elements(p.body->'clues') with ordinality as t(c, ord)
));
