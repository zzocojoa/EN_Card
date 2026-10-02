import type { ReactElement } from 'react';
import { api } from '../api';
import { Icon } from '../ui';
import { useStudio } from '../studio';
import { integratedStudio } from '../environment';
export function LoginPage(): ReactElement {
  const { boot, busy, setupToken, setSetupToken, refresh, perform, oauth } = useStudio();
  if (integratedStudio)
    return (
      <section className="login-panel">
        <h1>나의 영어 카드</h1>
        <p>하루단어에 연결한 본인 계정으로 로그인해 주세요.</p>
        <a className="primary" href="/signin-with-chatgpt?return_to=%2Fcards" target="_top">
          하루단어 로그인
        </a>
        <button className="secondary" onClick={() => window.location.reload()}>
          다시 확인
        </button>
      </section>
    );
  return (
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
              {busy ? '작업실 여는 중…' : '로컬 작업실 열기'} <Icon name="arrow" />
            </button>
          </>
        ) : (
          <>
            <label className="field">
              <span>운영자 등록·접속 토큰</span>
              <input
                type="password"
                autoComplete="off"
                value={setupToken}
                onChange={(event) => setSetupToken(event.target.value)}
              />
            </label>
            <p>최초 등록과 로그아웃 후 로그인에는 보관한 등록 토큰이 필요합니다.</p>
            <button
              className="primary"
              disabled={busy || !boot?.kakao_configured}
              onClick={() => void perform(oauth)}
            >
              {busy ? '카카오 연결 준비 중…' : '카카오로 로그인'}
            </button>
            {boot && !boot.kakao_configured ? (
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
  );
}
