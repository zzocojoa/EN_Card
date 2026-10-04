import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  cardSchema,
  LIMITS,
  type Card,
  type CardInput,
  type Schedule,
  type ScheduleInput,
  type PausePreview,
} from '../shared/model';
import { kstDate, nextRun } from '../shared/time';
import { api, upload, type AppState, type AttemptHistory, type Boot, type Collection } from './api';
import type { Page as ResultPage } from '../worker/pagination';
import { downloadBlob, pngBlob, renderCard } from './canvas';
import { EMPTY, initialSchedule, errorMessage } from './ui';
import { usePage } from './navigation';
import { endpoint, integratedStudio } from './environment';
import type { AutomationSettings } from '../shared/automation';
type Notice = { kind: 'error' | 'success'; text: string } | null;
function useStudioModel() {
  const [revision, setRevision] = useState(0);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [savedAsset, setSavedAsset] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [scheduleDirty, setScheduleDirty] = useState(false);
  const [automationDraft, setAutomationDraft] = useState<AutomationSettings | null>(null);
  const [automationDirty, setAutomationDirty] = useState(false);
  const [scheduleTitles, setScheduleTitles] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<{
    title: string;
    body: string;
    actionLabel: string;
    action: () => Promise<void>;
  } | null>(null);
  const [historyTab, setHistoryTab] = useState<'all' | 'attention' | 'previews'>('all');
  const [page, setPage] = usePage();
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
  const [pauseConfirm, setPauseConfirm] = useState<PausePreview | null>(null);
  const [recovery, setRecovery] = useState<PausePreview | null>(null);
  const [unknownId, setUnknownId] = useState<string | null>(null);
  const [acceptDuplicate, setAcceptDuplicate] = useState<boolean>(false);
  const preview = useRef<HTMLDivElement>(null);
  const modalOpener = useRef<HTMLElement | null>(null);
  const hadModal = useRef(false);
  const authenticated: boolean = state !== null;
  const entryRead = useRef({ page, authenticated: false, pending: false });
  const sendMode = state?.mode ?? boot?.mode;
  useEffect(() => {
    if (authenticated && (pauseConfirm || recovery || unknownId)) {
      hadModal.current = true;
    } else if (hadModal.current && !busy) {
      hadModal.current = false;
      if (modalOpener.current?.isConnected) modalOpener.current.focus();
    }
  }, [authenticated, pauseConfirm, recovery, unknownId, busy]);
  async function refresh(): Promise<void> {
    setState((await api('/api/state', 'GET', null, '')) as AppState);
    setRevision((value) => value + 1);
  }
  // Cron can change summaries while another screen is open. Refresh on entry,
  // and abort this read before a mutation or later navigation can supersede it.
  useEffect(() => {
    if (!authenticated) {
      entryRead.current = { page, authenticated: false, pending: false };
      return;
    }
    if (!entryRead.current.authenticated || entryRead.current.page !== page)
      entryRead.current = { page, authenticated: true, pending: true };
    const entry = entryRead.current;
    if (busy || !entry.pending) return;
    const controller = new AbortController();
    void api('/api/state', 'GET', null, '', controller.signal)
      .then((data) => {
        if (controller.signal.aborted || !entry.pending) return;
        entry.pending = false;
        setState(data as AppState);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !entry.pending) return;
        entry.pending = false;
        if (error instanceof Error && 'status' in error && error.status === 401) setState(null);
        setNotice({ kind: 'error', text: errorMessage(error) });
      });
    return () => controller.abort();
  }, [authenticated, page, busy]);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (dirty || scheduleDirty || automationDirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, scheduleDirty, automationDirty]);
  useEffect(() => {
    let active: boolean = true;
    void Promise.all([api('/api/boot', 'GET', null, ''), fetch(endpoint('/api/state'))])
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
      image.src = endpoint(`/images/${restored.public_id}.png`);
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
    const parsed = cardSchema.safeParse(card);
    if (!parsed.success) {
      setPreviewError('필수 항목과 입력 길이를 확인해 주세요.');
      setPreviewPending(false);
      return;
    }
    void renderCard(parsed.data, cardNumber)
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
    // An explicit operation supersedes an unfinished entry snapshot. In
    // particular, never replace a newly appended page with the old first page.
    entryRead.current.pending = false;
    setBusy(true);
    setNotice(null);
    try {
      await task();
    } catch (error: unknown) {
      if (error instanceof Error && 'status' in error && error.status === 401) setState(null);
      if (error instanceof Error && 'code' in error && error.code === 'SCHEDULE_UNRESOLVED') {
        setHistoryTab('attention');
        setPage('history');
      }
      setNotice({ kind: 'error', text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }
  function change(key: keyof CardInput, value: string): void {
    setCard((current) => ({ ...current, [key]: value }));
    setReviewed(false);
    setRestored(null);
    setSavedAsset(null);
    setDirty(true);
  }
  async function save(): Promise<void> {
    if (!state) return;
    setSavedAsset(null);
    setDirty(true);
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
      setSavedAsset(restored.id);
      setDirty(false);
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
    setSavedAsset(reviewed ? asset.id : null);
    setDirty(false);
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
    const result = (await api(
      integratedStudio ? '/api/studio/kakao' : '/auth/start',
      'POST',
      { setup_token: setupToken },
      state?.csrf ?? '',
    )) as {
      url: string;
    };
    setSetupToken('');
    (integratedStudio ? (window.top ?? window) : window).location.assign(result.url);
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
  const validation = cardSchema.safeParse(card);
  const fieldErrors: Record<string, string> = {};
  if (!validation.success)
    for (const issue of validation.error.issues) {
      const field = String(issue.path[0]);
      fieldErrors[field] =
        issue.code === 'too_big'
          ? `최대 ${issue.maximum}자까지 입력할 수 있습니다.`
          : issue.code === 'custom'
            ? issue.message
            : '필수 항목을 입력해 주세요.';
    }
  if (card.template === 'comparison') {
    if (!card.base_expression?.trim())
      fieldErrors.base_expression = '기본 영어 표현을 입력해 주세요.';
    if (!card.base_meaning_ko?.trim())
      fieldErrors.base_meaning_ko = '기본 표현의 뜻을 입력해 주세요.';
  }
  function addToSchedule(assetId: string, title: string): void {
    if (busy) return;
    if (
      !editingSchedule &&
      schedule.asset_ids.length >= 40 &&
      !schedule.asset_ids.includes(assetId)
    ) {
      setNotice({
        kind: 'error',
        text: '예약에는 최대 40장까지 담을 수 있습니다. 작성 중인 예약에서 카드를 빼거나 새 예약을 만드세요.',
      });
      return;
    }
    const open = () => {
      setSchedule((current) => ({
        ...(editingSchedule ? initialSchedule() : current),
        asset_ids: [...new Set([...(editingSchedule ? [] : current.asset_ids), assetId])],
      }));
      setEditingSchedule(null);
      setScheduleTitles((current) => ({ ...current, [assetId]: title }));
      setScheduleOpen(true);
      setScheduleDirty(true);
      setPage('schedules');
    };
    if (editingSchedule && scheduleDirty) {
      setConfirmation({
        title: '새 예약으로 전환',
        body: '저장하지 않은 예약 수정 내용을 버리고 이 카드로 새 예약을 작성합니다.',
        actionLabel: '새 예약 작성',
        action: async () => open(),
      });
    } else open();
  }
  function openCard(item: Card | null, number = 1): void {
    if (busy) return;
    const open = () => {
      setEditing(item ? { id: item.id, revision: item.revision } : null);
      setCard(item?.content ?? EMPTY);
      setCardNumber(number);
      setRestored(null);
      setReviewed(false);
      setSavedAsset(null);
      setDirty(false);
      setPage('editor');
    };
    if (dirty)
      setConfirmation({
        title: '편집 중인 카드 바꾸기',
        body: '저장하지 않은 카드 내용을 버리고 다른 카드를 엽니다.',
        actionLabel: '카드 열기',
        action: async () => open(),
      });
    else open();
  }
  const activeSchedules: number = state?.totals.active_schedules ?? 0;
  const credentialStorageFailure: boolean =
    state?.connection?.status === 'needs_reconnect' &&
    state.connection.refresh_failure === 'configuration';
  const storage: number = state?.usage.find((item) => item.day === 'storage')?.bytes ?? 0;
  const today = state?.usage.find((item) => item.day === kstDate(Date.now()));
  let next: number | null = null;
  try {
    next = nextRun(schedule, Date.now() + LIMITS.propagationMs - 1);
  } catch {
    next = null;
  }

  return {
    automationDraft,
    setAutomationDraft,
    automationDirty,
    setAutomationDirty,
    revision,
    scheduleOpen,
    setScheduleOpen,
    previewExpanded,
    setPreviewExpanded,
    savedAsset,
    setSavedAsset,
    dirty,
    setDirty,
    scheduleDirty,
    setScheduleDirty,
    scheduleTitles,
    setScheduleTitles,
    confirmation,
    setConfirmation,
    historyTab,
    setHistoryTab,
    fieldErrors,
    addToSchedule,
    openCard,
    page,
    setPage,
    boot,
    setBoot,
    state,
    setState,
    loading,
    setLoading,
    busy,
    setBusy,
    notice,
    setNotice,
    card,
    setCard,
    editing,
    setEditing,
    restored,
    setRestored,
    reviewed,
    setReviewed,
    cardNumber,
    setCardNumber,
    previewPending,
    setPreviewPending,
    backupCursor,
    setBackupCursor,
    backupPart,
    setBackupPart,
    attemptHistory,
    setAttemptHistory,
    previewError,
    setPreviewError,
    json,
    setJson,
    showImport,
    setShowImport,
    setupToken,
    setSetupToken,
    schedule,
    setSchedule,
    editingSchedule,
    setEditingSchedule,
    pauseConfirm,
    setPauseConfirm,
    recovery,
    setRecovery,
    unknownId,
    setUnknownId,
    acceptDuplicate,
    setAcceptDuplicate,
    preview,
    modalOpener,
    hadModal,
    authenticated,
    sendMode,
    activeSchedules,
    credentialStorageFailure,
    storage,
    today,
    next,
    refresh,
    perform,
    change,
    save,
    importCards,
    oauth,
    loadMore,
    moreButton,
    backup,
  };
}
type Studio = ReturnType<typeof useStudioModel>;
const StudioContext = createContext<Studio | null>(null);
export function StudioProvider({ children }: { children: ReactNode }): ReactElement {
  const studio = useStudioModel();
  return <StudioContext.Provider value={studio}>{children}</StudioContext.Provider>;
}
export function useStudio(): Studio {
  const value = useContext(StudioContext);
  if (!value) throw new Error('작업실 상태가 없습니다.');
  return value;
}
