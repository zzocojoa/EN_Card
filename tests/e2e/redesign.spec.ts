import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { AppState } from '../../src/web/api';
import type { Card, DeliverySummary } from '../../src/shared/model';

// UI-only fixtures isolate both browsers from the real local D1 regression suite.
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const cards: Card[] = Array.from({ length: 101 }, (_, index) => ({
  id: uuid(index + 1),
  asset_id: uuid(index + 1001),
  revision: 1,
  status: 'ready',
  created_at: 2000 - index,
  content: {
    template: 'expression',
    expression: `Study card ${index + 1}`,
    meaning_ko: `학습 표현 ${index + 1}`,
    example_en: 'Take your time.',
    example_ko: '천천히 해도 괜찮아.',
  },
}));
function initialState(): AppState {
  const now = Date.now();
  return {
    csrf: 'ui-fixture',
    cards: cards.slice(0, 100),
    assets: [],
    schedules: [],
    deliveries: [],
    cursors: { cards: 'next', assets: null, schedules: null, deliveries: null },
    totals: { cards: 101, assets: 101, schedules: 0, deliveries: 105, active_schedules: 0 },
    summary: {
      ready_cards: 101,
      attention: 1,
      api_accepted: 103,
      next_schedule: {
        id: uuid(5000),
        name: '아침 영어',
        due_at_utc: now + 600000,
        cards_per_occurrence: 1,
      },
    },
    previews: [],
    usage: [],
    connection: null,
    mode: 'dry_run',
    now,
  };
}
const delivery: DeliverySummary = {
  id: uuid(6000),
  occurrence_id: uuid(6001),
  schedule_id: uuid(5000),
  position: 0,
  state: 'unknown',
  mode: 'live',
  due_at_utc: Date.now(),
  updated_at: Date.now(),
  attempts: 1,
  error: '응답을 확인할 수 없습니다.',
  confirmed_by_user: 0,
  resolution: null,
  total_attempts: 1,
  occurrence_state: 'unknown',
  card_title: 'Immutable English title',
  schedule_name: '이전 아침 예약',
};
async function fixture(page: Page, state = initialState(), records = [delivery]) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/boot')
      return route.fulfill({ json: { local: false, mode: state.mode, kakao_configured: true } });
    if (url.pathname === '/api/state') return route.fulfill({ json: state });
    if (url.pathname === '/api/automation')
      return route.fulfill({
        json: {
          settings: null,
          version: 0,
          enabled: false,
          reason: null,
          next_due_at: null,
          available: false,
          trial_used_today: false,
          missing: [],
        },
      });
    if (url.pathname === '/api/automation/runs') return route.fulfill({ json: [] });
    if (url.pathname === '/api/page/cards') {
      const q = url.searchParams.get('q')?.toLowerCase() ?? '';
      const status = url.searchParams.get('status');
      const template = url.searchParams.get('template');
      const filtered = cards.filter(
        (card) =>
          (!q ||
            `${card.content.expression} ${card.content.meaning_ko}`.toLowerCase().includes(q)) &&
          (!status || status === 'all' || status === card.status) &&
          (!template || template === 'all' || template === card.content.template),
      );
      const offset = url.searchParams.has('cursor') ? 100 : 0;
      return route.fulfill({
        json: {
          items: filtered.slice(offset, offset + 100),
          total: filtered.length,
          next: filtered.length > offset + 100 ? 'next' : null,
        },
      });
    }
    if (url.pathname === '/api/page/deliveries')
      return route.fulfill({ json: { items: records, total: records.length, next: null } });
    if (url.pathname.endsWith('/attempts'))
      return route.fulfill({
        json: {
          attempts: [
            {
              id: 'call',
              started_at: state.now,
              outcome: 'unknown',
              detail: '모의 호출 기록',
              mode: 'mock',
            },
          ],
          decisions: [],
        },
      });
    return route.fulfill({ status: 500, json: { message: '예상하지 않은 테스트 요청' } });
  });
}
async function navigate(page: Page, route: string) {
  await page.evaluate((hash) => {
    window.location.hash = `/${hash}`;
  }, route);
  await expect(page).toHaveURL(new RegExp(`#/${route}$`));
}
const mainNotice = (page: Page) => page.locator('.workspace > .notice');

