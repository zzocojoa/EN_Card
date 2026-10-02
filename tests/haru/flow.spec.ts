import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';

test('하루단어 로그인 → 표현형·비교형 PNG → 예약 저장, 개인 API와 원래 학습 기록 분리', async ({
  page,
  request,
}, info) => {
  const anonymous = await request.get('/api/card-studio/api/state');
  expect(anonymous.status()).toBe(401);
  await page.goto('/signin-with-chatgpt?return_to=%2F');
  await expect(page.getByRole('button', { name: '영어 카드', exact: true })).toBeVisible();
  const learningBefore = await (await page.request.get('/api/state')).json();
  await page.getByRole('button', { name: '영어 카드', exact: true }).click();
  await expect(page).toHaveURL(/\/cards$/);
  const frame = page.frameLocator('iframe');
  const navigation = frame.getByRole('navigation', { name: '주 메뉴', exact: true });
  await expect(navigation.getByRole('button', { name: '카드 만들기', exact: true })).toBeVisible();
  await expect(frame.getByLabel('운영자 등록·접속 토큰')).toHaveCount(0);
  const stamp = `${info.project.name}-${Date.now()}`;
  for (const template of ['expression', 'comparison']) {
    await navigation.getByRole('button', { name: '카드 만들기', exact: true }).click();
    if (template === 'comparison') {
      await frame.getByRole('button', { name: '비교형', exact: true }).click();
      await frame.getByRole('textbox', { name: '기본 영어 표현', exact: true }).fill('No hurry');
      await frame
        .getByRole('textbox', { name: '기본 표현의 뜻', exact: true })
        .fill('서두르지 않아도 돼');
    }
    await frame
      .getByRole('textbox', { name: '영어 표현', exact: true })
      .fill(`Take your time ${template === 'expression' ? 'today' : 'again'}`);
    await frame.getByRole('textbox', { name: '한글 뜻', exact: true }).fill('천천히 해');
    await frame
      .getByRole('textbox', { name: '영어 예문', exact: true })
      .fill('Take your time. We can leave later.');
    await frame
      .getByRole('textbox', { name: '예문 번역', exact: true })
      .fill('천천히 해. 우리는 나중에 출발해도 돼.');
    await expect(frame.locator('canvas')).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await frame.getByRole('button', { name: 'PNG 다운로드', exact: false }).click();
    const download = await downloadEvent;
    const file = await download.path();
    const png = await readFile(file!);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    const dimensions = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(dimensions.getUint32(16)).toBe(1080);
    expect(dimensions.getUint32(20)).toBe(1080);
    await frame.getByRole('checkbox', { name: '내용과 미리보기를 직접 검토했습니다.' }).check();
    await frame.getByRole('button', { name: 'PNG 저장·검토 완료', exact: true }).click();
    await expect(frame.locator('.workspace > .notice[role=status]')).toContainText('PNG');
  }
  await frame.getByRole('button', { name: '발송 예약', exact: true }).click();
  await frame.getByRole('button', { name: '새 예약', exact: false }).first().click();
  await frame
    .getByRole('textbox', { name: '예약 이름', exact: true })
    .fill(`하루단어 통합 검증 ${stamp}`);
  const future = new Date(Date.now() + 9 * 3600_000 + 15 * 60_000).toISOString();
  await frame.getByLabel('시작 날짜').fill(future.slice(0, 10));
  await frame.getByLabel('시각 · 한국 시간').fill(future.slice(11, 16));
  await frame.locator('.card-picker input[type=checkbox]').first().check();
  await frame.getByRole('button', { name: '예약 저장', exact: true }).click();
  await expect(frame.locator('.workspace > .notice[role=status]')).toContainText(
    '예약을 저장했습니다',
  );
  const state = await (await page.request.get('/api/card-studio/api/state')).json();
  expect(
    state.schedules.some(
      (schedule: { name: string }) => schedule.name === `하루단어 통합 검증 ${stamp}`,
    ),
  ).toBe(true);
  expect(state.mode).toBe('dry_run');
  await mkdir('backups/haru-integration', { recursive: true });
  await frame.locator('body').evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `backups/haru-integration/${info.project.name}-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(frame.getByRole('navigation', { name: '모바일 메뉴' })).toBeVisible();
  await frame.locator('body').evaluate(() => window.scrollTo(0, 0));
  expect(
    await frame
      .locator('body')
      .evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `backups/haru-integration/${info.project.name}-mobile.png`,
    fullPage: true,
  });
  await frame.getByRole('link', { name: '하루단어로 돌아가기', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:5175/');
  expect(await (await page.request.get('/api/state')).json()).toEqual(learningBefore);
});
