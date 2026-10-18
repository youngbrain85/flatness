// 캔버스 색 상수(스펙 §3). 캔버스(히트맵·구배·겹쳐보기·대응점)는 CSS 토큰 클래스를 못 쓰므로
// 화면 코드는 hex 를 직접 적지 않고 이 파일의 상수만 쓴다. 값은 app/globals.css @theme 토큰과 같아야 한다
// (lib/domain/__tests__/palette.test.ts 가 globals.css 를 읽어 대조한다).
// 엔진 hex 는 PDF·엔진 PNG 전용이다: 평활도 PDF 색은 labels.ts 의 GRADE_COLOR(워커 대조용 참조표 - 화면은 import 하지
// 않는다), 구배 PNG 색은 엔진 outputs/slope_map.py 가 들고 있다.
import type { Grade, SlopeGrade } from './types';

/** 화면 등급 색: 적합 · 경계 · 보수 · 재시공 · 판정 불가 (= --color-grade-*) */
export const SCREEN_GRADE_COLOR: Record<Grade, string> = {
  pass: '#38d454',
  borderline: '#fad647',
  repair: '#ff8c1f',
  rework: '#ff332e',
  na: '#85817a',
};

/** 구배 5등급(엔진 한글 문자열)도 같은 다섯 색을 쓴다(스펙 §5-11: 구배 캔버스 색은 화면 등급 색) */
export const SCREEN_SLOPE_GRADE_COLOR: Record<SlopeGrade, string> = {
  적합: SCREEN_GRADE_COLOR.pass,
  경계: SCREEN_GRADE_COLOR.borderline,
  보수: SCREEN_GRADE_COLOR.repair,
  재시공: SCREEN_GRADE_COLOR.rework,
  판정불가: SCREEN_GRADE_COLOR.na,
};

/** 검정 스테이지 바탕(= --color-stage) */
export const STAGE_BG = '#000000';
/** 스테이지 격자선: ink 의 10% (아트보드 캔버스 공통) */
export const STAGE_GRID = 'rgba(242, 239, 233, 0.10)';
/** 축 숫자(IBM Plex Mono 11px, = --color-muted) */
export const STAGE_AXIS_TEXT = '#9a9690';
/** 스테이지 위 밝은 선·글자, 최댓값 칸 테두리(= --color-ink) */
export const STAGE_INK = '#f2efe9';
/** 칸 사이 2px 틈(= --color-stage) */
export const CELL_GAP_COLOR = '#000000';
/** 등급 색 칸 위에 쓰는 숫자·화살표(= --color-ground, 아트보드 ScanDone 의 칸 숫자 색) */
export const CELL_INK = '#0a0d1c';
/** 구배 배수구 표시(데이터 색, = --color-drain) */
export const DRAIN_COLOR = '#6fcdeb';
