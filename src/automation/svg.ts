import { create, type Font } from 'fontkit';
import { cardSchema, type CardInput } from '../shared/model';
import { layoutCard } from '../web/canvas';

// Used only by the private automation Durable Object.
// Reuse the shipped font subsets, weights and layout; outline glyphs so resvg does
// not silently substitute a system font or ignore variable-font weights.
export type FontSource = { bytes: Buffer; ranges: [number, number][] };
type Face = { font: Font; text: string };
export class CardFonts {
  private fonts = new Map<string, Font>();
  constructor(private readonly sources: FontSource[]) {}

  private face(character: string, weight: number): Font {
    const point = character.codePointAt(0)!;
    const index = this.sources.findLastIndex((source) =>
      source.ranges.some(([start, end]) => point >= start && point <= end),
    );
    if (index < 0) throw new RangeError(`폰트에 없는 문자: U+${point.toString(16)}`);
    const key = `${index}:${weight}`;
    let font = this.fonts.get(key);
    if (!font) {
      const parsed = create(this.sources[index]!.bytes);
      if (!('getVariation' in parsed)) throw new Error('단일 가변 폰트가 필요합니다.');
      font = parsed.getVariation({ wght: weight });
      this.fonts.set(key, font);
    }
    if (!font.hasGlyphForCodePoint(point))
      throw new RangeError(`글리프 누락: U+${point.toString(16)}`);
    return font;
  }

  private runs(text: string, weight: number): Face[] {
    const runs: Face[] = [];
    for (const character of text) {
      const font = this.face(character, weight);
      const last = runs.at(-1);
      if (last?.font === font) last.text += character;
      else runs.push({ font, text: character });
    }
    return runs;
  }

  measure(text: string, css: string): number {
    const match = /^(\d+) (\d+)px /.exec(css);
    if (!match) throw new Error('폰트 형식을 확인하세요.');
    const weight = Number(match[1]);
    const size = Number(match[2]);
    return this.runs(text, weight).reduce(
      (sum, { font, text }) => sum + (font.layout(text).advanceWidth * size) / font.unitsPerEm,
      0,
    );
  }

  // Build-time sprite preparation only; runtime atlas rendering never loads fonts.
  sprite(character: string, size: number, weight: number) {
    if (Array.from(character).length !== 1) throw new RangeError('문자 하나가 필요합니다.');
    const font = this.face(character, weight);
    const shaped = font.layout(character);
    const scale = size / font.unitsPerEm;
    const glyph = shaped.glyphs[0]!;
    const path = glyph.path.toSVG();
    const advance = shaped.advanceWidth * scale;
    if (!path) return { advance, left: 0, top: 0, width: 0, height: 0, svg: '' };
    const position = shaped.positions[0]!;
    const baseline = (font.ascent - position.yOffset) * scale;
    const left = Math.floor((glyph.bbox.minX + position.xOffset) * scale) - 1;
    const top = Math.floor(baseline - glyph.bbox.maxY * scale) - 1;
    const width = Math.ceil((glyph.bbox.maxX + position.xOffset) * scale) - left + 1;
    const height = Math.ceil(baseline - glyph.bbox.minY * scale) - top + 1;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path fill="#000" transform="translate(${position.xOffset * scale - left} ${baseline - top}) scale(${scale} ${-scale})" d="${path}"/></svg>`;
    return { advance, left, top, width, height, svg };
  }

  outline(text: string, x: number, y: number, size: number, weight: number, color: string): string {
    let cursor = x;
    const paths: string[] = [];
    for (const { font, text: runText } of this.runs(text, weight)) {
      const run = font.layout(runText);
      const scale = size / font.unitsPerEm;
      for (const [index, glyph] of run.glyphs.entries()) {
        const position = run.positions[index]!;
        const path = glyph.path.toSVG();
        const baseline = y + (font.ascent - position.yOffset) * scale;
        // All SVG attributes come from trusted layout/font data, never card markup.
        if (path)
          paths.push(
            `<path data-top="${baseline - glyph.bbox.maxY * scale}" data-bottom="${baseline - glyph.bbox.minY * scale}" fill="${color}" transform="translate(${cursor + position.xOffset * scale} ${baseline}) scale(${scale} ${-scale})" d="${path}"/>`,
          );
        cursor += position.xAdvance * scale;
      }
    }
    return paths.join('');
  }
}

export function cardSvg(input: CardInput, fonts: CardFonts, number = 1): string {
  const card = cardSchema.parse(input);
  const layout = layoutCard((text, css) => fonts.measure(text, css), card);
  const header = `${String(number).padStart(3, '0')}  /  ${card.template === 'comparison' ? '표현 비교' : '오늘의 표현'}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="#fff"/><rect x="88" y="83" width="38" height="5" fill="#214de5"/>${fonts.outline(header, 146, 72, 22, 600, '#657080')}${layout.dividerY === null ? '' : `<rect x="88" y="${layout.dividerY}" width="904" height="2" fill="#e3e7ef"/>`}${layout.lines.map((line) => fonts.outline(line.text, line.x, line.y, line.size, line.weight, line.color)).join('')}${fonts.outline('하루 한 표현', 88, 1015, 20, 400, '#7b8492')}</svg>`;
}
