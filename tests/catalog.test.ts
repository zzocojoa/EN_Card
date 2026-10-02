import { afterEach, beforeEach, expect, it } from 'vitest';
import { cardPage, deliveryPage, homeSummary } from '../src/worker/catalog';
import { saveCard } from '../src/worker/storage';
import { dueSchedule, harness, NOW, SAMPLE, type Harness } from './helpers';

let h: Harness;
beforeEach(async () => {
  h = await harness();
});
afterEach(async () => {
  await h.mf.dispose();
});

it('검색은 첫 100장 밖의 표현·한글 뜻도 찾고 필터와 커서를 함께 적용한다', async () => {
  const ids = Array.from({ length: 205 }, () => crypto.randomUUID());
  await h.env.DB.batch(
    ids.map((id, index) =>
      h.env.DB.prepare(
        'INSERT INTO cards(id,revision,content,status,created_at) VALUES(?,1,?,?,?)',
      ).bind(
        id,
        JSON.stringify({
          ...SAMPLE,
          expression: index === 0 ? 'A 100% literal_match' : `Search ${index}`,
          meaning_ko: index === 0 ? '오래된 첫 카드' : '검색 연습',
          ...(index === 1
            ? { template: 'comparison', base_expression: 'Thanks', base_meaning_ko: '고마워' }
            : {}),
        }),
        'draft',
        NOW + index,
      ),
    ),
  );
  const all = await cardPage(h.env, null);
  expect(all.total).toBe(205);
  expect(all.items).toHaveLength(100);
  const first = await cardPage(h.env, null, {
    q: 'search',
    status: 'draft',
    template: 'expression',
  });
  expect(first.total).toBe(203);
  expect(first.items).toHaveLength(100);
  const second = await cardPage(h.env, first.next, {
    q: 'search',
    status: 'draft',
    template: 'expression',
  });
  const third = await cardPage(h.env, second.next, {
    q: 'search',
    status: 'draft',
    template: 'expression',
  });
  expect(third.items).toHaveLength(3);
  expect(third.next).toBeNull();
  expect(
    new Set([...first.items, ...second.items, ...third.items].map((item) => item.id)).size,
  ).toBe(203);
  expect((await cardPage(h.env, null, { q: '오래된' })).items.map((item) => item.id)).toEqual([
    ids[0],
  ]);
  expect(
    (await cardPage(h.env, null, { q: '100% literal_' })).items.map((item) => item.id),
  ).toEqual([ids[0]]);
  expect((await cardPage(h.env, null, { q: "' OR 1=1 --" })).total).toBe(0);
  expect(
    (await cardPage(h.env, null, { template: 'comparison' })).items.map((item) => item.id),
  ).toEqual([ids[1]]);
  await expect(cardPage(h.env, null, { status: 'invalid' })).rejects.toThrow();
  await expect(cardPage(h.env, null, { q: 'x'.repeat(201) })).rejects.toThrow();
});

it('전체 집계·확인 필요 필터는 첫 페이지 밖 결과 불명을 찾고 종료한 결과를 제외한다', async () => {
  const scheduleId = await dueSchedule(h.env, 1, NOW);
  const item = await h.env.DB.prepare(
    'SELECT asset_id,payload FROM schedule_items WHERE schedule_id=?',
  )
    .bind(scheduleId)
    .first<{ asset_id: string; payload: string }>();
  for (let start = 0; start < 105; start += 35) {
    const statements = [];
    for (let i = start; i < Math.min(105, start + 35); i++) {
      const occurrence = `occ-${i}`;
      statements.push(
        h.env.DB.prepare("INSERT INTO occurrences VALUES(?,?,1,?,'live',?)").bind(
          occurrence,
          scheduleId,
          NOW + i,
          NOW,
        ),
      );
      statements.push(
        h.env.DB.prepare(
          "INSERT INTO deliveries(id,occurrence_id,schedule_id,schedule_version,position,asset_id,payload,state,mode,due_at_utc,updated_at,resolution) VALUES(?,?,?,1,0,?,?,?,'live',?,?,?)",
        ).bind(
          `delivery-${i}`,
          occurrence,
          scheduleId,
          item!.asset_id,
          item!.payload,
          i < 2 ? 'unknown' : 'sent',
          NOW + i,
          NOW,
          i === 1 ? 'abandoned' : null,
        ),
      );
    }
    await h.env.DB.batch(statements);
  }
  const all = await deliveryPage(h.env, null);
  expect(all.items).toHaveLength(100);
  expect(all.items.every((item) => item.state === 'sent')).toBe(true);
  const attention = await deliveryPage(h.env, null, { filter: 'attention' });
  expect(attention.total).toBe(1);
  expect(attention.items.map((item) => item.id)).toEqual(['delivery-0']);
  expect(attention.items[0]).toMatchObject({
    card_title: SAMPLE.expression,
    schedule_name: '아침 카드',
  });
  expect(await homeSummary(h.env)).toMatchObject({
    ready_cards: 1,
    attention: 1,
    api_accepted: 103,
    next_schedule: { id: scheduleId, due_at_utc: NOW },
  });
  const original = await h.env.DB.prepare('SELECT card_id FROM assets WHERE id=?')
    .bind(item!.asset_id)
    .first<{ card_id: string }>();
  await saveCard(
    { ...SAMPLE, expression: 'Changed later' },
    original!.card_id,
    1,
    h.env,
    NOW + 200,
  );
  expect((await deliveryPage(h.env, null, { filter: 'attention' })).items[0]!.card_title).toBe(
    SAMPLE.expression,
  );
  expect((await homeSummary(h.env)).ready_cards).toBe(0);
  await h.env.DB.prepare("UPDATE deliveries SET state='sending' WHERE id='delivery-0'").run();
  expect((await deliveryPage(h.env, null, { filter: 'attention' })).items[0]!.state).toBe(
    'sending',
  );
  expect((await homeSummary(h.env)).attention).toBe(1);
});

it('다음 예약은 활성 예약 중 가장 이른 시각을 반환하고 없으면 null이다', async () => {
  expect((await homeSummary(h.env)).next_schedule).toBeNull();
  const first = await dueSchedule(h.env, 1, NOW);
  const second = await dueSchedule(h.env, 1, NOW);
  await h.env.DB.prepare('UPDATE schedules SET next_run_at_utc=? WHERE id=?')
    .bind(NOW + 600_000, second)
    .run();
  expect((await homeSummary(h.env)).next_schedule!.id).toBe(first);
  await h.env.DB.prepare('UPDATE schedules SET enabled=0 WHERE id=?').bind(first).run();
  expect((await homeSummary(h.env)).next_schedule!.id).toBe(second);
});
