import type { ReactElement } from 'react';
import { formatKst } from '../../shared/time';
import { useStudio } from '../studio';
import { Icon, label } from '../ui';
export function HomePage(): ReactElement | null {
  const { state, boot, busy, setPage, openCard, setHistoryTab, setScheduleOpen, scheduleDirty } =
    useStudio();
  if (!state) return null;
  const summary = state.summary;
  const next = summary.next_schedule;
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
        <div className="eyebrow">NEXT ENGLISH MOMENT</div>
        <h2>{next ? '다음 영어 시간' : '나에게 맞는 영어 시간을 정해보세요.'}</h2>
        {next ? (
          <>
            <strong className="next-time">{formatKst(next.due_at_utc)}</strong>
            <p>
              {next.name} · 회차당 {next.cards_per_occurrence}장
            </p>
            {next.due_at_utc < state.now && (
              <p className="inline-warning">
                예정 시각이 지났습니다. 발송 기록과 연결 상태를 확인하세요.
              </p>
            )}
          </>
        ) : (
          <p>검토를 마친 카드로 첫 예약을 만들 수 있습니다.</p>
        )}
        <button
          className="primary"
          onClick={() => {
            setScheduleOpen(false);
            setPage('schedules');
          }}
        >
          예약 확인 <Icon name="arrow" />
        </button>
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
          <span className="eyebrow">MAKE SOMETHING STICK</span>
          <h2>오늘 기억하고 싶은 표현은?</h2>
          <p>한 문장을 고르고, 뜻과 예문을 담아보세요.</p>
        </div>
        <button className="primary" disabled={busy} onClick={() => openCard(null)}>
          카드 만들기 <Icon name="arrow" />
        </button>
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
