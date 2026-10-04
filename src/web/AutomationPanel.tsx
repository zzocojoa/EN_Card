import { useEffect, useState, useRef } from 'react';
import {
  automationReasons,
  reviewPassed,
  type AutomationSettings,
  type AutomationView,
  type AutomationRunView,
} from '../shared/automation';
import { formatKst, kstDate } from '../shared/time';
import { api } from './api';
import { endpoint } from './environment';
import { useStudio } from './studio';
import { label } from './ui';
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
        { version: view?.version ?? 0, ...(action === 'save' ? { settings } : {}) },
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
                ? '오늘의 추가 한 장 시험을 등록했습니다. 아래 제작·발송 시각을 확인하세요. PC를 꺼도 진행됩니다.'
                : '자동 제작과 대기 중인 자동 예약을 중단했습니다.',
      });
    });
  return (
    <details className="automation-panel">
      <summary>
        AI 카드 자동 제작{' '}
        <span className="badge">
          {!view
            ? error
              ? '상태 확인 실패'
              : '상태 확인 중'
            : view.enabled
              ? '실행 중'
              : view.reason === 'complete'
                ? '기간 종료'
                : '일시정지'}
        </span>
      </summary>
      <p className="muted">
        매일 한 장을 작성하고 다른 AI가 검토한 뒤 예약합니다. 시작 후에는 PC를 꺼도 진행됩니다. AI
        검토에는 오류가 있을 수 있습니다.
      </p>
      {error && <p role="alert">{error}</p>}
      {view && !view.available && (
        <p role="status">
          서버의 무료 AI 실행 설정이 준비되지 않았습니다. 자동 시작은 준비 후 사용할 수 있습니다.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          act('save');
        }}
      >
        <fieldset disabled={busy || !view}>
          <legend className="sr-only">자동 제작 설정</legend>
          <div className="automation-fields">
            <label>
              주제
              <input
                required
                maxLength={120}
                value={settings.topic}
                onChange={(e) => update('topic', e.target.value)}
              />
            </label>
            <label>
              기준 표현 (선택)
              <input
                maxLength={200}
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
            <label>
              매일 받을 시각 (한국 시간)
              <input
                required
                type="time"
                value={settings.time}
                onChange={(e) => update('time', e.target.value)}
              />
            </label>
          </div>
          <p className="tiny">
            발송 1시간 전부터 제작합니다. 준비 시간이 부족하면 다음 가능한 날짜부터 시작합니다. 설정
            저장은 실행 중인 자동 제작과 대기 예약을 중단합니다.
          </p>
          <div className="automation-actions">
            <button className="secondary" type="submit">
              설정 저장
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
              disabled={
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
              오늘 한 장 시험
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
          <p className="tiny">
            오늘 한 장 시험은 저장된 주제·난이도·카드 종류로 약 10분 뒤 제작하고 25분 뒤 발송합니다.
            매일 받을 날짜·시각 설정과 기존 기록은 보존됩니다. 추가 시험은 하루 한 번이며, 중단해도
            다시 제작하지 않습니다.
            {view?.trial_used_today && ' 오늘 시험은 이미 등록했습니다.'}
          </p>
        </fieldset>
      </form>
      {view?.reason && <p>{automationReasons[view.reason] ?? view.reason}</p>}
      {view?.next_due_at && (
        <p>
          다음 제작 {formatKst(view.next_due_at - 3600000)} · 발송 {formatKst(view.next_due_at)}
        </p>
      )}
      {state?.connection?.status !== 'connected' && (
        <p className="tiny">시작하려면 설정 화면에서 카카오를 먼저 연결하세요.</p>
      )}
      {state?.mode !== 'live' && (
        <p className="tiny">
          현재 모의 확인 모드입니다. 실제 예약 발송 모드에서 자동 제작을 시작할 수 있습니다.
        </p>
      )}
      <p className="tiny">
        카카오 나에게 보내기는 알림음·푸시 알림이 없습니다. 이미 접수된 메시지는 회수되지 않습니다.
      </p>
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
      {!runs.length && <p className="muted">아직 제작 기록이 없습니다.</p>}
      <ul className="automation-runs">
        {runs.map((run) => (
          <li key={run.id}>
            <strong>
              {run.day} · {run.kind === 'trial' ? '추가 한 장 시험' : '매일 제작'} ·{' '}
              {stages[run.status]}
            </strong>
            {run.kind === 'trial' && (
              <p>
                제작 시작 {formatKst(run.not_before)} · 발송 예정 {formatKst(run.due_at)}
              </p>
            )}
            <p>
              {String(run.content?.expression ?? '표현 준비 중')} · 작성{' '}
              {run.writer === 'google' ? 'Gemini' : 'Groq'} / 검토{' '}
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
                <a target="_blank" rel="noreferrer" href={endpoint(`/original/${run.public_id}`)}>
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
                      downloadBlob(await response.blob(), `AI-${run.day}.png`);
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
    </details>
  );
}
