-- 問い合わせの種類に「通報」(report) を足す。クロスワードの通報のリンクから開いたときだけ使う（2026-10-03 Hop 決定）
alter table public.contact_messages drop constraint contact_messages_kind_chk;
alter table public.contact_messages add constraint contact_messages_kind_chk check (
  kind = any (array['bug', 'request', 'question', 'report']::text[])
);
