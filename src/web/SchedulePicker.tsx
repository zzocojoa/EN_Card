import { useState, type ReactElement } from 'react';
import type { Card } from '../shared/model';
import { useStudio } from './studio';
import { useCatalog } from './useCatalog';
export function SchedulePicker(): ReactElement {
  const {
    state,
    setState,
    revision,
    schedule,
    setSchedule,
    setScheduleDirty,
    scheduleTitles,
    setScheduleTitles,
    editingSchedule,
    busy,
  } = useStudio();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const cards = useCatalog<Card>(
    'cards',
    { status: 'ready', q: search },
    revision,
    Boolean(state),
    () => setState(null),
  );
  const titles = new Map([
    ...(state?.cards.map((item) => [item.asset_id, item.content.expression] as const) ?? []),
    ...(editingSchedule?.items.map((item) => [item.asset_id, item.title] as const) ?? []),
    ...cards.items.map((item) => [item.asset_id, item.content.expression] as const),
    ...Object.entries(scheduleTitles),
  ]);
  const currentAssets = new Set(cards.items.map((item) => item.asset_id));
  const preservedItems =
    editingSchedule?.items
      .slice(editingSchedule.cursor)
      .filter((item) => !currentAssets.has(item.asset_id)) ?? [];
  function select(asset: string, title: string, checked: boolean) {
    setSchedule((current) => ({
      ...current,
      asset_ids: checked
        ? [...new Set([...current.asset_ids, asset])]
        : current.asset_ids.filter((id) => id !== asset),
    }));
    setScheduleTitles((current) => ({ ...current, [asset]: title }));
    setScheduleDirty(true);
  }
  function move(index: number, offset: number) {
    setSchedule((current) => {
      const ids = [...current.asset_ids];
      const other = index + offset;
      if (other < 0 || other >= ids.length) return current;
      [ids[index], ids[other]] = [ids[other]!, ids[index]!];
      return { ...current, asset_ids: ids };
    });
    setScheduleDirty(true);
  }
  return (
    <div className="schedule-picker">
      <div className="picker-search">
        <label>
          <span className="sr-only">예약할 카드 검색</span>
          <input
            type="search"
            maxLength={200}
            placeholder="검토 완료 카드 찾기"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="button" className="secondary" onClick={() => setSearch(query.trim())}>
          찾기
        </button>
        {search && (
          <button
            className="text-button"
            onClick={() => {
              setQuery('');
              setSearch('');
            }}
          >
            초기화
          </button>
        )}
      </div>
      {cards.loading && <p role="status">카드를 불러오고 있습니다…</p>}
      {cards.error && (
        <div className="notice error" role="alert">
          <span>{cards.error}</span>
          <button className="secondary" onClick={cards.reload}>
            다시 시도
          </button>
        </div>
      )}
      <div className="card-picker">
        {cards.items.map((item) => (
          <label className="check-row" key={item.id}>
            <input
              type="checkbox"
              aria-label={item.content.expression}
              checked={schedule.asset_ids.includes(item.asset_id!)}
              disabled={
                busy ||
                (!schedule.asset_ids.includes(item.asset_id!) && schedule.asset_ids.length >= 40)
              }
              onChange={(event) =>
                select(item.asset_id!, item.content.expression, event.target.checked)
              }
            />
            <span>{item.content.expression}</span>
            {schedule.asset_ids.includes(item.asset_id!) && (
              <em>{schedule.asset_ids.indexOf(item.asset_id!) + 1}</em>
            )}
          </label>
        ))}
        {!cards.loading && !cards.error && !cards.items.length && (
          <p>
            {search
              ? '검색 결과가 없습니다.'
              : '보관함에서 카드의 PNG를 저장하고 검토를 완료하세요.'}
          </p>
        )}
      </div>
      {preservedItems.length > 0 && (
        <div className="preserved-cards">
          <h4>이 예약에 저장된 카드</h4>
          <p className="help">
            예약 당시 이미지를 유지합니다. 선택을 해제한 뒤 다시 담을 수 있습니다.
          </p>
          {preservedItems.map((item) => (
            <label className="check-row" key={item.asset_id}>
              <input
                type="checkbox"
                checked={schedule.asset_ids.includes(item.asset_id)}
                disabled={
                  busy ||
                  (!schedule.asset_ids.includes(item.asset_id) && schedule.asset_ids.length >= 40)
                }
                onChange={(event) => select(item.asset_id, item.title, event.target.checked)}
              />
              <span>
                {item.title} <small>예약에 저장된 버전</small>
              </span>
            </label>
          ))}
        </div>
      )}
      {cards.next && (
        <button
          className="secondary wide"
          disabled={cards.loading || busy}
          onClick={() => void cards.more()}
        >
          카드 더 불러오기 ({cards.items.length} / {cards.total})
        </button>
      )}
      <h4>
        선택 순서 <span className="tiny">{schedule.asset_ids.length} / 40장</span>
      </h4>
      <ol className="selected-cards" aria-label="선택한 카드 순서">
        {schedule.asset_ids.map((id, index) => (
          <li key={id}>
            <span>
              <b>{index + 1}</b>
              {titles.get(id) ?? '선택한 카드'}
            </span>
            <div>
              <button
                type="button"
                className="icon-button"
                aria-label={`${titles.get(id) ?? '카드'} 위로`}
                disabled={busy || index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`${titles.get(id) ?? '카드'} 아래로`}
                disabled={busy || index === schedule.asset_ids.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="text-button"
                aria-label={`${titles.get(id) ?? '카드'} 선택 해제`}
                disabled={busy}
                onClick={() => select(id, titles.get(id) ?? '선택한 카드', false)}
              >
                빼기
              </button>
            </div>
          </li>
        ))}
      </ol>
      {!schedule.asset_ids.length && (
        <p className="help">
          보낼 카드를 선택하세요. 위 순서대로 사용하며, 이미 보낸 카드는 자동으로 반복하지 않습니다.
        </p>
      )}
    </div>
  );
}
