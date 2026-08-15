-- call-center: 置く画面（PlacePage）の生の叩きを保存する棚。
-- 棚の作成・入館証(GRANT)・カギ(RLS)を1回の適用でまとめる（未施錠の瞬間を作らないため）。
--
-- ※このファイルはまだ適用していません。適用（実行）はオーナー側で行います。

create table public.call_tap_sessions (
  id               uuid primary key default gen_random_uuid(),
  song_id          uuid not null references public.song_structures(id) on delete cascade,
  video_id         text not null check (char_length(video_id) between 5 and 20),
  mark_secs        numeric[] not null check (array_length(mark_secs, 1) between 1 and 5000),
  -- ペンライトの色替えと同じで、！ごとに選んでいた色（メンバー）が違ってよい。
  -- そのため「1回の参加=1メンバー」の列ではなく、mark_secs と同じ長さの並びにする。
  mark_member_ids  text[] not null,
  created_by       text not null default (auth.uid())::text check (char_length(created_by) between 8 and 64),
  created_at       timestamptz not null default now(),
  -- 「i番目の秒」と「i番目に選んでいたメンバー」が対応するので、長さが必ず揃っていること
  constraint call_tap_sessions_marks_len_match
    check (cardinality(mark_secs) = cardinality(mark_member_ids))
);

comment on table public.call_tap_sessions is
  'call-center: 置く画面の生の叩き。1行=1回の参加（1人が1曲を1回通しで叩いたぶん）。
秒はその動画の中の秒（曲の秒ではない。頭出しが未測定の曲があるため）。
created_by は入館証から外して外に見せない。新しい列を足したら GRANT SELECT (新列) ... TO anon, authenticated; を出し直すこと。
video_id に特定IDの名簿型CHECKを付けないこと（ハイ！テンションで名簿更新忘れによる保存全滅の前例あり。長さの縛りだけにする）。';

comment on column public.call_tap_sessions.song_id is
  'どの曲か。song_structures が消えたらこの行も一緒に消える（on delete cascade）。';
comment on column public.call_tap_sessions.video_id is
  'どの動画で叩いたか。長さだけ縛る（IDの名簿は作らない＝新しい動画を足すたびに保存が丸ごと止まる事故を防ぐ）。';
comment on column public.call_tap_sessions.mark_secs is
  '！を叩いた、その動画の中での秒の並び。空では保存できない（＝叩かずに送ることはできない）。上限5000（乱用対策）。';
comment on column public.call_tap_sessions.mark_member_ids is
  'i番目の！を叩いたときのメンバー（/profile と同じメンバー表 src/data/members.ts のID）。ペンライトの色替えと同じで、曲の途中で替えられる。選ばず叩いたぶんは null。mark_secs と必ず同じ長さ。';
comment on column public.call_tap_sessions.created_by is
  '端末ID＝匿名ログインのユーザーID。既定値と書き込みのカギの両方で本人照合しているので、他人を名乗って投稿できない。
なりすまし防止・個人特定防止のため anon/authenticated には非公開（入館証から除外）。';

-- ── 入館証（既定で広く付くので、まず全部剥がしてから出し直す）──
revoke all on public.call_tap_sessions from anon, authenticated;

-- 読み: created_by を除いた列だけ（外から個人を辿れないようにする）
grant select (id, song_id, video_id, mark_secs, mark_member_ids, created_at)
  on public.call_tap_sessions to anon, authenticated;

-- 書き: ログイン済み（匿名ログイン含む）だけが足せる
grant insert on public.call_tap_sessions to authenticated;

grant all on public.call_tap_sessions to service_role;

-- ── カギ（行レベルセキュリティ）────────────────────────
alter table public.call_tap_sessions enable row level security;

create policy "誰でも読める" on public.call_tap_sessions
  for select to anon, authenticated using (true);

-- 本人としてだけ足せる（他人を名乗って投稿できない）
create policy "本人としてだけ足せる" on public.call_tap_sessions
  for insert to authenticated
  with check (created_by = (select auth.uid())::text);

-- UPDATE/DELETEのポリシーは作らない＝一度置いた行は本人でも書き換え・削除できない。
-- （取り下げの仕組みは今回のスコープ外。後日 calls の取り下げ設計に合わせて足す）

-- ── 探すための目印 ─────────────────────────────────────
-- この棚は「曲ごと」に読む・数えるのが基本形なので、その入口に目印を付けておく
create index call_tap_sessions_song_idx on public.call_tap_sessions (song_id);

-- ── 集計の窓口 ─────────────────────────────────────────
-- 個人を特定できる値（created_by）は一切返さない。返すのは3つの数だけ。
--   participants = 参加した人数（同じ人が何度送っても1人と数える）→「あと◯人で目盛りが決まる」の元
--   entries      = 参加の回数（行数）
--   taps_total   = 叩かれた！の総数
create or replace function public.get_song_tap_counts(p_song_id uuid)
returns table(participants integer, entries integer, taps_total integer)
language sql stable security definer set search_path = '' as $$
  select count(distinct created_by)::int          as participants,
         count(*)::int                            as entries,
         coalesce(sum(cardinality(mark_secs)), 0)::int as taps_total
  from public.call_tap_sessions
  where song_id = p_song_id
$$;

grant execute on function public.get_song_tap_counts(uuid) to anon, authenticated;

-- ── 追記（2026-08-15 適用済み）: ！に付けた言葉 ─────────────
-- i番目の！に付けた言葉（付けなかった要素は null）。秒・色の列と必ず同じ長さ。
-- 1語の上限12文字は入力欄側で縛る（配列要素ごとのCHECKはSQLでは書けない）。

alter table public.call_tap_sessions
  add column mark_words text[];

alter table public.call_tap_sessions
  add constraint call_tap_sessions_words_len_match
  check (mark_words is null or cardinality(mark_words) = cardinality(mark_secs));

-- 総量の上限（乱用対策）
alter table public.call_tap_sessions
  add constraint call_tap_sessions_words_total_len
  check (mark_words is null or char_length(array_to_string(mark_words, '')) <= 60000);

comment on column public.call_tap_sessions.mark_words is
  'i番目の！に付けた言葉（コールの文字。例: オイ！／ウォオッオッオッオー）。付けなかった要素は null。列ごと null は「言葉なしで送った参加」。mark_secs と必ず同じ長さ。1語の上限12文字は入力欄側で縛る。';

-- 読みの入館証を出し直す（created_by は引き続き外に見せない）
grant select (mark_words) on public.call_tap_sessions to anon, authenticated;
