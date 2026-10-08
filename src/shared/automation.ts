import { z } from 'zod';
import { cardSchema, scheduleSchema } from './model';
import { nextRun } from './time';

export const MAX_AUTOMATION_CARDS_PER_DAY = 5;
// Initial duplicate plus two replacements. Existing AI attempt budgets still apply.
export const MAX_DUPLICATE_CANDIDATES = 3;
export const automationTrial = z
  .object({
    cards: z.number().int().min(1).max(MAX_AUTOMATION_CARDS_PER_DAY).default(1),
    due_at: z.number().int().safe().positive().optional(),
  })
  .strict();
export type AutomationTrial = z.infer<typeof automationTrial>;
export function trialLeadMinutes(cards: number): number {
  // Five-card trials use the regular schedule's full hour, including its
  // five-minute cutoff. Stored runs keep their original preparation window.
  if (cards === 5) return 60;
  // Six minute ticks for draft/review/render/KV propagation/schedule, plus
  // two duplicate draft replacements per slot. Other failures can still expire.
  return cards === 1 ? 25 : cards * (6 + MAX_DUPLICATE_CANDIDATES - 1) + 5;
}
export const automationSettings = z
  .object({
    topic: z.string().trim().min(1).max(120),
    base_expression: z.string().trim().max(200),
    level: z.enum(['초급', '중급', '고급']),
    template: z.enum(['expression', 'comparison']),
    start_date: scheduleSchema.shape.date,
    end_date: scheduleSchema.shape.end_date,
    time: scheduleSchema.shape.time,
    cards_per_day: z.number().int().min(1).max(MAX_AUTOMATION_CARDS_PER_DAY).default(1),
  })
  .strict()
  .refine((v) => !v.end_date || v.end_date >= v.start_date, '종료일을 확인하세요.');
export type AutomationSettings = z.infer<typeof automationSettings>;
export function nextAutomationDue(settings: AutomationSettings, after: number): number | null {
  return nextRun(
    {
      kind: 'daily',
      date: settings.start_date,
      time: settings.time,
      end_date: settings.end_date,
      weekdays: [],
    },
    after,
  );
}
export const AI_MODELS = { google: 'gemini-3.1-flash-lite', groq: 'openai/gpt-oss-120b' } as const;
// Suggestions only: each chosen expression still requires a complete independent card review.
export const expressionCandidatesSchema = z
  .object({
    expressions: z.array(z.string().trim().min(1).max(120)).min(1).max(10),
  })
  .strict();
export type Provider = keyof typeof AI_MODELS;
export const opposite = (provider: Provider): Provider =>
  provider === 'google' ? 'groq' : 'google';
export const reviewSchema = z
  .object({
    natural: z.boolean(),
    meaning: z.boolean(),
    grammar: z.boolean(),
    translation: z.boolean(),
    level: z.boolean(),
    comparison: z.boolean(),
    issues: z.array(z.string().trim().min(1).max(200)).max(6),
  })
  .strict();
export type AiReview = z.infer<typeof reviewSchema>;
export const reviewPassed = (r: AiReview): boolean =>
  r.natural &&
  r.meaning &&
  r.grammar &&
  r.translation &&
  r.level &&
  r.comparison &&
  r.issues.length === 0;
// All fields are required for Groq strict JSON Schema; unused comparison fields are empty.
export const aiCardSchema = z
  .object({
    template: z.enum(['expression', 'comparison']),
    expression: z.string().min(1).max(120),
    meaning_ko: z.string().min(1).max(120),
    example_en: z.string().min(1).max(240),
    example_ko: z.string().min(1).max(240),
    note_ko: z.string().max(160),
    base_expression: z.string().max(120),
    base_meaning_ko: z.string().max(120),
  })
  .strict();
export function parseAiCard(value: unknown, settings: AutomationSettings) {
  const card = cardSchema.parse(aiCardSchema.parse(value));
  if (card.template !== settings.template) throw new Error('TEMPLATE');
  return card;
}
export const expressionKey = (expression: string): string => expression.trim().toLowerCase();
export type AutomationStatus =
  'draft' | 'review' | 'revise' | 'render' | 'schedule' | 'scheduled' | 'skipped' | 'cancelled';
export type AutomationRunView = {
  id: string;
  day: string;
  kind: 'daily' | 'trial';
  item_index: number;
  item_count: number;
  not_before: number;
  due_at: number;
  status: AutomationStatus;
  error: string | null;
  writer: Provider;
  reviewer: Provider;
  revision: number;
  card_id: string;
  asset_id: string;
  schedule_id: string;
  content: Record<string, unknown> | null;
  review: AiReview | null;
  public_id: string | null;
  updated_at: number;
  delivery_state: string | null;
};
export type AutomationView = {
  settings: AutomationSettings | null;
  version: number;
  enabled: boolean;
  reason: string | null;
  next_due_at: number | null;
  available: boolean;
  missing: string[];
  trial_used_today?: boolean;
};
export const automationReasons: Record<string, string> = {
  paused: '일시정지',
  changed: '설정 변경으로 중단',
  expired: '제작 마감이 지나 오늘은 건너뜀',
  review_failed: '수정 후에도 검토를 통과하지 못함',
  quality_replacement: '품질 검토에 탈락해 다른 표현으로 새 후보 제작 대기',
  duplicate: '이미 있는 표현',
  duplicate_retry: '중복을 피할 다른 표현으로 다시 제작 대기',
  duplicate_limit: `중복 표현 ${MAX_DUPLICATE_CANDIDATES}회로 재생성 한도에 도달함`,
  candidate_empty: '사용하지 않은 표현 후보를 다시 확인하는 중',
  candidate_limit: '미사용 표현 후보 확보 한도에 도달함',
  invalid: 'AI 응답 형식을 확인할 수 없음',
  auth: 'AI 인증 설정 확인 필요',
  quota: '무료 AI 호출 한도 확인 필요',
  config: '무료 실행 설정 확인 필요',
  unavailable: 'AI 연결 실패',
  ai_limit: '카드 한 장의 AI 호출 예산이 부족함',
  storage: '이미지 저장 실패·저장량 확인 필요',
  layout: '내용이 이미지 분량을 초과함',
  unresolved: '이전 발송 결과 확인 필요',
  connection: '카카오 연결을 확인한 뒤 자동 제작을 다시 시작하세요',
  complete: '설정한 기간 종료',
};
