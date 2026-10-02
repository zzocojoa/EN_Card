import { describe, expect, it } from 'vitest';
import { parseImport } from '../src/shared/model';
import { kstToUtc, nextRun } from '../src/shared/time';
import { decrypt, encrypt } from '../src/worker/crypto';
import { kakaoOwner, makePayload, sendKakao, validatePayload } from '../src/worker/kakao';
import { validatePng } from '../src/worker/storage';
import { layoutCard } from '../src/web/canvas';
import { SAMPLE, png } from './helpers';

describe('입력·시간·암호화', () => {
  it('KST 자정과 월말·윤년을 변환한다', () => {
    expect(new Date(kstToUtc('2026-10-01', '00:05')).toISOString()).toBe(
      '2026-09-30T15:05:00.000Z',
    );
    expect(() => kstToUtc('2026-02-29', '08:00')).toThrow();
    expect(() => kstToUtc('2026-13-01', '08:00')).toThrow();
    expect(
      nextRun(
        { kind: 'weekly', date: '2026-09-28', time: '08:00', weekdays: [1], end_date: null },
        kstToUtc('2026-09-28', '08:00'),
      ),
    ).toBe(kstToUtc('2026-10-05', '08:00'));
    expect(
      nextRun(
        { kind: 'daily', date: '2026-09-28', time: '08:00', weekdays: [], end_date: '2026-09-28' },
        kstToUtc('2026-09-28', '08:00'),
      ),
    ).toBeNull();
  });
  it('가져오기 중복·부분 오류를 알리고 스크립트는 문자열로 유지한다', () => {
    const result = parseImport({
      schema_version: 1,
      cards: [
        { ...SAMPLE, id: 'same' },
        { ...SAMPLE, id: 'same' },
        { ...SAMPLE, template: 'comparison' },
      ],
    });
    expect(result.cards).toHaveLength(1);
    expect(result.errors.map((error) => error.index)).toEqual([1, 2]);
    expect(
      parseImport({
        schema_version: 1,
        cards: [{ ...SAMPLE, expression: '<script>alert(1)</script>' }],
      }).cards[0]?.expression,
    ).toContain('<script>');
  });
  it('토큰을 인증 암호화하며 변경된 암호문을 거부한다', async () => {
    const key: string = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
    const value: string = await encrypt('private-token', key);
    expect(value).not.toContain('private-token');
    expect(await decrypt(value, key)).toBe('private-token');
    await expect(decrypt(value.replace(/.$/, 'A'), key)).rejects.toThrow();
  });
  it('PNG 시그니처와 규격을 검사한다', () => {
    expect(() => validatePng(png())).not.toThrow();
    const invalid = png();
    new DataView(invalid.buffer).setUint32(16, 1);
    expect(() => validatePng(invalid)).toThrow('1080');
  });
});

