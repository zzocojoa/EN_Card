import type { CardInput } from '../../src/shared/model';

// Natural, schema-valid review counterexample: spans many Korean font pages.
export const atlasCoverageCard: CardInput = {
  template: 'comparison',
  base_expression: 'Be thorough',
  base_meaning_ko: '“작은 것부터 큰 것까지 빠짐없이 모두 살펴봐”',
  expression: 'Leave no stone unturned',
  meaning_ko: '“크고 작은 집까지 가능한 모든 방법을 써서 꼼꼼히 찾아봐”',
  example_en: '“Leave no stone unturned,” she said.',
  example_ko: '“좋은 곳을 찾으려면 작은 단서도 놓치지 말고 꼼꼼히 살펴봐.”',
  note_ko:
    '“돌 하나도 뒤집지 않은 채 두지 않는다”에서 나온 표현으로, 크고 작은 것도 꼼꼼히 살펴봐요.',
};

export const fixtures: Record<string, CardInput> = {
  expression: {
    template: 'expression',
    expression: 'Take your time',
    meaning_ko: '서두르지 말고 천천히 해',
    example_en: 'Take your time. We can leave later.',
    example_ko: '천천히 해. 우리는 나중에 출발해도 돼.',
    note_ko: '상대에게 서두르지 않아도 된다고 말할 때 사용',
  },
  comparison: {
    template: 'comparison',
    base_expression: "Don't rush",
    base_meaning_ko: '서두르지 마',
    expression: 'Take your time',
    meaning_ko: '천천히 해도 괜찮아',
    example_en: 'Take your time choosing a souvenir.',
    example_ko: '기념품은 천천히 골라도 괜찮아.',
  },
  long: {
    template: 'expression',
    expression: 'Could you point me in the right direction?',
    meaning_ko: '어느 쪽으로 가야 하는지 알려 주시겠어요?',
    example_en: '“Excuse me,” she said.\n“Could you point me in the right direction?”',
    example_ko: '그녀는 “실례합니다.\n어느 쪽으로 가야 하는지 알려 주시겠어요?”라고 말했다.',
  },
  long_comparison: {
    template: 'comparison',
    base_expression: 'Can you help me?',
    base_meaning_ko: '도와줄 수 있나요?',
    expression: 'Could you point me in the right direction?',
    meaning_ko: '어느 쪽으로 가야 하는지 알려 주시겠어요?',
    example_en: 'Could you point me in the right direction?\nI am looking for the station.',
    example_ko: '어느 쪽으로 가야 하는지 알려 주시겠어요?\n역을 찾고 있어요.',
  },
};
