// 把專案根目錄 shared/ 的人設、設定、prompt 模板與 JSON Schema 整理成一個 JSON 檔，
// 讓 Web App 直接 import。shared/ 才是唯一的來源；src/generated/ 是產物，不進版控。
// 會在 npm run dev / build / test 之前自動執行。
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const sharedDir = join(here, "..", "..", "shared");
const outFile = join(here, "..", "src", "generated", "shared.json");

const readYaml = (name) => parse(readFileSync(join(sharedDir, name), "utf8"));
const readDir = (dir, ext, convert) =>
  Object.fromEntries(
    readdirSync(join(sharedDir, dir))
      .filter((file) => file.endsWith(ext))
      .sort()
      .map((file) => [file.slice(0, -ext.length), convert(readFileSync(join(sharedDir, dir, file), "utf8"))]),
  );

const personaFile = readYaml("personas.yaml");
const shared = {
  settings: readYaml("settings.yaml"),
  personas: personaFile.personas,
  layBannedTerms: personaFile.lay_banned_terms,
  groupRules: personaFile.group_rules,
  prompts: readDir("prompts", ".txt", (text) => text),
  schemas: readDir("schemas", ".schema.json", (text) => JSON.parse(text)),
};

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, JSON.stringify(shared, null, 2) + "\n");
console.log(`已同步 shared/ → ${outFile}（${shared.personas.length} 位陪審員）`);
