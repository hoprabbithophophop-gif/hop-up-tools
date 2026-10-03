-- 問い合わせの棚の「対象ツール」の決まりに crossword と hai-to-diamond を足す。
-- hai-to-diamond は functions/api/contact.ts では受け付けていたのに決まりに無く、保存が弾かれていた（2026-10-03 発見）
alter table public.contact_messages drop constraint contact_messages_tool_chk;
alter table public.contact_messages add constraint contact_messages_tool_chk check (
  tool is null or tool = any (array['fc-ticket', 'youtube', 'the-ballad', 'hi-tension', 'arigato-beat', 'hai-to-diamond', 'crossword', 'site']::text[])
);
