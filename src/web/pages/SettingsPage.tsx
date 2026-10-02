import { type ReactElement } from 'react';
import { LIMITS } from '../../shared/model';
import { formatKst } from '../../shared/time';
import { api } from '../api';
import { label } from '../ui';
import { useStudio } from '../studio';
export function SettingsPage(): ReactElement | null {
  const {
    setConfirmation,
    modalOpener,
    boot,
    state,
    busy,
    setNotice,
    activeSchedules,
    credentialStorageFailure,
    storage,
    today,
    refresh,
    perform,
    oauth,
    moreButton,
  } = useStudio();
  if (!state) return null;
  return (
    <>
      <div className="settings-grid">
        <section className="editor-panel">
          <h2>카카오 연결</h2>
          <span className="badge">
            {credentialStorageFailure
              ? '저장 인증정보 오류'
              : boot?.local
                ? '로컬 테스트'
                : label(state.connection?.status ?? 'disconnected')}
          </span>
          {state.connection?.refresh_failure ? (
            <div className="soft-notice" role="status">
              <p>
                {state.connection.refresh_failure === 'transient'
                  ? '토큰 갱신 일시 오류로 대기 중입니다. 재로그인은 필요하지 않습니다.'
                  : state.connection.refresh_failure === 'exhausted'
                    ? '토큰 갱신 자동 재시도 3회를 소진했습니다. 인증 무효는 아닙니다. 제공사 복구 후 직접 재시도를 시작하세요.'
                    : state.connection.refresh_failure === 'uncertain'
                      ? '토큰 갱신 결과가 불명확합니다. 자동 재시도하지 않으므로 카카오를 다시 연결하세요.'
                      : state.connection.refresh_failure === 'configuration'
                        ? credentialStorageFailure
                          ? '저장 인증정보를 읽을 수 없어 자동 발송을 중지했습니다. 원래 암호화 설정을 복구한 뒤 설정 복구 확인을 실행하거나 카카오를 다시 연결하세요.'
                          : '카카오 앱 설정을 확인한 뒤 갱신 재시도를 시작하세요.'
                        : '인증이 만료되었거나 철회되었습니다. 카카오를 다시 연결하세요.'}
              </p>
              <p>
                갱신 시도 {state.connection.refresh_attempts}/3 · HTTP{' '}
                {state.connection.refresh_http_status ?? '응답 없음'} ·{' '}
                {state.connection.refresh_provider_error ?? '제공사 오류 없음'} ·{' '}
                {state.connection.refresh_provider_code ?? '코드 없음'}
              </p>
              {state.connection.refresh_retry_at ? (
                <p>다음 갱신: {formatKst(state.connection.refresh_retry_at)}</p>
              ) : null}
              {['exhausted', 'configuration'].includes(state.connection.refresh_failure) ? (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await api(
                        '/api/connection/retry',
                        'POST',
                        { version: state.connection!.version },
                        state.csrf,
                      );
                      await refresh();
                      if (credentialStorageFailure)
                        setNotice({
                          kind: 'success',
                          text: '저장 인증정보를 확인했습니다. 예약은 별도로 재개하세요.',
                        });
                    })
                  }
                >
                  {credentialStorageFailure ? '설정 복구 확인' : '토큰 갱신 다시 시도'}
                </button>
              ) : null}
              <p>
                갱신 대기는 메시지 발송 횟수를 사용하지 않습니다. 15분이 지난 회차는 새 날짜로
                예약하세요. 갱신 재시도는 다음 발송 시점에 수행합니다.
              </p>
            </div>
          ) : null}
          <p>
            로그아웃은 브라우저 세션만 종료합니다. 자동 발송 연결 해제는 예약을 중지하고 저장된
            토큰을 제거합니다.
          </p>
          {boot?.local ? (
            <div className="soft-notice">
              운영 계정의 인증·무료 플랜은 아직 확인하지 않았습니다. 실제 연결은 배포 설정 후
              진행하세요.
            </div>
          ) : (
            <button className="primary" disabled={busy} onClick={() => void perform(oauth)}>
              카카오 다시 연결
            </button>
          )}
          <button
            className="secondary wide"
            disabled={busy}
            onClick={(event) => {
              modalOpener.current = event.currentTarget;
              setNotice(null);
              setConfirmation({
                title: '자동 발송 연결 해제',
                body: '저장된 카카오 토큰을 제거하고 예약 발송을 중지합니다. 브라우저 로그아웃만 하려면 상단 로그아웃을 사용하세요.',
                actionLabel: '연결 해제 실행',
                action: async () => {
                  await api('/api/disconnect', 'POST', {}, state.csrf);
                  await refresh();
                  setNotice({
                    kind: 'success',
                    text: '저장된 토큰을 제거하고 자동 발송을 중단했습니다.',
                  });
                },
              });
            }}
          >
            자동 발송 연결 해제
          </button>
          <h2>무료 구성 안내</h2>
          <p>
            Workers Free · D1 Free · KV Free
            <br />
            이미지는 브라우저에서 생성합니다.
          </p>
          <p className="help">
            계정 내 다른 앱과 제공사 한도를 공유할 수 있습니다. 앱 설정만으로 무료 플랜이나 계정
            전체 사용량을 확인할 수 없습니다.
          </p>
        </section>
        <section className="editor-panel">
          <h2>앱 사용량·저장 공간</h2>
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
            삭제하면 과거 메시지의 원본 링크가 열리지 않을 수 있습니다. 예약과 미확정 발송에서
            사용하는 이미지는 보호합니다.
          </p>
          {state.assets.length === 0 && (
            <p className="empty compact">
              저장한 이미지가 없습니다. 카드 만들기에서 PNG를 저장해 보세요.
            </p>
          )}
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
                  onClick={(event) => {
                    modalOpener.current = event.currentTarget;
                    setNotice(null);
                    setConfirmation({
                      title: '이미지 삭제',
                      body: '이 이미지를 삭제하면 과거 메시지의 원본 링크도 열리지 않을 수 있습니다. 예약과 미확정 발송에서 사용하는 이미지는 삭제할 수 없습니다.',
                      actionLabel: '이미지 삭제 실행',
                      action: async () => {
                        await api(`/api/assets/${asset.id}`, 'DELETE', null, state.csrf);
                        await refresh();
                      },
                    });
                  }}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
          {moreButton('assets')}
        </section>
      </div>
    </>
  );
}
