-- クロスワードのタイムを「盤を開いていた時間」で測る（Hop 決定 2026-10-07）。
-- 遊んでいる回（crossword_plays）に、開いていた時間の合計・いま開き始めた時刻・最後の生存の合図を持たせる。
-- 書くのは受付係（crossword-play）だけ。既存の行は active_ms = 0 のままで、ランキングの受付係は
-- active_ms が 0 の古い回だけ今まで通り「始めた時刻→解けた時刻」の壁時計で出す。
alter table public.crossword_plays
  add column active_ms bigint not null default 0 check (active_ms >= 0),
  add column resumed_at timestamptz,
  add column seen_at timestamptz;

comment on column public.crossword_plays.active_ms is '盤を開いていた時間の合計（ミリ秒）。受付係の時計で測る';
comment on column public.crossword_plays.resumed_at is 'いま開いているなら、開き始めた時刻。閉じている・解けた後は null';
comment on column public.crossword_plays.seen_at is '開いている間の最後の生存の合図。中断が届かなかった時の打ち切りに使う';
