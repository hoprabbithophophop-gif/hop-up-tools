-- 回の記録の全体ブレーキ（2026-10-04 セキュリティ監査 中-2・本番適用済み）。受付係の接続元ごとの上限（1時間300回）をすり抜けても、
-- 1時間に全体で3000件【仮】を超える回の開始は止める。問題作りの crossword_puzzles_rate_guard と同じ作り。
create function public.crossword_plays_rate_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare recent int;
begin
  select count(*) into recent from public.crossword_plays where started_at > now() - interval '1 hour';
  if recent >= 3000 then
    raise exception 'crossword plays rate limit exceeded' using errcode = '53400';
  end if;
  return new;
end $$;
create trigger crossword_plays_rate_guard before insert on public.crossword_plays
  for each row execute function public.crossword_plays_rate_guard();
