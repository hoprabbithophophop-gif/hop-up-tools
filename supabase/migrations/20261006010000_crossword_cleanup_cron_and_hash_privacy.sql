-- 2026-10-06 法務の再照合（本番適用済み）: プラポリの「定期的に削除」「識別番号の値は公開しません」を実態にする。
-- ①回の記録と回数の印を時計で片付ける（受付係の片付けは残し、こちらは取りこぼしの掃除。毎時17分）
select cron.schedule('crossword_cleanup', '17 * * * *', $$
  delete from public.crossword_plays where checks = 0 and counted = false and solved_at is null and started_at < now() - interval '1 day';
  delete from public.crossword_plays where started_at < now() - interval '30 days';
  delete from public.crossword_play_counts where created_at < now() - interval '24 hours';
$$);
-- ②ランキングの棚の端末番号のハッシュは入口の鍵では読めない（画面は列を指定して読むので影響なし。受付係は service_role）
-- 列ごとの revoke は表全体の grant に負けるので、表の select を外してから読める列だけを grant する
revoke select on public.crossword_scores from anon, authenticated;
grant select (id, puzzle_id, display_name, time_seconds, is_hidden, created_at, updated_at, reveals, misses) on public.crossword_scores to anon, authenticated;
-- 戻し方: select cron.unschedule('crossword_cleanup'); grant select on public.crossword_scores to anon, authenticated;
