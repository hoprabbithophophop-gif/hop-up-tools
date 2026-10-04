-- 削除の関数 crossword_delete を anon / authenticated から直接呼べなくする（2026-10-04 公開前監査 #11b・本番適用済み）。
-- 呼ぶのは受付係 /api/crossword-delete（秘密の鍵＝service_role）だけ。ブラウザは呼ばない。
-- anon が直接呼べると、受付係が行うシェア画像の片付けを飛ばして問題だけ消せた。
-- 20261003010000 で anon, authenticated に grant していたのを取り消す。
revoke execute on function public.crossword_delete(text, text) from anon, authenticated;
