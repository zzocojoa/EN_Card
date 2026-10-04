import { z } from 'zod';
import { cardSchema } from '../../src/shared/model';

export const durableInput = z
  .object({
    job: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
    card: cardSchema,
    number: z.number().int().min(1).max(999),
  })
  .strict();
export const DURABLE_BODY_LIMIT = 16_384;
export const DURABLE_TRIAL_SLOTS = 4;
export const DURABLE_ATTEMPTS_PER_SLOT = 10;
