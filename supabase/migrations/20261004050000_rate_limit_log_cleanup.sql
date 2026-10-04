-- 連投制限の棚（rate_limit_log）の片付けの時計を直す（2026-10-04 Hop 決定・本番適用済み）。
-- 旧: 15分ごとに「5分より古い物」を消していたため、各受付係の「1時間に◯回」が実際は数分〜20分しか効いていなかった。
-- 新: 5分ごとに「1時間より古い物」を消す。各受付係は自分の endpoint の1時間より古い行を呼ばれるたびに消すので、
--     この仕事は取りこぼしの掃除。最大で1時間5分残る。
-- 影響: 問い合わせ（contact）、FC チケットの登録（60回/時）と復元（30回/時）、灰toダイヤモンドの問い合わせ、
--       クロスワードの受付係すべてで、1時間の上限が本来の長さで効き始める。
-- 戻し方: 下の alter_job を schedule '*/15 * * * *'、interval '5 minutes' で呼び直す。
select cron.alter_job(
  job_id := 2,
  schedule := '*/5 * * * *',
  command := $$DELETE FROM public.rate_limit_log WHERE created_at < now() - interval '1 hour'$$
);
