-- W2：記錄法官與修改建議的嘗試次數與每次被退回的原因（陪審員的 juror_results 已經有這兩個欄位）。
-- 在 Supabase SQL Editor 貼上整個檔案執行一次。只新增欄位，既有資料不受影響。

alter table public.verdicts
  add column if not exists attempts integer not null default 0,
  add column if not exists attempt_errors jsonb not null default '[]';

alter table public.advice
  add column if not exists attempts integer not null default 0,
  add column if not exists attempt_errors jsonb not null default '[]';
