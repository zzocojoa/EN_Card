import { type ReactElement } from 'react';
import { formatKst } from '../../shared/time';
import { api } from '../api';
import { type AttemptHistory } from '../api';
import { Modal } from '../Modal';
import { label } from '../ui';
import { useStudio } from '../studio';
import { useCatalog } from '../useCatalog';
import type { DeliverySummary } from '../../shared/model';
export function HistoryPage(): ReactElement | null {
  const {
    historyTab,
    setHistoryTab,
    revision,
    setState,
    state,
    busy,
    notice,
    setNotice,
    attemptHistory,
    setAttemptHistory,
    unknownId,
    setUnknownId,
    acceptDuplicate,
    setAcceptDuplicate,
    modalOpener,
    refresh,
    perform,
  } = useStudio();
  const records = useCatalog<DeliverySummary>(
    'deliveries',
    { filter: historyTab === 'attention' ? 'attention' : 'all' },
    revision,
    Boolean(state) && historyTab !== 'previews',
    () => setState(null),
  );
  if (!state) return null;
  return (
    <>
      <>
        <div className="stat-row">
          <div>
            <span>실제 API 접수</span>
            <strong>
              {state.summary.api_accepted}
              <small>건</small>
            </strong>
          </div>
          <div>
            <span>확인이 필요한 결과</span>
            <strong>
              {state.summary.attention}
              <small>건</small>
            </strong>
          </div>
          <div>
            <span>미리검증 기록 · 최근 50건</span>
            <strong>
              {state.previews.length}
              <small>건</small>
            </strong>
          </div>
        </div>
        <div className="segmented history-tabs" aria-label="발송 기록 분류">
          {(['attention', 'all', 'previews'] as const).map((tab) => (
            <button
              key={tab}
              disabled={busy}
              aria-pressed={historyTab === tab}
              className={historyTab === tab ? 'active' : ''}
              onClick={() => setHistoryTab(tab)}
            >
              {tab === 'attention' ? '확인 필요' : tab === 'all' ? '전체' : '미리검증'}
            </button>
          ))}
        </div>
        <p className="help">
          API 접수와 실제 열람은 다릅니다. 결과 불명은 채팅방에서 확인해 주세요.
        </p>
        {historyTab !== 'previews' && records.error && (
          <div role="alert" className="notice error">
            <span>{records.error}</span>
            <button className="secondary" onClick={records.reload}>
              다시 시도
            </button>
          </div>
        )}
        {historyTab !== 'previews' && records.loading && (
          <p role="status">발송 기록을 불러오고 있습니다…</p>
        )}
        {(
          historyTab === 'previews'
            ? state.previews.length === 0
            : !records.loading && !records.error && records.items.length === 0
        ) ? (
          <div className="empty">
            <h2>
              {historyTab === 'attention'
                ? '확인이 필요한 결과가 없습니다.'
                : '아직 발송 기록이 없습니다.'}
            </h2>
            <p>예약을 저장한 뒤 ‘예약 발송 미리검증’을 실행해 보세요.</p>
          </div>
        ) : (
          <div className="journal">
            {(historyTab === 'previews' ? [] : records.items).map((item) => (
              <article key={item.id}>
                <span className={`badge ${item.state}`}>
                  {item.resolution === 'abandoned'
                    ? label('abandoned')
                    : item.confirmed_by_user
                      ? '사용자 수신 확인'
                      : label(item.state)}
                </span>
                <div>
                  <strong className="delivery-title">{item.card_title}</strong>
                  <p className="delivery-meta">
                    {item.schedule_name ?? '예약'} · {formatKst(item.due_at_utc)}
                  </p>
                  <p>
                    {item.error ??
                      (item.state === 'sent'
                        ? '카카오 API 접수를 확인했습니다.'
                        : label(item.state))}
                  </p>
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
                          : decision.action === 'abandon'
                            ? '수신 여부를 확정하지 않고 재전송 포기'
                            : '채팅방 수신 확인'}
                      </p>
                    ))}
                  </details>
                  <small>
                    {item.mode === 'mock' ? '모의 발송' : '실제 API'} · 시도 {item.total_attempts}회
                    · 카드 순서 {item.position + 1} · 회차{' '}
                    {item.occurrence_state === 'completed'
                      ? '처리 종료'
                      : label(item.occurrence_state)}
                  </small>
                </div>
                {item.state === 'unknown' && item.resolution !== 'abandoned' ? (
                  <button
                    className="secondary"
                    onClick={(event) => {
                      modalOpener.current = event.currentTarget;
                      setNotice(null);
                      setUnknownId(item.id);
                      setAcceptDuplicate(false);
                    }}
                  >
                    결과 확인
                  </button>
                ) : null}
              </article>
            ))}
            {(historyTab === 'previews' ? state.previews : []).map((item) => (
              <article key={item.id}>
                <span className="badge">미리검증</span>
                <div>
                  <strong>{formatKst(item.due_at_utc)}</strong>
                  <p>시간·피드 형식 검사 완료. 실제 API 호출 및 카드 소비 없음.</p>
                  <details>
                    <summary>검사한 피드 보기</summary>
                    <pre>{JSON.stringify(JSON.parse(item.detail) as unknown, null, 2)}</pre>
                  </details>
                </div>
              </article>
            ))}
          </div>
        )}
        {historyTab !== 'previews' && records.next && (
          <button
            className="secondary wide load-more"
            disabled={records.loading || busy}
            onClick={() => void records.more()}
          >
            더 불러오기 ({records.items.length} / {records.total})
          </button>
        )}
        <p className="help">
          {historyTab === 'previews'
            ? '미리검증은 최근 50건까지 표시합니다.'
            : `발송 기록 ${records.items.length} / ${records.total}건 표시 · 위 집계는 전체 기록 기준입니다.`}
        </p>
        {unknownId ? (
          <Modal
            label="결과 불명 확인"
            busy={busy}
            returnFocus={modalOpener.current}
            onClose={() => setUnknownId(null)}
          >
            <h2 tabIndex={-1}>먼저 나와의 채팅을 확인하세요.</h2>
            {notice?.kind === 'error' ? (
              <p className="notice error" role="alert">
                {notice.text}
              </p>
            ) : null}
            <p>
              이미 도착한 메시지를 재시도하면 중복으로 받을 수 있습니다. 사용자 확인 사실과 새
              시도는 별도로 기록됩니다. 수신 여부를 알 수 없다면 재전송하지 않고 종료할 수 있습니다.
              이는 수신 확인이 아니며 이후 이 건을 다시 보내지 않습니다.
            </p>
            <label className="check-row">
              <input
                type="checkbox"
                checked={acceptDuplicate}
                onChange={(event) => setAcceptDuplicate(event.target.checked)}
              />
              재시도의 중복 위험과 재전송 없이 종료의 의미를 이해했습니다.
            </label>
            <div className="toolbar">
              {(['confirm_sent', 'retry', 'abandon'] as const).map((action) => (
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
                  {action === 'confirm_sent'
                    ? '이미 수신함'
                    : action === 'retry'
                      ? '다시 보내기'
                      : '재전송하지 않고 종료'}
                </button>
              ))}
              <button className="text-button" disabled={busy} onClick={() => setUnknownId(null)}>
                닫기
              </button>
            </div>
          </Modal>
        ) : null}
      </>
    </>
  );
}
