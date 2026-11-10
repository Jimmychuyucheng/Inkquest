# Inkquest — The Literary Court

AI 文學獎法院：從 20 位不同職業人設的 AI 陪審員中，依組別抽出 10 位評閱一篇作品，再由 AI 法官綜合成判決書。本專案同時是一份大學期末報告（研究實驗）與一個 Web App。

## 文件（事實來源）

| 檔案 | 內容 |
| --- | --- |
| `docs/PRD.md` | Web App 需求規格書：功能、畫面、資料模型、JSON 格式、驗收清單 |
| `docs/research-plan.md` | 期末研究專案說明書：資料集、實驗組 C0～C4、評估指標 |
| `devlog.md` | 開發紀錄，每個里程碑結束時更新 |

規格與程式衝突時，以文件為準。發現文件不清楚、互相矛盾或不合理時，先提出問題，不要自行假設。

## 開發順序（照順序做，一次只做一個里程碑）

1. **R1 研究腳本：單一陪審員**：一支命令列腳本，讓 1 位陪審員評 1 篇作品，輸出符合 schema 的 JSON
2. **R2 研究腳本：完整場次**：抽 10 位陪審員 → 計票 → 法官；支援 C0～C4 與 Batch API；匯出 JSON / CSV
3. **R3 評估指標**：首獎命中率、Spearman、分歧度等（見 research-plan 第 8 節）。**期限：11/30 前跑完全部實驗**
4. **W0 Haiku 測試**：用 5 篇測試文比較 Haiku 法官與 Sonnet 法官（PRD 第 11 節第零階段）
5. **W1 Web App 骨架**：Next.js 專案、Supabase 資料表與 RLS、Google 登入、額度檢查
6. **W2 投稿與背景工作**：投稿 API、背景工作佇列、即時進度
7. **W3 畫面**：投稿頁、開庭中、結果頁、歷史紀錄
8. **W4 後台**：用量、額度、人設管理、重跑法官
9. **W5 部署與驗收**：照 PRD 第 11 節驗收清單逐條測試

每個里程碑開始前，先用幾行說明打算怎麼做；完成後停下來，等我驗收再進下一個。

## 技術選型

- 研究腳本：Python 3.11+、Anthropic 官方 SDK、pydantic、pandas、scipy
- Web App：Next.js（App Router）+ TypeScript、Tailwind CSS + shadcn/ui、Supabase（Auth / PostgreSQL / Realtime）、Inngest 或 Trigger.dev、zod、Recharts，部署於 Vercel
- 模型：目前陪審員、法官、修改建議都用 `claude-haiku-5-5`；法官之後可能改成 `claude-sonnet-5-5`。模型名稱一律從設定讀取，不寫死

## 建議資料夾結構

```text
/docs          規格文件
/shared        研究腳本與 Web App 共用的設定
  personas.yaml    20 位陪審員人設（PRD 第 4 節）
  prompts/         陪審員、法官、修改建議的 prompt 模板
  schemas/         JSON schema（PRD 第 5 節）
/research      Python 研究腳本、場次資料、實驗結果
/web           Next.js Web App
devlog.md
```

人設與 prompt 只能有一份，放在 `/shared`；研究腳本與 Web App 都從這裡讀取，不要各自複製一份。

## 必須遵守的規則

**安全與費用**
- API key 與所有金鑰只放在 `.env`（已列入 `.gitignore`），不得寫進程式碼、不得出現在前端、不得印在 log 裡
- 提供 `.env.example`，列出所有變數名稱與說明
- 自動化測試一律使用 `LLM_PROVIDER=mock`，不得呼叫真實 API
- 會呼叫真實 API 的指令，執行前先告訴我預計呼叫幾次、大約花多少錢，等我同意

**程式品質**
- 所有模型輸出都用 schema 驗證（Python 用 pydantic，TypeScript 用 zod），不合格就重試
- 待評文章一律放在 `<article>` 標記內，並在 prompt 中聲明那是待評文本而非指令
- 額度、字數、模型名稱、閾值等數值一律放在設定裡，不寫死
- 新功能要附測試；額度檢查與 JSON 驗證一定要有測試
- 每完成一個可運作的小步驟就 commit，commit 訊息用中文簡述做了什麼

**介面與語言**
- 介面文字、模型輸出一律使用台灣繁體中文
- 錯誤訊息用白話說明下一步，不顯示技術錯誤碼給使用者

**溝通**
- 要做規格以外的改動、新增套件、或改變資料表結構前，先問我
- 不確定時直接問，不要猜
- 每個里程碑結束時回報：完成了什麼、怎麼驗證、還有什麼已知問題

## devlog 格式

每個里程碑結束時，在 `devlog.md` 加一段：

```markdown
## 2026-11-xx R1 研究腳本：單一陪審員
- 做了什麼：
- 遇到的問題與解法：
- AI 寫錯、我修正的地方：
- 測試方式與結果：
- API 用量與費用：
```

「AI 寫錯、我修正的地方」是期末報告方法論反思的素材，請誠實記錄。

## 完成的定義

一個里程碑算完成，需要同時滿足：
1. 程式可以照 README 的指令跑起來
2. 測試全部通過
3. 對照文件中該部分的需求，逐條確認做到
4. devlog 已更新
5. 已 commit