test('AI 자동 제작 설정·시작·중단과 검토 표시 및 화면 이동 후 초안을 확인한다', async ({
  page,
}) => {
  const state = initialState();
  state.mode = 'live';
  state.connection = {
    status: 'connected',
    expires_at: Date.now() + 86400000,
    refresh_expires_at: Date.now() + 86400000,
    version: 1,
    refresh_attempts: 0,
    refresh_retry_at: null,
    refresh_failure: null,
    refresh_http_status: null,
    refresh_provider_error: null,
    refresh_provider_code: null,
  };
  await fixture(page, state);
  let view = {
    settings: {
      topic: '일상 회화',
      base_expression: '',
      level: '초급',
      template: 'expression',
      start_date: '2026-10-04',
      end_date: null,
      time: '08:00',
    },
    version: 1,
    enabled: false,
    reason: 'paused',
    next_due_at: Date.now() + 86400000,
    available: true,
    trial_used_today: false,
    missing: [],
  };
  let delayStatus = false;
  let releaseStatus!: () => void;
  let statusStarted!: () => void;
  let statusFinished!: () => void;
  const statusWaiting = new Promise<void>((resolve) => {
    releaseStatus = resolve;
  });
  const statusRequested = new Promise<void>((resolve) => {
    statusStarted = resolve;
  });
  const statusDelivered = new Promise<void>((resolve) => {
    statusFinished = resolve;
  });
  await page.route('**/api/automation{,/**}', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === '/api/automation' && request.method() === 'GET' && delayStatus) {
      delayStatus = false;
      const snapshot = structuredClone(view);
      statusStarted();
      await statusWaiting;
      await route.fulfill({ json: snapshot }).catch(() => undefined);
      statusFinished();
      return;
    }
    if (path.endsWith('/runs'))
      return route.fulfill({
        json: [
          {
            id: 'test',
            day: '2026-10-03',
            kind: view.trial_used_today ? 'trial' : 'daily',
            item_index: view.trial_used_today ? 1 : 2,
            item_count: view.trial_used_today ? 1 : 5,
            not_before: Date.now() + 600000,
            due_at: Date.now(),
            status: 'revise',
            error: null,
            writer: 'google',
            reviewer: 'groq',
            revision: 1,
            content: cards[0]!.content,
            review: {
              natural: true,
              meaning: true,
              grammar: true,
              translation: false,
              level: true,
              comparison: true,
              issues: [],
            },
            public_id: null,
            updated_at: Date.now(),
            delivery_state: null,
          },
        ],
      });
    if (request.method() === 'PUT') {
      expect(request.postDataJSON().version).toBe(view.version);
      view = {
        ...view,
        settings: request.postDataJSON().settings,
        version: view.version + 1,
        enabled: false,
      };
    }
    if (path.endsWith('/start')) {
      expect(request.postDataJSON().version).toBe(view.version);
      view = { ...view, enabled: true, reason: '', version: view.version + 1 };
    }
    if (path.endsWith('/pause'))
      view = { ...view, enabled: false, reason: 'paused', version: view.version + 1 };
    if (path.endsWith('/trial')) {
      expect(request.postDataJSON()).toEqual({ version: view.version });
      view = {
        ...view,
        enabled: true,
        reason: '',
        version: view.version + 1,
        trial_used_today: true,
      };
    }
    return route.fulfill({ json: view });
  });
  await page.goto('/#/automation');
  await expect(page.getByRole('combobox', { name: '하루 제작 수량', exact: true })).toHaveValue(
    '1',
  );
  await page.getByRole('combobox', { name: '하루 제작 수량', exact: true }).selectOption('5');
  await expect(page.locator('.automation-runs')).toContainText('매일 제작 2/5');
  await page.locator('.automation-trial summary').click();
  await expect(page.getByText('AI 검토 미통과', { exact: false })).toBeVisible();
  await expect(page.getByText('AI 검토 통과', { exact: false })).toHaveCount(0);
  await page.getByLabel('주제', { exact: true }).fill('여행 중 쓸 표현');
  await expect(page.getByRole('button', { name: '자동 제작 시작', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '오늘 한 장 시험', exact: true })).toBeDisabled();
  await navigate(page, 'library');
  await navigate(page, 'automation');
  await page.locator('.automation-trial summary').click();
  await expect(page.getByLabel('주제', { exact: true })).toHaveValue('여행 중 쓸 표현');
  await expect(page.getByRole('combobox', { name: '하루 제작 수량', exact: true })).toHaveValue(
    '5',
  );
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '자동 제작 시작', exact: true })).toBeEnabled();
  delayStatus = true;
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await statusRequested;
  await page.getByLabel('주제', { exact: true }).fill('늦은 조회보다 새로 저장한 주제');
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '자동 제작 시작', exact: true })).toBeEnabled();
  releaseStatus();
  await statusDelivered;
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await expect(page.getByLabel('주제', { exact: true })).toHaveValue(
    '늦은 조회보다 새로 저장한 주제',
  );
  await page.getByRole('button', { name: '자동 제작 시작', exact: true }).click();
  await expect(page.locator('.automation-status')).toHaveText('실행 중');
  await expect(page.getByRole('complementary', { name: '현재 실행과 설정 저장' })).toContainText(
    '하루 5장',
  );
  // A Cron/other tab update uses the same session CSRF; the shared refresh must reload automation too.
  await expect(page.getByRole('button', { name: '새로고침', exact: true })).toBeEnabled();
  await page.getByLabel('주제', { exact: true }).fill('아직 저장하지 않은 주제');
  view = { ...view, enabled: false, reason: 'complete', version: view.version + 1 };
  await page.getByRole('button', { name: '새로고침', exact: true }).click();
  await expect(page.locator('.automation-status')).toHaveText('기간 종료');
  await expect(page.getByLabel('주제', { exact: true })).toHaveValue('아직 저장하지 않은 주제');
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  await expect(page.getByRole('button', { name: '자동 제작 시작', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '자동 제작 시작', exact: true }).click();
  await expect(page.locator('.automation-status')).toHaveText('실행 중');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(page.locator('.automation-status')).toHaveText('일시정지');
  await page.getByRole('button', { name: '오늘 한 장 시험', exact: true }).click();
  await expect(page.getByText('제작 시작', { exact: false })).toBeVisible();
  await expect(page.getByLabel('매일 받을 시각 (한국 시간)', { exact: true })).toHaveValue('08:00');
  await page.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(page.getByRole('button', { name: '오늘 한 장 시험', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('홈·주소·뒤로 가기와 카드 초안·키보드 본문 이동을 유지한다', async ({ page }) => {
  await fixture(page);
  await page.goto('/');
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.getByRole('heading', { name: '오늘의 작업실', exact: true })).toBeVisible();
  await page
    .getByRole('navigation', { name: '주 메뉴', exact: true })
    .getByRole('button', { name: '카드 만들기' })
    .click();
  const expression = page.getByRole('textbox', { name: '영어 표현', exact: true });
  await expression.fill('Keep my draft');
  const skip = page.getByRole('link', { name: '본문 바로가기' });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#\/editor$/);
  await expect(page.getByRole('main')).toBeFocused();
  await navigate(page, 'library');
  await expect(page.getByRole('heading', { name: '카드 보관함', exact: true })).toBeVisible();
  await page.goBack();
  await expect(expression).toHaveValue('Keep my draft');
  await page.goForward();
  await expect(page).toHaveURL(/#\/library$/);
  // Explicitly accept unloading the in-memory draft; URL persistence is independent.
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByRole('heading', { name: '카드 보관함', exact: true })).toBeVisible();
});

test('검색·필터 변경이 늦은 조회를 무시하고 오류 재시도·빈 결과를 구분한다', async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  let fail = true;
  await page.route('**/api/page/cards?**', async (route) => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === 'slow') {
      started();
      await delayed;
      return route.fulfill({ json: { items: [cards[0]], total: 1, next: null } }).catch(() => {});
    }
    if (q === 'retry' && fail)
      return route.fulfill({
        status: 503,
        json: { message: '일시적으로 목록을 읽지 못했습니다.' },
      });
    return route.fallback();
  });
  await page.goto('/#/library');
  await expect(page.locator('.library-card')).toHaveCount(100);
  await page.getByRole('button', { name: /더 불러오기/ }).click();
  await expect(page.locator('.library-card')).toHaveCount(101);
  const search = page.getByRole('searchbox', { name: '표현·뜻 검색' });
  await search.fill('slow');
  await search.press('Enter');
  await requested;
  await search.fill('Study card 101');
  await search.press('Enter');
  await expect(page.locator('.library-card')).toHaveCount(1);
  await expect(page.locator('.library-card')).toContainText('Study card 101');
  release();
  await page.getByRole('combobox', { name: '카드 유형', exact: true }).selectOption('comparison');
  await expect(page.getByText('조건에 맞는 카드가 없습니다.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '검색 초기화', exact: true }).click();
  await expect(page.locator('.library-card')).toHaveCount(100);
  await search.fill('retry');
  await search.press('Enter');
  await expect(page.getByRole('alert')).toContainText('일시적으로');
  fail = false;
  await page.getByRole('button', { name: '다시 시도', exact: true }).click();
  await expect(page.getByText('조건에 맞는 카드가 없습니다.', { exact: true })).toBeVisible();
});

test('100장 밖 카드 선택·검색·순서 변경·화면 이동 뒤 저장할 순서를 보존한다', async ({ page }) => {
  await fixture(page);
  let saved: { asset_ids: string[] } | undefined;
  await page.route('**/api/schedules', async (route) => {
    saved = route.request().postDataJSON() as typeof saved;
    return route.fulfill({ json: { id: uuid(9000) } });
  });
  await page.goto('/#/schedules');
  await expect(page.getByRole('heading', { name: '새로운 예약', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '＋ 새 예약', exact: true }).click();
  await page.getByLabel('Study card 1', { exact: true }).check();
  await page.getByLabel('Study card 2', { exact: true }).check();
  await page.getByRole('button', { name: /카드 더 불러오기/ }).click();
  await page.getByLabel('Study card 101', { exact: true }).check();
  await page.getByRole('searchbox', { name: '예약할 카드 검색' }).fill('Study card 101');
  await page.getByRole('button', { name: '찾기', exact: true }).click();
  const selected = page.getByRole('list', { name: '선택한 카드 순서' });
  await expect(selected.getByRole('listitem')).toHaveCount(3);
  await page.getByRole('button', { name: 'Study card 101 위로', exact: true }).click();
  await page.getByRole('button', { name: 'Study card 101 위로', exact: true }).click();
  await navigate(page, 'home');
  await page.getByRole('button', { name: '작성 중인 예약 이어서 보기', exact: true }).click();
  await expect(selected.getByRole('listitem').first()).toContainText('Study card 101');
  await page.getByRole('button', { name: 'Study card 2 선택 해제', exact: true }).click();
  await page.getByRole('combobox', { name: '반복', exact: true }).selectOption('daily');
  await page.getByRole('button', { name: '예약 저장', exact: true }).click();
  await expect(mainNotice(page)).toContainText('예약을 저장');
  expect(saved?.asset_ids).toEqual([cards[100]!.asset_id, cards[0]!.asset_id]);
});

test('실제 PNG 생성과 재저장 실패 시 이전 예약 버튼 제거를 확인한다', async ({ page }) => {
  await fixture(page);
  let revision = 0;
  let failUpload = false;
  await page.route('**/api/cards**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/image'))
      return route.fulfill(
        failUpload
          ? { status: 503, json: { message: 'PNG 저장 실패' } }
          : { json: { id: uuid(8001), public_id: uuid(8002) } },
      );
    if (path.endsWith('/review')) return route.fulfill({ json: { ok: true } });
    revision += 1;
    return route.fulfill({ json: { id: uuid(8000), revision } });
  });
  await page.goto('/#/editor');
  await expect(page.locator('canvas')).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PNG 다운로드' }).click();
  const path = await (await downloaded).path();
  expect(path).toBeTruthy();
  const png = await readFile(path!);
  const dimensions = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect(dimensions.getUint32(16)).toBe(1080);
  expect(dimensions.getUint32(20)).toBe(1080);
  await page.getByLabel('내용과 미리보기를 직접 검토했습니다.').check();
  await page.getByRole('button', { name: 'PNG 저장·검토 완료', exact: true }).click();
  await expect(page.getByRole('button', { name: '이 카드 예약하기', exact: true })).toBeVisible();
  failUpload = true;
  await page.getByRole('button', { name: 'PNG 저장·검토 완료', exact: true }).click();
  await expect(mainNotice(page)).toContainText('PNG 저장 실패');
  await expect(page.getByRole('button', { name: '이 카드 예약하기', exact: true })).toHaveCount(0);
  await expect(page.getByText('저장하지 않은 변경', { exact: true })).toBeVisible();
});

