import { describe, expect, it } from 'vitest';
import { parseImport } from '../src/shared/model';
import { kstToUtc, nextRun } from '../src/shared/time';
import { decrypt, encrypt } from '../src/worker/crypto';
import { makePayload, sendKakao } from '../src/worker/kakao';
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
describe('카카오 실제 어댑터의 응답 계약', () => {
  const payload = makePayload(SAMPLE, 'abc', 'https://example.test');
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
