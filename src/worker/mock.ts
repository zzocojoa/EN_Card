import type { FeedPayload, SendResult } from '../shared/model';
export async function sendMock(_payload: FeedPayload, _token: string): Promise<SendResult> {
  return { outcome: 'mock_sent', detail: '모의 API 접수입니다. 카카오톡에는 보내지 않았습니다.' };
}
