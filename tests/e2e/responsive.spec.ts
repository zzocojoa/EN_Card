import { test, expect, type Page } from '@playwright/test';
import type { AppState } from '../../src/web/api';
import type { AutomationView } from '../../src/shared/automation';
import { formatKst } from '../../src/shared/time';

const now = Date.now();
const due = now + 86400000;
const state: AppState = {
  csrf: 'responsive-fixture',
  cards: [],
  assets: [],
  schedules: [],
  deliveries: [],
  cursors: { cards: null, assets: null, schedules: null, deliveries: null },
  totals: { cards: 0, assets: 0, schedules: 0, deliveries: 0, active_schedules: 0 },
  summary: { ready_cards: 0, attention: 0, api_accepted: 0, next_schedule: null },
  previews: [],
  usage: [],
  mode: 'live',
  now,
  connection: {
    status: 'connected',
    expires_at: due,
    refresh_expires_at: due,
    version: 1,
    refresh_attempts: 0,
    refresh_retry_at: null,
    refresh_failure: null,
    refresh_http_status: null,
    refresh_provider_error: null,
    refresh_provider_code: null,
  },
};
const automation: AutomationView = {
  settings: {
    topic: '영화 대사',
    base_expression: '',
    level: '초급',
    template: 'expression',
    start_date: '2026-10-05',
    end_date: '2026-10-31',
    time: '08:00',
    cards_per_day: 1,
  },
  version: 6,
  enabled: true,
  reason: null,
  next_due_at: due,
  available: true,
  trial_used_today: false,
  missing: [],
};
async function fixture(page: Page) {
  const current = {
    state: structuredClone(state),
    automation: structuredClone(automation),
    failure: false,
  };
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    if (request.method() !== 'GET') writes.push(request.url());
    const path = new URL(request.url()).pathname;
    if (path === '/api/boot')
      return route.fulfill({ json: { local: false, mode: 'live', kakao_configured: true } });
    if (path === '/api/state') return route.fulfill({ json: current.state });
    if (path === '/api/automation')
      return current.failure
        ? route.fulfill({ status: 503, json: { message: '일시적으로 연결할 수 없습니다.' } })
        : route.fulfill({ json: current.automation });
    if (path === '/api/automation/runs') return route.fulfill({ json: [] });
    if (path.startsWith('/api/page/'))
      return route.fulfill({ json: { items: [], total: 0, next: null } });
    return route.fulfill({ status: 500, json: { message: '예상하지 않은 요청' } });
  });
  return { current, writes };
}

