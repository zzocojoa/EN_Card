import { useEffect, useRef, useState, type ReactElement } from 'react';
import { scheduleSchema, type ScheduleInput } from '../../shared/model';
import { type PausePreview } from '../../shared/model';
import { formatKst } from '../../shared/time';
import { api } from '../api';
import { PauseDialog } from '../PauseDialogs';
import { RecoveryDialog } from '../PauseDialogs';
import { Icon } from '../ui';
import { TextField } from '../ui';
import { initialSchedule } from '../ui';
import { label } from '../ui';
import { canPauseSchedule } from '../ui';
import { useStudio } from '../studio';
import { SchedulePicker } from '../SchedulePicker';
export function SchedulesPage(): ReactElement | null {
  const {
    scheduleOpen,
    setScheduleOpen,
    scheduleDirty,
    setScheduleDirty,
    setConfirmation,
    setHistoryTab,
    setScheduleTitles,
    setPage,
    state,
    busy,
    notice,
    setNotice,
    schedule,
    setSchedule: updateSchedule,
    editingSchedule,
    setEditingSchedule,
    pauseConfirm,
    setPauseConfirm,
    recovery,
    setRecovery,
    modalOpener,
    activeSchedules,
    next,
    refresh,
    perform,
    moreButton,
  } = useStudio();
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (scheduleOpen) {
      formHeading.current?.focus();
      formHeading.current?.scrollIntoView({ block: 'start' });
    }
  }, [scheduleOpen, editingSchedule?.id]);
  const errorProps = (field: string) => ({
    'aria-invalid': Boolean(fieldErrors[field]),
    'aria-describedby': fieldErrors[field] ? `schedule-${field}-error` : undefined,
  });
  const fieldError = (field: string) =>
    fieldErrors[field] ? (
      <span className="field-error" id={`schedule-${field}-error`}>
        {fieldErrors[field]}
      </span>
    ) : null;
  const setSchedule: typeof updateSchedule = (value) => {
    updateSchedule(value);
    setScheduleDirty(true);
    setFormErrors([]);
    setFieldErrors({});
  };
  function newSchedule() {
    const open = () => {
      setEditingSchedule(null);
      updateSchedule(initialSchedule());
      setScheduleTitles({});
      setScheduleDirty(false);
      setFormErrors([]);
      setFieldErrors({});
      setScheduleOpen(true);
    };
    if (scheduleDirty)
      setConfirmation({
        title: '새 예약 작성',
        body: '작성 중인 예약의 저장하지 않은 내용을 버리고 새 예약을 만듭니다.',
        actionLabel: '새 예약 작성',
        action: async () => open(),
      });
    else open();
  }
  if (!state) return null;
  return (
    <>
      <div className="toolbar schedule-toolbar">
        <button className="primary" disabled={busy} onClick={newSchedule}>
          ＋ 새 예약
        </button>
        {scheduleDirty && !scheduleOpen && (
          <button className="secondary" disabled={busy} onClick={() => setScheduleOpen(true)}>
            작성 중인 예약 이어서 보기
          </button>
        )}
      </div>
      <div className={scheduleOpen ? 'schedule-grid composing' : 'schedule-grid'}>
        {scheduleOpen && (
          <section className="editor-panel schedule-form">
            <div className="panel-heading">
              <h2 ref={formHeading} tabIndex={-1}>
                {editingSchedule ? '예약 수정' : '새로운 예약'}
              </h2>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => setScheduleOpen(false)}
              >
                작성 접기
              </button>
            </div>
            <h3 className="step-heading">
              01 <span>보낼 시간</span>
            </h3>
            {editingSchedule ? (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  newSchedule();
                }}
              >
                새 예약 작성
              </button>
            ) : null}
            <fieldset disabled={busy}>
              <TextField
                label="예약 이름"
                value={schedule.name}
                required
                error={fieldErrors.name}
                onChange={(value) => setSchedule((current) => ({ ...current, name: value }))}
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
                    {...errorProps('date')}
                    value={schedule.date}
                    onChange={(event) =>
                      setSchedule((current) => ({ ...current, date: event.target.value }))
                    }
                  />
                  {fieldError('date')}
                </label>
                <label className="field">
                  <span>시각 · 한국 시간</span>
                  <input
                    type="time"
                    {...errorProps('time')}
                    value={schedule.time}
                    onChange={(event) =>
                      setSchedule((current) => ({ ...current, time: event.target.value }))
                    }
                  />
                  {fieldError('time')}
                </label>
              </div>
              {schedule.kind === 'weekly' ? (
                <div className="weekdays">
                  {['일', '월', '화', '수', '목', '금', '토'].map((day, index) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        {...errorProps('weekdays')}
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
              {fieldError('weekdays')}
              {schedule.kind !== 'once' ? (
                <label className="field">
                  <span>종료 날짜 · 선택</span>
                  <input
                    type="date"
                    {...errorProps('end_date')}
                    value={schedule.end_date ?? ''}
                    onChange={(event) =>
                      setSchedule((current) => ({
                        ...current,
                        end_date: event.target.value || null,
                      }))
                    }
                  />
                  {fieldError('end_date')}
                </label>
              ) : null}
              <label className="field">
                <span>한 회차 카드 수</span>
                <select
                  value={schedule.cards_per_occurrence}
                  {...errorProps('cards_per_occurrence')}
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
                {fieldError('cards_per_occurrence')}
              </label>
              <h3 className="step-heading">
                02 <span>카드 선택·순서</span>
              </h3>
              <SchedulePicker />
              <h3 className="step-heading">
                03 <span>예약 확인</span>
              </h3>{' '}
              <div className="schedule-preview">
                <span>다음 발송 예정</span>
                <strong>{next ? formatKst(next) : '실행 가능한 시각을 선택하세요'}</strong>
                <small>
                  {schedule.asset_ids.length}장 준비 · 최대{' '}
                  {schedule.kind === 'once'
                    ? Math.min(
                        1,
                        Math.floor(schedule.asset_ids.length / schedule.cards_per_occurrence),
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
                    const parsed = scheduleSchema.safeParse(schedule);
                    if (!parsed.success || !next) {
                      const errors: Record<string, string> = {};
                      if (!parsed.success)
                        for (const issue of parsed.error.issues) {
                          const field = String(issue.path[0]);
                          errors[field] =
                            issue.code === 'custom'
                              ? issue.message
                              : field === 'name'
                                ? '예약 이름을 1~80자로 입력하세요.'
                                : field === 'date' || field === 'end_date'
                                  ? '유효한 날짜를 선택하세요.'
                                  : field === 'time'
                                    ? '시각을 선택하세요.'
                                    : '카드 선택과 회차당 카드 수를 확인하세요.';
                        }
                      if (!next && !errors.date && !errors.time)
                        errors.time = '최소 2분 이후의 미래 시각을 선택하세요.';
                      setFieldErrors(errors);
                      setFormErrors([...new Set(Object.values(errors))]);
                      return;
                    }
                    if (schedule.asset_ids.length < schedule.cards_per_occurrence) {
                      setFormErrors([
                        '회차당 카드 수보다 준비한 카드가 적습니다. 카드를 추가해 주세요.',
                      ]);
                      return;
                    }
                    await api(
                      editingSchedule ? `/api/schedules/${editingSchedule.id}` : '/api/schedules',
                      editingSchedule ? 'PUT' : 'POST',
                      editingSchedule
                        ? {
                            version: editingSchedule.version,
                            expected_cursor: editingSchedule.cursor,
                            schedule,
                          }
                        : schedule,
                      state.csrf,
                    );
                    await refresh();
                    updateSchedule(initialSchedule());
                    setEditingSchedule(null);
                    setScheduleOpen(false);
                    setScheduleDirty(false);
                    setScheduleTitles({});
                    setNotice({
                      kind: 'success',
                      text:
                        state.mode === 'live'
                          ? '예약을 저장했습니다. 예정 시각은 한국 시간 기준입니다.'
                          : '예약을 저장했습니다. 미리검증 모드에서는 실제 발송하지 않습니다.',
                    });
                  })
                }
              >
                {busy ? '저장 중…' : editingSchedule ? '예약 수정 저장' : '예약 저장'}
                <Icon name="arrow" />
              </button>
              {formErrors.length > 0 && (
                <div className="notice error" role="alert">
                  <ul>
                    {formErrors.map((message) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="help">
                이미지 저장 후 2분 이상 여유를 두세요. 여러 장은 분당 최대 3건씩 처리하며 늦어질 수
                있습니다. 카카오 인증을 갱신한 경우 다음 실행까지 추가로 기다릴 수 있습니다. 준비한
                카드가 부족하면 멈춥니다.
              </p>
            </fieldset>
          </section>
        )}
        <section className="schedule-list">
          <div className="panel-heading">
            <h2>내 예약</h2>
            <span className="tiny">활성 {activeSchedules} / 10</span>
          </div>
          <div className="soft-notice">
            무료 ‘나에게 보내기’에는 푸시 알림·알림음이 없습니다. 도착 시각과 무중단을 보장하지
            않습니다.
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
                    {item.kind === 'once' ? '한 번' : item.kind === 'daily' ? '매일' : '요일 반복'}{' '}
                    · {item.time} KST
                  </span>
                  <span className="badge">
                    {item.enabled ? '예약 중' : label(item.reason ?? 'paused')}
                  </span>
                </div>
                <h2>{item.name}</h2>
                <p>{item.next_run_at_utc ? formatKst(item.next_run_at_utc) : '다음 회차 없음'}</p>
                <p>
                  회차당 {item.cards_per_occurrence}장 · 남은 목록{' '}
                  {Math.max(0, item.asset_ids.length - item.cursor)}장
                </p>
                <div className="card-actions">
                  <button
                    className="text-button"
                    disabled={busy || item.reason === 'cancelled'}
                    onClick={() => {
                      const open = () => {
                        setScheduleOpen(true);
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
                        setScheduleTitles(
                          Object.fromEntries(
                            item.items.map((entry) => [entry.asset_id, entry.title]),
                          ),
                        );
                        setScheduleDirty(false);
                        setFormErrors([]);
                      };
                      if (scheduleDirty)
                        setConfirmation({
                          title: '예약 수정으로 전환',
                          body: '작성 중인 예약의 저장하지 않은 내용을 버리고 선택한 예약을 수정합니다.',
                          actionLabel: '수정하기',
                          action: async () => open(),
                        });
                      else open();
                    }}
                  >
                    수정
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={(event) => {
                      modalOpener.current = event.currentTarget;
                      void perform(async () => {
                        if (canPauseSchedule(item)) {
                          setPauseConfirm(
                            (await api(
                              `/api/schedules/${item.id}/pause-preview?version=${item.version}`,
                              'GET',
                              null,
                              '',
                            )) as PausePreview,
                          );
                        } else if (item.reason === 'paused' || item.reason === 'cancelled') {
                          setRecovery(
                            (await api(
                              `/api/schedules/${item.id}/recovery?version=${item.version}`,
                              'GET',
                              null,
                              '',
                            )) as PausePreview,
                          );
                        } else {
                          await api(
                            `/api/schedules/${item.id}/resume`,
                            'POST',
                            { version: item.version },
                            state.csrf,
                          );
                        }
                        await refresh();
                      });
                    }}
                  >
                    {canPauseSchedule(item)
                      ? '일시정지'
                      : item.reason === 'cancelled'
                        ? '중지 카드 확인'
                        : '재개'}
                  </button>
                  <button
                    className="text-button danger"
                    disabled={busy || item.reason === 'cancelled'}
                    onClick={(event) => {
                      modalOpener.current = event.currentTarget;
                      setNotice(null);
                      setConfirmation({
                        title: '예약 취소',
                        body: '앞으로 이 예약의 카드를 보내지 않습니다. 이미 접수된 메시지는 회수할 수 없으며, 남은 카드는 중지 카드 확인에서 처리할 수 있습니다.',
                        actionLabel: '예약 취소 실행',
                        action: async () => {
                          await api(
                            `/api/schedules/${item.id}/cancel`,
                            'POST',
                            { version: item.version },
                            state.csrf,
                          );
                          await refresh();
                        },
                      });
                    }}
                  >
                    취소
                  </button>
                </div>
              </article>
            ))
          )}
          {pauseConfirm ? (
            <PauseDialog
              preview={pauseConfirm}
              busy={busy}
              error={notice?.kind === 'error' ? notice.text : null}
              returnFocus={modalOpener.current}
              onClose={() => setPauseConfirm(null)}
              onPause={() =>
                void perform(async () => {
                  const result = (await api(
                    `/api/schedules/${pauseConfirm.schedule_id}/pause`,
                    'POST',
                    { version: pauseConfirm.version },
                    state.csrf,
                  )) as PausePreview;
                  setPauseConfirm(null);
                  setRecovery(result);
                  await refresh();
                  setNotice({
                    kind: 'success',
                    text: `일시정지했습니다. 실제 중지 결과와 복구·제외 대상을 확인하세요.`,
                  });
                })
              }
            />
          ) : null}
          {recovery ? (
            <RecoveryDialog
              key={recovery.items
                .filter((item) => item.decision === null)
                .map((item) => item.delivery_id)
                .join(',')}
              preview={recovery}
              busy={busy}
              error={notice?.kind === 'error' ? notice.text : null}
              returnFocus={modalOpener.current}
              onClose={() => setRecovery(null)}
              onHistoryMore={() =>
                void perform(async () => {
                  const result = (await api(
                    `/api/schedules/${recovery.schedule_id}/recovery-history?version=${recovery.version}&cursor=${encodeURIComponent(recovery.history_next!)}`,
                    'GET',
                    null,
                    '',
                  )) as { items: PausePreview['items']; next: string | null };
                  setRecovery({
                    ...recovery,
                    items: [...recovery.items, ...result.items],
                    history_next: result.next,
                  });
                })
              }
              onDecide={(input) =>
                void perform(async () => {
                  await api(
                    `/api/schedules/${recovery.schedule_id}/recovery`,
                    'POST',
                    input,
                    state.csrf,
                  );
                  setRecovery(
                    (await api(
                      `/api/schedules/${recovery.schedule_id}/recovery?version=${recovery.version}`,
                      'GET',
                      null,
                      '',
                    )) as PausePreview,
                  );
                  await refresh();
                })
              }
              onResume={() =>
                void perform(async () => {
                  await api(
                    `/api/schedules/${recovery.schedule_id}/resume`,
                    'POST',
                    { version: recovery.version },
                    state.csrf,
                  );
                  setRecovery(null);
                  await refresh();
                  setNotice({
                    kind: 'success',
                    text: '기존 예약의 남은 목록을 재개했습니다.',
                  });
                })
              }
            />
          ) : null}
          {moreButton('schedules')}
          <button
            className="secondary wide"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                await api('/api/dry-run', 'POST', {}, state.csrf);
                await refresh();
                setHistoryTab('previews');
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
    </>
  );
}
