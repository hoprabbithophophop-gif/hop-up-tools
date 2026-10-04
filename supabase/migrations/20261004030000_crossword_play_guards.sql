-- ランキングと遊ばれた回数のごまかし対策（Hop 決定 2026-10-04）。
-- counted: その回で遊ばれた回数をもう数えたか（受付係が回ごとに1度だけ数える）
-- too_fast: 人間には無理な速さで解けた回か（解けた時に受付係が付ける。ランキングに載せない）
-- 遊ばれた回数を足す呼び出しは、誰でも使える鍵からは使えなくする（受付係が秘密の鍵で呼ぶ）
alter table public.crossword_plays
  add column counted boolean not null default false,
  add column too_fast boolean not null default false;
revoke execute on function public.crossword_add_play(text) from anon, authenticated;