it('읽기 전용 사용자 조회의 네트워크 실패를 세 번까지만 재시도한다', async () => {
  let calls: number = 0;
  expect(
    await kakaoOwner('private-token', async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('network');
      return Response.json({ id: 42 });
    }),
  ).toBe('42');
  expect(calls).toBe(3);
  const last = new TypeError('last network error');
  await expect(
    kakaoOwner('private-token', async () => {
      throw last;
    }),
  ).rejects.toBe(last);
  await expect(
    kakaoOwner('private-token', async () => new Response('<html>')),
  ).rejects.toMatchObject({ code: 'OWNER_RESPONSE', status: 502 });
});
describe('카카오 실제 어댑터의 응답 계약', () => {
  const payload = makePayload(SAMPLE, 'abc', 'https://example.test');
  it('두 템플릿의 피드와 길이 경계를 검증한다', () => {
    for (const template of ['expression', 'comparison'] as const) {
      const feed = makePayload(
        { ...SAMPLE, template, expression: '한'.repeat(200) },
        'abc',
        'https://example.test',
      );
      expect(validatePayload(feed, 'https://example.test')).toEqual(feed);
      feed.content.title += 'x';
      expect(() => validatePayload(feed, 'https://example.test')).toThrow();
    }
  });
  it.each([
    ['null', () => null],
    ['배열', () => []],
    ['루트 추가 필드', (p) => ({ ...p, extra: true })],
    ['다른 형식', (p) => ({ ...p, object_type: 'text' })],
    ['내용 누락', (p) => ({ object_type: p.object_type, buttons: p.buttons })],
    ['내용 배열', (p) => ({ ...p, content: [] })],
    ['내용 추가 필드', (p) => ({ ...p, content: { ...p.content, extra: true } })],
    ['빈 제목', (p) => ({ ...p, content: { ...p.content, title: '' } })],
    ['제목 타입', (p) => ({ ...p, content: { ...p.content, title: 1 } })],
    ['빈 뜻', (p) => ({ ...p, content: { ...p.content, description: '' } })],
    ['긴 뜻', (p) => ({ ...p, content: { ...p.content, description: 'x'.repeat(201) } })],
    ['이미지 URL 타입', (p) => ({ ...p, content: { ...p.content, image_url: null } })],
    ['가로 규격', (p) => ({ ...p, content: { ...p.content, image_width: 1 } })],
    ['세로 규격', (p) => ({ ...p, content: { ...p.content, image_height: '1080' } })],
    ['링크 null', (p) => ({ ...p, content: { ...p.content, link: null } })],
    [
      '링크 누락',
      (p) => ({ ...p, content: { ...p.content, link: { web_url: 'https://example.test' } } }),
    ],
    [
      '링크 추가 필드',
      (p) => ({ ...p, content: { ...p.content, link: { ...p.content.link, extra: true } } }),
    ],
    ['버튼 없음', (p) => ({ ...p, buttons: [] })],
    ['버튼 둘', (p) => ({ ...p, buttons: [p.buttons[0], p.buttons[0]] })],
    ['버튼 null', (p) => ({ ...p, buttons: [null] })],
    ['다른 버튼 제목', (p) => ({ ...p, buttons: [{ ...p.buttons[0], title: '다른 제목' }] })],
    ['버튼 추가 필드', (p) => ({ ...p, buttons: [{ ...p.buttons[0], extra: true }] })],
    [
      '버튼 링크 추가 필드',
      (p) => ({
        ...p,
        buttons: [{ ...p.buttons[0], link: { ...p.buttons[0]!.link, extra: true } }],
      }),
    ],
  ] satisfies [string, (p: typeof payload) => unknown][])('%s 피드를 거부한다', (_, change) => {
    expect(() =>
      validatePayload(change(structuredClone(payload)), 'https://example.test'),
    ).toThrow();
  });
  it('이미지와 두 링크의 모든 URL을 검사하며 출처를 제한한다', () => {
    const setters = [
      (p: typeof payload, url: string) => {
        p.content.image_url = url;
      },
      (p: typeof payload, url: string) => {
        p.content.link.web_url = url;
      },
      (p: typeof payload, url: string) => {
        p.content.link.mobile_web_url = url;
      },
      (p: typeof payload, url: string) => {
        p.buttons[0]!.link.web_url = url;
      },
      (p: typeof payload, url: string) => {
        p.buttons[0]!.link.mobile_web_url = url;
      },
    ];
    for (const set of setters) {
      for (const url of [
        '/relative',
        'not a URL',
        'https://outside.test/x',
        'javascript:alert(1)',
        'https://example.test.evil.test/x',
      ]) {
        const feed = structuredClone(payload);
        set(feed, url);
        expect(() => validatePayload(feed, 'https://example.test')).toThrow();
      }
    }
  });
  it('URL·인증·form 본문과 result_code=0을 요구한다', async () => {
    const result = await sendKakao(payload, 'token', async (url, init) => {
      expect(url).toBe('https://kapi.kakao.com/v2/api/talk/memo/default/send');
      expect(init.headers).toHaveProperty('Authorization', 'Bearer token');
      expect(new URLSearchParams(init.body as string).get('template_object')).toBe(
        JSON.stringify(payload),
      );
      return Response.json({ result_code: 0 });
    });
    expect(result.outcome).toBe('sent');
  });
  it.each([
    [200, {}, 'unknown'],
    [200, null, 'unknown'],
    [200, [], 'unknown'],
    [200, { result_code: '0' }, 'unknown'],
    [200, { result_code: null }, 'unknown'],
    [200, { result_code: 0, code: 'bad' }, 'unknown'],
    [200, { result_code: 0, code: null }, 'unknown'],
    [200, { result_code: 0, extra: true }, 'sent'],
    [400, { result_code: 0, code: -2 }, 'failed'],
    [500, { code: -1 }, 'unknown'],
    [401, { code: -401 }, 'unauthorized'],
    [403, { code: -402 }, 'reconnect'],
    [400, { code: -2 }, 'failed'],
    [400, { code: -10 }, 'retry'],
    [400, { code: -603 }, 'unknown'],
  ])('HTTP %s 응답을 안전하게 분류한다', async (status, body, outcome) => {
    expect(
      (
        await sendKakao(payload, 'token', async () =>
          Response.json(body, { status: status as number }),
        )
      ).outcome,
    ).toBe(outcome);
  });
  it('전송 응답 유실을 자동 재시도하지 않는다', async () => {
    let count: number = 0;
    expect(
      (
        await sendKakao(payload, 'token', async () => {
          count += 1;
          throw new TypeError('network');
        })
      ).outcome,
    ).toBe('unknown');
    expect(count).toBe(1);
  });
});

it('비교형은 뜻 뒤에 발음을 표시하고 줄바꿈·최소 글자 크기를 보존한다', () => {
  const layout = layoutCard((text) => text.length * 15, {
    ...SAMPLE,
    template: 'comparison',
    base_expression: 'Slow down',
    base_meaning_ko: '속도를 줄여',
    pronunciation_ko: '테이크 유어 타임',
  });
  const meaning = layout.lines.find((line) => line.text === SAMPLE.meaning_ko)!;
  const pronunciation = layout.lines.find((line) => line.text === '테이크 유어 타임')!;
  expect(meaning.y).toBeLessThan(pronunciation.y);
  expect(layout.lines.every((line) => line.size >= 26 && line.y + line.size < 984)).toBe(true);
});
