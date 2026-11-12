-- 0007：記錄陪審團的組成方式（2026-11-12 新增「自己選陪審員」）
--   random：系統依組別隨機抽選（原本的做法）
--   chosen：使用者每一組都自己選滿
--   mixed ：使用者選了一部分，其餘由系統隨機補滿
-- 研究分析時可以只取 random 的場次，避免使用者挑選影響隨機抽選的比較。
-- 既有的投稿都是隨機抽選，用預設值 random 補上。

alter table public.submissions
  add column if not exists jury_mode text not null default 'random'
    check (jury_mode in ('random', 'chosen', 'mixed'));
