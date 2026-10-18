// 캔버스 색 상수(palette.ts)와 CSS 토큰(app/globals.css @theme)이 어긋나지 않는지 본다.
// 캔버스는 토큰 클래스를 못 쓰므로 같은 값을 두 곳이 들고 있다 - 한쪽만 고치면 범례(클래스)와
// 칸(캔버스) 색이 갈라진다. globals.css 를 직접 읽어 대조한다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRADE_COLOR } from '../labels';
import { SLOPE_GRADE_TO_GRADE } from '../grade-tone';
import {
  CELL_GAP_COLOR, CELL_INK, DRAIN_COLOR, SCREEN_GRADE_COLOR, SCREEN_SLOPE_GRADE_COLOR,
  STAGE_AXIS_TEXT, STAGE_BG, STAGE_GRID, STAGE_INK,
} from '../palette';
import type { Grade, SlopeGrade } from '../types';

// vitest는 __dirname을 준다(palette-sweep.test.ts 와 같은 방식)
const CSS = readFileSync(join(__dirname, '../../../app/globals.css'), 'utf8');

function token(name: string): string {
  const m = CSS.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`globals.css 에 --color-${name} 토큰이 없다`);
  return m[1].toLowerCase();
}

describe('palette: 캔버스 색 상수 = globals.css 토큰', () => {
  it('화면 등급 색 다섯은 --color-grade-* 와 같고 스펙 §3 값 그대로다', () => {
    expect(SCREEN_GRADE_COLOR).toEqual({
      pass: token('grade-pass'), borderline: token('grade-borderline'), repair: token('grade-repair'),
      rework: token('grade-rework'), na: token('grade-na'),
    });
    expect(SCREEN_GRADE_COLOR).toEqual({
      pass: '#38d454', borderline: '#fad647', repair: '#ff8c1f', rework: '#ff332e', na: '#85817a',
    });
  });

  it('구배 5등급은 같은 이름 등급의 화면 색이다(SLOPE_GRADE_TO_GRADE 경유)', () => {
    for (const [slope, grade] of Object.entries(SLOPE_GRADE_TO_GRADE) as [SlopeGrade, Grade][]) {
      expect(SCREEN_SLOPE_GRADE_COLOR[slope]).toBe(SCREEN_GRADE_COLOR[grade]);
    }
    // 엔진이 내는 구배 등급 문자열 다섯(engine slope.py: 적합·경계·보수·재시공·판정불가)을 하나도 빠뜨리지 않는다
    expect(Object.keys(SCREEN_SLOPE_GRADE_COLOR).sort()).toEqual(['적합', '경계', '보수', '재시공', '판정불가'].sort());
  });

  it('스테이지·칸·배수구 색은 토큰 값이다', () => {
    expect(STAGE_BG).toBe(token('stage'));
    expect(CELL_GAP_COLOR).toBe(token('stage'));
    expect(STAGE_AXIS_TEXT).toBe(token('muted'));
    expect(STAGE_INK).toBe(token('ink'));
    expect(CELL_INK).toBe(token('ground'));
    expect(DRAIN_COLOR).toBe(token('drain'));
  });

  it('격자선은 ink 의 10% 투명도다(아트보드 캔버스 공통)', () => {
    const ink = token('ink');
    const rgb = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16)).join(', ');
    expect(STAGE_GRID).toBe(`rgba(${rgb}, 0.10)`);
  });

  it('화면 등급 색은 엔진 hex(PDF·엔진 PNG 전용)와 다르다 - 둘을 합치지 않는다', () => {
    for (const g of Object.keys(GRADE_COLOR) as Grade[]) {
      expect(SCREEN_GRADE_COLOR[g]).not.toBe(GRADE_COLOR[g].toLowerCase());
    }
  });
});
