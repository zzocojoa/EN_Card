import { useEffect, useRef, useState } from 'react';
import type { CatalogPage } from '../worker/catalog';

// Each request belongs to its filter/revision. Late responses cannot replace a newer list.
export function useCatalog<T extends { id: string }>(
  kind: 'cards' | 'deliveries',
  params: Record<string, string>,
  revision: number,
  enabled: boolean,
  onSessionExpired: () => void,
) {
  const query = new URLSearchParams(params).toString();
  const key = `${kind}?${query}:${revision}`;
  const [result, setResult] = useState<{ key: string; page: CatalogPage<T> } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef<{ controller: AbortController; key: string } | null>(null);
  const expired = useRef(onSessionExpired);
  expired.current = onSessionExpired;

  async function read(cursor: string | null, controller: AbortController): Promise<CatalogPage<T>> {
    const url = new URLSearchParams(query);
    if (cursor) url.set('cursor', cursor);
    const response = await fetch(`/api/page/${kind}?${url}`, { signal: controller.signal });
    if (response.status === 401) expired.current();
    const body = (await response.json()) as CatalogPage<T> & { message?: string };
    if (!response.ok) throw new Error(body.message ?? '목록을 불러오지 못했습니다.');
    return body;
  }
  useEffect(() => {
    request.current?.controller.abort();
    if (!enabled) return;
    const controller = new AbortController();
    request.current = { controller, key };
    setError('');
    setLoading(true);
    void read(null, controller)
      .then((page) => {
        if (!controller.signal.aborted) setResult({ key, page });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '목록을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [key, retry, enabled]);

  async function more(): Promise<void> {
    if (loading || result?.key !== key || !result.page.next) return;
    const controller = new AbortController();
    request.current?.controller.abort();
    request.current = { controller, key };
    setLoading(true);
    setError('');
    try {
      const page = await read(result.page.next, controller);
      if (controller.signal.aborted) return;
      setResult((current) =>
        current?.key === key
          ? {
              key,
              page: {
                ...page,
                items: [
                  ...current.page.items,
                  ...page.items.filter(
                    (item) => !current.page.items.some((old) => old.id === item.id),
                  ),
                ],
              },
            }
          : current,
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : '목록을 불러오지 못했습니다.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => () => request.current?.controller.abort(), []);
  return {
    items: result?.key === key ? result.page.items : [],
    total: result?.key === key ? result.page.total : 0,
    next: result?.key === key ? result.page.next : null,
    loading: enabled && (loading || (result?.key !== key && !error)),
    error,
    more,
    reload: () => setRetry((value) => value + 1),
  };
}
