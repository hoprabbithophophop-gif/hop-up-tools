-- クロスワード段階2a: 保存は受付係（秘密の鍵）だけ・遊ばれた回数・通報で自動で隠す・本人だけが消せる・全体のブレーキ

-- 1. 遊ばれた回数
alter table public.crossword_puzzles add column play_count integer not null default 0;

-- 2. 誰でも入れられる、を外す（保存は functions/api/crossword-save の受付係だけ）
drop policy "anyone can add visible puzzles" on public.crossword_puzzles;

-- 3. 削除用の合言葉。元に戻せない形（sha256 の16進）だけを置き、誰からも見えない
create table public.crossword_owner_keys (
  puzzle_id text primary key references public.crossword_puzzles(id) on delete cascade,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.crossword_owner_keys enable row level security;

-- 4. 通報。通報した人は接続元を元に戻せない形にした値で見分け、同じ人の2回目は入らない
create table public.crossword_reports (
  id bigint generated always as identity primary key,
  puzzle_id text not null references public.crossword_puzzles(id) on delete cascade,
  reporter_hash text not null check (reporter_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (puzzle_id, reporter_hash)
);
alter table public.crossword_reports enable row level security;

-- 別々の3人分そろったら隠す（Hop 決定 2026-10-03）
create function public.crossword_reports_autohide() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  update public.crossword_puzzles set is_hidden = true
   where id = new.puzzle_id and not is_hidden
     and (select count(*) from public.crossword_reports where puzzle_id = new.puzzle_id) >= 3;
  return new;
end $$;
create trigger crossword_reports_autohide after insert on public.crossword_reports
  for each row execute function public.crossword_reports_autohide();

-- 6. 全体のブレーキ。受付係を全部すり抜けても、1時間に全体で100件【仮】を超える保存は止める
create function public.crossword_puzzles_rate_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare recent int;
begin
  select count(*) into recent from public.crossword_puzzles where created_at > now() - interval '1 hour';
  if recent >= 100 then
    raise exception 'crossword rate limit exceeded' using errcode = '53400';
  end if;
  return new;
end $$;
create trigger crossword_puzzles_rate_guard before insert on public.crossword_puzzles
  for each row execute function public.crossword_puzzles_rate_guard();

-- 5. 小さな窓口3つ
-- 遊ばれた回数を1足すだけ。隠された問題には効かない
create function public.crossword_add_play(p_id text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.crossword_puzzles set play_count = play_count + 1 where id = p_id and not is_hidden;
$$;

-- 隠されているかだけを答える（中身は返さない）
create function public.crossword_is_hidden(p_id text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select is_hidden from public.crossword_puzzles where id = p_id), false);
$$;

-- 合言葉が合ったときだけ消す
create function public.crossword_delete(p_id text, p_key text) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare n int;
begin
  if p_key is null or length(p_key) < 32 or length(p_key) > 128 then
    return false;
  end if;
  delete from public.crossword_puzzles p
   using public.crossword_owner_keys k
   where p.id = p_id and k.puzzle_id = p.id
     and k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.crossword_add_play(text) from public, anon, authenticated;
revoke all on function public.crossword_is_hidden(text) from public, anon, authenticated;
revoke all on function public.crossword_delete(text, text) from public, anon, authenticated;
grant execute on function public.crossword_add_play(text) to anon, authenticated;
grant execute on function public.crossword_is_hidden(text) to anon, authenticated;
grant execute on function public.crossword_delete(text, text) to anon, authenticated;

revoke all on function public.crossword_reports_autohide() from public, anon, authenticated;
revoke all on function public.crossword_puzzles_rate_guard() from public, anon, authenticated;
