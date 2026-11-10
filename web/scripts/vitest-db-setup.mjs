// 資料庫整合測試的前置：讀取 web/.env.local。
import { loadEnv } from "./env.mjs";

loadEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
