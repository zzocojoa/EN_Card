import { useEffect, useRef, useState, type ReactElement } from 'react';
import { StudioProvider, useStudio } from './studio';
import { pages, pageTitles, type Page } from './navigation';
import { Icon } from './ui';
import { api } from './api';
import { integratedStudio } from './environment';
import { Modal } from './Modal';
import { HomePage } from './pages/HomePage';
import { EditorPage } from './pages/EditorPage';
import { LibraryPage } from './pages/LibraryPage';
import { SchedulesPage } from './pages/SchedulesPage';
import { HistoryPage } from './pages/HistoryPage';
import { SettingsPage } from './pages/SettingsPage';
import { LoginPage } from './pages/LoginPage';
import { AutomationPanel } from './AutomationPanel';

const descriptions: Record<Page, string> = {
  home: '다음 영어 시간과 오늘 필요한 일을 확인하세요.',
  automation: '주제와 시간을 정하면, 매일 한 장을 준비해 드려요.',
  editor: '직접 고른 표현을 담고, 미리보기를 확인한 뒤 저장하세요.',
  library: '준비한 표현을 찾아 편집하거나 예약에 담으세요.',
  schedules: '한국 시간으로 예약하고, 준비한 카드를 순서대로 보내세요.',
  history: '보낸 카드와 확인이 필요한 결과를 살펴보세요.',
  settings: '카카오 연결과 학습 자료를 관리하세요.',
};
const studioName = integratedStudio ? '하루단어' : '하루 한 표현';
export function App(): ReactElement {
  return (
    <StudioProvider>
      <Workspace />
    </StudioProvider>
  );
}
function Workspace(): ReactElement {
  const {
    page,
    setPage,
    state,
    setState,
    boot,
    loading,
    busy,
    notice,
    setNotice,
    sendMode,
    perform,
    refresh,
    confirmation,
    setConfirmation,
    modalOpener,
  } = useStudio();
  const [moreOpen, setMoreOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef(page);
  useEffect(() => {
    document.title = `${state ? pageTitles[page] : '로그인'} · ${studioName}`;
    if (previousPage.current !== page) {
      setMoreOpen(false);
      window.scrollTo({ top: 0 });
      heading.current?.focus();
    }
    previousPage.current = page;
  }, [page, Boolean(state)]);
  const modeLabel =
    sendMode === 'live'
      ? 'LIVE'
      : sendMode === 'mock'
        ? 'MOCK · 모의 발송'
        : sendMode === 'dry_run'
          ? 'DRY RUN · 실제 발송 없음'
          : loading
            ? '발송 모드 확인 중'
            : '발송 모드 확인 불가';
  function navButton(id: Page, mobile = false): ReactElement {
    return (
      <button
        key={id}
        className={`nav-item ${page === id ? 'selected' : ''}`}
        aria-current={page === id ? 'page' : undefined}
        aria-label={pageTitles[id]}
        disabled={busy}
        onClick={() => setPage(id)}
      >
        <Icon name={id} />
        <span>
          {mobile && id === 'home'
            ? '홈'
            : mobile && id === 'library'
              ? '보관함'
              : mobile && id === 'schedules'
                ? '예약'
                : mobile && id === 'automation'
                  ? '자동 제작'
                  : pageTitles[id]}
        </span>
        {!mobile && id === 'library' && state && <em>{state.totals.cards}</em>}
      </button>
    );
  }
  return (
    <div
      className={`app-shell ${!state ? 'signed-out' : ''}`}
      onClickCapture={(event) => {
        // Safari does not focus a button on pointer activation. Keep the actual
        // trigger so dialogs still return keyboard focus to that button.
        if (!(event.target instanceof Element) || event.target.closest('dialog')) return;
        const trigger = event.target.closest<HTMLElement>('button,a,summary,input,select,textarea');
        if (trigger) modalOpener.current = trigger;
      }}
    >
      <a
        className="skip-link"
        href="#workspace-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('workspace-content')?.focus();
        }}
      >
        본문 바로가기
      </a>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => setPage('home')}
          disabled={busy}
          aria-label={`${studioName} 홈`}
        >
          <span className="brand-mark">
            a<span>↗</span>
          </span>
          <span>
            {studioName}
            <small>{integratedStudio ? 'ENGLISH CARDS' : 'MY ENGLISH STUDIO'}</small>
          </span>
        </button>
        <div className="nav-label">나의 학습 공간</div>
        <nav aria-label="주 메뉴">{pages.map((id) => navButton(id))}</nav>
        <div className="sidebar-bottom">
          <strong>
            <span className={`mode-dot ${sendMode ?? 'unavailable'}`} />
            {boot?.local
              ? '로컬 작업실'
              : sendMode === 'live'
                ? '클라우드 발송'
                : sendMode
                  ? '발송 전 검증 모드'
                  : '발송 모드 확인 불가'}
          </strong>
          <p>
            {boot?.local
              ? '이 기기의 테스트 저장소를 사용합니다.'
              : '미리 준비한 표현을 나에게 보내세요.'}
          </p>
          <span className="tiny">Asia/Seoul · 한국 표준시</span>
        </div>
      </aside>
      <main id="workspace-content" tabIndex={-1}>
        <header className="topbar">
          <span className="topbar-brand">
            {studioName} <span>{integratedStudio ? '나의 영어 카드' : '나에게 보내는 영어'}</span>
          </span>
          <div>
            <span className={`status-pill ${sendMode ?? 'unavailable'}`}>{modeLabel}</span>
            {integratedStudio && (
              <a className="text-button" href="/" target="_top">
                하루단어로 돌아가기
              </a>
            )}
            {state && !integratedStudio && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await api('/api/logout', 'POST', {}, state.csrf);
                    setState(null);
                  })
                }
              >
                로그아웃
              </button>
            )}
          </div>
        </header>
        <div className="workspace" aria-busy={loading}>
          {notice && (
            <div
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={`notice ${notice.kind}`}
            >
              <span>{notice.text}</span>
              <button aria-label="알림 닫기" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
          )}
          {loading ? (
            <div className="empty" role="status">
              작업실을 불러오고 있습니다…
            </div>
          ) : !state ? (
            <>
              {!boot && (
                <button className="secondary" onClick={() => window.location.reload()}>
                  연결 상태 다시 확인
                </button>
              )}
              <LoginPage />
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">나를 위한 영어 한 장</div>
                  <h1 ref={heading} tabIndex={-1}>
                    {pageTitles[page]}
                  </h1>
                  <p>{descriptions[page]}</p>
                </div>
                <button
                  className="secondary refresh-button"
                  disabled={busy}
                  onClick={() => void perform(refresh)}
                >
                  {busy ? '처리 중…' : '새로고침'}
                </button>
              </div>
              {page === 'home' && <HomePage />}
              {page === 'automation' && <AutomationPanel />}
              {page === 'editor' && <EditorPage />}
              {page === 'library' && <LibraryPage />}
              {page === 'schedules' && <SchedulesPage />}
              {page === 'history' && <HistoryPage />}
              {page === 'settings' && <SettingsPage />}
            </>
          )}
        </div>
        <footer>
          <strong>{studioName}</strong>
          <span>작게 만들고, 오래 기억하세요.</span>
          <span>한국 시간 · KST</span>
        </footer>
      </main>
      {state && (
        <nav className="mobile-nav" aria-label="모바일 메뉴">
          {(['home', 'automation', 'library', 'schedules'] as Page[]).map((id) =>
            navButton(id, true),
          )}
          <button
            className={`nav-item ${['editor', 'history', 'settings'].includes(page) ? 'selected' : ''}`}
            disabled={busy}
            aria-expanded={moreOpen}
            onClick={(event) => {
              modalOpener.current = event.currentTarget;
              setMoreOpen(true);
            }}
          >
            <Icon name="more" />
            <span>더보기</span>
          </button>
        </nav>
      )}
      {moreOpen && (
        <Modal
          label="더보기"
          busy={busy}
          returnFocus={modalOpener.current}
          onClose={() => setMoreOpen(false)}
        >
          <h2 tabIndex={-1}>내 작업실</h2>
          <div className="menu-actions">
            <button
              className="primary"
              onClick={() => {
                setMoreOpen(false);
                setPage('editor');
              }}
            >
              카드 만들기
            </button>
            <button
              className="secondary"
              onClick={() => {
                setMoreOpen(false);
                setPage('history');
              }}
            >
              발송 기록
            </button>
            <button
              className="secondary"
              onClick={() => {
                setMoreOpen(false);
                setPage('settings');
              }}
            >
              연결 및 설정
            </button>
            <button className="secondary" onClick={() => setMoreOpen(false)}>
              닫기
            </button>
          </div>
        </Modal>
      )}
      {confirmation && (
        <Modal
          label={confirmation.title}
          busy={busy}
          returnFocus={modalOpener.current}
          onClose={() => setConfirmation(null)}
        >
          <h2 tabIndex={-1}>{confirmation.title}</h2>
          <p>{confirmation.body}</p>
          {notice?.kind === 'error' && (
            <p className="notice error" role="alert">
              {notice.text}
            </p>
          )}
          <div className="toolbar">
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await confirmation.action();
                  setConfirmation(null);
                })
              }
            >
              {busy ? '처리 중…' : confirmation.actionLabel}
            </button>
            <button className="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              돌아가기
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
