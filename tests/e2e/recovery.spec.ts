import { expect, test } from '@playwright/test';
import type { AppState, AttemptHistory } from '../../src/web/api';
import { seed } from './db';

test('R7 저장 인증정보 오류를 표시하고 잘못된 설정의 복구 확인을 거부한다', async ({
  page,
}, info) => {
  const now = Date.now();
  await seed(
    `INSERT INTO credentials(singleton,owner_id,access_token,refresh_token,expires_at,refresh_expires_at,version,status,refresh_failure) VALUES(1,'storage-test','invalid-access','invalid-refresh',${now + 3600_000},${now + 86400_000},1,'needs_reconnect','configuration');`,
    info,
  );
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
    await page.getByRole('button', { name: '연결 및 설정', exact: true }).click();
    await expect(page.getByText('저장 인증정보 오류', { exact: true })).toBeVisible();
    await expect(
      page.getByText('저장 인증정보를 읽을 수 없어 자동 발송을 중지했습니다.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: '토큰 갱신 다시 시도' })).toHaveCount(0);
    const response = page.waitForResponse((result) =>
      result.url().endsWith('/api/connection/retry'),
    );
    await page.getByRole('button', { name: '설정 복구 확인', exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(503);
    const body = (await result.json()) as { error: string; message: string };
    expect(body.error).toBe('TOKEN_STORAGE_CONFIG');
    expect(body.message).not.toContain('invalid-access');
    expect(body.message).not.toContain('invalid-refresh');
    const state = (await (await page.request.get('/api/state')).json()) as AppState;
    expect(state.connection).toMatchObject({
      status: 'needs_reconnect',
      refresh_failure: 'configuration',
      version: 1,
    });
    expect(state.connection).not.toHaveProperty('access_token');
    expect(state.connection).not.toHaveProperty('refresh_token');
  } finally {
    await seed("DELETE FROM credentials WHERE owner_id='storage-test';", info);
  }
});

test('이전 버전·취소 예약의 결과 불명을 수신 확인 없이 종료하고 이력을 표시한다', async ({
  page,
}, info) => {
  const scheduleId: string = crypto.randomUUID();
  const cardId: string = crypto.randomUUID();
  const assetId: string = crypto.randomUUID();
  const deliveryId: string = crypto.randomUUID();
  const occurrenceId: string = crypto.randomUUID();
  const now: number = Date.now();
  await seed(
    `
    INSERT INTO cards(id,revision,content,status,created_at) VALUES('${cardId}',1,'{"template":"expression","expression":"Recovery fixture","meaning_ko":"복구 검사","example_en":"Keep the history.","example_ko":"이력을 보존하세요."}','draft',${now});
    INSERT INTO assets(id,card_id,revision,snapshot,kv_key,public_id,bytes,state,created_at,usage_day) VALUES('${assetId}','${cardId}',1,'{"expression":"Recovery fixture"}','${assetId}','${assetId}',33,'ready',${now},'2026-09-29');
    INSERT INTO schedules(id,name,kind,date,time,weekdays,cards_per_occurrence,timezone,version,enabled,reason) VALUES('${scheduleId}','이전 예약 복구','daily','2026-09-28','12:05','[]',1,'Asia/Seoul',2,0,'cancelled');
    INSERT INTO occurrences VALUES('${occurrenceId}','${scheduleId}',1,${now},'mock',${now});
    INSERT INTO deliveries(id,occurrence_id,schedule_id,schedule_version,position,asset_id,payload,state,mode,due_at_utc,error,updated_at) VALUES('${deliveryId}','${occurrenceId}','${scheduleId}',1,0,'${assetId}','{}','unknown','mock',${now},'과거 토큰 발송의 응답 유실',${now});
    INSERT INTO delivery_attempts VALUES('${crypto.randomUUID()}','${deliveryId}','fixture-owner',${now},'2026-09-29','unknown','원래 발송 결과는 불명','mock');
  `,
    info,
  );
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
    await page.getByRole('button', { name: '발송 기록', exact: true }).click();
    const article = page.locator('article').filter({ hasText: '과거 토큰 발송의 응답 유실' });
    await article.getByRole('button', { name: '결과 확인', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '결과 불명 확인' });
    await expect(dialog).toContainText('이는 수신 확인이 아니며');
    await expect(dialog.getByRole('button', { name: '재전송하지 않고 종료' })).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    const response = page.waitForResponse((result) =>
      result.url().endsWith(`/api/deliveries/${deliveryId}/resolve`),
    );
    await dialog.getByRole('button', { name: '재전송하지 않고 종료' }).click();
    expect((await response).status()).toBe(200);
    await expect(article).toContainText('재전송 없이 종료 (수신 미확인)');
    await expect(article.getByRole('button', { name: '결과 확인' })).toHaveCount(0);
    await article.getByText('시도별 호출 기록 · 사용자 확인').click();
    await expect(article).toContainText('수신 여부를 확정하지 않고 재전송 포기');
    await expect(article).toContainText('원래 발송 결과는 불명');
    const state = (await (await page.request.get('/api/state')).json()) as AppState;
    expect(state.schedules.find((item) => item.id === scheduleId)).toMatchObject({
      version: 2,
      enabled: 0,
      reason: 'cancelled',
    });
    expect(state.deliveries.find((item) => item.id === deliveryId)).toMatchObject({
      state: 'unknown',
      resolution: 'abandoned',
      confirmed_by_user: 0,
      occurrence_state: 'abandoned',
    });
    const history = (await (
      await page.request.get(`/api/deliveries/${deliveryId}/attempts`)
    ).json()) as AttemptHistory;
    expect(history.decisions).toHaveLength(1);
  } finally {
    await seed(
      `DELETE FROM manual_decisions WHERE delivery_id='${deliveryId}'; DELETE FROM delivery_attempts WHERE delivery_id='${deliveryId}'; DELETE FROM deliveries WHERE id='${deliveryId}'; DELETE FROM occurrences WHERE id='${occurrenceId}'; DELETE FROM schedules WHERE id='${scheduleId}'; UPDATE assets SET state='deleted' WHERE id='${assetId}'; DELETE FROM assets WHERE id='${assetId}'; DELETE FROM cards WHERE id='${cardId}';`,
      info,
    );
  }
});

test('토큰 일시 오류와 소진을 구분하고 재로그인 없이 갱신 재시도를 시작한다', async ({
  page,
}, info) => {
  const now: number = Date.now();
  await seed(
    `INSERT INTO credentials(singleton,owner_id,expires_at,refresh_expires_at,version,status,refresh_attempts,refresh_failure,refresh_retry_at,refresh_http_status,refresh_provider_error) VALUES(1,'test-owner',${now - 1},${now + 86400_000},1,'connected',1,'transient',${now + 60_000},503,'temporarily_unavailable');`,
    info,
  );
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '로컬 작업실 열기' }).click();
    await page.getByRole('button', { name: '연결 및 설정', exact: true }).click();
    await expect(
      page.getByText('토큰 갱신 일시 오류로 대기 중입니다. 재로그인은 필요하지 않습니다.'),
    ).toBeVisible();
    await expect(page.getByText('다음 갱신:', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: '토큰 갱신 다시 시도' })).toHaveCount(0);
    await seed(
      "UPDATE credentials SET refresh_attempts=3,refresh_failure='exhausted',refresh_retry_at=NULL WHERE singleton=1;",
      info,
    );
    await page.reload();
    await page.getByRole('button', { name: '연결 및 설정', exact: true }).click();
    await expect(
      page.getByText('토큰 갱신 자동 재시도 3회를 소진했습니다.', { exact: false }),
    ).toBeVisible();
    const response = page.waitForResponse((result) =>
      result.url().endsWith('/api/connection/retry'),
    );
    await page.getByRole('button', { name: '토큰 갱신 다시 시도' }).click();
    expect((await response).status()).toBe(200);
    const state = (await (await page.request.get('/api/state')).json()) as AppState;
    expect(state.connection).toMatchObject({
      status: 'connected',
      version: 2,
      refresh_attempts: 0,
      refresh_failure: null,
    });
  } finally {
    await seed("DELETE FROM credentials WHERE owner_id='test-owner';", info);
  }
});
