-- W4：用量紀錄表（只能新增，不能修改或刪除）。
-- 在 Supabase SQL Editor 貼上整個檔案執行一次。會新增一張表、三個觸發器，並更新 admin_usage 函式。
--
-- 為什麼要這張表：token 用量原本只存在 juror_results、verdicts、advice，
-- 使用者刪除投稿時會一起刪掉，後台的費用與月預算檢查就會少算。
-- 這張表另外保留每一次寫入結果時的 token 數，刪除投稿後仍然留著。
--
-- 不存文章內容、標題、email，也不存 user id；只存「哪一篇投稿（隨機 id）、誰的呼叫、哪個模型、多少 token」。
-- submission_id 不設外鍵：投稿刪除後，這裡的 id 只是一串找不到對應的隨機碼。

create table public.usage_log (
  id bigint generated always as identity primary key,
  submission_id uuid not null,
  source text not null check (source in ('juror', 'judge', 'advice')),
  -- 陪審員編號（J01～J20）；法官與修改建議為空
  juror_code text,
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  created_at timestamptz not null default now()
);

create index usage_log_created_idx on public.usage_log (created_at);

-- ---------------------------------------------------------------------------
-- 只能新增：禁止修改、刪除、清空（連伺服器的 service role 也不行）
-- ---------------------------------------------------------------------------
create function public.usage_log_forbid_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '用量紀錄只能新增，不能修改或刪除';
end;
$$;

create trigger usage_log_no_update_delete
  before update or delete on public.usage_log
  for each row execute function public.usage_log_forbid_change();

create trigger usage_log_no_truncate
  before truncate on public.usage_log
  for each statement execute function public.usage_log_forbid_change();

-- ---------------------------------------------------------------------------
-- 自動記錄：結果表每次新增，或更新 token 數時，寫一筆用量紀錄
-- ---------------------------------------------------------------------------
-- 結果是用 upsert 寫入的：背景工作重跑同一位陪審員時，會更新原本那一列而不是新增，
-- 但那次重跑也真的花了錢，所以「更新 token」也要記一筆。
-- security definer：由函式擁有者寫入。網站的 service role 本身沒有寫入這張表的權限，
-- 用量紀錄只能經由這個觸發器產生，程式無法自己寫入或竄改。
create function public.log_usage()
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
    case when tg_argv[0] = 'juror' then new.juror_code else null end,
    new.model,
    new.input_tokens,
    new.output_tokens
  );
  return null;
end;
$$;

create trigger juror_results_log_usage
  after insert or update of input_tokens, output_tokens on public.juror_results
  for each row execute function public.log_usage('juror');

create trigger verdicts_log_usage
  after insert or update of input_tokens, output_tokens on public.verdicts
  for each row execute function public.log_usage('judge');

create trigger advice_log_usage
  after insert or update of input_tokens, output_tokens on public.advice
  for each row execute function public.log_usage('advice');

-- ---------------------------------------------------------------------------
-- 補上既有的紀錄（還沒被刪除的投稿）；已經刪除的投稿無法找回
-- ---------------------------------------------------------------------------
insert into public.usage_log (submission_id, source, juror_code, model, input_tokens, output_tokens, created_at)
select submission_id, 'juror', juror_code, model, input_tokens, output_tokens, created_at from public.juror_results
union all
select submission_id, 'judge', null, model, input_tokens, output_tokens, created_at from public.verdicts
union all
select submission_id, 'advice', null, model, input_tokens, output_tokens, created_at from public.advice;

-- ---------------------------------------------------------------------------
-- 權限：開啟 RLS 且不設任何政策；一般使用者與訪客完全碰不到。
-- 伺服器只能讀（後台統計用），不能新增、修改、刪除。
-- ---------------------------------------------------------------------------
alter table public.usage_log enable row level security;
revoke all on public.usage_log from public, anon, authenticated, service_role;
grant select on public.usage_log to service_role;

revoke execute on function public.usage_log_forbid_change() from public, anon, authenticated;
revoke execute on function public.log_usage() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 後台統計改讀用量紀錄（投稿數與投稿人數仍以目前還在的投稿計算）
-- ---------------------------------------------------------------------------
create or replace function public.admin_usage(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'submissions', coalesce((
      select jsonb_object_agg(status, n)
      from (select status, count(*) as n
            from public.submissions where created_at >= p_since
            group by status) s
    ), '{}'::jsonb),
    'active_users', (
      select count(distinct user_id) from public.submissions where created_at >= p_since
    ),
    'tokens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', source, 'model', model, 'calls', calls,
        'input_tokens', input_tokens, 'output_tokens', output_tokens))
      from (
        select source, model, count(*) as calls,
               sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens
          from public.usage_log
          where created_at >= p_since
          group by source, model
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.admin_usage(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_usage(timestamptz) to service_role;
