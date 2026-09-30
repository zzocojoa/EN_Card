import { z } from 'zod';

export const LIMITS = Object.freeze({
  imageBytes: 1_048_576,
  storageBytes: 200_000_000,
  uploadsPerDay: 100,
  activeSchedules: 10,
  cardsPerOccurrence: 5,
  sendsPerTick: 3,
  attemptsPerDay: 20,
  graceMs: 15 * 60_000,
  automaticAttempts: 3,
  tokenRefreshAttempts: 3,
  propagationMs: 120_000,
  claimMs: 60_000,
  importCards: 100,
  recoveryBatchSize: 40,
  jsonBytes: 1_000_000,
});
const shortText = z.string().trim().max(200);
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const timestamp: number = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  }, '존재하지 않는 날짜입니다.');
export const cardSchema = z
  .object({
    template: z.enum(['expression', 'comparison']),
    expression: shortText.min(1),
    meaning_ko: shortText.min(1),
    example_en: z.string().trim().min(1).max(500),
    example_ko: z.string().trim().min(1).max(500),
    pronunciation_ko: shortText.optional(),
    note_ko: z.string().trim().max(300).optional(),
    category: z.string().trim().max(40).optional(),
    level: z.string().trim().max(20).optional(),
    base_expression: shortText.optional(),
    base_meaning_ko: shortText.optional(),
  })
  .strict()
  .superRefine((card, ctx) => {
    if (card.template === 'comparison' && (!card.base_expression || !card.base_meaning_ko))
      ctx.addIssue({
        code: 'custom',
        message: '비교형에는 기본 표현과 뜻이 필요합니다.',
        path: ['base_expression'],
      });
  });
export type CardInput = z.infer<typeof cardSchema>;
export type Card = {
  id: string;
  revision: number;
  content: CardInput;
  status: 'draft' | 'ready';
  asset_id: string | null;
  created_at: number;
};
export type Asset = {
  id: string;
  card_id: string;
  revision: number;
  public_id: string;
  bytes: number;
  state: 'uploading' | 'ready' | 'cleanup_needed' | 'deleting';
  created_at: number;
  expression: string;
};
export const scheduleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(['once', 'daily', 'weekly']),
    date: calendarDate,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    end_date: calendarDate.nullable(),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7),
    cards_per_occurrence: z.number().int().min(1).max(LIMITS.cardsPerOccurrence),
    asset_ids: z.array(z.string().uuid()).min(1).max(40),
  })
  .strict()
  .superRefine((schedule, ctx) => {
    if (schedule.kind === 'weekly' && !schedule.weekdays.length)
      ctx.addIssue({ code: 'custom', message: '반복 요일을 선택하세요.', path: ['weekdays'] });
    if (schedule.end_date && schedule.end_date < schedule.date)
      ctx.addIssue({
        code: 'custom',
        message: '종료일은 시작일 이후여야 합니다.',
        path: ['end_date'],
      });
    if (new Set(schedule.asset_ids).size !== schedule.asset_ids.length)
      ctx.addIssue({
        code: 'custom',
        message: '같은 이미지를 중복 선택할 수 없습니다.',
        path: ['asset_ids'],
      });
    if (schedule.asset_ids.length < schedule.cards_per_occurrence)
      ctx.addIssue({
        code: 'custom',
        message: '회차에 필요한 카드가 부족합니다.',
        path: ['asset_ids'],
      });
    if (schedule.kind === 'once' && schedule.asset_ids.length > schedule.cards_per_occurrence)
      ctx.addIssue({
        code: 'custom',
        message: '한 번 예약에는 한 회차 카드 수만큼만 선택하세요.',
        path: ['asset_ids'],
      });
  });
