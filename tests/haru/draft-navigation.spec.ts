import { test, expect, type APIRequestContext, type Page, type Route } from '@playwright/test';

const site = 'http://127.0.0.1:5175';
const stateHeaders = {
  'X-Study-Grammar': '3',
  'X-Study-Sense-Keys': '1',
  'X-Study-Feedback-Structure': '1',
  'X-Study-Review-Resume': '1',
  'X-Study-Monthly-Carryover': '1',
};
const apple = 'adb44eba7b3ceef3';
type Document = Record<string, unknown>;
type LearningState = {
  settings: Document;
  progress: Record<string, Document>;
  sessions: Record<string, Document & { records: Record<string, Document> }>;
  grammar: Record<string, Document>;
};
type Snapshot = { revision: number; state: LearningState };
let restoreFixture: (() => Promise<void>) | undefined;
test.use({ actionTimeout: 10_000, navigationTimeout: 15_000 });
test.afterEach(async () => {
  // Hooks have their own budget, so cleanup still runs after a test timeout.
  test.setTimeout(30_000);
  const restore = restoreFixture;
  restoreFixture = undefined;
  await restore?.();
});

async function snapshot(request: APIRequestContext): Promise<Snapshot> {
  const response = await request.get(`${site}/api/state`, { headers: stateHeaders });
  expect(response.status()).toBe(200);
  return response.json() as Promise<Snapshot>;
}
async function saved(page: Page) {
  await page.bringToFront();
  await expect(page.getByText('서버에 저장됨', { exact: true })).toBeVisible();
  // Let the acknowledged render and navigation-epoch effects commit before
  // starting the next user action (especially after a full WebKit reload).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(page.getByRole('button', { name: '영어 카드', exact: true })).toBeEnabled();
}
async function openGrammar(page: Page) {
  await page.getByRole('tab', { name: '전체 단어장', exact: true }).click();
  await page.getByRole('tab', { name: '품사·문장 연습', exact: true }).click();
  await page
    .locator('.grammar-tile')
    .filter({ has: page.locator('b', { hasText: /^명사$/ }) })
    .click();
}
async function cardRoundTrip(page: Page) {
  await page.getByRole('button', { name: '영어 카드', exact: true }).click();
  await expect(page).toHaveURL(`${site}/cards`);
  await page
    .frameLocator('iframe')
    .getByRole('link', { name: '하루단어로 돌아가기', exact: true })
    .click();
  await expect(page).toHaveURL(`${site}/`);
  await page.reload();
  await saved(page);
}
async function resumeStudy(page: Page) {
  const resume = page.getByRole('button', { name: '중단한 학습 이어서', exact: true });
  // Reopening is setup for the persistence assertion. Keyboard activation keeps
  // WebKit's window-focus clock refresh separate from the activation event.
  await resume.focus();
  await expect(resume).toBeEnabled();
  const response = page.waitForResponse(
    (result) =>
      new URL(result.url()).pathname === '/api/state' && result.request().method() === 'PUT',
  );
  await resume.press('Enter');
  expect((await response).status()).toBe(200);
  await saved(page);
}

