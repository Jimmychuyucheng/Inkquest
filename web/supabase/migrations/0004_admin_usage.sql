-- W4：後台用量統計（PRD E-1）與月費用警戒線（PRD 第 10 節）。
-- 只新增一個唯讀的統計函式，不改資料表。在 Supabase SQL Editor 貼上整個檔案執行一次。
--
-- 為什麼放在資料庫：token 用量要加總所有陪審員、法官、修改建議的紀錄，
-- 一個月可能上萬筆，從網站逐筆讀回來會超過 Supabase 一次 1,000 筆的上限。
-- 費用的單價放在 shared/settings.yaml，由網站依這裡回傳的「各模型 token 總數」換算，
-- 單價只有一份，不複製到資料庫。

create or replace function public.admin_usage(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    -- 這段期間建立的投稿，依狀態分別計數
    'submissions', coalesce((
      select jsonb_object_agg(status, n)
      from (select status, count(*) as n
            from public.submissions where created_at >= p_since
            group by status) s
    ), '{}'::jsonb),
    -- 這段期間有投稿的使用者數
    'active_users', (
      select count(distinct user_id) from public.submissions where created_at >= p_since
    ),
    -- 依來源（陪審員／法官／修改建議）與模型加總 token
    'tokens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'source', source, 'model', model, 'calls', calls,
        'input_tokens', input_tokens, 'output_tokens', output_tokens))
      from (
        select 'juror' as source, model, count(*) as calls,
               sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens
          from public.juror_results where created_at >= p_since group by model
        union all
        select 'judge', model, count(*), sum(input_tokens), sum(output_tokens)
          from public.verdicts where created_at >= p_since group by model
        union all
        select 'advice', model, count(*), sum(input_tokens), sum(output_tokens)
          from public.advice where created_at >= p_since group by model
      ) t
    ), '[]'::jsonb)
  );
$$;

-- 只有伺服器能呼叫（後台 API 會先確認呼叫者是管理者）
revoke execute on function public.admin_usage(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_usage(timestamptz) to service_role;
