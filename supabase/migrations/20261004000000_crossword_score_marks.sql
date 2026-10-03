-- クロスワードのランキングに「何文字見たか」と「ミスの回数」を残す（Hop 決定 2026-10-04）。
-- ランキングの印（ノーミス・ノーヒント／ノーヒント／ノーミス・N文字見た／N文字見た）に使う。
-- 書くのはこれまでどおり受付係（/api/crossword-score）だけ。読む決まり（RLS）は変えない。
alter table public.crossword_scores
  add column reveals integer not null default 0 check (reveals between 0 and 1000),
  add column misses integer not null default 0 check (misses between 0 and 10000);
