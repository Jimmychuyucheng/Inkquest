# Inkquest Web App

設定與啟動方式請看專案根目錄的 [README](../README.md#web-app)。

- `src/lib/core/`：字數、抽選、計分、JSON 驗證、額度（與 Python 研究腳本同一套規則）
- `src/generated/`：由 `scripts/sync-shared.mjs` 從 `../shared/` 產生，不要手動修改
- `supabase/migrations/`：資料庫結構、RLS 與額度函式
- `scripts/seed.mjs`：把人設與額度初始值寫進資料庫
- `scripts/test-db.mjs`：用真實的 Supabase 專案測試額度與資料權限