test('카드 화면 이동은 학습·문법 저장 지연과 실패를 막고 재시도한 초안을 보존한다', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  // This fixed local owner is provided by the existing development sign-in.
  // Never send synthetic identity headers or seed a hosted account.
  expect(baseURL).toBe(site);
  expect((await request.get(`${site}/api/state`)).status()).toBe(401);
  const boot = await request.get('http://127.0.0.1:8787/api/boot');
  expect(await boot.json()).toMatchObject({ local: true, mode: 'dry_run' });
  const blockedRequests: string[] = [];
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin !== site ||
      (route.request().method() !== 'GET' && url.pathname !== '/api/state')
    ) {
      blockedRequests.push(`${route.request().method()} ${url.pathname}`);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.goto('/signin-with-chatgpt?return_to=%2F');
  await saved(page);
  const account = await page.request.get(`${site}/api/card-studio/account`);
  expect(await account.json()).toEqual({ userId: 'local_seedy', enabled: true });
  await page.getByRole('tab', { name: '전체 단어장', exact: true }).click();
  await expect(
    page.getByRole('tab', { name: '품사·문장 연습', exact: true }),
    'Enable the local grammar_enabled feature before running the draft regression',
  ).toBeVisible();
  await page.goto('/');
  await saved(page);
  const cardsBefore = await (await page.request.get(`${site}/api/card-studio/api/state`)).json();
  expect(cardsBefore.mode).toBe('dry_run');
  const before = await snapshot(page.request);
  const sessionId = crypto.randomUUID();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const material = {
    meaning: '사과',
    ipa: '',
    expression: 'an apple',
    expressionTranslation: '사과 하나',
    example: 'I have a book and an apple.',
    translation: '나는 책 한 권과 사과 한 개가 있어요.',
    source: '학습용 작성 예문',
  };
  const session = {
    id: sessionId,
    kind: 'daily',
    date,
    period: date,
    ids: [apple],
    warmupIds: [],
    stage: 'en',
    index: 0,
    records: {
      [apple]: {
        meaning: material.meaning,
        material,
        en: 'unmeasured',
        ko: 'unmeasured',
        sentenceStatus: 'unmeasured',
        sentence: '',
        notes: '',
      },
    },
    retry: [],
    retryMode: false,
    elapsed: 0,
    finished: false,
    paused: true,
    createdAt: new Date().toISOString(),
  };
  const grammar = {
    stage: 5,
    sentence: 'I like books.',
    updatedAt: new Date().toISOString(),
    answers: Object.fromEntries(
      ['teacher', 'bag', 'I like music.'].map((answer, index) => [
        `q${index + 1}`,
        { first: answer, latest: answer, attempts: 1, helped: false },
      ]),
    ),
  };
  let seeded = false;
  let held: Route | undefined;
  const holdSave = async (route: Route) => {
    if (route.request().method() === 'PUT') {
      expect(held, 'one save remains in flight').toBeUndefined();
      held = route;
    } else await route.continue();
  };
  restoreFixture = async () => {
    if (held) await held.abort().catch(() => {});
    await page.close(); // Stop timers and in-flight UI writes before restoring the fixture.
    if (!seeded) return;
    const current = await snapshot(context.request);
    const restored = structuredClone(current.state);
    delete restored.sessions[sessionId];
    if (Object.hasOwn(before.state.progress, apple))
      restored.progress[apple] = before.state.progress[apple]!;
    else delete restored.progress[apple];
    for (const key of ['dailyGoal', 'activeSessionId']) {
      if (Object.hasOwn(before.state.settings, key))
        restored.settings[key] = before.state.settings[key];
      else delete restored.settings[key];
    }
    if (Object.hasOwn(before.state.grammar, 'noun'))
      restored.grammar.noun = before.state.grammar.noun!;
    else delete restored.grammar.noun;
    // Restore only our fixture's fields, retaining unrelated records. Revision
    // comparison rejects concurrent changes instead of overwriting another test.
    const cleanup = await context.request.post(`${site}/api/state/restore`, {
      headers: { ...stateHeaders, 'X-Study-Revision': String(current.revision) },
      data: { format: 'haru-words-v1', exportedAt: new Date().toISOString(), state: restored },
    });
    expect(cleanup.status(), 'restore this local synthetic fixture').toBe(200);
    expect((await snapshot(context.request)).state).toEqual(before.state);
  };
  const seed = await page.request.put(`${site}/api/state`, {
    headers: stateHeaders,
    data: {
      revision: before.revision,
      settings: { ...before.state.settings, dailyGoal: 1, activeSessionId: sessionId },
      progress: {},
      sessions: { [sessionId]: session },
      grammar: { noun: grammar },
    },
  });
  expect(seed.status()).toBe(200);
  seeded = true;
  await page.reload();
  await saved(page);
  await resumeStudy(page);
  const answer = page.getByRole('textbox', { name: '한국어 뜻 입력', exact: true });
  const answerText = '사과 — 카드로 이동하기 전에 보관할 답';
  await answer.fill(answerText);
  const beforeLeave = await snapshot(page.request);
  const cardButton = page.getByRole('button', { name: '영어 카드', exact: true });
  await expect(cardButton).toBeEnabled();
  await page.route('**/api/state', holdSave);
  await cardButton.click();
  await expect.poll(() => Boolean(held)).toBe(true);
  expect(held!.request().postDataJSON().sessions[sessionId].records[apple].draft.answer).toBe(
    answerText,
  );
  await expect(cardButton).toBeDisabled();
  await expect(page).toHaveURL(`${site}/`);
  await expect(page.getByRole('button', { name: '계속 학습하기', exact: true })).toBeVisible();
  expect((await snapshot(page.request)).state).toEqual(beforeLeave.state);
  await held!.fulfill({ status: 503, json: { error: '합성 저장 실패: 초안 보존 검사' } });
  held = undefined;
  await page.unroute('**/api/state', holdSave);
  await expect(page.locator('.error-banner[role=alert]')).toContainText('합성 저장 실패');
  await expect(cardButton).toBeDisabled();
  await expect(page).toHaveURL(`${site}/`);
  // Departure pauses the lesson and hides the input. The recovery export is
  // the public way to inspect the retained draft before retrying a failed save.
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '현재 입력 백업', exact: true }).click();
  const stream = await (await download).createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const recovery = JSON.parse(Buffer.concat(chunks).toString('utf8')) as LearningState;
  expect(recovery.sessions[sessionId]!.records[apple]).toMatchObject({
    en: 'unmeasured',
    draft: { answer: answerText },
  });
  expect((await snapshot(page.request)).state).toEqual(beforeLeave.state);
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await saved(page);
  await page.getByRole('button', { name: '계속 학습하기', exact: true }).click();
  await saved(page);
  await expect(answer).toHaveValue(answerText);
  await cardRoundTrip(page);
  const persistedStudy = (await snapshot(page.request)).state.sessions[sessionId]!;
  expect(persistedStudy.records[apple]).toMatchObject({
    en: 'unmeasured',
    ko: 'unmeasured',
    draft: { answer: answerText },
  });
  expect(persistedStudy).toMatchObject({ paused: true, finished: false });
  await resumeStudy(page);
  await expect(answer).toHaveValue(answerText);

  // A fresh home view avoids a mounted study handler while checking grammar.
  await page.goto('/');
  await saved(page);
  await openGrammar(page);
  const sentence = page.getByRole('textbox', { name: '내 문장', exact: true });
  await expect(sentence).toHaveValue(grammar.sentence);
  await page.route('**/api/state', holdSave);
  await sentence.fill('I like coffee and books.');
  await expect.poll(() => Boolean(held)).toBe(true);
  expect(held!.request().postDataJSON().grammar.noun.sentence).toBe('I like coffee and books.');
  await expect(cardButton).toBeDisabled();
  await expect(page).toHaveURL(`${site}/`);
  const latestSentence = 'I like coffee and books every morning.';
  await sentence.fill(latestSentence);
  await held!.fulfill({
    status: 503,
    json: { error: '합성 문법 저장 실패: 최신 입력 보존 검사' },
  });
  held = undefined;
  await page.unroute('**/api/state', holdSave);
  await expect(page.locator('.error-banner[role=alert]')).toContainText('합성 문법 저장 실패');
  await expect(cardButton).toBeDisabled();
  await expect(sentence).toHaveValue(latestSentence);
  expect((await snapshot(page.request)).state.grammar.noun).toEqual(grammar);
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await saved(page);
  await cardRoundTrip(page);
  await openGrammar(page);
  await expect(sentence).toHaveValue(latestSentence);
  const after = await snapshot(page.request);
  expect(after.state.grammar.noun).toMatchObject({
    sentence: latestSentence,
    answers: grammar.answers,
  });
  expect(after.state.sessions[sessionId]!.records[apple]).toMatchObject({
    en: 'unmeasured',
    draft: { answer: answerText },
  });
  // Pausing an unfinished fixture also marks its word for review.
  expect(
    Object.fromEntries(Object.entries(after.state.progress).filter(([id]) => id !== apple)),
  ).toEqual(
    Object.fromEntries(Object.entries(before.state.progress).filter(([id]) => id !== apple)),
  );
  expect(
    Object.fromEntries(Object.entries(after.state.sessions).filter(([id]) => id !== sessionId)),
  ).toEqual(before.state.sessions);
  expect(
    Object.fromEntries(Object.entries(after.state.grammar).filter(([id]) => id !== 'noun')),
  ).toEqual(
    Object.fromEntries(Object.entries(before.state.grammar).filter(([id]) => id !== 'noun')),
  );
  const cardsAfter = await (await page.request.get(`${site}/api/card-studio/api/state`)).json();
  for (const field of ['cards', 'assets', 'schedules', 'deliveries'])
    expect(cardsAfter[field]).toEqual(cardsBefore[field]);
  expect(blockedRequests).toEqual([]);
  expect(browserErrors).toEqual([]);
});
