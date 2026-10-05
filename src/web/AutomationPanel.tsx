import { useEffect, useState, useRef } from 'react';
import {
  automationReasons,
  MAX_AUTOMATION_CARDS_PER_DAY,
  trialLeadMinutes,
  reviewPassed,
  type AutomationSettings,
  type AutomationView,
  type AutomationRunView,
} from '../shared/automation';
import { formatKst, kstDate } from '../shared/time';
import { api } from './api';
import { endpoint } from './environment';
import { useStudio } from './studio';
import { Icon, label } from './ui';
import type { Card } from '../shared/model';
import { downloadBlob } from './canvas';
const stages: Record<string, string> = {
  draft: '초안 작성',
  review: '교차 검토',
  revise: '한 번 수정',
  render: '이미지 저장',
  schedule: '예약 준비',
  scheduled: '예약 등록 완료',
  skipped: '건너뜀',
  cancelled: '중단',
};
const initial: AutomationSettings = {
  topic: '일상 회화',
  base_expression: '',
  level: '초급',
  template: 'expression',
  start_date: kstDate(Date.now()),
  end_date: null,
  time: '08:00',
  cards_per_day: 1,
};
export function AutomationPanel() {
  const {
    state,
    revision,
    perform,
    busy,
    setNotice,
    automationDraft,
    setAutomationDraft,
    automationDirty: dirty,
    setAutomationDirty: setDirty,
    openCard,
  } = useStudio();
  const [view, setView] = useState<AutomationView | null>(null);
  const settings = automationDraft ?? initial;
  const setSettings = setAutomationDraft;
  const [runs, setRuns] = useState<AutomationRunView[]>([]);
  const [error, setError] = useState('');
  const [trialCards, setTrialCards] = useState(1);
  const [trialTime, setTrialTime] = useState('');
  const dirtyRef = useRef(dirty);
  const statusRequest = useRef<AbortController | null>(null);
  const editRequest = useRef<AbortController | null>(null);
  dirtyRef.current = dirty;
  const csrf = state?.csrf ?? '';
  useEffect(() => {
    const controller = new AbortController();
    statusRequest.current = controller;
    void Promise.all([
      api('/api/automation', 'GET', null, csrf, controller.signal),
      api('/api/automation/runs', 'GET', null, csrf, controller.signal),
    ])
      .then(([v, r]) => {
        if (controller.signal.aborted) return;
        const next = v as AutomationView;
        setView(next);
        if (!dirtyRef.current) setSettings(next.settings ?? initial);
        setRuns(r as AutomationRunView[]);
        setError('');
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : '불러오지 못했습니다.');
      });
    return () => {
      controller.abort();
      editRequest.current?.abort();
    };
  }, [csrf, revision]);
  function update<K extends keyof AutomationSettings>(key: K, value: AutomationSettings[K]) {
    setSettings((s) => ({ ...(s ?? initial), [key]: value }));
    setDirty(true);
  }
  function editCard(cardId: string) {
    if (editRequest.current) return;
    const controller = new AbortController();
    editRequest.current = controller;
    void perform(async () => {
      try {
        const card = await api(`/api/cards/${cardId}`, 'GET', null, csrf, controller.signal);
        if (controller.signal.aborted) return;
        openCard(card as Card);
        setNotice({
          kind: 'success',
          text: '최신 수정본을 열었습니다. 기존 자동 예약을 중지·취소한 뒤 새 예약으로 등록하세요.',
        });
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      } finally {
        if (editRequest.current === controller) editRequest.current = null;
      }
    });
  }
  const act = (action: 'save' | 'start' | 'pause' | 'trial') =>
    void perform(async () => {
      statusRequest.current?.abort();
      const next = (await api(
        action === 'save' ? '/api/automation' : `/api/automation/${action}`,
        action === 'save' ? 'PUT' : 'POST',
        {
          version: view?.version ?? 0,
          ...(action === 'save' ? { settings } : {}),
          ...(action === 'trial'
            ? {
                trial: {
                  cards: trialCards,
                  ...(trialTime
                    ? { due_at: Date.parse(`${kstDate(Date.now())}T${trialTime}:00+09:00`) }
                    : {}),
                },
              }
            : {}),
        },
        csrf,
      )) as AutomationView;
      setView(next);
      if (action !== 'pause') {
        setSettings(next.settings ?? initial);
        setDirty(false);
      }
      setError('');
      setRuns((await api('/api/automation/runs', 'GET', null, csrf)) as AutomationRunView[]);
      setNotice({
        kind: 'success',
        text:
          action === 'save'
            ? '자동 제작 설정을 저장했습니다. 시작을 누르면 적용됩니다.'
            : action === 'start'
              ? '자동 제작을 시작했습니다.'
              : action === 'trial'
                ? `오늘의 새 AI 카드 ${trialCards}장 시험을 등록했습니다. 아래 제작·발송 시각을 확인하세요. PC를 꺼도 진행됩니다.`
                : '자동 제작과 대기 중인 자동 예약을 중단했습니다.',
      });
    });
  return (
    <section className="automation-panel" aria-label="AI 카드 자동 제작">
      <header className="automation-heading">
        <div>
          <span className="eyebrow">MY DAILY ENGLISH</span>
          <h2>나에게 맞는 분량으로, 꾸준히.</h2>
          <p>
            작성부터 검토, 이미지와 예약까지.
            <br />
            시작하면 PC를 꺼도 이어집니다.
          </p>
          {!error && view?.enabled && view.next_due_at && (
            <p className="automation-mobile-next">다음 발송 · {formatKst(view.next_due_at)}</p>
          )}
        </div>
        <span
          className={`badge automation-status ${!error && view?.enabled ? 'ready' : ''}`}
          role="status"
        >
          {error
            ? '상태 확인 실패'
            : !view
              ? '상태 확인 중'
              : view.enabled
                ? '실행 중'
                : view.reason === 'complete'
                  ? '기간 종료'
                  : view.settings
                    ? '일시정지'
                    : '설정 전'}
        </span>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error} 상단 새로고침으로 다시 확인해 주세요.
        </p>
      )}
      {view && !view.available && (
        <p className="soft-notice" role="status">
          서버의 무료 AI 실행 설정이 준비되지 않았습니다. 자동 시작은 준비 후 사용할 수 있습니다.
        </p>
      )}
      <div className="automation-layout">
        <form
          id="automation-settings"
          className="automation-form"
          onSubmit={(e) => {
            e.preventDefault();
            act('save');
          }}
        >
          <fieldset disabled={busy || !view}>
            <legend className="sr-only">자동 제작 설정</legend>
            <div className="automation-section-title">
              <span>01</span>
              <h3>어떤 영어를 배울까요?</h3>
            </div>
            <div className="automation-fields">
              <label className="full-field">
                주제
                <input
                  required
                  maxLength={120}
                  placeholder="예: 여행에서 바로 쓰는 영어"
                  value={settings.topic}
                  onChange={(e) => update('topic', e.target.value)}
                />
              </label>
              <label className="full-field">
                기준 표현 (선택)
                <input
                  maxLength={200}
                  placeholder="바꿔 쓸 표현을 배우고 싶을 때"
                  value={settings.base_expression}
                  onChange={(e) => update('base_expression', e.target.value)}
                />
              </label>
              <label>
                난이도
                <select
                  value={settings.level}
                  onChange={(e) => update('level', e.target.value as AutomationSettings['level'])}
                >
                  {['초급', '중급', '고급'].map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              </label>
              <label>
                카드 종류
                <select
                  value={settings.template}
                  onChange={(e) =>
                    update('template', e.target.value as AutomationSettings['template'])
                  }
                >
                  <option value="expression">표현형</option>
                  <option value="comparison">비교형</option>
                </select>
              </label>
            </div>
            <div className="automation-section-title">
              <span>02</span>
              <h3>언제 받아볼까요?</h3>
            </div>
            <div className="automation-fields">
              <label className="full-field">
                하루 제작 수량
                <select
                  value={settings.cards_per_day ?? 1}
                  onChange={(e) => update('cards_per_day', Number(e.target.value))}
                  aria-describedby="automation-quantity-help"
                >
                  {Array.from({ length: MAX_AUTOMATION_CARDS_PER_DAY }, (_, i) => i + 1).map(
                    (count) => (
                      <option key={count} value={count}>
                        {count}장
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                시작일
                <input
                  required
                  type="date"
                  value={settings.start_date}
                  onChange={(e) => update('start_date', e.target.value)}
                />
              </label>
              <label>
                종료일 (선택)
                <input
                  type="date"
                  min={settings.start_date}
                  value={settings.end_date ?? ''}
                  onChange={(e) => update('end_date', e.target.value || null)}
                />
              </label>
              <label className="full-field automation-time-field">
                매일 받을 시각 (한국 시간)
                <input
                  required
                  type="time"
                  value={settings.time}
                  onChange={(e) => update('time', e.target.value)}
                />
              </label>
            </div>
            <p id="automation-quantity-help" className="tiny">
              카드마다 따로 제작·검토하고, 준비된 카드만 한 장씩 보냅니다. 일부가 실패하면 수신
              수량이 줄 수 있고, 여러 장은 나누어 도착할 수 있습니다. 수량에 따라 무료 AI 사용량도
              늘어납니다.
            </p>
            <p className="tiny">
              발송 1시간 전부터 제작합니다. 준비 시간이 부족하면 다음 가능한 날짜부터 시작합니다.
            </p>
          </fieldset>
        </form>
        <aside className="automation-plan" aria-label="현재 실행과 설정 저장">
          <div className="automation-plan-heading">
            <Icon name="automation" />
            <h3>나의 영어 루틴</h3>
          </div>
          {view?.enabled && !error && view.next_due_at ? (
            <dl className="automation-next">
              <div>
                <dt>다음 제작</dt>
                <dd>{formatKst(view.next_due_at - 3600000)}</dd>
              </div>
              <div>
                <dt>발송 예정</dt>
                <dd>{formatKst(view.next_due_at)}</dd>
              </div>
            </dl>
          ) : (
            <p>
              {error
                ? '현재 실행 상태를 다시 확인해 주세요.'
                : view?.reason === 'complete'
                  ? '설정한 기간이 끝났어요. 새 기간을 저장한 뒤 시작하세요.'
                  : '설정을 저장하고 시작하면 다음 제작·발송 시각이 표시됩니다.'}
            </p>
          )}
          {view?.enabled && view.settings && !error && (
            <p className="tiny">
              현재 적용: {view.settings.topic} · {view.settings.level} · 하루{' '}
              {view.settings.cards_per_day ?? 1}장 · 매일 {view.settings.time}
            </p>
          )}
          <div className={`automation-save-state ${dirty ? 'unsaved' : ''}`} role="status">
            <strong>
              {dirty
                ? '저장하지 않은 변경이 있어요'
                : error
                  ? '실행 상태를 확인하지 못했어요'
                  : !view
                    ? '설정을 불러오고 있어요'
                    : view.enabled
                      ? '설정한 일정으로 진행 중이에요'
                      : '저장 → 시작 순서로 진행해 주세요'}
            </strong>
            <p>
              {dirty
                ? '지금 보이는 입력은 아직 실행에 반영되지 않았습니다.'
                : `매일 ${settings.cards_per_day ?? 1}장을 다른 AI가 각각 검토한 뒤 예약합니다.`}
            </p>
          </div>
          <fieldset disabled={busy || !view}>
            <legend className="sr-only">자동 제작 실행</legend>
            <div className="automation-actions">
              <button
                className={dirty || !view?.settings ? 'primary' : 'secondary'}
                type="submit"
                form="automation-settings"
              >
                {busy ? '처리 중…' : '설정 저장'}
              </button>
              <button
                className="primary"
                type="button"
                disabled={
                  !view?.available ||
                  !view.settings ||
                  view.enabled ||
                  dirty ||
                  state?.mode !== 'live' ||
                  state.connection?.status !== 'connected'
                }
                onClick={() => act('start')}
              >
                자동 제작 시작
              </button>
              <button
                className="secondary"
                type="button"
                disabled={!view?.enabled}
                onClick={() => act('pause')}
              >
                일시정지
              </button>
            </div>
          </fieldset>
          <p className="tiny">
            설정 저장은 실행 중인 자동 제작과 대기 예약을 중단합니다. 변경한 설정으로 보내려면 다시
            시작해 주세요.
          </p>
          {runs.some((run) => run.kind === 'daily' && run.day === kstDate(Date.now())) && (
            <p className="tiny">
              오늘은 이미 제작 기록이 있습니다. 중단하거나 수량을 바꿔도 오늘 분량을 추가로 만들지
              않으며, 변경한 수량은 다음 제작일부터 적용됩니다.
            </p>
          )}
          {view?.reason && <p>{automationReasons[view.reason] ?? view.reason}</p>}
          {state?.connection?.status !== 'connected' && (
            <p className="tiny">시작하려면 설정 화면에서 카카오를 먼저 연결하세요.</p>
          )}
          {state?.mode !== 'live' && (
            <p className="tiny">
              현재 모의 확인 모드입니다. 실제 예약 발송 모드에서 자동 제작을 시작할 수 있습니다.
            </p>
          )}
          <p className="tiny">
            AI 검토에도 오류가 있을 수 있습니다. 카카오 나에게 보내기는 알림음·푸시 알림이 없으며,
            이미 접수된 메시지는 회수되지 않습니다.
          </p>
        </aside>
      </div>
      <details className="automation-trial">
        <summary>
          새 AI 카드를 먼저 받아보고 싶다면 <span>추가 시험</span>
        </summary>
        <p>
          저장한 주제로 새 카드를 작성·검토하고 이미지를 준비합니다. 매일 받을 설정과 기존 기록은
          보존됩니다. 시험은 하루 한 번 1~5장이며, 중단해도 다시 제작하지 않습니다. 시험 후 매일
          자동 제작은 직접 다시 시작하세요.
        </p>
        <label>
          시험 카드 수
          <select
            aria-label="시험 카드 수"
            value={trialCards}
            disabled={busy}
            onChange={(e) => setTrialCards(Number(e.target.value))}
          >
            {Array.from({ length: MAX_AUTOMATION_CARDS_PER_DAY }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}장
              </option>
            ))}
          </select>
        </label>
        <label>
          오늘 시험 발송 시각 (한국 시간, 선택)
          <input
            type="time"
            value={trialTime}
            disabled={busy}
            onChange={(e) => setTrialTime(e.target.value)}
          />
        </label>
        <p>
          최소 {trialLeadMinutes(trialCards)}분의 준비 시간이 필요합니다. 시각을 비워 두면 가장 빠른
          시간으로 예약합니다. 여러 장은 순차 발송됩니다.
        </p>
        {view?.trial_used_today && <p role="status">오늘 시험은 이미 등록했습니다.</p>}
        <button
          className="secondary"
          type="button"
          disabled={
            busy ||
            !view?.available ||
            !view.settings ||
            view.enabled ||
            dirty ||
            view.trial_used_today !== false ||
            state?.mode !== 'live' ||
            state.connection?.status !== 'connected'
          }
          onClick={() => act('trial')}
        >
          오늘 새 AI 카드 {trialCards}장 시험
        </button>
      </details>
      <section className="automation-history" aria-label="최근 제작 기록">
        <div className="panel-heading">
          <h2>최근 제작 기록</h2>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                statusRequest.current?.abort();
                setRuns(
                  (await api('/api/automation/runs', 'GET', null, csrf)) as AutomationRunView[],
                );
                const v = (await api('/api/automation', 'GET', null, csrf)) as AutomationView;
                setView(v);
                setError('');
                if (!dirty) setSettings(v.settings ?? initial);
              })
            }
          >
            기록 새로고침
          </button>
        </div>
        {!runs.length && !error && view && (
          <div className="empty compact">
            <h3>첫 영어 카드가 기다리고 있어요.</h3>
            <p>아직 제작 기록이 없습니다. 자동 제작을 시작하면 진행 상황이 여기에 표시됩니다.</p>
          </div>
        )}
        <ul className="automation-runs">
          {runs.map((run) => (
            <li key={run.id}>
              <div className="automation-run-meta">
                <span>
                  {run.day} ·{' '}
                  {run.kind === 'trial'
                    ? `추가 시험 ${run.item_index ?? 1}/${run.item_count ?? 1}`
                    : `매일 제작 ${run.item_index ?? 1}/${run.item_count ?? 1}`}
                </span>
                <span className={`badge ${run.status === 'scheduled' ? 'ready' : ''}`}>
                  {stages[run.status]}
                </span>
              </div>
              <h3>{String(run.content?.expression ?? '표현 준비 중')}</h3>
              {run.kind === 'trial' && (
                <p>
                  제작 시작 {formatKst(run.not_before)} · 발송 예정 {formatKst(run.due_at)}
                </p>
              )}
              <p>
                작성 {run.writer === 'google' ? 'Gemini' : 'Groq'} / 검토{' '}
                {run.reviewer === 'google' ? 'Gemini' : 'Groq'}
              </p>
              {run.error && <p>{automationReasons[run.error] ?? '처리 결과 확인 필요'}</p>}
              {run.review && (
                <p>
                  {reviewPassed(run.review)
                    ? 'AI 검토 통과'
                    : run.review.issues.join(' · ') || 'AI 검토 미통과'}{' '}
                  · 수정본 {run.revision}
                </p>
              )}
              {run.delivery_state && <p>발송: {label(run.delivery_state)}</p>}
              {run.public_id && (
                <div className="automation-actions">
                  <a
                    className="text-button"
                    target="_blank"
                    rel="noreferrer"
                    href={endpoint(`/original/${run.public_id}`)}
                  >
                    저장된 카드 보기
                  </a>
                  <button
                    className="secondary"
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      void perform(async () => {
                        const response = await fetch(endpoint(`/images/${run.public_id}.png`));
                        if (!response.ok)
                          throw new Error('PNG를 내려받지 못했습니다. 잠시 후 다시 시도하세요.');
                        downloadBlob(
                          await response.blob(),
                          `AI-${run.day}-${run.kind}-${run.item_index ?? 1}.png`,
                        );
                      })
                    }
                  >
                    PNG 다운로드
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    type="button"
                    onClick={() => editCard(run.card_id)}
                  >
                    카드 편집
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
