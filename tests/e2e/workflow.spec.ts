import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Card } from '../../src/shared/model';

const sample = {
  template: 'expression',
  expression: 'A verified preview',
  meaning_ko: '확인한 미리보기',
  example_en: 'Check the card before saving.',
  example_ko: '저장 전에 카드를 확인하세요.',
};

test('태블릿 메뉴에 접근성 이름이 유지된다', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/');
  const menu = page.getByRole('navigation', { name: '주 메뉴' });
  for (const name of ['카드 만들기', '카드 보관함', '발송 예약', '발송 기록', '연결 및 설정']) {
    await expect(menu.getByRole('button', { name, exact: true })).toHaveCount(1);
  }
});

test('카드 작성 → 실제 PNG → 저장·검토 → 예약 → 비소비 미리검증', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
  await expect(page.getByRole('heading', { name: '오늘, 어떤 표현을 담을까요?' })).toBeVisible();
  await page.getByLabel('영어 표현', { exact: true }).fill('A little progress every day');
  await page.getByLabel('한글 뜻', { exact: true }).fill('매일 조금씩 앞으로');
  await expect(page.locator('canvas')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 다운로드' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('PNG 다운로드 경로가 없습니다.');
  const png = await readFile(path);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(16)).toBe(1080);
  expect(new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(20)).toBe(1080);
  expect(png.length).toBeGreaterThan(15000);
  expect(png.length).toBeLessThan(1048576);
  await page.getByLabel('내용과 미리보기를 직접 검토했습니다.').check();
  await page.getByRole('button', { name: 'PNG 저장·검토 완료' }).click();
  await expect(page.getByRole('status')).toContainText('검토가 완료');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/editor-desktop.png', fullPage: true });
  await page.getByText('PNG 백업 복원', { exact: true }).click();
  await page
    .getByLabel('PNG 백업 파일')
    .setInputFiles({ name: 'restore.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('status')).toContainText('PNG를 복원');
  await expect(page.locator('.preview-paper img')).toBeVisible();
  await page.getByLabel('내용과 미리보기를 직접 검토했습니다.').check();
  await page.getByRole('button', { name: 'PNG 저장·검토 완료' }).click();
  await expect(page.getByRole('status')).toContainText('복원한 PNG의 검토');
  await page.getByRole('button', { name: '발송 예약', exact: true }).click();
  await page.getByLabel('예약 이름', { exact: true }).fill('브라우저 검증 예약');
  await page.getByLabel('A little progress every day', { exact: true }).last().check();
  await page.getByRole('button', { name: '예약 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('예약을 저장');
  await page.locator('.schedule-card').getByRole('button', { name: '수정', exact: true }).click();
  await page.getByLabel('예약 이름', { exact: true }).fill('수정한 브라우저 검증 예약');
  const updated = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' && response.url().includes('/api/schedules/'),
  );
  await page.getByRole('button', { name: '예약 수정 저장', exact: true }).click();
  expect((await updated).status()).toBe(200);
  await expect(page.locator('.schedule-card')).toContainText('수정한 브라우저 검증 예약');
  const before = await page.request.get('/api/state');
  const beforeState = (await before.json()) as { schedules: { id: string; cursor: number }[] };
  await page.getByRole('button', { name: '예약 발송 미리검증' }).click();
  await expect(page.getByRole('heading', { name: '보낸 기록, 남은 이야기' })).toBeVisible();
  await expect(page.getByText('시간·피드 형식 검사 완료.', { exact: false }).first()).toBeVisible();
  const after = await page.request.get('/api/state');
  const afterState = (await after.json()) as {
    schedules: { id: string; cursor: number }[];
    deliveries: unknown[];
  };
  expect(afterState.schedules.map((item) => item.cursor)).toEqual(
    beforeState.schedules.map((item) => item.cursor),
  );
  expect(afterState.deliveries).toHaveLength(0);
  expect(errors).toEqual([]);
});

test('편집한 두 번째 카드의 미리보기·저장·PNG 복원이 동일한 바이트를 사용한다', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
  await expect(page.getByRole('heading', { name: '오늘, 어떤 표현을 담을까요?' })).toBeVisible();
  const session = (await (await page.request.get('/api/state')).json()) as { csrf: string };
  const imported = await page.request.post('/api/import', {
    headers: { 'X-CSRF-Token': session.csrf, Origin: 'http://127.0.0.1:8787' },
    data: {
      schema_version: 1,
      cards: [sample, { ...sample, expression: 'Another verified preview' }],
    },
  });
  expect(imported.status()).toBe(201);
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await page.getByRole('button', { name: '카드 보관함', exact: false }).click();
  await page.locator('.library-card').nth(1).getByRole('button', { name: '편집하기' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const preview = await page
    .locator('canvas')
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png').split(',')[1]!);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 다운로드' }).click();
  const file = await downloadPromise;
  const path = await file.path();
  if (!path) throw new Error('PNG 파일이 없습니다.');
  expect(await readFile(path)).toEqual(Buffer.from(preview, 'base64'));
  await page.getByLabel('내용과 미리보기를 직접 검토했습니다.').check();
  await page.getByRole('button', { name: 'PNG 저장·검토 완료' }).click();
  await expect(page.getByRole('status')).toContainText('검토가 완료');
  const state = (await (await page.request.get('/api/state')).json()) as {
    assets: { public_id: string }[];
  };
  const saved = await page.request.get(`/images/${state.assets[0]!.public_id}.png`);
  expect(await saved.body()).toEqual(Buffer.from(preview, 'base64'));
  const backup = await page.locator('canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas가 없습니다.');
    ctx.fillStyle = '#214de5';
    ctx.fillRect(10, 10, 24, 24);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.getByText('PNG 백업 복원', { exact: true }).click();
  await page.getByLabel('PNG 백업 파일').setInputFiles({
    name: 'backup.png',
    mimeType: 'image/png',
    buffer: Buffer.from(backup, 'base64'),
  });
  await expect(page.locator('.preview-paper img')).toBeVisible();
  const restorePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 다운로드' }).click();
  const restoreFile = await restorePromise;
  const restorePath = await restoreFile.path();
  if (!restorePath) throw new Error('복원 PNG 파일이 없습니다.');
  expect(await readFile(restorePath)).toEqual(Buffer.from(backup, 'base64'));
});

test('저장·PNG 복원 응답을 기다리는 동안 편집 대상을 바꾸지 않고 다음 카드를 보존한다', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  const session = (await (await page.request.get('/api/state')).json()) as { csrf: string };
  const firstContent = { ...sample, expression: 'First card stays first' };
  const secondContent = { ...sample, expression: 'Second card stays second' };
  const firstResponse = await page.request.post('/api/cards', {
    headers: { 'X-CSRF-Token': session.csrf, Origin: 'http://127.0.0.1:8787' },
    data: firstContent,
  });
  const secondResponse = await page.request.post('/api/cards', {
    headers: { 'X-CSRF-Token': session.csrf, Origin: 'http://127.0.0.1:8787' },
    data: secondContent,
  });
  expect(firstResponse.status()).toBe(201);
  expect(secondResponse.status()).toBe(201);
  const first = (await firstResponse.json()) as { id: string };
  const second = (await secondResponse.json()) as { id: string };
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  const library = page.getByRole('button', { name: '카드 보관함', exact: false });
  await library.click();
  await page
    .locator('.library-card')
    .filter({ has: page.getByRole('heading', { name: firstContent.expression, exact: true }) })
    .getByRole('button', { name: '편집하기' })
    .click();
  let releaseSave!: () => void;
  const saveBarrier: Promise<void> = new Promise((resolve) => {
    releaseSave = resolve;
  });
  await page.route(`**/api/cards/${first.id}`, async (route) => {
    const response = await route.fetch();
    await saveBarrier;
    await route.fulfill({ response });
  });
  const pendingSave = page.waitForRequest(
    (request) => request.method() === 'PUT' && request.url().endsWith(`/api/cards/${first.id}`),
  );
  await page.getByRole('button', { name: 'PNG와 초안 저장' }).click();
  await pendingSave;
  try {
    await expect(library).toBeDisabled();
    await library.click({ force: true });
    await expect(page.getByLabel('영어 표현', { exact: true })).toHaveValue(
      firstContent.expression,
    );
  } finally {
    releaseSave();
  }
  await expect(page.getByRole('status')).toContainText('PNG를 저장했습니다');
  await library.click();
  await page
    .locator('.library-card')
    .filter({ has: page.getByRole('heading', { name: secondContent.expression, exact: true }) })
    .getByRole('button', { name: '편집하기' })
    .click();
  await page.getByRole('button', { name: 'PNG와 초안 저장' }).click();
  await expect(page.getByRole('status')).toContainText('PNG를 저장했습니다');
  const backup: string = await page
    .locator('canvas')
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL('image/png').split(',')[1]!);
  let releaseRestore!: () => void;
  const restoreBarrier: Promise<void> = new Promise((resolve) => {
    releaseRestore = resolve;
  });
  await page.route(`**/api/cards/${second.id}/image`, async (route) => {
    const response = await route.fetch();
    await restoreBarrier;
    await route.fulfill({ response });
  });
  const pendingRestore = page.waitForRequest((request) =>
    request.url().endsWith(`/api/cards/${second.id}/image`),
  );
  await page.getByText('PNG 백업 복원', { exact: true }).click();
  await page.getByLabel('PNG 백업 파일').setInputFiles({
    name: 'second-card.png',
    mimeType: 'image/png',
    buffer: Buffer.from(backup, 'base64'),
  });
  await pendingRestore;
  try {
    await expect(library).toBeDisabled();
    await library.click({ force: true });
    await expect(page.getByLabel('영어 표현', { exact: true })).toHaveValue(
      secondContent.expression,
    );
  } finally {
    releaseRestore();
  }
  await expect(page.locator('.preview-paper img')).toBeVisible();
  await page.getByLabel('내용과 미리보기를 직접 검토했습니다.').check();
  await page.getByRole('button', { name: 'PNG 저장·검토 완료' }).click();
  await expect(page.getByRole('status')).toContainText('복원한 PNG의 검토');
  const state = (await (await page.request.get('/api/state')).json()) as { cards: Card[] };
  expect(state.cards.find((card) => card.id === first.id)?.content).toEqual(firstContent);
  expect(state.cards.find((card) => card.id === second.id)?.content).toEqual(secondContent);
  expect(state.cards.find((card) => card.id === second.id)?.status).toBe('ready');
});

