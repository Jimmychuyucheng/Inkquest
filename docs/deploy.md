# Inkquest 部署說明（W5）

照順序一步一步做。每一步標明：**在哪個網站 → 點哪裡 → 填什麼**。
需要填金鑰的地方只寫變數名稱；金鑰的值只貼在該網站的輸入框，不要貼到聊天、文件或程式碼裡。

文中的 `<正式網址>` 指 Vercel 給的網址，例如 `https://inkquest-xxxx.vercel.app`（第 4 步才會拿到）。

---

## 第 0 步：部署前確認（本機）

- [ ] **0-1 推送程式碼到 GitHub**：本機的 main 比 GitHub 多了 29 個 commit，Vercel 是從 GitHub 拿程式碼的。在專案資料夾執行 `git push`（或請 Claude 代為推送）。
- [ ] **0-2 確認 GitHub 儲存庫的可見度**：github.com → `Inkquest` 儲存庫 → Settings → General → 最下方 Danger Zone 的 Change visibility。程式碼裡沒有金鑰，公開或私人都可以；不想公開就設成 Private。

---

## 第 1 步：建立正式環境專用的 Anthropic API 金鑰

正式環境使用一把新的金鑰，和本機研究腳本用的分開。這樣出問題時可以只停用正式環境那把。

- [ ] **1-1** 網站：console.anthropic.com → 左上角 workspace 選單 → **Create workspace**，名稱填 `Inkquest Web`。（已經有本專案的 workspace 就直接選它。）
- [ ] **1-2** 同一個 workspace → **Limits**（或 Settings → Limits）→ 設定每月用量上限，建議 **US$15**。這是網站自己的月警戒線（US$12）之外的第二道防線。
- [ ] **1-3** 同一個 workspace → **API Keys** → **Create Key**，名稱填 `inkquest-vercel-production`。
- [ ] **1-4** 金鑰只會顯示一次：先不要關掉視窗，第 3 步要貼到 Vercel 的 `ANTHROPIC_API_KEY`。記下金鑰的**末四碼**，之後在 Vercel 的 log 裡會看到 `使用 Anthropic 金鑰 …末四碼`，可以用來對照。

---

## 第 2 步：建立 Inngest 正式帳號並取得金鑰

- [ ] **2-1** 網站：app.inngest.com → 註冊或登入（免費方案即可）。
- [ ] **2-2** 左上角環境選單確認是 **Production**。
- [ ] **2-3** 左側 **Manage** → **Event Keys** → **Create Event Key**，名稱填 `vercel`。複製這把金鑰，第 3 步貼到 `INNGEST_EVENT_KEY`。
- [ ] **2-4** 左側 **Manage** → **Signing Key** → 複製，第 3 步貼到 `INNGEST_SIGNING_KEY`。

> 不建議安裝「Inngest 的 Vercel 整合」：它會用每次部署專屬的網址同步，而 Vercel 預設的部署保護會擋住這種網址，Hobby 方案也不能設定繞過。我們改成第 7 步的手動同步，使用固定的正式網址。

---

## 第 3 步：建立 Vercel 專案並設定環境變數

- [ ] **3-1** 網站：vercel.com → 用 GitHub 登入 → **Add New…** → **Project** → 在列表中找到 `Inkquest` → **Import**。
- [ ] **3-2** 在設定畫面：
  - **Root Directory**：按 Edit，選 `web`。
  - 下方確認 **Include files outside the root directory in the Build Step** 是開啟的（預設開啟）。建置時要讀上一層的 `shared/`（人設、prompt、設定），關掉會建置失敗。
  - **Framework Preset**：Next.js（會自動偵測）。
- [ ] **3-3** 先**不要**按 Deploy。展開 **Environment Variables**，或之後到專案 → **Settings** → **Environment Variables**，逐一新增下表的變數。
  - **每一個變數都只勾 Production**，把 Preview 和 Development 的勾拿掉。這樣只有正式網址拿得到金鑰，其他分支自動產生的預覽版本拿不到。

| 變數名稱 | 值從哪裡來 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 和本機 `web/.env.local` 相同 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 和本機相同 |
| `SUPABASE_SECRET_KEY` | 和本機相同 |
| `LLM_PROVIDER` | 填 `anthropic` |
| `ANTHROPIC_API_KEY` | 第 1 步建立的**新**金鑰 |
| `INNGEST_EVENT_KEY` | 第 2-3 步 |
| `INNGEST_SIGNING_KEY` | 第 2-4 步 |
| `ADMIN_EMAILS` | 你的 email（和本機相同） |
| `RESEARCH_EXPORT_SALT` | 和本機 `web/.env.local` **完全相同**。不同的話，本機和正式環境匯出的匿名代號會對不起來 |

> `NEXT_PUBLIC_SITE_URL` 不用設：登入後導回的網址是從瀏覽器當下的網址取得的，程式沒有用到這個變數。

- [ ] **3-4** 之後如果有修改環境變數，要到 **Deployments** → 最新一筆右邊的 **⋯** → **Redeploy** 才會生效。

