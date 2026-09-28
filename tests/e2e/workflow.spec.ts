import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

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
  await page
    .getByLabel('영어 예문', { exact: true })
    .fill('This is a very long sentence. '.repeat(80));
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
