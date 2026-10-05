import { useEffect, useState, type ReactElement } from 'react';
import { formatKst } from '../../shared/time';
import type { AutomationView } from '../../shared/automation';
import { api } from '../api';
import { useStudio } from '../studio';
import { Icon, label } from '../ui';
export function HomePage(): ReactElement | null {
  const {
    state,
    boot,
    busy,
    revision,
    setPage,
    openCard,
    setHistoryTab,
    setScheduleOpen,
    scheduleDirty,
  } = useStudio();
  const [automation, setAutomation] = useState<AutomationView | null>(null);
  const [automationError, setAutomationError] = useState(false);
  const csrf = state?.csrf ?? '';
  useEffect(() => {
    const controller = new AbortController();
    void api('/api/automation', 'GET', null, csrf, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setAutomation(result as AutomationView);
        setAutomationError(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAutomationError(true);
      });
    return () => controller.abort();
  }, [csrf, revision]);
  if (!state) return null;
  const summary = state.summary;
  const next = summary.next_schedule;
  const automationActive = !automationError && automation?.enabled;
  const automaticDue = automationActive ? automation.next_due_at : null;
  const showAutomatic = Boolean(automaticDue && (!next || automaticDue <= next.due_at_utc));
  const nextDue = showAutomatic ? automaticDue : next?.due_at_utc;
  const connection = boot?.local
    ? '로컬 테스트'
    : label(state.connection?.status ?? 'disconnected');
  const connectionNeedsAction =
    !boot?.local &&
    (state.connection?.status !== 'connected' || Boolean(state.connection?.refresh_failure));
  return (
    <div className="home-grid">
      {summary.attention > 0 && (
        <section className="attention-banner" aria-label="확인할 발송 결과">
          <div>
            <strong>확인할 발송 결과가 {summary.attention}건 있어요.</strong>
            <p>결과 불명은 나와의 채팅을 먼저 확인해 주세요.</p>
          </div>
          <button
            className="secondary"
            onClick={() => {
              setHistoryTab('attention');
              setPage('history');
            }}
          >
            결과 확인하기 <Icon name="arrow" />
          </button>
        </section>
      )}
      <section className="next-card">
        <div className="next-card-label">
          <span className="eyebrow">나에게 도착할 한 장</span>
          {(nextDue || automationActive) && (
            <span className="badge">
              {showAutomatic || !nextDue ? 'AI 자동 제작' : '카드 예약'}
            </span>
          )}
        </div>
        <h2>
          {nextDue
            ? '다음 영어 시간'
            : automationActive
              ? '자동 제작이 실행 중이에요'
              : '영어 한 장으로 시작하는 하루'}
        </h2>
        {nextDue ? (
          <>
            <strong className="next-time">{formatKst(nextDue)}</strong>
            <p>
              {showAutomatic
                ? `${automation?.settings?.topic ?? '설정한 주제'} · 매일 ${automation?.settings?.cards_per_day ?? 1}장`
                : `${next!.name} · 회차당 ${next!.cards_per_occurrence}장`}
            </p>
            {showAutomatic && (
              <p className="next-preparation">제작 시작 {formatKst(nextDue - 3600000)}</p>
            )}
            {nextDue < state.now && (
              <p className="inline-warning">
                예정 시각이 지났습니다. 발송 기록과 연결 상태를 확인하세요.
              </p>
            )}
          </>
        ) : (
          <p>
            {automationActive
              ? '제작·예약의 진행 상황은 자동 제작 화면에서 확인할 수 있어요.'
              : 'AI가 매일 새 표현을 준비하거나, 직접 만든 카드를 예약할 수 있어요.'}
          </p>
        )}
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setScheduleOpen(false);
            setPage(showAutomatic || !nextDue ? 'automation' : 'schedules');
          }}
        >
          {showAutomatic || (!nextDue && automationActive)
            ? '자동 제작 관리'
            : nextDue
              ? '예약 확인'
              : '자동 제작 설정'}{' '}
          <Icon name="arrow" />
        </button>
        {automationError && (
          <p className="tiny" role="status">
            자동 제작 상태를 불러오지 못했어요. 새로고침하거나 자동 제작 메뉴에서 확인해 주세요.
          </p>
        )}
        {!automation && !automationError && (
          <p className="tiny" role="status">
            자동 제작 일정 확인 중…
          </p>
        )}
        <small>
          한국 시간 ·{' '}
          {state.mode !== 'live'
            ? '검증 모드에서는 실제로 보내지 않습니다.'
            : '여러 장은 순서대로 처리하며 늦어질 수 있습니다.'}
        </small>
      </section>
      <section className="home-connection">
        <h2>카카오 연결</h2>
        <span className={`badge ${connectionNeedsAction ? 'blocked' : 'ready'}`}>{connection}</span>
        <p>
          {connectionNeedsAction
            ? '설정에서 연결 상태와 복구 방법을 확인하세요.'
            : boot?.local
              ? '실제 발송 없이 제작과 예약을 확인할 수 있습니다.'
              : '준비한 카드를 나와의 채팅으로 보냅니다.'}
        </p>
        <button className="text-button" onClick={() => setPage('settings')}>
          연결 및 저장 공간 <Icon name="arrow" />
        </button>
        <small>나에게 보내기에는 푸시 알림·알림음이 없습니다.</small>
      </section>
      <section className="home-create">
        <div>
          <span className="eyebrow">나에게 맞는 두 가지 방법</span>
          <h2>직접 골라도, 맡겨도 좋아요.</h2>
          <p>기억하고 싶은 문장은 직접 담고, 새로운 표현은 AI에게 맡겨보세요.</p>
        </div>
        <div className="home-create-actions">
          <button className="secondary" disabled={busy} onClick={() => openCard(null)}>
            카드 만들기 <Icon name="editor" />
          </button>
          <button className="text-button" disabled={busy} onClick={() => setPage('automation')}>
            AI 자동 제작 <Icon name="arrow" />
          </button>
        </div>
      </section>
      <section className="home-library">
        <div>
          <h2>예약할 준비가 된 카드</h2>
          <strong className="count">
            {summary.ready_cards}
            <small>장</small>
          </strong>
          <p>총 {state.totals.cards}장 중 PNG 저장·검토 완료</p>
        </div>
        <button className="secondary" onClick={() => setPage('library')}>
          보관함 열기
        </button>
      </section>
      {scheduleDirty && (
        <button
          className="secondary"
          onClick={() => {
            setScheduleOpen(true);
            setPage('schedules');
          }}
        >
          작성 중인 예약 이어서 보기
        </button>
      )}
    </div>
  );
}
