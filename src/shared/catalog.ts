import { z } from 'zod';

export const cardFilterSchema = z.object({
  q: z.string().trim().max(200).default(''),
  status: z.enum(['all', 'draft', 'ready']).default('all'),
  template: z.enum(['all', 'expression', 'comparison']).default('all'),
});
export type CardFilters = z.infer<typeof cardFilterSchema>;
export const deliveryFilterSchema = z.object({
  filter: z.enum(['all', 'attention']).default('all'),
});
export type HomeSummary = {
  ready_cards: number;
  attention: number;
  api_accepted: number;
  next_schedule: {
    id: string;
    name: string;
    due_at_utc: number;
    cards_per_occurrence: number;
  } | null;
};
