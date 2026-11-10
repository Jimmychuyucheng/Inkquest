-- W2：送出頻率限制（PRD 第 10 節：同一帳號每分鐘最多 3 次）。
-- 只更新 create_submission 函式，不改資料表。在 Supabase SQL Editor 貼上整個檔案執行一次。
--
-- 做法：計算這個帳號最近 60 秒內建立的投稿筆數（不論成功或失敗）。
-- 檢查放在額度檢查之後，所以「處理中」「今日次數用完」會先顯示各自的說明；
-- 這一條主要擋的是「連續失敗後不斷重送」。
-- 被伺服器的字數檢查擋下的請求不會建立投稿，也不會呼叫模型，所以不列入計算。

create or replace function public.create_submission(
  p_user_id uuid,
  p_genre text,
  p_title text,
  p_content text,
  p_char_count integer,
  p_modules text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terms timestamptz;
  v_status jsonb;
  v_recent integer;
  v_id uuid;
begin
  -- 全站一把鎖（全站上限）＋ 每位使用者一把鎖（個人額度）；交易結束時自動釋放
  perform pg_advisory_xact_lock(727001);
  perform pg_advisory_xact_lock(727002, hashtext(p_user_id::text));

  select terms_accepted_at into v_terms from public.profiles where id = p_user_id;
  if v_terms is null then
    return jsonb_build_object('ok', false, 'reason', 'terms_required');
  end if;

  v_status := public.get_quota_status(p_user_id);

  if (v_status ->> 'in_progress')::boolean then
    return jsonb_build_object('ok', false, 'reason', 'in_progress');
  end if;
  if (v_status ->> 'used')::integer >= (v_status ->> 'limit')::integer then
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded');
  end if;
  if (v_status ->> 'global_used')::integer >= (v_status ->> 'global_limit')::integer then
    return jsonb_build_object('ok', false, 'reason', 'global_full');
  end if;

  select count(*) into v_recent
    from public.submissions
    where user_id = p_user_id and created_at > now() - interval '1 minute';
  if v_recent >= public.setting_int('rate_limit_per_minute', 3) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  insert into public.submissions (user_id, genre, title, content, char_count, modules)
  values (p_user_id, p_genre, coalesce(p_title, ''), p_content, p_char_count, p_modules)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- create or replace 會保留原本的權限設定；這裡再明確設定一次，確保只有伺服器能呼叫
revoke execute on function public.create_submission(uuid, text, text, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.create_submission(uuid, text, text, text, integer, text[]) to service_role;
