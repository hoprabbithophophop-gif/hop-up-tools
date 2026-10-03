-- ランキングの名前の通報（Hop 決定 2026-10-04）。問題の通報（crossword_reports）と同じく、別々の3人分そろったら自動で隠す。
-- 書くのは受付係（/api/crossword-report-name）だけ。RLS を有効にしてポリシーを作らない
create table public.crossword_score_reports (
  id bigint generated always as identity primary key,
  score_id bigint not null references public.crossword_scores(id) on delete cascade,
  reporter_hash text not null check (reporter_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (score_id, reporter_hash)
);
alter table public.crossword_score_reports enable row level security;

create function public.crossword_score_reports_autohide() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  update public.crossword_scores set is_hidden = true
   where id = new.score_id and not is_hidden
     and (select count(*) from public.crossword_score_reports where score_id = new.score_id) >= 3;
  return new;
end $$;
create trigger crossword_score_reports_autohide after insert on public.crossword_score_reports
  for each row execute function public.crossword_score_reports_autohide();
revoke all on function public.crossword_score_reports_autohide() from public, anon, authenticated;