---

## 第 4 步：第一次部署

- [ ] **4-1** 按 **Deploy**，等建置完成（約 1～2 分鐘）。
- [ ] **4-2** 完成後，專案首頁 **Domains** 那一欄的網址就是 `<正式網址>`（`xxxx.vercel.app`，不是很長、帶亂碼的那種部署專屬網址）。
- [ ] **4-3** 確認 Fluid compute 是開啟的：專案 → **Settings** → **Functions** → **Fluid Compute** 是 Enabled（新專案預設開啟）。原因見第 8 步。
- [ ] **4-4** 打開 `<正式網址>`，首頁應該正常顯示。這時還不能登入，要做完第 5、6 步。

---

## 第 5 步：Supabase 的網址設定

- [ ] **5-1** 網站：supabase.com → 你的專案 → 左側 **Authentication** → **URL Configuration**。
- [ ] **5-2** **Site URL**：改成 `<正式網址>`（例如 `https://inkquest-xxxx.vercel.app`，結尾不要加 `/`）。
- [ ] **5-3** **Redirect URLs** → **Add URL**，加入：
  - `<正式網址>/auth/callback`
  - 原本的 `http://localhost:3000/auth/callback` **保留**，本機開發還要用。
- [ ] **5-4** 按 **Save**。

---

## 第 6 步：Google 登入設定

網站：console.cloud.google.com → 上方選擇本專案 → 左側選單 **APIs & Services** → **OAuth consent screen**。新版介面會進入 **Google Auth Platform**，左側有 Branding、Audience、Clients 等分頁。

### 6-1 加上正式網址

- [ ] **Clients** → 點你的 Web 用戶端 → **Authorized JavaScript origins** → **Add URI** → 填 `<正式網址>`。
- [ ] **Authorized redirect URIs** 維持原本的 `https://<你的專案代碼>.supabase.co/auth/v1/callback`，**不用**加 Vercel 網址：Google 是先導回 Supabase，再由 Supabase 導回網站。
- [ ] 按 **Save**。

### 6-2 測試模式和正式發布的差別

| | 測試模式（Testing） | 正式發布（In production） |
| --- | --- | --- |
| 誰能登入 | 只有加入「測試使用者」名單的 Google 帳號，最多 100 個 | 任何 Google 帳號 |
| 名單外的人 | 登入時被 Google 擋下 | 都可以登入 |
| 警告畫面 | 可能出現「Google 尚未驗證這個應用程式」，按「繼續」即可 | 本專案只用基本資料（email、名字、頭像），通常不需要送審 |
| 適合 | 約 20 位同學的課堂使用：只有名單上的人能用，額度與費用最好控制 | 開放給所有人 |

**建議：維持測試模式**，把 20 位同學加進名單。網站的「白名單」功能延後了，這等於用 Google 這一關代替白名單。

### 6-3 加入測試使用者

- [ ] **Audience** → **Publishing status** 確認是 **Testing**（不要按 Publish app）。
- [ ] 同一頁往下 **Test users** → **Add users** → 貼上同學的 Gmail，可以一次貼多個（一行一個，或用逗號分隔）→ **Save**。
- [ ] 之後有新同學，同樣在這裡加入；加入後馬上就能登入。
- [ ] 提醒同學：第一次登入如果看到「Google 尚未驗證這個應用程式」，按 **繼續** 即可。

---

## 第 7 步：同步 Inngest（讓背景工作連上正式網址）

- [ ] **7-1** 網站：app.inngest.com → 左上角環境選 **Production** → 左側 **Apps** → **Sync new app**。
- [ ] **7-2** URL 填 `<正式網址>/api/inngest` → **Sync app**。
- [ ] **7-3 確認同步成功**：
  - **Apps** 列表出現 `inkquest`，狀態沒有錯誤。
  - 點進去，**Functions** 應該有 **2 個**：`hold-court`（開庭）和 `add-advice`（補勾修改建議）。
  - 同一頁可以看到同步紀錄（Syncs）與網址。
  - 如果失敗：看錯誤訊息，或到 **Unattached Syncs** 和 **App Diagnostics** 查原因。最常見的原因是 Vercel 的 `INNGEST_SIGNING_KEY` 沒設或貼錯（改完記得 Redeploy），或網址打錯。
- [ ] **7-4 之後每次重新部署**：如果有改到背景工作（`web/src/inngest/`），部署完成後到 Inngest → **Apps** → `inkquest` → **Resync**。只改畫面的話不需要。

---

## 第 8 步：函式時間限制（已確認，請看一下風險）

依 Vercel 官方文件：Hobby 方案在 Fluid compute 開啟時，函式最長可執行 **300 秒**；新專案預設開啟。
背景工作的每一個階段是一次獨立的請求，各自有 300 秒：