test('홈은 가장 가까운 실제 일정을 선택하고 조회 실패·복구를 구분한다', async ({ page }) => {
  const { current, writes } = await fixture(page);
  await page.goto('/#/home');
  const next = page.locator('.next-card');
  const dueText = await page.evaluate(formatKst, due);
  const preparationText = await page.evaluate(formatKst, due - 3600000);
  const manualText = await page.evaluate(formatKst, due - 7200000);
  await expect(next.locator('.next-time')).toHaveText(dueText);
  await expect(next.getByRole('button', { name: '자동 제작 관리' })).toBeVisible();
  await expect(next).toContainText(`제작 시작 ${preparationText}`);
  current.state.summary.next_schedule = {
    id: 'manual',
    name: '먼저 보내는 카드',
    due_at_utc: due - 7200000,
    cards_per_occurrence: 1,
  };
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(next.locator('.next-time')).toHaveText(manualText);
  await expect(next).toContainText('먼저 보내는 카드');
  await expect(next.getByRole('button', { name: '예약 확인' })).toBeVisible();
  current.state.summary.next_schedule = null;
  current.automation.next_due_at = null;
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(next.getByRole('heading')).toHaveText('자동 제작이 실행 중이에요');
  await expect(next.getByRole('button', { name: '자동 제작 관리' })).toBeVisible();
  current.automation.next_due_at = due;
  current.failure = true;
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(next).toContainText('자동 제작 상태를 불러오지 못했어요');
  await expect(next.locator('.next-time')).toHaveCount(0);
  current.failure = false;
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(next.locator('.next-time')).toHaveText(dueText);
  await next.getByRole('button', { name: '자동 제작 관리' }).click();
  await expect(page).toHaveURL(/#\/automation$/);
  await expect(page.locator('.automation-status')).toHaveText('실행 중');
  expect(writes).toEqual([]);
});

test('아이폰 입력·초안·실행 일정과 화면 회전 후 메뉴를 보존한다', async ({
  page,
  isMobile,
}, info) => {
  const { current, writes } = await fixture(page);
  if (!isMobile) await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/home');
  const menu = page.getByRole('navigation', { name: '모바일 메뉴' });
  await menu.getByRole('button', { name: 'AI 자동 제작', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI 자동 제작', exact: true })).toBeFocused();
  await expect(page.locator('.automation-status')).toHaveText('실행 중');
  const plan = page.getByRole('complementary', { name: '현재 실행과 설정 저장' });
  const dueText = await page.evaluate(formatKst, due);
  await expect(plan).toContainText(`발송 예정${dueText}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: info.outputPath('automation-active-viewport.png') });
  await page.screenshot({
    path: info.outputPath('automation-active-portrait.png'),
    fullPage: true,
  });
  await page.getByLabel('주제', { exact: true }).fill('여행에서 쓸 표현 '.repeat(10));
  await page.getByRole('combobox', { name: '하루 제작 수량', exact: true }).selectOption('5');
  await page.getByLabel('시작일', { exact: true }).fill('2026-11-01');
  await page.getByLabel('종료일 (선택)', { exact: true }).fill('2026-11-30');
  await page.getByLabel('매일 받을 시각 (한국 시간)', { exact: true }).fill('09:30');
  await expect(plan).toContainText('저장하지 않은 변경이 있어요');
  await expect(plan).toContainText('현재 적용: 영화 대사 · 초급 · 하루 1장 · 매일 08:00');
  await expect(plan).toContainText(`발송 예정${dueText}`);
  for (const input of await page
    .locator('.automation-fields input, .automation-fields select')
    .all()) {
    const size = await input.boundingBox();
    expect(size!.height).toBeGreaterThanOrEqual(44);
    expect(size!.x + size!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(
      await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    ).toBeGreaterThanOrEqual(16);
  }
  for (const button of await menu.getByRole('button').all()) {
    const size = (await button.boundingBox())!;
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }
  await menu.getByRole('button', { name: '오늘의 작업실', exact: true }).click();
  await menu.getByRole('button', { name: 'AI 자동 제작', exact: true }).click();
  await expect(page.getByLabel('매일 받을 시각 (한국 시간)', { exact: true })).toHaveValue('09:30');
  await expect(page.getByRole('combobox', { name: '하루 제작 수량', exact: true })).toHaveValue(
    '5',
  );
  current.failure = true;
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.locator('.automation-status')).toHaveText('상태 확인 실패');
  await expect(plan).not.toContainText('설정한 일정으로 진행 중');
  await expect(page.getByLabel('매일 받을 시각 (한국 시간)', { exact: true })).toHaveValue('09:30');
  current.failure = false;
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.locator('.automation-status')).toHaveText('실행 중');
  await page.setViewportSize({ width: 844, height: 390 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .getByRole('navigation', { name: '주 메뉴', exact: true })
    .getByRole('button', { name: '연결 및 설정', exact: true })
    .click();
  await expect(page).toHaveURL(/#\/settings$/);
  await page
    .getByRole('navigation', { name: '주 메뉴', exact: true })
    .getByRole('button', { name: 'AI 자동 제작', exact: true })
    .click();
  await expect(page.getByLabel('매일 받을 시각 (한국 시간)', { exact: true })).toHaveValue('09:30');
  await page.screenshot({ path: info.outputPath('automation-landscape.png'), fullPage: true });
  expect(writes).toEqual([]);
});