test('100개를 넘는 보관함과 여러 JSON 백업 파일에 접근한다', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
  await expect(page.getByRole('heading', { name: '오늘, 어떤 표현을 담을까요?' })).toBeVisible();
  const session = (await (await page.request.get('/api/state')).json()) as { csrf: string };
  const response = await page.request.post('/api/import', {
    headers: { 'X-CSRF-Token': session.csrf, Origin: 'http://127.0.0.1:8787' },
    data: {
      schema_version: 1,
      cards: Array.from({ length: 100 }, (_, index) => ({
        ...sample,
        expression: `Pagination ${index}`,
      })),
    },
  });
  expect(response.status()).toBe(201);
  const extra = await page.request.post('/api/cards', {
    headers: { 'X-CSRF-Token': session.csrf, Origin: 'http://127.0.0.1:8787' },
    data: { ...sample, expression: 'Pagination extra' },
  });
  expect(extra.status()).toBe(201);
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await page.getByRole('button', { name: '카드 보관함', exact: false }).click();
  await expect(page.locator('.library-card')).toHaveCount(100);
  const state = (await (await page.request.get('/api/state')).json()) as {
    totals: { cards: number };
  };
  expect(state.totals.cards).toBeGreaterThan(100);
  await page.getByRole('button', { name: '더 불러오기' }).click();
  await expect(page.locator('.library-card')).toHaveCount(state.totals.cards);
  const firstPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSON 백업 ↓', exact: false }).click();
  const first = await firstPromise;
  const firstPath = await first.path();
  if (!firstPath) throw new Error('첫 JSON 백업이 없습니다.');
  expect(
    (JSON.parse(await readFile(firstPath, 'utf8')) as { cards: unknown[] }).cards,
  ).toHaveLength(100);
  const nextPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '다음 JSON 백업' }).click();
  const next = await nextPromise;
  const nextPath = await next.path();
  if (!nextPath) throw new Error('두 번째 JSON 백업이 없습니다.');
  expect((JSON.parse(await readFile(nextPath, 'utf8')) as { cards: unknown[] }).cards).toHaveLength(
    state.totals.cards - 100,
  );
});

