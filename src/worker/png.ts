import { LIMITS } from '../shared/model';
import { appError } from './types';

const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_, index): number => {
  let value: number = index;
  for (let bit: number = 0; bit < 8; bit += 1)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc(bytes: Uint8Array, start: number, end: number): number {
  let value: number = 0xffffffff;
  for (let index: number = start; index < end; index += 1)
    value = CRC_TABLE[(value ^ bytes[index]!) & 255]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function invalid(detail: string): Error {
  return appError(
    400,
    'PNG_STRUCTURE',
    `PNG 구조가 잘못되었습니다: ${detail}. PNG를 다시 저장하세요.`,
  );
}
// Production uploads keep the 1080 default. Smaller outputs are opt-in until
// storage and message payloads carry their actual dimensions end to end.
export function validatePng(
  bytes: Uint8Array<ArrayBuffer>,
  expectedSize: 1080 | 800 | 720 = 1080,
  // Trusted internal checksum implementation; never selected by upload input.
  // Production callers retain the portable default and all structure checks.
  checksum: (bytes: Uint8Array, start: number, end: number) => number = crc,
): void {
  if (bytes.length > LIMITS.imageBytes)
    throw appError(413, 'IMAGE_LIMIT', 'PNG 크기는 1MiB 이하여야 합니다.');
  if (
    bytes.length < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  )
    throw appError(400, 'PNG_SIGNATURE', 'PNG 파일만 업로드할 수 있습니다.');
  const view: DataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset: number = 8;
  let depth: number = 0;
  let color: number = -1;
  let palette: boolean = false;
  let dataBytes: number = 0;
  let dataStarted: boolean = false;
  let dataEnded: boolean = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw invalid('잘린 청크');
    const size: number = view.getUint32(offset);
    if (size > 0x7fffffff || size > bytes.length - offset - 12) throw invalid('청크 길이');
    const type: string = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type)) throw invalid('청크 이름');
    const end: number = offset + 12 + size;
    if (offset === 8 && type !== 'IHDR') throw invalid('IHDR 순서');
    if (type === 'IHDR') {
      if (offset !== 8 || size !== 13) throw invalid('IHDR 중복 또는 길이');
      if (
        view.getUint32(offset + 8) !== expectedSize ||
        view.getUint32(offset + 12) !== expectedSize
      )
        throw appError(400, 'PNG_DIMENSIONS', `${expectedSize}×${expectedSize} PNG를 사용하세요.`);
      depth = bytes[offset + 16]!;
      color = bytes[offset + 17]!;
      const depths: Readonly<Record<number, readonly number[]>> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16],
      };
      if (
        !depths[color]?.includes(depth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        ![0, 1].includes(bytes[offset + 20]!)
      )
        throw invalid('IHDR 색상·비트 깊이·압축·필터·인터레이스');
    } else if (type === 'PLTE') {
      if (
        palette ||
        dataStarted ||
        color === 0 ||
        color === 4 ||
        size === 0 ||
        size % 3 !== 0 ||
        size > 768 ||
        (color === 3 && size / 3 > 2 ** depth)
      )
        throw invalid('PLTE 순서 또는 크기');
      palette = true;
    } else if (type === 'IDAT') {
      if (dataEnded || (color === 3 && !palette)) throw invalid('IDAT 순서 또는 팔레트 누락');
      dataStarted = true;
      dataBytes += size;
    } else if (type === 'IEND') {
      if (size !== 0 || !dataStarted || dataBytes === 0 || end !== bytes.length)
        throw invalid('IDAT 누락 또는 IEND 종료');
    } else {
      if (type[0] === type[0]!.toUpperCase()) throw invalid(`지원하지 않는 필수 청크 ${type}`);
      if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw invalid('애니메이션 PNG는 지원하지 않음');
    }
    if (dataStarted && type !== 'IDAT') dataEnded = true;
    if (checksum(bytes, offset + 4, end - 4) !== view.getUint32(end - 4))
      throw invalid(`${type} CRC 불일치`);
    if (type === 'IEND') return;
    offset = end;
  }
  throw invalid('IEND 누락');
}
