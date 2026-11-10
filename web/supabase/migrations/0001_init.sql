-- Inkquest 資料庫初始結構（PRD 第 8 節）
-- 7 張表：profiles、submissions、juror_results、verdicts、advice、personas、settings
--
-- 安全設計：
-- 1. 每張表都開啟列層級安全（RLS）。使用者只能讀自己的資料。
-- 2. 使用者不能直接新增或修改投稿與結果；所有寫入都由伺服器（service role）執行。
--    建立投稿只能透過 create_submission 函式，額度檢查與建立投稿在同一個交易內完成。
-- 3. 使用者可以刪除自己的投稿（真正刪除，相關結果一併刪除）。

-- ---------------------------------------------------------------------------
-- profiles：使用者資料
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  -- 個別使用者的每日額度；空值表示使用全站預設
  daily_quota_override integer check (daily_quota_override >= 0),
  terms_accepted_at timestamptz,
  -- 是否同意將投稿統計（不含文章內容）用於課程研究（PRD A-7）
  research_consent boolean not null default false,
  research_consent_at timestamptz,
  created_at timestamptz not null default now()
);

-- 新帳號第一次登入時，自動建立對應的 profile
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- settings：可調整的數值（每日額度、全站上限等）
-- ---------------------------------------------------------------------------
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- personas：20 位陪審員人設（由 npm run seed 從 shared/personas.yaml 寫入）
-- ---------------------------------------------------------------------------
create table public.personas (
  code text primary key check (code ~ '^J[0-9]{2}$'),
  name text not null,
  -- group 是 SQL 保留字，所以欄位叫 group_name
  group_name text not null check (group_name in ('文學專業', '一般讀者', '跨界視角')),
  background text not null,
  focus text not null,
  tone text not null,
  voice_traits text not null,
  vocabulary_rule text not null,
  icon text,
  enabled boolean not null default true,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- submissions：一次投稿
-- ---------------------------------------------------------------------------
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  genre text not null,
  title text not null default '',
  content text not null,
  char_count integer not null,
  modules text[] not null,
  status text not null default 'queued'
    check (status in ('queued', 'jurors_running', 'judge_running', 'advice_running', 'done', 'failed')),
  -- 本次抽中的陪審員編號
  jury text[] not null default '{}',
  jurors_ok integer not null default 0,
  stats jsonb,
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index submissions_user_created_idx on public.submissions (user_id, created_at desc);
create index submissions_created_idx on public.submissions (created_at);

-- ---------------------------------------------------------------------------
-- juror_results：每位陪審員一筆
-- ---------------------------------------------------------------------------
create table public.juror_results (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  juror_code text not null,
  persona_version integer not null,
  status text not null check (status in ('ok', 'failed')),
  output jsonb,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  latency_ms integer not null default 0,
  attempts integer not null default 0,
  -- 每次失敗嘗試的原因（即使最後成功也保留）
  attempt_errors jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (submission_id, juror_code)
);

-- ---------------------------------------------------------------------------
-- verdicts：法官結果；advice：修改建議（每篇最多一筆）
-- ---------------------------------------------------------------------------
create table public.verdicts (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  output jsonb not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.advice (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  output jsonb not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 列層級安全（RLS）
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.personas enable row level security;
alter table public.submissions enable row level security;
alter table public.juror_results enable row level security;
alter table public.verdicts enable row level security;
alter table public.advice enable row level security;

-- profiles：只能讀自己的。沒有 insert / update / delete 政策：
-- 建立由 trigger 處理；同意條款透過 accept_terms 函式；role 與額度只有伺服器能改。
create policy "讀取自己的 profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

-- settings：沒有任何政策，只有伺服器（service role）能讀寫。

-- personas：所有人都能讀（首頁要顯示陪審團陣容），只有伺服器能改。
create policy "所有人可讀人設" on public.personas
  for select to anon, authenticated using (true);

-- submissions：只能讀、刪自己的。沒有 insert / update 政策。
create policy "讀取自己的投稿" on public.submissions
  for select to authenticated using (user_id = (select auth.uid()));
create policy "刪除自己的投稿" on public.submissions
  for delete to authenticated using (user_id = (select auth.uid()));

-- 結果表：只能讀屬於自己投稿的資料。
create policy "讀取自己投稿的陪審員結果" on public.juror_results
  for select to authenticated using (
    exists (select 1 from public.submissions s
            where s.id = juror_results.submission_id and s.user_id = (select auth.uid()))
  );
create policy "讀取自己投稿的判決" on public.verdicts
  for select to authenticated using (
    exists (select 1 from public.submissions s
            where s.id = verdicts.submission_id and s.user_id = (select auth.uid()))
  );
create policy "讀取自己投稿的修改建議" on public.advice
  for select to authenticated using (
    exists (select 1 from public.submissions s
            where s.id = advice.submission_id and s.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- 函式
-- ---------------------------------------------------------------------------

-- 讀取整數設定；沒有設定時用預設值
create function public.setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (value #>> '{}')::integer from public.settings where key = p_key), p_default);
$$;

-- 「今天」的起點：台北時間 00:00
create function public.taipei_day_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
$$;

-- 額度狀態。只有伺服器能呼叫（由伺服器確認登入身分後帶入 p_user_id）。
-- 額度以 submissions 中當日、狀態不是 failed 的筆數計算，不另存計數器（PRD 第 8 節）。
create function public.get_quota_status(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_day_start timestamptz := public.taipei_day_start();
  v_limit integer;
  v_used integer;
  v_global_limit integer := public.setting_int('global_daily_limit', 25);
  v_global_used integer;
  v_stale interval := make_interval(mins => public.setting_int('stale_minutes', 10));
  v_in_progress boolean;
begin
  select coalesce(p.daily_quota_override, public.setting_int('daily_quota_per_user', 3))
    into v_limit
    from public.profiles p where p.id = p_user_id;
  if v_limit is null then
    v_limit := 0;  -- 找不到這個使用者
  end if;

  select count(*) into v_used
    from public.submissions
    where user_id = p_user_id and created_at >= v_day_start and status <> 'failed';

  select count(*) into v_global_used
    from public.submissions
    where created_at >= v_day_start and status <> 'failed';

  -- 處理中超過 stale_minutes 的投稿視為卡住，不再擋住使用者
  select exists (
    select 1 from public.submissions
    where user_id = p_user_id
      and status in ('queued', 'jurors_running', 'judge_running', 'advice_running')
      and created_at > now() - v_stale
  ) into v_in_progress;

  return jsonb_build_object(
    'used', v_used,
    'limit', v_limit,
    'remaining', greatest(v_limit - v_used, 0),
    'global_used', v_global_used,
    'global_limit', v_global_limit,
    'in_progress', v_in_progress
  );
end;
$$;

-- 建立投稿。額度檢查與建立在同一個交易內完成，並用鎖避免同時送出多次超額。
-- 只有伺服器能呼叫：伺服器先確認登入身分、檢查文類與字數，再帶入 p_user_id。
-- 回傳 {"ok": true, "id": "..."} 或 {"ok": false, "reason": "..."}。
create function public.create_submission(
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

  insert into public.submissions (user_id, genre, title, content, char_count, modules)
  values (p_user_id, p_genre, coalesce(p_title, ''), p_content, p_char_count, p_modules)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- 同意使用條款（PRD A-2）與研究同意（A-7）。登入的使用者替自己呼叫。
create function public.accept_terms(p_research_consent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception '尚未登入';
  end if;
  update public.profiles
  set terms_accepted_at = coalesce(terms_accepted_at, now()),
      research_consent = coalesce(p_research_consent, false),
      research_consent_at = case when coalesce(p_research_consent, false) then now() else null end
  where id = v_user;
end;
$$;

-- 權限：額度與建立投稿只開放給伺服器；同意條款開放給登入的使用者
revoke execute on function public.setting_int(text, integer) from public, anon, authenticated;
revoke execute on function public.get_quota_status(uuid) from public, anon, authenticated;
revoke execute on function public.create_submission(uuid, text, text, text, integer, text[]) from public, anon, authenticated;
revoke execute on function public.accept_terms(boolean) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.setting_int(text, integer) to service_role;
grant execute on function public.get_quota_status(uuid) to service_role;
grant execute on function public.create_submission(uuid, text, text, text, integer, text[]) to service_role;
grant execute on function public.accept_terms(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 即時進度（W2 使用）：陪審員完成、投稿狀態改變時推送到頁面
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.submissions;
alter publication supabase_realtime add table public.juror_results;

-- ---------------------------------------------------------------------------
-- 資料表權限：先全部收回，再只給需要的（RLS 之外的第二道防線）
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

grant select on public.personas to anon, authenticated;
grant select on public.profiles to authenticated;
grant select, delete on public.submissions to authenticated;
grant select on public.juror_results to authenticated;
grant select on public.verdicts to authenticated;
grant select on public.advice to authenticated;

grant all on all tables in schema public to service_role;