test('세션 만료 후 화면에서 다시 로그인할 수 있다', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await context.clearCookies();
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.getByRole('button', { name: '로컬 작업실 열기' })).toBeVisible();
  await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
  await expect(page.getByRole('heading', { name: '오늘, 어떤 표현을 담을까요?' })).toBeVisible();
});
test('비교형·긴 문장·JSON 가져오기·모바일 표시', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
  await page.getByRole('button', { name: '비교형', exact: true }).click();
  await page.getByLabel('기본 영어 표현').fill('Thank you');
  await page.getByLabel('기본 표현의 뜻').fill('고마워');
  await page.getByLabel('영어 표현', { exact: true }).fill('I really appreciate it');
  await page.getByLabel('한글 뜻', { exact: true }).fill('정말 고맙게 생각해');
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/editor-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const comparisonDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 다운로드' }).click();
  const comparison = await comparisonDownload;
  const comparisonPath = await comparison.path();
  if (!comparisonPath) throw new Error('비교형 PNG가 없습니다.');
  const comparisonPng = await readFile(comparisonPath);
  expect(
    new DataView(
      comparisonPng.buffer,
      comparisonPng.byteOffset,
      comparisonPng.byteLength,
    ).getUint32(16),
  ).toBe(1080);
  expect(comparisonPng.length).toBeGreaterThan(15000);
  await page.getByLabel('영어 예문', { exact: true }).fill('W'.repeat(500));
  await expect(page.getByRole('alert')).toContainText('모두 들어가지');
  await expect(page.getByRole('button', { name: 'PNG와 초안 저장' })).toBeDisabled();
  await page.getByRole('button', { name: '카드 보관함', exact: false }).click();
  await page.getByRole('button', { name: '예제 12개 가져오기' }).click();
  await expect(page.getByRole('status')).toContainText('초안으로 가져왔습니다');
  await page.getByRole('button', { name: 'JSON 가져오기', exact: true }).click();
  await page.getByLabel('가져올 JSON').fill('{"schema_version":1,"cards":[{}]}');
  await page.getByRole('button', { name: '가져오기', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('1번째');
});
