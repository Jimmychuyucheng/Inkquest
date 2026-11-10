-- W4：修正 0005 的用量紀錄觸發函式。在 Supabase SQL Editor 貼上整個檔案執行一次。
--
-- 錯誤：0005 的 log_usage() 直接寫 new.juror_code。verdicts 與 advice 沒有這個欄位，
-- PL/pgSQL 準備 case 運算式時就會找這個欄位而報錯（即使那個分支不會執行），
-- 導致法官判決與修改建議寫入失敗、整次開庭失敗。
-- 修正：改從整列資料（to_jsonb(new)）讀 juror_code；沒有這個欄位時為空值。
-- 只替換函式內容，三個觸發器與權限不變。

create or replace function public.log_usage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usage_log (submission_id, source, juror_code, model, input_tokens, output_tokens)
  values (
    new.submission_id,
    tg_argv[0],
    to_jsonb(new) ->> 'juror_code',
    new.model,
    new.input_tokens,
    new.output_tokens
  );
  return null;
end;
$$;

revoke execute on function public.log_usage() from public, anon, authenticated;