export type ScheduleInput = z.infer<typeof scheduleSchema>;
export const recoverySchema = z
  .object({
    version: z.number().int().positive(),
    recover_ids: z.array(z.string().min(1).max(100)).max(LIMITS.recoveryBatchSize),
    exclude_ids: z.array(z.string().min(1).max(100)).max(LIMITS.recoveryBatchSize),
    date: calendarDate.nullable(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable(),
    warning_accepted: z.literal(true),
  })
  .strict()
  .superRefine((input, context) => {
    const ids: string[] = [...input.recover_ids, ...input.exclude_ids];
    if (!ids.length || new Set(ids).size !== ids.length)
      context.addIssue({
        code: 'custom',
        message: '복구·제외 대상은 중복 없이 한 번씩 선택하세요.',
      });
    if (ids.length > LIMITS.recoveryBatchSize)
      context.addIssue({
        code: 'custom',
        message: `복구·제외는 합계 ${LIMITS.recoveryBatchSize}장씩 처리하세요.`,
      });
  });
export type RecoveryInput = z.infer<typeof recoverySchema>;
export type RecoveryItem = {
  delivery_id: string;
  title: string;
  state: string;
  available: boolean;
  reason: string;
  decision: 'reschedule' | 'exclude' | null;
  target_schedule_id: string | null;
};
export type PausePreview = {
  schedule_id: string;
  version: number;
  remaining: number;
  can_resume: boolean;
  unresolved: boolean;
  pending_count?: number;
  history_next?: string | null;
  items: RecoveryItem[];
};
export type Schedule = ScheduleInput & {
  id: string;
  version: number;
  timezone: 'Asia/Seoul';
  next_run_at_utc: number | null;
  cursor: number;
  enabled: number;
  reason: string | null;
  pending_delivery_count: number;
  items: { asset_id: string; title: string }[];
};
export type SendMode = 'dry_run' | 'mock' | 'live';
export type DeliveryStatus =
  | 'pending'
  | 'claimed'
  | 'sending'
  | 'sent'
  | 'mock_sent'
  | 'retry_wait'
  | 'failed'
  | 'unknown'
  | 'cancelled'
  | 'missed'
  | 'blocked';
export type Delivery = {
  id: string;
  occurrence_id: string;
  schedule_id: string;
  schedule_version: number;
  position: number;
  asset_id: string;
  payload: string;
  state: DeliveryStatus;
  mode: SendMode;
  due_at_utc: number;
  attempts: number;
  auth_retries: number;
  claim_owner: string | null;
  claim_until: number | null;
  retry_at: number | null;
  manual_retry_until: number | null;
  error: string | null;
  updated_at: number;
  confirmed_by_user: number;
  resolution: 'abandoned' | null;
};
export type DeliverySummary = Pick<
  Delivery,
  | 'id'
  | 'occurrence_id'
  | 'schedule_id'
  | 'position'
  | 'state'
  | 'mode'
  | 'due_at_utc'
  | 'attempts'
  | 'error'
  | 'updated_at'
  | 'confirmed_by_user'
  | 'resolution'
> & { total_attempts: number; occurrence_state: string };
export type FeedPayload = {
  object_type: 'feed';
  content: {
    title: string;
    description: string;
    image_url: string;
    image_width: number;
    image_height: number;
    link: { web_url: string; mobile_web_url: string };
  };
  buttons: { title: string; link: { web_url: string; mobile_web_url: string } }[];
};
export type SendResult = {
  outcome: 'sent' | 'mock_sent' | 'retry' | 'unauthorized' | 'reconnect' | 'failed' | 'unknown';
  detail: string;
};
export type ImportResult = { cards: CardInput[]; errors: { index: number; message: string }[] };

export function parseImport(input: unknown): ImportResult {
  const envelope = z
    .object({
      schema_version: z.literal(1),
      cards: z.array(z.unknown()).max(LIMITS.importCards),
      next_cursor: z.string().max(300).nullable().optional(),
    })
    .strict()
    .parse(input);
  const seen: Set<string> = new Set<string>();
  const results = envelope.cards.map((value: unknown, index: number) => {
    const record = z
      .object({
        id: z.string().min(1).max(200).optional(),
        revision: z.number().int().positive().optional(),
      })
      .passthrough()
      .safeParse(value);
    if (!record.success) return { index, error: '카드 객체 형식이 잘못되었습니다.' };
    const { id, revision: _revision, ...content } = record.data;
    if (id && seen.has(id)) return { index, error: `중복 ID: ${id}` };
    if (id) seen.add(id);
    const parsed = cardSchema.safeParse(content);
    return parsed.success
      ? { index, card: parsed.data }
      : {
          index,
          error: parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; '),
        };
  });
  return {
    cards: results.flatMap((item) => (item.card ? [item.card] : [])),
    errors: results.flatMap((item) =>
      item.error ? [{ index: item.index, message: item.error }] : [],
    ),
  };
}
