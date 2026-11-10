// 給 scripts/ 底下的工具用：讀取 web/.env.local，並檢查需要的變數都有填。
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const envPath = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");

export function loadEnv(required) {
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith("#")) continue;
      const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
      if (!(match[1] in process.env)) process.env[match[1]] = value;
    }
  }
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    console.error(`web/.env.local 缺少這些設定：${missing.join("、")}\n請照 web/.env.example 填好後再執行。`);
    process.exit(1);
  }
  return process.env;
}
