import { useState, type ReactElement } from 'react';
import type { Card } from '../../shared/model';
import seeds from '../../../seed/cards.json';
import { label, Icon } from '../ui';
import { useStudio } from '../studio';
import { useCatalog } from '../useCatalog';
export function LibraryPage(): ReactElement | null {
  const {
    state,
    setState,
    revision,
    busy,
    backupCursor,
    backupPart,
    json,
    setJson,
    showImport,
    setShowImport,
    perform,
    importCards,
    backup,
    openCard,
    addToSchedule,
  } = useStudio();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [template, setTemplate] = useState('all');
  const cards = useCatalog<Card>(
    'cards',
    { q: search, status, template },
    revision,
    Boolean(state),
    () => setState(null),
  );
  if (!state) return null;
  return (
    <>
      <div className="library-toolbar">
        <p>
          총 <strong>{state.totals.cards}장</strong>의 표현 · 검토 완료{' '}
          <strong>{state.summary.ready_cards}장</strong>
        </p>
        <button className="primary" disabled={busy} onClick={() => openCard(null)}>
          ＋ 새 카드
        </button>
      </div>
      <form
        className="filter-bar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(query.trim());
        }}
      >
        <label className="search-field">
          <span className="sr-only">표현·뜻 검색</span>
          <input
            type="search"
            placeholder="영어 표현이나 한글 뜻 찾기"
            value={query}
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="secondary" type="submit">
          검색
        </button>
        <label>
          <span className="sr-only">카드 상태</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">모든 상태</option>
            <option value="draft">초안</option>
            <option value="ready">검토 완료</option>
          </select>
        </label>
        <label>
          <span className="sr-only">카드 유형</span>
          <select value={template} onChange={(event) => setTemplate(event.target.value)}>
            <option value="all">모든 유형</option>
            <option value="expression">표현형</option>
            <option value="comparison">비교형</option>
          </select>
        </label>
        {(search || status !== 'all' || template !== 'all') && (
          <button
            className="text-button"
            type="button"
            onClick={() => {
              setQuery('');
              setSearch('');
              setStatus('all');
              setTemplate('all');
            }}
          >
            검색 초기화
          </button>
        )}
      </form>
      <details className="library-tools">
        <summary>가져오기·백업</summary>
        <div className="toolbar">
          <button
            className="secondary"
            disabled={busy}
            aria-expanded={showImport}
            onClick={() => setShowImport(!showImport)}
          >
            JSON 가져오기
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void perform(() => importCards(seeds))}
          >
            예제 12개 가져오기
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void perform(() => backup(null, 1))}
          >
            JSON 백업 ↓ (파일당 최대 100개)
          </button>
          {backupCursor && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void perform(() => backup(backupCursor, backupPart))}
            >
              다음 JSON 백업 ↓ ({backupPart}번째 파일)
            </button>
          )}
        </div>
        {showImport && (
          <section className="import-panel">
            <h2>카드 JSON 가져오기</h2>
            <p>
              schema_version: 1 형식, 파일당 최대 100개입니다. 오류가 있으면 해당 파일 전체 저장을
              멈추고 위치를 안내합니다.
            </p>
            <textarea
              aria-label="가져올 JSON"
              rows={7}
              value={json}
              disabled={busy}
              onChange={(event) => setJson(event.target.value)}
            />
            <input
              type="file"
              accept=".json,application/json"
              aria-label="JSON 파일 선택"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void perform(async () => setJson(await file.text()));
              }}
            />
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  let value: unknown;
                  try {
                    value = JSON.parse(json);
                  } catch {
                    throw new Error(
                      'JSON 문법을 확인하세요. 따옴표와 쉼표가 올바른지 확인해 주세요.',
                    );
                  }
                  await importCards(value);
                })
              }
            >
              {busy ? '가져오는 중…' : '가져오기'}
            </button>
          </section>
        )}
      </details>
      {cards.error && (
        <div className="notice error" role="alert">
          <span>{cards.error}</span>
          <button className="secondary" onClick={cards.reload}>
            다시 시도
          </button>
        </div>
      )}
      {cards.loading && <p role="status">카드를 불러오고 있습니다…</p>}
      {!cards.loading && !cards.error && cards.items.length === 0 && (
        <div className="empty">
          <h2>{state.totals.cards ? '조건에 맞는 카드가 없습니다.' : '첫 표현을 담아보세요.'}</h2>
          <p>
            {state.totals.cards
              ? '다른 표현이나 뜻으로 검색해 보세요.'
              : '새 카드를 만들거나 가져오기에서 예제 12개로 시작하세요.'}
          </p>
          {!state.totals.cards && (
            <button className="primary" onClick={() => openCard(null)}>
              첫 카드 만들기
            </button>
          )}
        </div>
      )}
      <div className="library-grid">
        {cards.items.map((item, index) => (
          <article className="library-card" key={item.id}>
            <div className="card-meta">
              <span>
                {String(index + 1).padStart(3, '0')} /{' '}
                {item.content.template === 'comparison' ? '비교형' : '표현형'}
              </span>
              <span className={`badge ${item.status}`}>
                {item.status === 'ready' && item.review_source === 'ai'
                  ? 'AI 검토 완료'
                  : label(item.status)}
              </span>
            </div>
            {item.content.template === 'comparison' && (
              <p className="base-expression">{item.content.base_expression}</p>
            )}
            <h2>{item.content.expression}</h2>
            <p className="blue">{item.content.meaning_ko}</p>
            <p>{item.content.example_en}</p>
            <div className="card-actions">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => openCard(item, index + 1)}
              >
                편집하기 <Icon name="arrow" />
              </button>
              {item.status === 'ready' && item.asset_id ? (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => addToSchedule(item.asset_id!, item.content.expression)}
                >
                  예약에 담기
                </button>
              ) : (
                <span className="tiny">PNG 저장·검토가 필요해요</span>
              )}
            </div>
          </article>
        ))}
      </div>
      {cards.next && (
        <button
          className="secondary wide load-more"
          disabled={cards.loading}
          onClick={() => void cards.more()}
        >
          더 불러오기 ({cards.items.length} / {cards.total})
        </button>
      )}
      {!cards.loading && (
        <p className="list-count" role="status">
          검색 결과 {cards.total}장 · {cards.items.length}장 표시
        </p>
      )}
    </>
  );
}
