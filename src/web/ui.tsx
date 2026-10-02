import { useId, type ReactElement, type ReactNode } from 'react';
import type { CardInput, Schedule, ScheduleInput } from '../shared/model';
import { kstDate } from '../shared/time';
import type { Page } from './navigation';
export const EMPTY: CardInput = {
  template: 'expression',
  expression: 'Take your time',
  meaning_ko: '서두르지 말고 천천히 해',
  example_en: 'Take your time. We can leave later.',
  example_ko: '천천히 해. 우리는 나중에 출발해도 돼.',
  pronunciation_ko: '',
  note_ko: '상대가 서두르지 않아도 된다고 말할 때',
  category: '일상',
  level: '기초',
};
const LABELS: Record<string, string> = {
  pending: '대기',
  claimed: '준비 중',
  sending: '응답 확인 중',
  sent: 'API 접수 확인',
  mock_sent: '모의 접수',
  retry_wait: '재시도 대기',
  failed: '실패',
  unknown: '결과 불명',
  abandoned: '재전송 없이 종료 (수신 미확인)',
  cancelled: '취소',
  missed: '시각 지남',
  blocked: '확인 필요',
  paused: '일시정지',
  content_shortage: '카드 부족',
  completed: '목록 소비 완료',
  daily_limit: '일일 시도 한도',
  needs_reconnect: '재연결 필요',
  disconnected: '연결 해제',
  connected: '연결됨',
  ready: '검토 완료',
  draft: '초안',
  uploading: '저장 중',
  cleanup_needed: '정리 필요',
  deleting: '정리 중',
};
export function label(value: string): string {
  return LABELS[value] ?? value;
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '요청을 완료하지 못했습니다.';
}
export function Icon({ name }: { name: Page | 'arrow' | 'more' }): ReactElement {
  const paths: Record<Page | 'arrow' | 'more', ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    editor: (
      <>
        <path d="m4 17-1 4 4-1L20 7l-3-3Z" />
        <path d="m14 7 3 3" />
      </>
    ),
    library: (
      <>
        <rect x="5" y="3" width="15" height="17" rx="2" />
        <path d="M2 7v14M9 8h7M9 12h5" />
      </>
    ),
    schedules: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M7 2v6M17 2v6M3 11h18M8 15h2M14 15h2" />
      </>
    ),
    history: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6l4 2" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="8" cy="6" r="2" />
        <circle cx="16" cy="12" r="2" />
        <circle cx="9" cy="18" r="2" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  required?: boolean;
};
export function TextField({
  label: caption,
  value,
  onChange,
  error,
  required,
}: FieldProps): ReactElement {
  const id: string = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {caption}
        {required && (
          <span className="required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      <input
        id={id}
        value={value}
        aria-required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}
export function TextAreaField({
  label: caption,
  value,
  onChange,
  error,
  required,
}: FieldProps): ReactElement {
  const id: string = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        {caption}
        {required && (
          <span className="required" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      <textarea
        id={id}
        value={value}
        aria-required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
        rows={2}
      />
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}
export function canPauseSchedule(item: Schedule): boolean {
  return Boolean(
    item.enabled ||
    (['completed', 'content_shortage'].includes(item.reason ?? '') &&
      item.pending_delivery_count > 0),
  );
}
export function initialSchedule(): ScheduleInput {
  const future: number = Date.now() + 10 * 60_000;
  return {
    name: '나의 영어 시간',
    kind: 'once',
    date: kstDate(future),
    time: new Date(future + 9 * 3600_000).toISOString().slice(11, 16),
    end_date: null,
    weekdays: [1, 2, 3, 4, 5],
    cards_per_occurrence: 1,
    asset_ids: [],
  };
}