test('필드 오류와 대화상자 키보드 포커스가 입력 및 호출 버튼에 연결된다', async ({ page }) => {
  await fixture(page);
  await page.goto('/#/editor');
  const field = page.getByRole('textbox', { name: '영어 표현', exact: true });
  await field.fill('');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription('필수 항목을 입력해 주세요.');
  await navigate(page, 'library');
  const newCard = page.getByRole('button', { name: '＋ 새 카드', exact: true });
  await newCard.click();
  const dialog = page.getByRole('dialog', { name: '편집 중인 카드 바꾸기' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '돌아가기', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '카드 열기', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(newCard).toBeFocused();
});

test('발송 기록은 불변 카드 제목·예약 이름을 표시하고 확인 필요와 미리검증을 구분한다', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#/home');
  await page.getByRole('button', { name: '결과 확인하기' }).click();
  await expect(page.getByRole('button', { name: '확인 필요', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.journal')).toContainText('Immutable English title');
  await expect(page.locator('.journal')).toContainText('이전 아침 예약');
  await page.getByRole('button', { name: '미리검증', exact: true }).click();
  await expect(page.locator('.journal')).toHaveCount(0);
  await expect(
    page.getByText('예약을 저장한 뒤 ‘예약 발송 미리검증’을 실행해 보세요.'),
  ).toBeVisible();
});

test('화면 진입 때 최신 요약을 읽고 발송 호출 기록 펼침을 유지한다', async ({ page }) => {
  const state = initialState();
  state.summary.attention = 0;
  await fixture(page, state, [{ ...delivery, state: 'sending' }]);
  await page.goto('/#/editor');
  await page
    .getByRole('textbox', { name: '영어 표현', exact: true })
    .fill('Keep this across entry refresh');
  state.summary.attention = 1;
  state.summary.next_schedule!.name = '갱신된 예약';
  await navigate(page, 'home');
  await expect(page.locator('.attention-banner')).toContainText('1건');
  await expect(page.locator('.next-card')).toContainText('갱신된 예약');
  await page.getByRole('button', { name: '결과 확인하기' }).click();
  await expect(page.locator('.journal')).toContainText('응답 확인 중');
  await page.getByText(/시도별 호출 기록/).click();
  await expect(page.locator('.journal details')).toHaveAttribute('open', '');
  await expect(page.locator('.journal details')).toContainText('모의 호출 기록');
  await navigate(page, 'editor');
  await expect(page.getByRole('textbox', { name: '영어 표현', exact: true })).toHaveValue(
    'Keep this across entry refresh',
  );
});

function preservedState(): AppState {
  const state = initialState();
  const future = new Date(state.now + 600000 + 9 * 3600000).toISOString();
  state.schedules = [
    {
      id: uuid(9000),
      version: 1,
      timezone: 'Asia/Seoul',
      name: 'Preserve'.repeat(10),
      kind: 'once',
      date: future.slice(0, 10),
      time: future.slice(11, 16),
      end_date: null,
      weekdays: [],
      cards_per_occurrence: 1,
      asset_ids: [uuid(9999)],
      items: [{ asset_id: uuid(9999), title: 'Original version' }],
      cursor: 0,
      enabled: 1,
      reason: null,
      pending_delivery_count: 0,
      next_run_at_utc: state.now + 600000,
    },
  ];
  return state;
}
test('늦은 화면 진입 응답이 더 불러온 이미지 목록을 덮어쓰지 않는다', async ({ page }) => {
  const state = initialState();
  const asset = {
    id: uuid(7000),
    card_id: uuid(1),
    revision: 1,
    public_id: uuid(7001),
    bytes: 1000,
    state: 'ready' as const,
    created_at: state.now,
    expression: 'First asset',
  };
  state.assets = [asset];
  state.cursors.assets = 'next';
  state.totals.assets = 2;
  await fixture(page, state);
  await page.route('**/api/page/assets?**', (route) =>
    route.fulfill({
      json: { items: [{ ...asset, id: uuid(7002), expression: 'Second asset' }], next: null },
    }),
  );
  await page.goto('/#/home');
  await expect(page.locator('.next-card')).toBeVisible();
  let release!: () => void;
  const delay = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/state', async (route) => {
    started();
    await delay;
    await route.fulfill({ json: state }).catch(() => {});
  });
  await navigate(page, 'settings');
  await requested;
  await page.getByRole('button', { name: /더 불러오기/ }).click();
  await expect(page.locator('.asset-list > div')).toHaveCount(2);
  release();
  await expect(page.getByRole('button', { name: '새로고침', exact: true })).toBeEnabled();
  await expect(page.locator('.asset-list')).toContainText('Second asset');
  await expect(page.getByRole('button', { name: /더 불러오기/ })).toHaveCount(0);
});
test('예약에 저장된 이전 버전을 빼고 다시 선택하며 수정 내용을 보존한다', async ({ page }) => {
  await fixture(page, preservedState());
  await page.goto('/#/schedules');
  await page.locator('.schedule-card').getByRole('button', { name: '수정', exact: true }).click();
  await page
    .getByRole('textbox', { name: '예약 이름', exact: true })
    .fill('Keep this schedule draft');
  await page.getByRole('button', { name: 'Original version 선택 해제', exact: true }).click();
  await page.getByRole('checkbox', { name: /Original version/ }).check();
  await expect(page.getByRole('list', { name: '선택한 카드 순서' })).toContainText(
    'Original version',
  );
  await expect(page.getByRole('textbox', { name: '예약 이름', exact: true })).toHaveValue(
    'Keep this schedule draft',
  );
});

test('예약 항목 오류·요일 터치 영역·비교형 선택 상태를 제공한다', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await fixture(page);
  await page.goto('/#/schedules');
  await page.getByRole('button', { name: '＋ 새 예약', exact: true }).click();
  await page.getByRole('combobox', { name: '반복', exact: true }).selectOption('weekly');
  const widths = await page
    .locator('.weekdays label')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
  expect(widths).toHaveLength(7);
  expect(Math.min(...widths)).toBeGreaterThanOrEqual(44);
  await page.getByRole('textbox', { name: '예약 이름', exact: true }).fill('');
  await page.getByRole('checkbox', { name: 'Study card 1', exact: true }).check();
  await page.getByRole('button', { name: '예약 저장', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: '예약 이름', exact: true }),
  ).toHaveAccessibleDescription('예약 이름을 1~80자로 입력하세요.');
  await navigate(page, 'editor');
  await page.getByRole('button', { name: '비교형', exact: true }).click();
  await expect(page.getByRole('button', { name: '비교형', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('textbox', { name: '기본 표현의 뜻', exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
});

for (const width of [375, 390, 430, 768, 1440]) {
  test(`${width}px 모든 화면의 가로 넘침·입력 크기와 모바일 핵심 정보·메뉴를 확인한다`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await fixture(page, preservedState(), [
      { ...delivery, card_title: 'W'.repeat(200), schedule_name: 'S'.repeat(80) },
    ]);
    await page.route('**/api/page/cards?**', (route) =>
      route.fulfill({
        json: { items: cards.slice(0, 3), total: 101, next: 'next' },
      }),
    );
    await page.goto('/#/home');
    await expect(page.getByRole('heading', { name: '다음 영어 시간', exact: true })).toBeVisible();
    if (width < 600) {
      const nav = page.getByRole('navigation', { name: '모바일 메뉴', exact: true });
      await expect(nav.getByRole('button')).toHaveCount(5);
      const navTop = (await nav.boundingBox())!.y;
      for (const selector of ['.attention-banner', '.next-time']) {
        const bounds = (await page.locator(selector).boundingBox())!;
        expect(bounds.y + bounds.height).toBeLessThan(navTop);
      }
      await nav.getByRole('button', { name: '더보기', exact: true }).click();
      await page
        .getByRole('dialog', { name: '더보기', exact: true })
        .getByRole('button', { name: '카드 만들기', exact: true })
        .click();
      await expect(page).toHaveURL(/#\/editor$/);
      await expect(page.locator('.preview-paper')).not.toBeVisible();
      await page.getByRole('button', { name: '미리보기 펼치기', exact: true }).click();
      await expect(page.locator('canvas')).toBeVisible();
    }
    for (const route of [
      'home',
      'automation',
      'editor',
      'library',
      'schedules',
      'history',
      'settings',
    ]) {
      await navigate(page, route);
      await expect(page.locator('h1')).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      const poorContrast = await page.evaluate(() => {
        const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number);
        const luminance = (color: number[]) =>
          color
            .slice(0, 3)
            .map((value) => {
              const s = value / 255;
              return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
        return Array.from(
          document.querySelectorAll<HTMLElement>(
            '.workspace p, .workspace h1, .workspace h2, .workspace h3, .workspace strong, .workspace small, nav button, .workspace button',
          ),
        )
          .filter(
            (node) =>
              node.getBoundingClientRect().width &&
              node.getBoundingClientRect().height &&
              !node.matches(':disabled') &&
              getComputedStyle(node).visibility !== 'hidden',
          )
          .flatMap((node) => {
            const foreground = rgb(getComputedStyle(node).color);
            let background = [255, 255, 255];
            let parent: HTMLElement | null = node;
            while (parent) {
              const value = rgb(getComputedStyle(parent).backgroundColor);
              if (value.length === 3 || value[3] === 1) {
                background = value;
                break;
              }
              parent = parent.parentElement;
            }
            const a = luminance(foreground),
              b = luminance(background);
            const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            return ratio < 4.5
              ? [`${node.textContent?.trim().slice(0, 35)}: ${ratio.toFixed(2)}`]
              : [];
          });
      });
      expect(poorContrast, `${width}px ${route} text contrast`).toEqual([]);
      if (route === 'editor') {
        const input = page.getByRole('textbox', { name: '영어 표현', exact: true });
        expect(
          await input.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
        ).toBeGreaterThanOrEqual(16);
      }
      await page.screenshot({ path: info.outputPath(`${route}-${width}.png`), fullPage: true });
    }
  });
}
