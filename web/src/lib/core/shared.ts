// 讀取由 shared/ 產生的設定（scripts/sync-shared.mjs）。
// 這裡只定義型別與存取方式；內容的唯一來源是專案根目錄的 shared/。
import raw from "@/generated/shared.json";

export type Group = "文學專業" | "一般讀者" | "跨界視角";

export interface Persona {
  code: string;
  name: string;
  group: Group;
  background: string;
  focus: string;
  tone: string;
  voice_traits: string;
  vocabulary_rule: string;
  enabled: boolean;
  version: number;
}

export interface GenreRule {
  min_chars: number;
  max_chars: number;
  max_lines?: number;
  description: string;
}

export interface RoleConfig {
  max_tokens: number;
  thinking: "disabled" | "adaptive";
  effort: "low" | "medium" | "high" | null;
  timeout_seconds: number;
  max_retries: number;
}

export interface Settings {
  default_provider: "anthropic" | "mock";
  models: Record<string, string>;
  juror: RoleConfig;
  juror_output: {
    one_line_max: number;
    comment_min: number;
    comment_max: number;
    length_tolerance: number;
  };
  jury: { size_by_group: Record<string, number>; min_success: number; concurrency: number };
  judge: RoleConfig;
  judge_output: {
    headline_max: number;
    verdict_min: number;
    verdict_max: number;
    minority_min: number;
    minority_max: number;
    disagreement_max: number;
    min_cited_jurors: number;
    banned_words: string[];
    length_tolerance: number;
  };
  advice: RoleConfig;
  advice_output: { min_items: number; max_items: number; max_weaknesses: number };
  stats: {
    controversy_high_std: number;
    controversy_mid_std: number;
    controversy_split_low: number;
    controversy_split_high: number;
    top_tags: number;
    potential_labels: { min: number; label: string }[];
  };
  genres: Record<string, GenreRule>;
  pricing: Record<string, { input_per_mtok: number; output_per_mtok: number }>;
  mock: { min_delay_seconds: number; max_delay_seconds: number; failure_rate: number };
  web: {
    daily_quota_per_user: number;
    global_daily_limit: number;
    timezone: string;
    stale_minutes: number;
    rate_limit_per_minute: number;
    monthly_budget_usd: number;
    modules: string[];
    default_modules: string[];
  };
}

interface Shared {
  settings: Settings;
  personas: Persona[];
  layBannedTerms: string[];
  groupRules: Record<Group, string>;
  prompts: Record<string, string>;
  schemas: Record<string, unknown>;
}

const shared = raw as unknown as Shared;

export const settings: Settings = shared.settings;
export const personas: Persona[] = shared.personas;
export const layBannedTerms: string[] = shared.layBannedTerms;
export const groupRules = shared.groupRules;
export const prompts = shared.prompts;

export const GENRES = Object.keys(settings.genres);
export const GROUPS: Group[] = ["文學專業", "一般讀者", "跨界視角"];
export const schemas = shared.schemas;
