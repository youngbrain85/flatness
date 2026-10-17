// 루트 레이아웃: next/font 네 벌(Montserrat · Noto Sans KR · IBM Plex Mono · Anton)의 CSS 변수 이름이
// globals.css @theme 가 부르는 이름과 같은지, body 가 다크 토큰(ground 바탕 · ink 글자 · 15px)으로
// 칠해지는지, <title> 틀에 em dash 가 없는지 본다. next/font/google 은 빌드 때 글꼴을 내려받으므로
// 테스트에서는 부른 옵션만 기록하는 가짜로 바꾼다. RootLayout 은 동기 함수라 반환 엘리먼트를 그대로 본다
// (<html> 을 jsdom 컨테이너에 그리지 않는다).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

type FontOpts = { variable: string; subsets?: string[]; weight?: string | string[] };
const fontCalls = vi.hoisted(() => ({} as Record<string, FontOpts>));

vi.mock('next/font/google', () => {
  const make = (name: string) => (opts: FontOpts) => {
    fontCalls[name] = opts;
    return { className: `cls-${name}`, variable: `var-${name}`, style: { fontFamily: name } };
  };
  return {
    Montserrat: make('Montserrat'),
    Noto_Sans_KR: make('Noto_Sans_KR'),
    IBM_Plex_Mono: make('IBM_Plex_Mono'),
    Anton: make('Anton'),
  };
});

import RootLayout, { metadata } from '../layout';

const CSS = readFileSync(join(__dirname, '../globals.css'), 'utf8');

describe('RootLayout (다크 C안 글꼴·바탕)', () => {
  it('글꼴 네 벌을 부르고, 각 CSS 변수는 globals.css @theme 가 var() 로 부르는 이름이다', () => {
    expect(Object.keys(fontCalls).sort()).toEqual(['Anton', 'IBM_Plex_Mono', 'Montserrat', 'Noto_Sans_KR']);
    for (const opts of Object.values(fontCalls)) expect(CSS).toContain(`var(${opts.variable})`);
  });

  it('globals.css 글꼴 스택이 부르는 var(--font-…) 는 모두 layout 이 만든 변수다(오타 난 변수는 조용히 대체 글꼴로 떨어진다)', () => {
    const made = Object.values(fontCalls).map((o) => o.variable);
    // 주석을 걷어 낸 코드에서만 센다(설명 주석의 글자로 통과하지 않게)
    const used = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/var\((--font-[\w-]+)\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const v of used) expect(made, `${v} 를 만드는 next/font 가 없다`).toContain(v);
  });

  it('IBM Plex Mono·Anton 은 가변 글꼴이 아니라 weight 를 준다(아트보드: Plex Mono 400·500, Anton 400)', () => {
    expect(fontCalls.IBM_Plex_Mono.weight).toEqual(['400', '500']);
    expect(fontCalls.Anton.weight).toBe('400');
  });

  it('body: 글꼴 변수 네 개 + ground 바탕 · ink 글자 · 15px 본문, 흰 바탕·cs 토큰이 없다', () => {
    const html = RootLayout({ children: <p>본문</p> }) as ReactElement<{
      lang: string; children: ReactElement<{ className: string }>;
    }>;
    expect(html.props.lang).toBe('ko');
    const body = html.props.children.props.className.split(/\s+/);
    for (const c of ['var-Montserrat', 'var-Noto_Sans_KR', 'var-IBM_Plex_Mono', 'var-Anton',
      'min-h-screen', 'bg-ground', 'font-sans', 'text-[15px]', 'text-ink']) {
      expect(body).toContain(c);
    }
    expect(body.some((c) => c === 'bg-white' || c.includes('cs-'))).toBe(false);
  });

  it('<title> 은 "Flatness · 화면 이름" 틀이고 em dash 가 없다(스펙 §9)', () => {
    expect(metadata.title).toEqual({ default: 'Flatness', template: 'Flatness · %s' });
    expect(JSON.stringify(metadata)).not.toContain('\u2014'); // em dash(U+2014)
  });
});

// Task 2: 전역 셸(상단 바·사이드 내비)을 지웠다 - 셸은 화면이 고른다(스펙 §4.3).
describe('RootLayout 셸 (Task 2)', () => {
  it('body 의 자식은 받은 children 그대로다(전역 헤더·사이드 내비를 끼우지 않는다)', () => {
    const page = <p>본문</p>;
    const html = RootLayout({ children: page }) as ReactElement<{
      children: ReactElement<{ children: unknown }>;
    }>;
    expect(html.props.children.props.children).toBe(page);
  });
});
