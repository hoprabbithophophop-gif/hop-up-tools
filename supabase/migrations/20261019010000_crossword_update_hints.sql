-- 2026-10-19 本番適用済み（Hop「入れとくれ」。Supabase の MCP 経由で適用。手元の SQL と同じ内容）。
-- クロスワード: 作った本人が、遊ばれた後でもヒントだけを差し替える（Hop 決定 2026-10-19「遊ばれた後でも、本人がヒントだけは差し替えられるように」）。
-- 組み直し（crossword_update）は「遊ばれた回数 0」の時だけで、答えや盤が変わるとランキングの公平さが崩れるため。
-- ヒントは答えに触れないので、その理由に当たらない。既存の crossword_update は変えず、本文だけを書き換える係を1つ足す。
-- 呼べるのは受付係（秘密の鍵＝service_role）だけ。/api/crossword-update-hints から呼ぶ。
-- 受付係は棚にある本文を読み、ヒントの部分だけを入れ替えた本文を p_body に渡す（題名・答え・カギの文はこの係からは変えられない）。
-- 問題の棚の決まり（本文の大きさ 51200 バイト）は書き換えにも効く。

create function public.crossword_update_hints(
  p_id text,
  p_key text,
  p_body jsonb
) returns boolean
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare n int;
begin
  if p_key is null or length(p_key) < 32 or length(p_key) > 128 then
    return false;
  end if;
  if p_body is null or jsonb_typeof(p_body) <> 'object' then
    return false;
  end if;
  update public.crossword_puzzles p
     set body = p_body
    from public.crossword_owner_keys k
   where p.id = p_id and k.puzzle_id = p.id
     and k.key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')
     and p.is_hidden = false;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.crossword_update_hints(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.crossword_update_hints(text, text, jsonb) to service_role;
