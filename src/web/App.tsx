import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  cardSchema,
  LIMITS,
  type CardInput,
  type Schedule,
  type ScheduleInput,
} from '../shared/model';
import { formatKst, kstDate, nextRun } from '../shared/time';
import seeds from '../../seed/cards.json';
import { api, upload, type AppState, type AttemptHistory, type Boot, type Collection } from './api';
import type { Page as ResultPage } from '../worker/pagination';
import { downloadBlob, pngBlob, renderCard, validateBackup } from './canvas';

type Page = 'editor' | 'library' | 'schedules' | 'history' | 'settings';
type Notice = { kind: 'error' | 'success'; text: string } | null;
const EMPTY: CardInput = {
  template: 'expression',
  expression: 'Take your time',
  meaning_ko: '서두르지 말고 천천히 해',
  example_en: 'Take your time. We can leave later.',
  example_ko: '천천히 해. 우리는 나중에 출발해도 돼.',
  pronunciation_ko: '',
  note_ko: '상대가 서두르지 않아도 된다고 말할 때',
  category: '일상',
  level: '기초',
};
const LABELS: Record<string, string> = {
  pending: '대기',
  claimed: '준비 중',
  sending: '응답 확인 중',
  sent: 'API 접수 확인',
  mock_sent: '모의 접수',
  retry_wait: '재시도 대기',
  failed: '실패',
  unknown: '결과 불명',
  cancelled: '취소',
  missed: '시각 지남',
  blocked: '확인 필요',
  paused: '일시정지',
  content_shortage: '카드 부족',
  completed: '목록 소비 완료',
  daily_limit: '일일 시도 한도',
  needs_reconnect: '재연결 필요',
  disconnected: '연결 해제',
  connected: '연결됨',
  ready: '검토 완료',
  draft: '초안',
  uploading: '저장 중',
  cleanup_needed: '정리 필요',
  deleting: '정리 중',
};
function label(value: string): string {
  return LABELS[value] ?? value;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 완료하지 못했습니다.';
}
function Icon({ name }: { name: Page | 'arrow' }): ReactElement {
  const paths: Record<Page | 'arrow', ReactNode> = {
    editor: (
      <>
        <path d="m4 17-1 4 4-1L20 7l-3-3Z" />
        <path d="m14 7 3 3" />
      </>
    ),
    library: (
      <>
        <rect x="5" y="3" width="15" height="17" rx="2" />
        <path d="M2 7v14M9 8h7M9 12h5" />
      </>
    ),
    schedules: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 2v6M17 2v6M3 11h18M8 15h2M14 15h2" />
      </>
    ),
    history: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6l4 2" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="8" cy="6" r="2" />
        <circle cx="16" cy="12" r="2" />
        <circle cx="9" cy="18" r="2" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
type FieldProps = { label: string; value: string; onChange: (value: string) => void };
function TextField({ label: caption, value, onChange }: FieldProps): ReactElement {
  const id: string = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{caption}</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
function TextAreaField({ label: caption, value, onChange }: FieldProps): ReactElement {
  const id: string = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{caption}</label>
      <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} rows={2} />
    </div>
  );
}
function initialSchedule(): ScheduleInput {
  const future: number = Date.now() + 10 * 60_000;
  return {
    name: '나의 영어 시간',
    kind: 'once',
    date: kstDate(future),
    time: new Date(future + 9 * 3600_000).toISOString().slice(11, 16),
    end_date: null,
    weekdays: [1, 2, 3, 4, 5],
    cards_per_occurrence: 1,
    asset_ids: [],
  };
}
export function App(): ReactElement {
  const [page, setPage] = useState<Page>('editor');
  const [boot, setBoot] = useState<Boot | null>(null);
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busy, setBusy] = useState<boolean>(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [card, setCard] = useState<CardInput>(EMPTY);
  const [editing, setEditing] = useState<{ id: string; revision: number } | null>(null);
  const [restored, setRestored] = useState<{ id: string; public_id: string } | null>(null);
  const [reviewed, setReviewed] = useState<boolean>(false);
  const [cardNumber, setCardNumber] = useState<number>(1);
  const [previewPending, setPreviewPending] = useState<boolean>(true);
  const [backupCursor, setBackupCursor] = useState<string | null>(null);
  const [backupPart, setBackupPart] = useState<number>(1);
  const [attemptHistory, setAttemptHistory] = useState<Record<string, AttemptHistory>>({});
  const [previewError, setPreviewError] = useState<string>('');
  const [json, setJson] = useState<string>('');
  const [showImport, setShowImport] = useState<boolean>(false);
  const [setupToken, setSetupToken] = useState<string>('');
  const [schedule, setSchedule] = useState<ScheduleInput>(initialSchedule);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [unknownId, setUnknownId] = useState<string | null>(null);
  const [acceptDuplicate, setAcceptDuplicate] = useState<boolean>(false);
  const preview = useRef<HTMLDivElement>(null);
  const authenticated: boolean = state !== null;
  async function refresh(): Promise<void> {
    setState((await api('/api/state', 'GET', null, '')) as AppState);
  }
  useEffect(() => {
    let active: boolean = true;
    void Promise.all([api('/api/boot', 'GET', null, ''), fetch('/api/state')])
      .then(async ([config, response]) => {
        const data: unknown = await response.json();
        if (!active) return;
        setBoot(config as Boot);
        if (response.ok) setState(data as AppState);
        else if (response.status !== 401) throw new Error((data as { message: string }).message);
      })
      .catch((error: unknown) => {
        if (active) setNotice({ kind: 'error', text: errorMessage(error) });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active: boolean = true;
    if (page !== 'editor' || !authenticated) return;
    setPreviewError('');
    setPreviewPending(true);
    preview.current?.replaceChildren();
    if (restored) {
      const image: HTMLImageElement = document.createElement('img');
      image.src = `/images/${restored.public_id}.png`;
      image.alt = '복원한 PNG';
      image.onload = () => {
        if (active) {
          preview.current?.replaceChildren(image);
          setPreviewPending(false);
        }
      };
      image.onerror = () => {
        if (active)
          setPreviewError('복원한 PNG를 읽을 수 없습니다. 전파를 기다린 후 다시 시도하세요.');
      };
      return () => {
        active = false;
      };
    }
    void renderCard(card, cardNumber)
      .then((canvas) => {
        if (active) {
          preview.current?.replaceChildren(canvas);
          setPreviewPending(false);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setPreviewError(errorMessage(error));
          preview.current?.replaceChildren();
        }
      });
    return () => {
      active = false;
    };
  }, [authenticated, state?.now, card, cardNumber, page, restored]);
  async function perform(task: () => Promise<void>): Promise<void> {
    setBusy(true);
    setNotice(null);
    try {
      await task();
    } catch (error: unknown) {
      if (error instanceof Error && 'status' in error && error.status === 401) setState(null);
      setNotice({ kind: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  function change(key: keyof CardInput, value: string): void {
    setCard((current) => ({ ...current, [key]: value }));
    setReviewed(false);
    setRestored(null);
  }
  async function save(): Promise<void> {
    if (!state) return;
    if (restored && editing) {
      if (!reviewed) throw new Error('복원한 PNG와 카드 내용이 일치하는지 검토해 주세요.');
      await api(
        `/api/cards/${editing.id}/review`,
        'POST',
        { asset_id: restored.id, revision: editing.revision, reviewed: true },
        state.csrf,
      );
      await refresh();
      setNotice({ kind: 'success', text: '복원한 PNG의 검토가 완료됐습니다.' });
      return;
    }
    const input: CardInput = cardSchema.parse(card);
    const blob: Blob = await pngBlob(await renderCard(input, cardNumber));
    const saved = (await api(
      editing ? `/api/cards/${editing.id}` : '/api/cards',
      editing ? 'PUT' : 'POST',
      editing ? { revision: editing.revision, content: input } : input,
      state.csrf,
    )) as { id: string; revision: number };
    setEditing(saved);
    const asset = await upload(saved.id, saved.revision, blob, state.csrf);
    if (reviewed)
      await api(
        `/api/cards/${saved.id}/review`,
        'POST',
        { asset_id: asset.id, revision: saved.revision, reviewed: true },
        state.csrf,
      );
    await refresh();
    setNotice({
      kind: 'success',
      text: reviewed
        ? 'PNG 저장과 검토가 완료됐습니다. 예약에 추가할 수 있습니다.'
        : 'PNG를 저장했습니다. 내용을 확인하고 검토 완료로 전환하세요.',
    });
  }
  async function importCards(value: unknown): Promise<void> {
    if (!state) return;
    await api('/api/import', 'POST', value, state.csrf);
    await refresh();
    setShowImport(false);
    setPage('library');
    setNotice({
      kind: 'success',
      text: '카드를 초안으로 가져왔습니다. PNG를 만들고 내용을 검토해 주세요.',
    });
  }
  async function oauth(): Promise<void> {
    const result = (await api('/auth/start', 'POST', { setup_token: setupToken }, '')) as {
      url: string;
    };
    setSetupToken('');
    window.location.assign(result.url);
  }
  async function loadMore<K extends Collection>(kind: K): Promise<void> {
    const cursor: string | null | undefined = state?.cursors[kind];
    if (!cursor) return;
    const page = (await api(
      `/api/page/${kind}?cursor=${encodeURIComponent(cursor)}`,
      'GET',
      null,
      '',
    )) as ResultPage<AppState[K][number]>;
    setState((current) =>
      current
        ? {
            ...current,
            [kind]: [
              ...current[kind],
              ...page.items.filter(
                (item) => !current[kind].some((existing) => existing.id === item.id),
              ),
            ],
            cursors: { ...current.cursors, [kind]: page.next },
          }
        : current,
    );
  }
  function moreButton(kind: Collection): ReactElement | null {
    return state?.cursors[kind] ? (
      <button
        className="secondary wide"
        disabled={busy}
        onClick={() => void perform(() => loadMore(kind))}
      >
        더 불러오기 ({state[kind].length} / {state.totals[kind]})
      </button>
    ) : null;
  }
  async function backup(cursor: string | null, part: number): Promise<void> {
    const data = (await api(
      `/api/export${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
      'GET',
      null,
      '',
    )) as { schema_version: 1; cards: unknown[]; next_cursor: string | null };
    downloadBlob(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      `en-cards-${part}.json`,
    );
    setBackupCursor(data.next_cursor);
    setBackupPart(part + 1);
    setNotice({
      kind: 'success',
      text: data.next_cursor
        ? `${part}번째 JSON ${data.cards.length}개를 백업했습니다. 다음 JSON 백업도 내려받으세요.`
        : '모든 JSON 백업 파일을 내려받았습니다.',
    });
  }
  const readyCards = state?.cards.filter((item) => item.status === 'ready') ?? [];
  const activeSchedules: number = state?.totals.active_schedules ?? 0;
  const storage: number = state?.usage.find((item) => item.day === 'storage')?.bytes ?? 0;
  const today = state?.usage.find((item) => item.day === kstDate(Date.now()));
  let next: number | null = null;
  try {
    next = nextRun(schedule, Date.now() + LIMITS.propagationMs - 1);
  } catch {
    next = null;
  }
  const navigation: { id: Page; title: string }[] = [
    { id: 'editor', title: '카드 만들기' },
    { id: 'library', title: '카드 보관함' },
    { id: 'schedules', title: '발송 예약' },
    { id: 'history', title: '발송 기록' },
    { id: 'settings', title: '연결 및 설정' },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="하루 한 표현 홈">
          <span className="brand-mark">
            a<span>↗</span>
          </span>
          <span>
            하루 한 표현<small>MY ENGLISH STUDIO</small>
          </span>
        </a>
        <div className="nav-label">나의 학습 공간</div>
        <nav aria-label="주 메뉴">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={page === item.id ? 'nav-item selected' : 'nav-item'}
              onClick={() => setPage(item.id)}
            >
              <Icon name={item.id} />
              <span>{item.title}</span>
              {item.id === 'library' && state ? <em>{state.totals.cards}</em> : null}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mode-dot" />
          <strong>
            {boot?.local
              ? '로컬 작업실'
              : state?.mode === 'live'
                ? '클라우드 발송'
                : '발송 전 검증 모드'}
          </strong>
          <p>
            {boot?.local
              ? '이 기기의 테스트 저장소를 사용합니다.'
              : '미리 준비한 표현을 나에게 보내세요.'}
          </p>
          <span className="tiny">Asia/Seoul · 한국 표준시</span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>나만을 위한 작은 영어 습관</span>
          <div>
            <span className="status-pill">
              {state?.mode === 'live' ? 'LIVE' : 'DRY RUN · 실제 발송 없음'}
            </span>
            <button
              className="text-button"
              disabled={!state || busy}
              onClick={() =>
                void perform(async () => {
                  await api('/api/logout', 'POST', {}, state!.csrf);
                  setState(null);
                })
              }
            >
              로그아웃
            </button>
          </div>
        </header>
        <div className="workspace">
          {notice ? (
            <div
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={`notice ${notice.kind}`}
            >
              <span>{notice.text}</span>
              <button aria-label="알림 닫기" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
          ) : null}
          {loading ? (
            <div className="empty">작업실을 불러오고 있습니다…</div>
          ) : !state ? (
            <section className="welcome">
              <div className="eyebrow">A LITTLE ENGLISH, EVERY DAY</div>
              <h1>
                좋은 표현 하나가
                <br />
                하루에 남도록.
              </h1>
              <p>
                직접 고른 영어를 카드로 만들고,
                <br />
                나만의 시간에 카카오톡으로 받아보세요.
              </p>
              <div className="login-panel">
                <h2>{boot?.local ? '로컬 작업실 시작하기' : '나의 카카오 계정 연결'}</h2>
                {boot?.local ? (
                  <>
                    <p>
                      계정 없이 카드 제작·저장·예약 미리검증을 체험합니다. 실제 카카오톡으로 보내지
                      않습니다.
                    </p>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api('/auth/local', 'POST', {}, '');
                          await refresh();
                        })
                      }
                    >
                      로컬 작업실 열기 <Icon name="arrow" />
                    </button>
                  </>
                ) : (
                  <>
                    <label className="field">
                      <span>최초 운영자 등록 토큰 (최초 연결만)</span>
                      <input
                        type="password"
                        autoComplete="off"
                        value={setupToken}
                        onChange={(event) => setSetupToken(event.target.value)}
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={busy || !boot?.kakao_configured}
                      onClick={() => void perform(oauth)}
                    >
                      카카오로 로그인
                    </button>
                    {!boot?.kakao_configured ? (
                      <p>먼저 Worker에 카카오 앱 설정을 등록하세요.</p>
                    ) : null}
                  </>
                )}
                <small>무료 ‘나에게 보내기’는 푸시 알림·알림음이 없습니다.</small>
              </div>
              <span className="welcome-word">
                Take your time<span>.</span>
              </span>
            </section>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {page === 'editor'
                      ? '01 / CREATE YOUR CARD'
                      : page === 'library'
                        ? '02 / YOUR COLLECTION'
                        : page === 'schedules'
                          ? '03 / MAKE IT A HABIT'
                          : page === 'history'
                            ? '04 / DELIVERY JOURNAL'
                            : '05 / YOUR WORKSPACE'}
                  </div>
                  <h1>
                    {page === 'editor'
                      ? '오늘, 어떤 표현을 담을까요?'
                      : page === 'library'
                        ? '내가 고른 표현들'
                        : page === 'schedules'
                          ? '영어가 찾아오는 시간'
                          : page === 'history'
                            ? '보낸 기록, 남은 이야기'
                            : '연결과 저장 공간'}
                  </h1>
                  <p>
                    {page === 'editor'
                      ? '작은 카드 한 장에, 오래 기억하고 싶은 영어를 담으세요.'
                      : page === 'library'
                        ? `총 ${state.totals.cards}개의 카드 · 불러온 ${state.cards.length}개 중 검토 완료 ${readyCards.length}개`
                        : page === 'schedules'
                          ? '한국 시간으로 예약하고, 준비한 카드를 순서대로 보내세요.'
                          : page === 'history'
                            ? 'API 접수와 실제 열람은 다릅니다. 결과 불명은 채팅방에서 확인해 주세요.'
                            : '카카오 연결, 무료 한도와 학습 자료를 관리하세요.'}
                  </p>
                </div>
                <button className="secondary" disabled={busy} onClick={() => void perform(refresh)}>
                  새로고침
                </button>
              </div>
              {page === 'editor' ? (
                <div className="editor-grid">
                  <section className="editor-panel">
                    <div className="panel-heading">
                      <h2>표현 편집</h2>
                      <span className="tiny">
                        {editing ? `수정본 ${editing.revision}` : '새 카드'}
                      </span>
                    </div>
                    <fieldset disabled={busy}>
                      <legend className="sr-only">카드 내용</legend>
                      <div className="segmented">
                        <button
                          type="button"
                          className={card.template === 'expression' ? 'active' : ''}
                          onClick={() => change('template', 'expression')}
                        >
                          표현형
                        </button>
                        <button
                          type="button"
                          className={card.template === 'comparison' ? 'active' : ''}
                          onClick={() => change('template', 'comparison')}
                        >
                          비교형
                        </button>
                      </div>
                      {card.template === 'comparison' ? (
                        <div className="base-fields">
                          <TextField
                            label="기본 영어 표현"
                            value={card.base_expression ?? ''}
                            onChange={(value) => change('base_expression', value)}
                          />
                          <TextField
                            label="기본 표현의 뜻"
                            value={card.base_meaning_ko ?? ''}
                            onChange={(value) => change('base_meaning_ko', value)}
                          />
                        </div>
                      ) : null}
                      <TextField
                        label="영어 표현"
                        value={card.expression}
                        onChange={(value) => change('expression', value)}
                      />
                      <TextField
                        label="한글 뜻"
                        value={card.meaning_ko}
                        onChange={(value) => change('meaning_ko', value)}
                      />
                      <TextAreaField
                        label="영어 예문"
                        value={card.example_en}
                        onChange={(value) => change('example_en', value)}
                      />
                      <TextAreaField
                        label="예문 번역"
                        value={card.example_ko}
                        onChange={(value) => change('example_ko', value)}
                      />
                      <details>
                        <summary>
                          발음과 메모 추가 <span>선택</span>
                        </summary>
                        <TextField
                          label="한글식 발음 (참고용)"
                          value={card.pronunciation_ko ?? ''}
                          onChange={(value) => change('pronunciation_ko', value)}
                        />
                        <TextAreaField
                          label="추가 설명"
                          value={card.note_ko ?? ''}
                          onChange={(value) => change('note_ko', value)}
                        />
                        <div className="two-col">
                          <TextField
                            label="분류"
                            value={card.category ?? ''}
                            onChange={(value) => change('category', value)}
                          />
                          <TextField
                            label="수준"
                            value={card.level ?? ''}
                            onChange={(value) => change('level', value)}
                          />
                        </div>
                      </details>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={reviewed}
                          disabled={previewPending || Boolean(previewError)}
                          onChange={(event) => setReviewed(event.target.checked)}
                        />
                        <span>내용과 미리보기를 직접 검토했습니다.</span>
                      </label>
                      <button
                        className="primary wide"
                        disabled={Boolean(previewError) || previewPending || busy}
                        onClick={() => void perform(save)}
                      >
                        {busy ? '저장 중…' : reviewed ? 'PNG 저장·검토 완료' : 'PNG와 초안 저장'}
                        <Icon name="arrow" />
                      </button>
                      <p className="help">이미지 URL을 아는 사람은 학습 카드를 볼 수 있습니다.</p>
                      {editing ? (
                        <details>
                          <summary>PNG 백업 복원</summary>
                          <p className="help">
                            현재 카드와 동일한 내용의 1080×1080 PNG를 선택하고 미리보기를
                            검토하세요. 새 이미지는 별도 URL로 저장됩니다.
                          </p>
                          <input
                            aria-label="PNG 백업 파일"
                            type="file"
                            accept="image/png"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file)
                                void perform(async () => {
                                  await validateBackup(file);
                                  const saved = (await api(
                                    `/api/cards/${editing.id}`,
                                    'PUT',
                                    { revision: editing.revision, content: cardSchema.parse(card) },
                                    state.csrf,
                                  )) as { id: string; revision: number };
                                  setEditing(saved);
                                  const asset = await upload(
                                    saved.id,
                                    saved.revision,
                                    file,
                                    state.csrf,
                                  );
                                  await refresh();
                                  setRestored({ id: asset.id, public_id: asset.public_id });
                                  setReviewed(false);
                                  setNotice({
                                    kind: 'success',
                                    text: 'PNG를 복원했습니다. 미리보기와 내용을 확인한 뒤 검토 완료를 눌러주세요.',
                                  });
                                });
                            }}
                          />
                        </details>
                      ) : null}
                    </fieldset>
                  </section>
                  <section className="preview-panel">
                    <div className="panel-heading">
                      <h2>카드 미리보기</h2>
                      <span className="tiny">1080 × 1080 · PNG</span>
                    </div>
                    <div className="preview-mat">
                      <div
                        className="preview-paper"
                        ref={preview}
                        role="img"
                        aria-label={`${card.expression} 카드 미리보기`}
                      />
                      {previewError ? (
                        <div role="alert" className="preview-error">
                          {previewError}
                        </div>
                      ) : null}
                    </div>
                    <div className="preview-footer">
                      <span>지금 보이는 그대로 저장됩니다.</span>
                      <button
                        className="secondary"
                        disabled={busy || previewPending || Boolean(previewError)}
                        onClick={() =>
                          void perform(async () => {
                            if (restored) {
                              const response = await fetch(`/images/${restored.public_id}.png`);
                              if (!response.ok)
                                throw new Error(
                                  '복원한 PNG를 내려받지 못했습니다. 다시 시도하세요.',
                                );
                              downloadBlob(await response.blob(), 'english-card.png');
                            } else
                              downloadBlob(
                                await pngBlob(await renderCard(card, cardNumber)),
                                'english-card.png',
                              );
                          })
                        }
                      >
                        PNG 다운로드 ↓
                      </button>
                    </div>
                    <div className="tip">
                      <span>작은 학습 팁</span>
                      <p>
                        예문을 나의 이야기로 바꿔 보세요.
                        <br />
                        표현이 조금 더 오래 기억됩니다.
                      </p>
                    </div>
                  </section>
                </div>
              ) : null}
              {page === 'library' ? (
                <>
                  <div className="toolbar">
                    <button
                      className="primary"
                      onClick={() => {
                        setEditing(null);
                        setCardNumber(1);
                        setRestored(null);
                        setCard(EMPTY);
                        setReviewed(false);
                        setPage('editor');
                      }}
                    >
                      ＋ 새 카드
                    </button>
                    <button className="secondary" onClick={() => setShowImport((value) => !value)}>
                      JSON 가져오기
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void perform(() => importCards(seeds))}
                    >
                      예제 12개 가져오기
                    </button>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void perform(() => backup(null, 1))}
                    >
                      JSON 백업 ↓ (파일당 최대 100개)
                    </button>
                  </div>
                  {backupCursor ? (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void perform(() => backup(backupCursor, backupPart))}
                    >
                      다음 JSON 백업 ↓ ({backupPart}번째 파일)
                    </button>
                  ) : null}
                  {showImport ? (
                    <section className="import-panel">
                      <h2>카드 JSON 가져오기</h2>
                      <p>
                        schema_version: 1 형식, 파일당 최대 100개입니다. 오류가 있으면 해당 파일
                        전체 저장을 멈추고 위치를 안내합니다.
                      </p>
                      <textarea
                        aria-label="가져올 JSON"
                        rows={7}
                        value={json}
                        onChange={(event) => setJson(event.target.value)}
                      />
                      <input
                        type="file"
                        accept=".json,application/json"
                        aria-label="JSON 파일 선택"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void perform(async () => setJson(await file.text()));
                        }}
                      />
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void perform(() => importCards(JSON.parse(json) as unknown))}
                      >
                        가져오기
                      </button>
                    </section>
                  ) : null}
                  {state.cards.length === 0 ? (
                    <div className="empty">
                      <h2>첫 표현을 담아보세요.</h2>
                      <p>새 카드를 만들거나 예제 12개로 시작할 수 있습니다.</p>
                    </div>
                  ) : (
                    <div className="library-grid">
                      {state.cards.map((item, index) => (
                        <article className="library-card" key={item.id}>
                          <div className="card-meta">
                            <span>
                              {String(index + 1).padStart(3, '0')} ·{' '}
                              {item.content.template === 'comparison' ? '비교형' : '표현형'}
                            </span>
                            <span className={`badge ${item.status}`}>{label(item.status)}</span>
                          </div>
                          <h2>{item.content.expression}</h2>
                          <p className="blue">{item.content.meaning_ko}</p>
                          <p>{item.content.example_en}</p>
                          <div className="card-actions">
                            <button
                              className="text-button"
                              onClick={() => {
                                setEditing({ id: item.id, revision: item.revision });
                                setCardNumber(index + 1);
                                setRestored(null);
                                setCard(item.content);
                                setReviewed(false);
                                setPage('editor');
                              }}
                            >
                              편집하기 <span>↗</span>
                            </button>
                            {item.status === 'ready' ? (
                              <button
                                className="text-button"
                                onClick={() => {
                                  setSchedule((current) => ({
                                    ...current,
                                    asset_ids: [...new Set([...current.asset_ids, item.asset_id!])],
                                  }));
                                  setPage('schedules');
                                }}
                              >
                                예약에 담기
                              </button>
                            ) : null}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
              {page === 'library' ? moreButton('cards') : null}
              {page === 'schedules' ? (
                <div className="schedule-grid">
                  <section className="editor-panel">
                    <h2>{editingSchedule ? '예약 수정' : '새로운 예약'}</h2>
                    {editingSchedule ? (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => {
                          setEditingSchedule(null);
                          setSchedule(initialSchedule());
                        }}
                      >
                        새 예약 작성
                      </button>
                    ) : null}
                    <fieldset disabled={busy}>
                      <TextField
                        label="예약 이름"
                        value={schedule.name}
                        onChange={(value) =>
                          setSchedule((current) => ({ ...current, name: value }))
                        }
                      />
                      <label className="field">
                        <span>반복</span>
                        <select
                          value={schedule.kind}
                          onChange={(event) =>
                            setSchedule((current) => ({
                              ...current,
                              kind: event.target.value as ScheduleInput['kind'],
                            }))
                          }
                        >
                          <option value="once">한 번 보내기</option>
                          <option value="daily">매일</option>
                          <option value="weekly">요일 선택</option>
                        </select>
                      </label>
                      <div className="two-col">
                        <label className="field">
                          <span>시작 날짜</span>
                          <input
                            type="date"
                            value={schedule.date}
                            onChange={(event) =>
                              setSchedule((current) => ({ ...current, date: event.target.value }))
                            }
                          />
                        </label>
                        <label className="field">
                          <span>시각 · 한국 시간</span>
                          <input
                            type="time"
                            value={schedule.time}
                            onChange={(event) =>
                              setSchedule((current) => ({ ...current, time: event.target.value }))
                            }
                          />
                        </label>
                      </div>
                      {schedule.kind === 'weekly' ? (
                        <div className="weekdays">
                          {['일', '월', '화', '수', '목', '금', '토'].map((day, index) => (
                            <label key={day}>
                              <input
                                type="checkbox"
                                checked={schedule.weekdays.includes(index)}
                                onChange={(event) =>
                                  setSchedule((current) => ({
                                    ...current,
                                    weekdays: event.target.checked
                                      ? [...current.weekdays, index]
                                      : current.weekdays.filter((value) => value !== index),
                                  }))
                                }
                              />
                              {day}
                            </label>
                          ))}
                        </div>
                      ) : null}
                      {schedule.kind !== 'once' ? (
                        <label className="field">
                          <span>종료 날짜 · 선택</span>
                          <input
                            type="date"
                            value={schedule.end_date ?? ''}
                            onChange={(event) =>
                              setSchedule((current) => ({
                                ...current,
                                end_date: event.target.value || null,
                              }))
                            }
                          />
                        </label>
                      ) : null}
                      <label className="field">
                        <span>한 회차 카드 수</span>
                        <select
                          value={schedule.cards_per_occurrence}
                          onChange={(event) =>
                            setSchedule((current) => ({
                              ...current,
                              cards_per_occurrence: Number(event.target.value),
                            }))
                          }
                        >
                          {[1, 2, 3, 4, 5].map((value) => (
                            <option key={value} value={value}>
                              {value}장
                            </option>
                          ))}
                        </select>
                      </label>
                      <h3>
                        보낼 카드 <span className="tiny">선택 순서대로</span>
                      </h3>
                      <div className="card-picker">
                        {editingSchedule?.items
                          .filter(
                            (item) =>
                              editingSchedule.asset_ids.indexOf(item.asset_id) >=
                                editingSchedule.cursor &&
                              !readyCards.some((card) => card.asset_id === item.asset_id),
                          )
                          .map((item) => (
                            <label className="check-row" key={item.asset_id}>
                              <input
                                type="checkbox"
                                checked={schedule.asset_ids.includes(item.asset_id)}
                                onChange={(event) =>
                                  setSchedule((current) => ({
                                    ...current,
                                    asset_ids: event.target.checked
                                      ? [...current.asset_ids, item.asset_id]
                                      : current.asset_ids.filter((id) => id !== item.asset_id),
                                  }))
                                }
                              />
                              <span>{item.title} · 예약에 저장한 이미지</span>
                              <em>
                                {schedule.asset_ids.includes(item.asset_id)
                                  ? schedule.asset_ids.indexOf(item.asset_id) + 1
                                  : ''}
                              </em>
                            </label>
                          ))}
                        {readyCards.length ? (
                          readyCards.map((item) => (
                            <label className="check-row" key={item.id}>
                              <input
                                type="checkbox"
                                checked={schedule.asset_ids.includes(item.asset_id!)}
                                onChange={(event) =>
                                  setSchedule((current) => ({
                                    ...current,
                                    asset_ids: event.target.checked
                                      ? [...current.asset_ids, item.asset_id!]
                                      : current.asset_ids.filter((id) => id !== item.asset_id),
                                  }))
                                }
                              />
                              <span>{item.content.expression}</span>
                              {schedule.asset_ids.includes(item.asset_id!) ? (
                                <em>{schedule.asset_ids.indexOf(item.asset_id!) + 1}</em>
                              ) : null}
                            </label>
                          ))
                        ) : (
                          <p>보관함에서 카드의 PNG를 저장하고 검토를 완료하세요.</p>
                        )}
                      </div>
                      {moreButton('cards')}
                      <div className="schedule-preview">
                        <span>다음 발송 예정</span>
                        <strong>{next ? formatKst(next) : '실행 가능한 시각을 선택하세요'}</strong>
                        <small>
                          {schedule.asset_ids.length}장 준비 · 최대{' '}
                          {schedule.kind === 'once'
                            ? Math.min(
                                1,
                                Math.floor(
                                  schedule.asset_ids.length / schedule.cards_per_occurrence,
                                ),
                              )
                            : Math.floor(schedule.asset_ids.length / schedule.cards_per_occurrence)}
                          회차
                        </small>
                      </div>
                      <button
                        className="primary wide"
                        disabled={busy || !schedule.asset_ids.length}
                        onClick={() =>
                          void perform(async () => {
                            await api(
                              editingSchedule
                                ? `/api/schedules/${editingSchedule.id}`
                                : '/api/schedules',
                              editingSchedule ? 'PUT' : 'POST',
                              editingSchedule
                                ? { version: editingSchedule.version, schedule }
                                : schedule,
                              state.csrf,
                            );
                            await refresh();
                            setSchedule(initialSchedule());
                            setEditingSchedule(null);
                            setNotice({
                              kind: 'success',
                              text: '예약을 저장했습니다. dry_run에서는 실제 발송하지 않습니다.',
                            });
                          })
                        }
                      >
                        {editingSchedule ? '예약 수정 저장' : '예약 저장'}
                        <Icon name="arrow" />
                      </button>
                      <p className="help">
                        이미지 저장 후 2분 이상 여유를 두세요. 여러 장은 분당 최대 3건씩 처리하며
                        늦어질 수 있습니다. 준비한 카드가 부족하면 멈춥니다.
                      </p>
                    </fieldset>
                  </section>
                  <section>
                    <div className="panel-heading">
                      <h2>내 예약</h2>
                      <span className="tiny">활성 {activeSchedules} / 10</span>
                    </div>
                    <div className="soft-notice">
                      무료 ‘나에게 보내기’에는 푸시 알림·알림음이 없습니다. 도착 시각과 무중단을
                      보장하지 않습니다.
                    </div>
                    {state.schedules.length === 0 ? (
                      <div className="empty">
                        <h3>아직 예약이 없습니다.</h3>
                        <p>검토한 카드와 나에게 맞는 시간을 골라보세요.</p>
                      </div>
                    ) : (
                      state.schedules.map((item) => (
                        <article className="schedule-card" key={item.id}>
                          <div className="card-meta">
                            <span>
                              {item.kind === 'once'
                                ? '한 번'
                                : item.kind === 'daily'
                                  ? '매일'
                                  : '요일 반복'}{' '}
                              · {item.time} KST
                            </span>
                            <span className="badge">
                              {item.enabled ? '예약 중' : label(item.reason ?? 'paused')}
                            </span>
                          </div>
                          <h2>{item.name}</h2>
                          <p>
                            {item.next_run_at_utc
                              ? formatKst(item.next_run_at_utc)
                              : '다음 회차 없음'}
                          </p>
                          <p>
                            회차당 {item.cards_per_occurrence}장 · 남은 목록{' '}
                            {Math.max(0, item.asset_ids.length - item.cursor)}장
                          </p>
                          <div className="card-actions">
                            <button
                              className="text-button"
                              disabled={busy || item.reason === 'cancelled'}
                              onClick={() => {
                                setEditingSchedule(item);
                                setSchedule({
                                  name: item.name,
                                  kind: item.kind,
                                  date: item.date,
                                  time: item.time,
                                  end_date: item.end_date,
                                  weekdays: item.weekdays,
                                  cards_per_occurrence: item.cards_per_occurrence,
                                  asset_ids: item.asset_ids.slice(item.cursor),
                                });
                              }}
                            >
                              수정
                            </button>
                            <button
                              className="text-button"
                              disabled={busy || item.reason === 'cancelled'}
                              onClick={() =>
                                void perform(async () => {
                                  await api(
                                    `/api/schedules/${item.id}/${item.enabled ? 'pause' : 'resume'}`,
                                    'POST',
                                    { version: item.version },
                                    state.csrf,
                                  );
                                  await refresh();
                                })
                              }
                            >
                              {item.enabled ? '일시정지' : '재개'}
                            </button>
                            <button
                              className="text-button danger"
                              disabled={busy || item.reason === 'cancelled'}
                              onClick={() =>
                                void perform(async () => {
                                  await api(
                                    `/api/schedules/${item.id}/cancel`,
                                    'POST',
                                    { version: item.version },
                                    state.csrf,
                                  );
                                  await refresh();
                                })
                              }
                            >
                              취소
                            </button>
                          </div>
                        </article>
                      ))
                    )}
                    {moreButton('schedules')}
                    <button
                      className="secondary wide"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api('/api/dry-run', 'POST', {}, state.csrf);
                          await refresh();
                          setPage('history');
                          setNotice({
                            kind: 'success',
                            text: '시간과 피드 구성을 검사했습니다. 카드 목록은 소비하지 않았습니다.',
                          });
                        })
                      }
                    >
                      예약 발송 미리검증
                    </button>
                  </section>
                </div>
              ) : null}
              {page === 'history' ? (
                <>
                  <div className="stat-row">
                    <div>
                      <span>실제 API 접수</span>
                      <strong>
                        {
                          state.deliveries.filter(
                            (item) => item.state === 'sent' && item.confirmed_by_user === 0,
                          ).length
                        }
                        <small>건</small>
                      </strong>
                    </div>
                    <div>
                      <span>확인이 필요한 결과</span>
                      <strong>
                        {
                          state.deliveries.filter((item) =>
                            ['unknown', 'failed', 'blocked'].includes(item.state),
                          ).length
                        }
                        <small>건</small>
                      </strong>
                    </div>
                    <div>
                      <span>미리검증 기록</span>
                      <strong>
                        {state.previews.length}
                        <small>건</small>
                      </strong>
                    </div>
                  </div>
                  {state.deliveries.length === 0 && state.previews.length === 0 ? (
                    <div className="empty">
                      <h2>아직 발송 기록이 없습니다.</h2>
                      <p>예약을 저장한 뒤 ‘예약 발송 미리검증’을 실행해 보세요.</p>
                    </div>
                  ) : (
                    <div className="journal">
                      {state.deliveries.map((item) => (
                        <article key={item.id}>
                          <span className={`badge ${item.state}`}>
                            {item.confirmed_by_user ? '사용자 수신 확인' : label(item.state)}
                          </span>
                          <div>
                            <strong>{formatKst(item.due_at_utc)}</strong>
                            <p>{item.error ?? '발송 대기 중'}</p>
                            <details
                              onToggle={(event) => {
                                if (event.currentTarget.open)
                                  void perform(async () => {
                                    const history = (await api(
                                      `/api/deliveries/${item.id}/attempts`,
                                      'GET',
                                      null,
                                      '',
                                    )) as AttemptHistory;
                                    setAttemptHistory((current) => ({
                                      ...current,
                                      [item.id]: history,
                                    }));
                                  });
                              }}
                            >
                              <summary>시도별 호출 기록 · 사용자 확인</summary>
                              {attemptHistory[item.id]?.attempts.map((attempt) => (
                                <p key={attempt.id}>
                                  {formatKst(attempt.started_at)} · {label(attempt.outcome)}
                                  <br />
                                  {attempt.detail}
                                </p>
                              ))}
                              {attemptHistory[item.id]?.decisions.map((decision, index) => (
                                <p key={index}>
                                  {formatKst(decision.created_at)} · 사용자가{' '}
                                  {decision.action === 'retry'
                                    ? '중복 가능성을 확인하고 재시도 선택'
                                    : '채팅방 수신 확인'}
                                </p>
                              ))}
                            </details>
                            <small>
                              {item.mode === 'mock' ? '모의 발송' : '실제 API'} · 시도{' '}
                              {item.total_attempts}회 · 카드 순서 {item.position + 1} · 회차{' '}
                              {item.occurrence_state === 'completed'
                                ? '처리 종료'
                                : label(item.occurrence_state)}
                            </small>
                          </div>
                          {item.state === 'unknown' ? (
                            <button
                              className="secondary"
                              onClick={() => {
                                setUnknownId(item.id);
                                setAcceptDuplicate(false);
                              }}
                            >
                              결과 확인
                            </button>
                          ) : null}
                        </article>
                      ))}
                      {state.previews.map((item) => (
                        <article key={item.id}>
                          <span className="badge">미리검증</span>
                          <div>
                            <strong>{formatKst(item.due_at_utc)}</strong>
                            <p>시간·피드 형식 검사 완료. 실제 API 호출 및 카드 소비 없음.</p>
                            <details>
                              <summary>검사한 피드 보기</summary>
                              <pre>
                                {JSON.stringify(JSON.parse(item.detail) as unknown, null, 2)}
                              </pre>
                            </details>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {moreButton('deliveries')}
                  <p className="help">
                    발송 기록 {state.deliveries.length} / {state.totals.deliveries}건 표시 · 위
                    집계는 불러온 기록 기준입니다.
                  </p>
                  {unknownId ? (
                    <div className="modal-backdrop">
                      <section
                        className="modal"
                        role="dialog"
                        aria-modal="true"
                        aria-label="결과 불명 확인"
                      >
                        <h2>먼저 나와의 채팅을 확인하세요.</h2>
                        <p>
                          이미 도착한 메시지를 재시도하면 중복으로 받을 수 있습니다. 사용자 확인
                          사실과 새 시도는 별도로 기록됩니다.
                        </p>
                        <label className="check-row">
                          <input
                            type="checkbox"
                            checked={acceptDuplicate}
                            onChange={(event) => setAcceptDuplicate(event.target.checked)}
                          />
                          채팅방을 확인했고 중복 가능성을 이해했습니다.
                        </label>
                        <div className="toolbar">
                          {(['confirm_sent', 'retry'] as const).map((action) => (
                            <button
                              className="secondary"
                              key={action}
                              disabled={busy || !acceptDuplicate}
                              onClick={() =>
                                void perform(async () => {
                                  await api(
                                    `/api/deliveries/${unknownId}/resolve`,
                                    'POST',
                                    { action, warning_accepted: true },
                                    state.csrf,
                                  );
                                  setUnknownId(null);
                                  await refresh();
                                })
                              }
                            >
                              {action === 'confirm_sent' ? '이미 수신함' : '다시 보내기'}
                            </button>
                          ))}
                          <button className="text-button" onClick={() => setUnknownId(null)}>
                            닫기
                          </button>
                        </div>
                      </section>
                    </div>
                  ) : null}
                </>
              ) : null}
              {page === 'settings' ? (
                <div className="settings-grid">
                  <section className="editor-panel">
                    <h2>카카오 연결</h2>
                    <span className="badge">
                      {boot?.local
                        ? '로컬 테스트'
                        : label(state.connection?.status ?? 'disconnected')}
                    </span>
                    <p>
                      로그아웃은 브라우저 세션만 종료합니다. 자동 발송 연결 해제는 예약을 중지하고
                      저장된 토큰을 제거합니다.
                    </p>
                    {boot?.local ? (
                      <div className="soft-notice">
                        운영 계정의 인증·무료 플랜은 아직 확인하지 않았습니다. 실제 연결은 배포 설정
                        후 진행하세요.
                      </div>
                    ) : (
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void perform(oauth)}
                      >
                        카카오 다시 연결
                      </button>
                    )}
                    <button
                      className="secondary wide"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await api('/api/disconnect', 'POST', {}, state.csrf);
                          await refresh();
                          setNotice({
                            kind: 'success',
                            text: '저장된 토큰을 제거하고 자동 발송을 중단했습니다.',
                          });
                        })
                      }
                    >
                      자동 발송 연결 해제
                    </button>
                    <h2>무료 구성</h2>
                    <p>
                      Workers Free · D1 Free · KV Free
                      <br />
                      이미지는 브라우저에서 생성합니다.
                    </p>
                    <p className="help">
                      계정 내 다른 앱과 제공사 한도를 공유할 수 있습니다. 앱 설정만으로 무료
                      플랜이나 계정 전체 사용량을 확인할 수 없습니다.
                    </p>
                  </section>
                  <section className="editor-panel">
                    <h2>오늘과 저장 공간</h2>
                    <div className="meter-label">
                      <span>이미지 저장량</span>
                      <strong>{(storage / 1_000_000).toFixed(2)} / 200 MB</strong>
                    </div>
                    <meter value={storage} max={LIMITS.storageBytes} />
                    <div className="usage-lines">
                      <p>
                        오늘 업로드 <strong>{today?.uploads ?? 0} / 100</strong>
                      </p>
                      <p>
                        오늘 발송 시도 <strong>{today?.sends ?? 0} / 20</strong>
                      </p>
                      <p>
                        활성 예약 <strong>{activeSchedules} / 10</strong>
                      </p>
                    </div>
                    <small>앱의 하루 기준: KST. 제공사 초기화 시각과 다를 수 있습니다.</small>
                    <h3>이미지 정리 및 PNG 백업</h3>
                    <p className="help">
                      삭제하면 과거 메시지의 원본 링크가 열리지 않을 수 있습니다. 예약과 미확정
                      발송에서 사용하는 이미지는 보호합니다.
                    </p>
                    <div className="asset-list">
                      {state.assets.map((asset) => (
                        <div key={asset.id}>
                          <span>
                            {asset.expression}
                            <small>
                              {label(asset.state)} · {(asset.bytes / 1024).toFixed(0)} KB
                            </small>
                          </span>
                          {asset.state === 'ready' ? (
                            <a href={`/images/${asset.public_id}.png`} download="card.png">
                              PNG ↓
                            </a>
                          ) : null}
                          <button
                            className="text-button danger"
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                if (
                                  !window.confirm(
                                    '이미지를 삭제하면 이전 메시지 링크도 사라질 수 있습니다. 삭제할까요?',
                                  )
                                )
                                  return;
                                await api(`/api/assets/${asset.id}`, 'DELETE', null, state.csrf);
                                await refresh();
                              })
                            }
                          >
                            삭제
                          </button>
                        </div>
                      ))}
                    </div>
                    {moreButton('assets')}
                  </section>
                </div>
              ) : null}
            </>
          )}
        </div>
        <footer>
          하루 한 표현 <span>작게 만들고, 오래 기억하세요.</span>
          <span>나에게 보내는 영어 · KST</span>
        </footer>
      </main>
    </div>
  );
}
