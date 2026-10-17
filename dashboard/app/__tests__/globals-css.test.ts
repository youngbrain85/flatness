// globals.css 전역 규칙 가드. 이 규칙들은 CSS 라서 컴포넌트 테스트가 닿지 않는다(jsdom 은 Tailwind 를 컴파일하지
// 않는다). 아래 셋은 지워지거나 자리가 바뀌어도 어떤 테스트도 실패하지 않았다(변이 실험으로 확인):
//   1. :focus-visible 규칙 하나가 앱 전체의 키보드 포커스(2px ink 외곽선)를 맡는다. @layer base 밖으로 나가면
//      unlayered 규칙이 되어 Tailwind 유틸리티(outline-*)를 항상 이긴다(globals.css 끝의 사고 주석).
//   2. html { color-scheme: dark } 는 스크롤바·날짜 선택기·select 목록 같은 브라우저 기본 부품을 어둡게 그린다.
//   3. @utility drafting-grid 가 없어도 Tailwind 는 모르는 클래스를 조용히 버릴 뿐이라 본문 격자가 소리 없이 사라진다.
// palette.test.ts 처럼 globals.css 를 직접 읽는다. 설명 주석에 "@layer base", ":focus-visible" 같은 글자가 들어 있어서
// 주석부터 걷어 낸다 - 규칙은 지워졌는데 주석만 남아 통과하는 일을 막는다. 줄 끝은 CRLF 체크아웃을 위해 /\r?\n/ 로 맞춘다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAIN_BG } from '@/components/ui/page';

// vitest는 __dirname을 준다(palette.test.ts 와 같은 방식)
const CSS = readFileSync(join(__dirname, '../globals.css'), 'utf8')
  .split(/\r?\n/).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '');

type Block = { body: string; outside: string };

/**
 * header 가 처음 맞는 블록을 찾는다(중괄호 깊이를 센다). header 정규식은 여는 중괄호 `\{` 로 끝나야 한다.
 * body = 중괄호 안쪽, outside = 그 블록 전체(머리말·중괄호 포함)를 잘라 낸 나머지. 없으면 null.
 */
function findBlock(src: string, header: RegExp): Block | null {
  const m = header.exec(src);
  if (!m) return null;
  const bodyStart = m.index + m[0].length;
  let depth = 1;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) {
      return { body: src.slice(bodyStart, i), outside: src.slice(0, m.index) + src.slice(i + 1) };
    }
  }
  return null;
}

function need<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`globals.css 에 ${what} 이(가) 없다`);
  return value;
}

// "a: b; c: d" -> ['a: b', 'c: d'] (공백·줄바꿈을 한 칸으로 줄이고 빈 조각은 버린다)
const decls = (body: string) => body.split(';').map((d) => d.replace(/\s+/g, ' ').trim()).filter(Boolean);

describe('globals.css 전역 규칙 (@layer base)', () => {
  it(':focus-visible 은 @layer base 안에서 2px ink 외곽선 + 2px 간격을 그린다(앱 전체 키보드 포커스를 이 규칙 하나가 맡는다)', () => {
    const base = need(findBlock(CSS, /@layer\s+base\s*\{/), '@layer base 블록');
    const rule = need(findBlock(base.body, /:focus-visible\s*\{/), '@layer base 안의 :focus-visible 규칙');
    expect(decls(rule.body)).toEqual(['outline: 2px solid --theme(--color-ink)', 'outline-offset: 2px']);
  });

  it(':focus-visible 규칙이 @layer base 밖에 따로 없다(layer 밖 규칙은 outline-* 유틸리티와 화면별 포커스 클래스를 덮는다)', () => {
    const base = need(findBlock(CSS, /@layer\s+base\s*\{/), '@layer base 블록');
    // 맨 :focus-visible 선택자만 본다('.btn:focus-visible' 같은 한정 선택자는 전역 규칙이 아니다)
    expect(/(?:^|[\s,}]):focus-visible\s*[{,]/.test(base.outside)).toBe(false);
  });

  it('html { color-scheme: dark } 가 @layer base 안에 있다(스크롤바·날짜 선택기·select 목록 같은 브라우저 부품도 어둡게)', () => {
    const base = need(findBlock(CSS, /@layer\s+base\s*\{/), '@layer base 블록');
    const rule = need(findBlock(base.body, /(?:^|[\s}])html\s*\{/), '@layer base 안의 html 규칙');
    expect(decls(rule.body)).toEqual(['color-scheme: dark']);
  });
});

describe('globals.css @utility drafting-grid (본문 도면 격자)', () => {
  // 격자선 색은 ink 토큰의 7%(스펙 §3, 아트보드 gridBg). palette.test.ts 의 STAGE_GRID 검사처럼 토큰에서 얻어
  // ink 를 바꿀 때 격자색도 같이 정하게 한다.
  function inkRgb(): string {
    const m = CSS.match(/--color-ink:\s*#([0-9a-fA-F]{6})\s*;/);
    if (!m) throw new Error('globals.css 에 --color-ink 토큰이 없다');
    return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).join(', ');
  }

  it('ink 7% 1px 선 두 겹(가로 · 세로) + 가로 4칸 · 세로 3칸(25% 100%, 100% 33.33%)이다', () => {
    const rule = need(findBlock(CSS, /@utility\s+drafting-grid\s*\{/), '@utility drafting-grid');
    const line = `rgba(${inkRgb()}, 0.07) 1px, transparent 1px`;
    expect(decls(rule.body)).toEqual([
      `background-image: linear-gradient(to right, ${line}), linear-gradient(to bottom, ${line})`,
      'background-size: 25% 100%, 100% 33.33%',
    ]);
  });

  it('MAIN_BG 가 쓰는 drafting-grid 와 @utility 이름이 같다(정의가 없으면 Tailwind 가 클래스를 조용히 버린다)', () => {
    const defined = [...CSS.matchAll(/@utility\s+([\w-]+)\s*\{/g)].map((m) => m[1]);
    expect(MAIN_BG.split(/\s+/)).toContain('drafting-grid');
    expect(defined).toContain('drafting-grid');
  });
});
