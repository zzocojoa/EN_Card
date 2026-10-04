import { useEffect, useState } from 'react';

export const pages = [
  'home',
  'automation',
  'editor',
  'library',
  'schedules',
  'history',
  'settings',
] as const;
export type Page = (typeof pages)[number];
export const pageTitles: Record<Page, string> = {
  home: '오늘의 작업실',
  automation: 'AI 자동 제작',
  editor: '카드 만들기',
  library: '카드 보관함',
  schedules: '발송 예약',
  history: '발송 기록',
  settings: '연결 및 설정',
};
function currentPage(): Page {
  const value = window.location.hash.slice(2);
  return pages.includes(value as Page) ? (value as Page) : 'home';
}
export function usePage(): [Page, (page: Page) => void] {
  const [page, update] = useState<Page>(currentPage);
  useEffect(() => {
    const sync = () => {
      update(currentPage());
    };
    if (!pages.some((value) => window.location.hash === `#/${value}`))
      window.history.replaceState(null, '', '#/home');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return [
    page,
    (next) => {
      update(next);
      if (window.location.hash !== `#/${next}`) window.location.hash = `/${next}`;
    },
  ];
}