| 階段 | 平常 | 最壞情況（逾時並重試到上限） | 是否在 300 秒內 |
| --- | --- | --- | --- |
| 陪審員（10 位同時） | 約 15～30 秒 | 45 秒 × 3 次 ≒ 135 秒 | ✅ |
| 法官 | 約 15～25 秒 | 60 秒 × 3 次 ≒ 180 秒 | ✅ |
| 修改建議 | 約 15～20 秒 | 60 秒 × 3 次 ≒ 180 秒 | ✅ |

- 程式已設定 `maxDuration = 300`，SDK 本身的自動重試已關閉，不會讓時間加倍。
- **唯一的風險**：如果 Fluid compute 被關掉，Hobby 的上限會比 300 秒短很多，法官重試時可能被中斷。所以第 4-3 步一定要確認它是開啟的。
- 最壞情況只會在 Anthropic 服務很慢時發生，不影響一般使用。

---

## 第 9 步：上線前檢查

Claude 在 2026-11-11 已經唯讀檢查過一次，結果如下；正式開放前請再看一次。

- [ ] **9-1 額度與預算設定都是預設值**：網站 `<正式網址>/admin` → 額度設定，應該是每人每日 **3**、全站上限 **25**。預算在 Supabase → **Table Editor** → `settings` 表，`monthly_budget_usd` 應該是 **12**。
  - 2026-11-11 檢查：daily_quota_per_user = 3、global_daily_limit = 25、monthly_budget_usd = 12、rate_limit_per_minute = 3、stale_minutes = 10，全部正確；沒有殘留的測試帳號。
- [ ] **9-2 個別額度**：你的帳號目前 `daily_quota_override = 100`（開發時調高的）。
  - 要保留方便課堂示範：不用動。
  - 要改回一般額度：`/admin` → 個別使用者額度 → 搜尋自己 → **改回預設**。
- [ ] **9-3 清掉開發時的假資料投稿**：你的歷史紀錄裡有假資料模式產生的假判決。到 `<正式網址>/history` → **全部刪除**，展示時才不會混淆。用量紀錄（0 元）會保留，不影響費用。
- [ ] **9-4 用自己的帳號登入正式網址**：右上角要有「後台」，代表 `ADMIN_EMAILS` 生效。
  - 沒有的話，在本機 `web/` 執行 `npm run seed`。正式環境和本機用的是同一個 Supabase，所以本機執行就會生效。
- [ ] **9-5 投一篇真實的作品**（會花錢：約 12 次 AI 呼叫，US$0.02 以內）。確認：
  - 開庭畫面會自己更新，90 秒內出現判決。
  - Vercel → 專案 → **Logs** 出現 `使用 Anthropic 金鑰 …`，末四碼和第 1-4 步記下的相同。
  - Inngest → **Runs** 出現一筆 `hold-court`，狀態 Completed。
- [ ] **9-6** 接著照 PRD 第 11 節的驗收清單逐條測試（W5 的驗收）。

> 注意：上線後，本機和正式環境共用同一個 Supabase 資料庫。上線後**不要再在本機跑** `test:admin`、`test:pages`、`test:e2e`、`test:db`：這些測試會建立測試帳號，並暫時修改額度與預算設定，會影響正在使用的同學。

---

## 第 10 步：出問題時

### 10-1 緊急暫停所有投稿（最快，不需要重新部署）

- [ ] 網站 `<正式網址>/admin` → 額度設定 → **全站每日上限** 改成 `0` → **儲存**。
  - 立即生效，所有人送出時會看到「今日法院已滿庭，請明天再來」。
  - 已經在開庭中的那幾篇會繼續跑完。
  - 恢復：改回 `25` → 儲存。
- 想讓訊息改成「本月費用已達上限」：Supabase → **SQL Editor** 執行
  `update public.settings set value = '0' where key = 'monthly_budget_usd';`
  恢復時把 `'0'` 改回 `'12'`。
- **最後手段**（例如懷疑金鑰外洩）：Anthropic Console → `Inkquest Web` workspace → **API Keys** → 停用 `inkquest-vercel-production`。之後所有開庭都會失敗（不扣使用者次數）；要恢復就建立新金鑰、更新 Vercel 的 `ANTHROPIC_API_KEY` 並 Redeploy。

### 10-2 回到上一版部署

Hobby 方案**只能回到前一版**正式部署。

- [ ] 網站：vercel.com → 專案首頁 → **Production Deployment** 區塊 → **Instant Rollback** → 選擇要回去的部署 → **Continue** → 確認畫面 → **Confirm Rollback**。
  - 另一條路：**Deployments** 分頁 → 那一筆右邊的 **⋯** → **Instant Rollback**。
- 回滾之後要知道的事：
  - 環境變數不會變。
  - **資料庫不會跟著回去**：已經執行的 migration 和資料都維持現狀。
  - Vercel 會暫停「新部署自動上線」。修好之後，到專案首頁 Production Deployment 區塊按 **Manage** → 選新的部署 → **Confirm**，才會恢復。
  - 如果新舊版本的背景工作不同，回滾後到 Inngest → **Apps** → `inkquest` → **Resync**。
