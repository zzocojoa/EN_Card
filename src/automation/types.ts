import type { Env } from '../worker/types';
import type { AutomationStatus, Provider } from '../shared/automation';
export type AutomationEnv = Pick<
  Env,
  'DB' | 'CARD_IMAGES' | 'APP_ORIGIN' | 'COST_MODE' | 'SEND_MODE'
> & {
  FONT_ASSETS: Fetcher;
  AUTOMATION_MODE?: string;
  AI_FREE_CONFIRMED?: string;
  // Scoped key derived from the existing studio bridge; supplied per private DO request, never stored.
  AI_RELAY_KEY?: string;
};
export type Run = {
  id: string;
  day: string;
  dedupe_key: string;
  kind: 'daily' | 'trial';
  item_index: number;
  item_count: number;
  not_before: number;
  config_version: number;
  settings: string;
  due_at: number;
  deadline: number;
  status: AutomationStatus;
  writer: Provider;
  reviewer: Provider;
  revision: number;
  content: string | null;
  content_hash: string | null;
  review: string | null;
  review_hash: string | null;
  card_id: string;
  asset_id: string;
  public_id: string;
  schedule_id: string;
  claim_owner: string | null;
  claim_until: number | null;
  retry_at: number | null;
  error: string | null;
  updated_at: number;
  render_attempts: number;
};
export type SettingsRow = {
  settings: string;
  version: number;
  enabled: number;
  reason: string | null;
  next_due_at: number | null;
  updated_at: number;
};
export const ACTIVE = "('draft','review','revise','render','schedule')";
export const currentGuard = `EXISTS(SELECT 1 FROM automation_settings c WHERE c.singleton=1 AND c.enabled=1 AND c.version=automation_runs.config_version)`;
// Application timing policy, not provider limits. Keep the claim lease and KV wait independent.
export const AUTOMATION_TIMING = {
  preparationMs: 60 * 60_000,
  deadlineMarginMs: 5 * 60_000,
  claimMs: 2 * 60_000,
  imagePropagationMs: 2 * 60_000,
  aiRetryMs: 60_000,
} as const;
export function readiness(env: AutomationEnv): string[] {
  return [
    env.COST_MODE === 'free_only' ? null : 'COST_MODE',
    env.AUTOMATION_MODE === 'live' ? null : 'AUTOMATION_MODE',
    env.AI_FREE_CONFIRMED === 'google_groq_free' ? null : 'AI_FREE_CONFIRMED',
    env.AI_RELAY_KEY && /^[a-f0-9]{64}$/.test(env.AI_RELAY_KEY) ? null : 'SITE_AI_CONNECTION',
  ].filter((v): v is string => v !== null);
}
