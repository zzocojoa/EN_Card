import { useState, type ReactElement } from 'react';
import { LIMITS, type PausePreview, type RecoveryInput } from '../shared/model';
import { kstDate } from '../shared/time';

type PauseProps = {
  preview: PausePreview;
  busy: boolean;
  onClose: () => void;
  onPause: () => void;
};
export function PauseDialog({ preview, busy, onClose, onPause }: PauseProps): ReactElement {
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-label="일시정지 확인">
        <h2>현재 회차의 미발송 {preview.items.length}장</h2>
        <p>
          아래 카드는 현재 회차에서 제외됩니다. 재개할 때 새 미래 시각에 다시 예약하거나 제외할 수
          있습니다. 확인 중 발송이 진행되면 실제 중지 결과 목록을 다시 보여드립니다.
        </p>
        <ul>
          {preview.items.map((item) => (
            <li key={item.delivery_id}>{item.title}</li>
          ))}
        </ul>
        {preview.unresolved ? (
          <p>
            응답 확인 중이거나 결과 불명인 발송이 있습니다. 일시정지는 가능하며 이미 접수된 메시지는
            회수할 수 없습니다.
          </p>
        ) : null}
        <div className="toolbar">
          <button disabled={busy} onClick={onPause}>
            일시정지 실행
          </button>
          <button className="secondary" disabled={busy} onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </div>
  );
}
type RecoveryProps = {
  preview: PausePreview;
  busy: boolean;
  onClose: () => void;
  onDecide: (input: RecoveryInput) => void;
  onResume: () => void;
};
export function RecoveryDialog({
  preview,
  busy,
  onClose,
  onDecide,
  onResume,
}: RecoveryProps): ReactElement {
  const undecided = preview.items.filter((item) => item.decision === null);
  const pending = undecided.slice(0, LIMITS.recoveryBatchSize);
  const pendingCount: number = preview.pending_count ?? undecided.length;
  const [selected, setSelected] = useState<string[]>(
    pending.filter((item) => item.available).map((item) => item.delivery_id),
  );
  const future: number = Date.now() + 10 * 60_000;
  const [date, setDate] = useState<string>(kstDate(future));
  const [time, setTime] = useState<string>(
    new Date(future + 9 * 3600_000).toISOString().slice(11, 16),
  );
  const [accepted, setAccepted] = useState<boolean>(false);
  const excluded = pending.filter((item) => !selected.includes(item.delivery_id));
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-label="미발송 카드 다시 예약">
        <h2>미발송 카드 다시 예약</h2>
        {preview.can_resume ? (
          <p>
            회차에 아직 들어가지 않은 {preview.remaining}장은 기존 예약에 남아 있습니다. 아래 선택을
            저장한 뒤 별도로 재개하세요.
          </p>
        ) : (
          <p>
            기존 예약은 취소되어 재개할 수 없습니다. 일시정지로 남았던 카드만 새 미래 예약으로
            복구하거나 제외할 수 있습니다.
          </p>
        )}
        {preview.unresolved ? (
          <p role="alert">
            응답 확인 중·미해결 결과 불명이 있습니다. 발송 기록에서 결과를 처리한 뒤
            복구·재개하세요.
          </p>
        ) : null}
        {pending.length ? (
          <>
            <p>
              미결정 총 {pendingCount}장 · 이번 {pending.length}장
            </p>
            {pendingCount > pending.length ? (
              <p>
                이번 선택을 저장하면 남은 {pendingCount - pending.length}장을 이어서 처리합니다.
              </p>
            ) : null}
            <div className="toolbar">
              <button
                className="secondary"
                disabled={busy || preview.unresolved}
                onClick={() => {
                  setSelected(
                    pending.filter((item) => item.available).map((item) => item.delivery_id),
                  );
                  setAccepted(false);
                }}
              >
                이번 {pending.length}장 모두 복구
              </button>
              <button
                className="secondary"
                disabled={busy || preview.unresolved}
                onClick={() => {
                  setSelected([]);
                  setAccepted(false);
                }}
              >
                이번 {pending.length}장 모두 제외
              </button>
            </div>
          </>
        ) : null}
        {pending.map((item) => (
          <div key={item.delivery_id}>
            <label className="check-row">
              <input
                type="checkbox"
                checked={selected.includes(item.delivery_id)}
                disabled={busy || !item.available}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, item.delivery_id]
                      : current.filter((id) => id !== item.delivery_id),
                  )
                }
              />
              {item.title}
            </label>
            <small>{item.reason}</small>
          </div>
        ))}
        {pending.length ? (
          <>
            <p>
              복구 {selected.length}장 · 제외 {excluded.length}장
            </p>
            <p>
              제외 목록: {excluded.length ? excluded.map((item) => item.title).join(', ') : '없음'}.
              제외한 원본은 자동 복구되지 않고 취소 이력이 남습니다.
            </p>
            {selected.length ? (
              <>
                <label>
                  새 예약 날짜 (KST)
                  <input
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                  />
                </label>
                <label>
                  새 예약 시각 (KST)
                  <input
                    type="time"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                  />
                </label>
                <p>
                  최소 2분 이후에 새 예약으로 발송합니다. 5장 초과 시 5장씩 2분 간격으로 나누며 분당
                  3건 한도로 지연될 수 있습니다.
                </p>
              </>
            ) : null}
            <label className="check-row">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(event) => setAccepted(event.target.checked)}
              />
              복구·제외 수와 목록, 새 시각을 확인했습니다.
            </label>
            <button
              disabled={busy || !accepted || preview.unresolved}
              onClick={() =>
                onDecide({
                  version: preview.version,
                  recover_ids: selected,
                  exclude_ids: excluded.map((item) => item.delivery_id),
                  date: selected.length ? date : null,
                  time: selected.length ? time : null,
                  warning_accepted: true,
                })
              }
            >
              복구·제외 선택 저장
            </button>
          </>
        ) : (
          <>
            <p>
              추가 선택이 필요한 미발송 카드가 없습니다. 원래 회차를 되살리거나 지난 시각으로
              발송하지 않습니다.
            </p>
            <ul>
              {preview.items.map((item) => (
                <li key={item.delivery_id}>
                  {item.title} ·{' '}
                  {item.decision === 'reschedule'
                    ? `새 예약 생성 (${item.target_schedule_id})`
                    : '제외 완료'}
                </li>
              ))}
            </ul>
            <button
              disabled={
                busy || preview.unresolved || preview.remaining === 0 || !preview.can_resume
              }
              onClick={onResume}
            >
              남은 {preview.remaining}장 예약 재개
            </button>
            {preview.remaining === 0 ? (
              <p>기존 예약에 남은 카드가 없습니다. 복구 예약은 별도로 진행됩니다.</p>
            ) : null}
          </>
        )}
        <button className="secondary" disabled={busy} onClick={onClose}>
          닫기
        </button>
      </section>
    </div>
  );
}
