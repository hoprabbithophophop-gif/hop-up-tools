-- 2026-10-05 本番適用済み（Hop「3つとも入れてから公開」。適用は受付係の鍵で実行）。
-- クロスワード: 作った本人が、まだ誰にも遊ばれていない問題を組み直す（Hop 決定 2026-10-05）。
-- 窓口は2つ。どちらも合言葉の sha256 を crossword_owner_keys と照らす（crossword_delete と同じ流儀）。
-- 呼べるのは受付係（秘密の鍵＝service_role）だけ。/api/crossword-owner-get・/api/crossword-update から呼ぶ。
--
-- 1. crossword_owner_read: 合言葉が合えば答え（crossword_answers.answers）を返す。合わなければ null
-- 2. crossword_update: 合言葉が合い、遊ばれた回数が 0 で、隠されていないときだけ、
--    問題の棚（題名・ジャンル・タグ・本文・初めての人向けの印・グループ）と答えの棚を書き換えて true。それ以外は false。
--    p_body は答えを抜いて文字数（length）だけを残した形（受付係 crossword-save が入れる形と同じ）。
--    問題の棚の決まり（題名の長さ・本文の大きさ・タグの数など）は書き換えにも効く。

create function public.crossword_owner_read(p_id text, p_key text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
begin
  if p_key is null or length(p_key) < 32 or length(p_key) > 128 then
    return null;
  end if;
  return (
    select a.answers
      from public.crossword_answers a
      join public.crossword_owner_keys k on k.puzzle_id = a.puzzle_id
     where a.puzzle_id = p_id
       and k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
  );
end $$;

create function public.crossword_update(
  p_id text,
  p_key text,
  p_body jsonb,
  p_answers jsonb,
  p_title text,
  p_genre text,
  p_tags text[],
  p_is_beginner boolean,
  p_group_tags text[]
) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare n int;
begin
  if p_key is null or length(p_key) < 32 or length(p_key) > 128 then
    return false;
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'array' then
    return false;
  end if;
  update public.crossword_puzzles p
     set title = p_title,
         genre = p_genre,
         tags = coalesce(p_tags, '{}'),
         body = p_body,
         is_beginner = coalesce(p_is_beginner, false),
         group_tags = coalesce(p_group_tags, '{}')
    from public.crossword_owner_keys k
   where p.id = p_id and k.puzzle_id = p.id
     and k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
     and p.play_count = 0
     and p.is_hidden = false;
  get diagnostics n = row_count;
  if n = 0 then
    return false;
  end if;
  -- 同じ関数の中なので、答えを書けなければ問題の書き換えもまとめて取り消される
  update public.crossword_answers set answers = p_answers where puzzle_id = p_id;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'crossword_update: answers row missing for %', p_id;
  end if;
  return true;
end $$;

revoke all on function public.crossword_owner_read(text, text) from public, anon, authenticated;
revoke all on function public.crossword_update(text, text, jsonb, jsonb, text, text, text[], boolean, text[]) from public, anon, authenticated;
grant execute on function public.crossword_owner_read(text, text) to service_role;
grant execute on function public.crossword_update(text, text, jsonb, jsonb, text, text, text[], boolean, text[]) to service_role;
