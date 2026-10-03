// 3D 점군 뷰어 도메인: points3d.bin 리더, 분류, 좌표 복원, 읽기 창 문자열, 색 표
// (스펙 docs/superpowers/specs/2026-10-02-pointcloud-viewer-design.md §5.5, §5.6, §7.2, §7.4, §7.6, §7.9)
//
// 판정 이중화 아님(리트머스): 이 파일은 판정 기준의 허용치·불확도 필드를 읽지 않는다. 임계값은 호출자가
// 0.1mm 정수로 넘겨주는 표시용 값이고, 점을 어느 색으로 칠할지만 정한다. 합격·불합격을 가르지 않는다.
// 이 모듈은 DOM·WebGL 을 건드리지 않고 lib/viz 를 import 하지 않는다.

import type { Stats, Surface } from './types';

// ---- 상수 ----
// 아래 다섯 개는 엔진과 같은 값이어야 한다. engine/tests/test_points3d.py 가 이 파일을 정규식으로 읽어
// 대조하므로 `export const 이름 = 값;` 꼴을 바꾸지 않는다.
export const POINTS3D_MAGIC = 'FP3D';
export const POINTS3D_SCHEMA_VERSION = 1;       // 엔진 outputs/points3d.py SCHEMA_VERSION
export const DEV_NOT_FLOOR = -32768;            // 엔진 core/pointsample.py. 바닥이 아닌 점
export const DEV_NO_DEVIATION = -32767;         // 바닥 구역 안이지만 잔차가 없는 점
export const DEV_UNIT_MM = 0.1;                 // dev 정수 1 = 0.1mm
export const THRESHOLD_Q_MIN = 10;              // 1mm
export const THRESHOLD_Q_MAX = 300;             // 30mm
export const THRESHOLD_Q_STEP = 5;              // 0.5mm
export const EXAGGERATIONS = [1, 10, 50, 100] as const;

/** 좌표 양자화의 최댓값(uint16). local = q * extent_m / Q_MAX */
const Q_MAX = 65535;

export type PointClass = 'flat' | 'depression' | 'protrusion' | 'none';

/** 범례와 읽기 창이 쓰는 분류 이름(§7.12). */
export const POINT_CLASS_LABEL: Record<PointClass, string> = {
  flat: 'FLAT', depression: 'DEPRESSION', protrusion: 'PROTRUSION', none: '편차 없음',
};

// ---- 파일 형식 ----
export interface Points3dMeta {
  schema_version: number;
  n_points: number;
  units: 'm';
  origin_m: [number, number, number];   // 절대 좌표(float64). 파일-로컬 원점의 위치
  extent_m: [number, number, number];   // 축별 범위(m). 0 이상
  deviation: { unit_mm: number; not_floor: number; no_deviation: number };
  sample_cell_m: number;                // 표본 칸 변(m). 점 크기의 근거
  fit_bounds: { min: [number, number, number]; max: [number, number, number] };  // 편차 있는 점의 파일-로컬 범위
  sampling: { method: string; source_points: number; cap: number };              // 정보용. 리더가 검사하지 않는다
  order: 'hash';
}

/** xyz(길이 3n, x·y·z 인터리브)와 dev(길이 n)는 받은 버퍼를 복사 없이 가리키는 뷰다. */
export interface Points3dData { meta: Points3dMeta; xyz: Uint16Array; dev: Int16Array; }

export type Points3dError = 'too_short' | 'bad_magic' | 'bad_header' | 'bad_json'
  | 'unsupported_version' | 'bad_meta' | 'size_mismatch' | 'big_endian_host';

export type Points3dParse = { ok: true; data: Points3dData } | { ok: false; reason: Points3dError };

/** TypedArray 는 호스트 바이트 순서로 읽는다. 파일은 little-endian 이라 호스트도 그래야 한다. */
export function isLittleEndianHost(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isTriple(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber);
}

/** §5.6 리더 규칙 6번. 표에 적힌 항목만 본다(모르는 키는 무시, sampling 은 검사 대상이 아니다). */
function isValidMeta(m: Record<string, unknown>): boolean {
  if (!isFiniteNumber(m.n_points) || !Number.isInteger(m.n_points) || m.n_points < 1) return false;
  if (m.units !== 'm') return false;
  if (!isTriple(m.origin_m)) return false;
  if (!isTriple(m.extent_m) || m.extent_m.some((e) => e < 0)) return false;
  const d = m.deviation;
  if (!isRecord(d) || d.unit_mm !== DEV_UNIT_MM || d.not_floor !== DEV_NOT_FLOOR
    || d.no_deviation !== DEV_NO_DEVIATION) return false;
  if (!isFiniteNumber(m.sample_cell_m) || m.sample_cell_m <= 0) return false;
  const f = m.fit_bounds;
  if (!isRecord(f) || !isTriple(f.min) || !isTriple(f.max)) return false;
  for (let a = 0; a < 3; a++) if (f.min[a] > f.max[a]) return false;
  if (m.order !== 'hash') return false;
  return true;
}

/**
 * points3d.bin 을 읽는다. §5.6 리더 규칙을 표의 순서대로 검사하고 처음 어긴 항목의 사유로 실패한다.
 *
 * 입력을 `instanceof ArrayBuffer` 로 검사하지 않는다. vitest jsdom 에서 readFileSync(...).buffer 는 전역
 * ArrayBuffer 의 인스턴스가 아니어서, 그렇게 짜면 브라우저에서는 통과하고 골든 테스트에서만 거부된다.
 * byteLength 와 DataView·TypedArray 생성만 쓴다.
 */
export function parsePoints3d(
  buf: ArrayBufferLike,
  hostIsLittleEndian: boolean = isLittleEndianHost(),
): Points3dParse {
  const fail = (reason: Points3dError): Points3dParse => ({ ok: false, reason });
  const size = buf.byteLength;

  // 1. 헤더 8바이트
  if (size < 8) return fail('too_short');
  const head = new DataView(buf, 0, 8);

  // 2. magic
  for (let i = 0; i < 4; i++) {
    if (head.getUint8(i) !== POINTS3D_MAGIC.charCodeAt(i)) return fail('bad_magic');
  }

  // 3. json_len (공백 패딩 포함). 본문 시작은 4의 배수다
  const jsonLen = head.getUint32(4, true);
  const bodyStart = 8 + jsonLen;
  if (bodyStart > size || bodyStart % 4 !== 0) return fail('bad_header');

  // 4. JSON 메타. 끝의 공백 패딩은 JSON.parse 가 무시한다
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buf, 8, jsonLen));
    parsed = JSON.parse(text);
  } catch {
    return fail('bad_json');
  }
  if (!isRecord(parsed)) return fail('bad_json');

  // 5. 버전
  if (parsed.schema_version !== POINTS3D_SCHEMA_VERSION) return fail('unsupported_version');

  // 6. 메타 형식
  if (!isValidMeta(parsed)) return fail('bad_meta');
  const meta = parsed as unknown as Points3dMeta;
  const n = meta.n_points;

  // 7. 전체 크기
  if (size !== bodyStart + 8 * n) return fail('size_mismatch');

  // 8. 호스트 바이트 순서(버퍼가 아니라 호스트의 성질)
  if (!hostIsLittleEndian) return fail('big_endian_host');

  // 뷰는 7번을 통과한 뒤에 만든다. 본문 시작이 4의 배수이고 6n 이 짝수라 정렬이 맞는다
  return {
    ok: true,
    data: {
      meta,
      xyz: new Uint16Array(buf, bodyStart, 3 * n),
      dev: new Int16Array(buf, bodyStart + 6 * n, n),
    },
  };
}

// ---- 분류와 좌표 복원 ----

/**
 * 점의 분류. 0.1mm 정수끼리 비교한다(§7.4 표). 셰이더가 같은 표를 쓴다.
 * 임계값과 같은 편차는 FLAT 이다(경계 포함). 두 센티널은 구분하지 않고 '편차 없음'이다.
 */
export function classifyDev(d: number, thresholdQ: number): PointClass {
  if (d <= DEV_NO_DEVIATION) return 'none';
  if (d > thresholdQ) return 'protrusion';
  if (d < -thresholdQ) return 'depression';
  return 'flat';
}

/** i번 점의 파일-로컬 좌표(m). local = q * extent_m / 65535 (§5.5) */
export function localOf(data: Points3dData, i: number): [number, number, number] {
  const { xyz, meta } = data;
  const e = meta.extent_m;
  return [
    (xyz[3 * i] * e[0]) / Q_MAX,
    (xyz[3 * i + 1] * e[1]) / Q_MAX,
    (xyz[3 * i + 2] * e[2]) / Q_MAX,
  ];
}

/**
 * i번 점의 절대 좌표(m) = origin_m + local. JS number(float64)로만 계산한다.
 * UTM 급 좌표(수백만 m)는 float32 에 담으면 0.25m 단위로 뭉개지므로 Float32Array·Math.fround 를 거치지 않는다.
 */
export function absoluteOf(data: Points3dData, i: number): [number, number, number] {
  const o = data.meta.origin_m;
  const l = localOf(data, i);
  return [o[0] + l[0], o[1] + l[1], o[2] + l[2]];
}

// ---- 화면 문자열 ----

/** 화면 문구의 음수 부호(U+2212). ASCII 하이픈을 쓰지 않는다(§7.12). */
const MINUS_SIGN = '\u2212';

/** 좌표(m)를 소수 3자리로. 음수 부호는 U+2212, 반올림해 0 이 되는 음수는 부호 없이 적는다. */
function fmtCoordM(v: number): string {
  const s = v.toFixed(3);
  if (!s.startsWith('-')) return s;
  return Number(s) === 0 ? s.slice(1) : MINUS_SIGN + s.slice(1);
}

/**
 * 편차(0.1mm 정수)를 mm 소수 1자리로. 양수 '+', 음수 U+2212, 0 은 부호 없이 '0.0'.
 * 정수에서 직접 만든다(32 -> '+3.2'). 0.1 을 곱한 뒤 반올림하는 연산이 없다.
 */
function fmtDevMm(d: number): string {
  const a = Math.abs(d);
  const body = `${Math.floor(a / 10)}.${a % 10}`;
  if (d > 0) return `+${body}`;
  if (d < 0) return MINUS_SIGN + body;
  return body;
}

/**
 * 읽기 창의 줄(§7.9). 편차 있는 점은 5줄(X, Y, Z, 편차, 분류 이름), 편차 없는 점은 4줄(X, Y, Z, '편차 없음').
 * X·Y·Z 는 절대 좌표이고 Z 는 과장하지 않은 실제 높이다. 컴포넌트는 이 줄을 그대로 그린다.
 */
export function readoutLines(data: Points3dData, i: number, thresholdQ: number): string[] {
  const [x, y, z] = absoluteOf(data, i);
  const lines = [`X ${fmtCoordM(x)} m`, `Y ${fmtCoordM(y)} m`, `Z ${fmtCoordM(z)} m`];
  const d = data.dev[i];
  const cls = classifyDev(d, thresholdQ);
  if (cls === 'none') return [...lines, POINT_CLASS_LABEL.none];
  return [...lines, `편차 ${fmtDevMm(d)} mm`, POINT_CLASS_LABEL[cls]];
}

/** 임계값(0.1mm 정수)의 mm 표기. 70 -> '7', 75 -> '7.5', 63 -> '6.3'. HUD·고지 문구·슬라이더가 쓴다. */
export function fmtThresholdMm(q: number): string {
  return q % 10 === 0 ? String(q / 10) : `${Math.floor(q / 10)}.${q % 10}`;
}

// ---- 색 표 (§7.6) ----
// 뷰어 색의 유일한 출처다. 캔버스는 uniform 과 clearColor 로, DOM 오버레이는 인라인 style 로 이 hex 를 쓴다.
// Tailwind 색 클래스와 globals.css 토큰으로 옮기지 않는다(UI 크롬이 아니라 그림의 색이다).

export type ThemeName = 'dark' | 'light';

/** 색 표의 한 열. 색은 `#rrggbb` hex 문자열, 알파는 0~1. */
export interface Points3dTheme {
  background: string;
  flat: string;
  depression: string;
  protrusion: string;
  none: string;               // 편차 없는 점
  line: string;               // 격자선·축선·읽기 창 테두리의 색. 알파만 다르다
  gridAlpha: number;
  axisAlpha: number;          // 축선. 읽기 창 테두리도 이 값을 쓴다
  text: string;               // 범례 이름, HUD, 읽기 창 본문
  textSecondary: string;      // 축 눈금 숫자, 축 이름, 조작 안내
  readoutBackground: string;
  readoutAlpha: number;
}

export const POINTS3D_THEME: Record<ThemeName, Points3dTheme> = {
  // 검정 배경(기본)
  dark: {
    background: '#000000',
    flat: '#4cc96f',
    depression: '#f5c33b',
    protrusion: '#f06464',
    none: '#4a4f57',
    line: '#ffffff',
    gridAlpha: 0.09,
    axisAlpha: 0.28,
    text: '#f2f4f7',
    textSecondary: '#9aa3ad',
    readoutBackground: '#000000',
    readoutAlpha: 0.8,
  },
  // 밝은 배경(화면 캡처용 전환)
  light: {
    background: '#ffffff',
    flat: '#1e9e50',
    depression: '#b88700',
    protrusion: '#d93636',
    none: '#b4bac2',
    line: '#000716',
    gridAlpha: 0.09,
    axisAlpha: 0.28,
    text: '#000716',
    textSecondary: '#5f6b7a',
    readoutBackground: '#ffffff',
    readoutAlpha: 0.9,
  },
};

/** `#rrggbb` -> [r, g, b] (각 0~1). WebGL uniform 과 clearColor 에 넘길 때 쓴다. */
export function hexToRgb01(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// ---- stats 접근 (스펙 §7.2, §8) ----
// 브라우저가 stats 에서 읽는 것은 아래 두 키뿐이다. 판정 기준 객체는 읽지 않는다.

/** 받을 점 파일 이름. 키가 없거나 목록이 비면 null 이다.
 *  파일명 상수를 TS 에 두지 않는다. 엔진이 stats 에 적은 이름이 곧 fetch 할 이름이다. */
export function points3dFile(stats: Stats): string | null {
  return (stats.points3d_paths ?? [])[0] ?? null;
}

/** 뷰어의 기본 표시 임계값(0.1mm 정수). 정수가 아니면 null, 정수면 슬라이더 범위로 clamp 한다.
 *  슬라이더 눈금(5)의 배수로 맞추지 않는다. 63 은 63 그대로다. */
export function defaultThresholdQ(stats: Stats): number | null {
  const q: unknown = stats.points3d_threshold_q;
  if (typeof q !== 'number' || !Number.isInteger(q)) return null;
  return Math.min(THRESHOLD_Q_MAX, Math.max(THRESHOLD_Q_MIN, q));
}

// ---- 적재 상태 (스펙 §7.3) ----
// Webgl2Support 와 Points3dLoad 를 이 모듈에 두는 이유: lib/domain 이 lib/viz 를 import 하지 않게 한다.

export type Webgl2Support = 'hardware' | 'software' | 'unsupported';

export type Points3dLoad =
  | { status: 'idle' }
  | { status: 'loading'; dir: string }
  | { status: 'ready'; dir: string; data: Points3dData }
  | { status: 'error'; dir: string; reason: 'fetch' | 'format' };

/** 지금 보는 분석(dir)의 적재 상태. 다른 분석의 상태가 남아 있으면 idle 로 본다.
 *  분석을 바꿔도 상위 state 가 그대로 남으므로, 이 비교가 없으면 이전 분석의 점이 새 분석 화면에 나온다. */
export function loadFor(load: Points3dLoad, dir: string | null): Points3dLoad {
  if (load.status !== 'idle' && load.dir !== dir) return { status: 'idle' };
  return load;
}

// ---- 3D 탭 모드 결정 (스펙 §7.11 분기표) ----

export type Preview3dMode = 'wall' | 'import' | 'no_data' | 'software_prompt' | 'loading' | 'viewer'
  | 'error_stats' | 'error_fetch' | 'error_format' | 'error_webgl' | 'error_context';

export interface Preview3dInput {
  surface: Surface;                    // analysis.surface
  isImport: boolean;                   // isExternalImport(...)
  dir: string | null;                  // analysis.artifacts_dir (지금 보는 분석)
  file: string | null;                 // points3dFile(stats)
  thresholdQ: number | null;           // defaultThresholdQ(stats)
  support: Webgl2Support | null;       // null = 아직 탐지 전(또는 다시 탐지하는 중)
  optedIn: boolean;                    // 소프트웨어 렌더에서 "3D로 보기"를 눌렀는가
  load: Points3dLoad;                  // 상위 state 그대로. 함수 안에서 loadFor(load, dir) 로 읽는다
  rendererFailed: boolean;             // createRenderer 가 null 을 돌려줬는가
  contextLost: boolean;                // 컨텍스트 손실이 3초 안에 복구되지 않았는가
}

/** 분기표 1~4행: 뷰어 대상이 아닌 분석이면 그 모드, 뷰어 대상이면 null.
 *  이 네 경우에는 WebGL2 탐지도 fetch 도 하지 않는다. */
function nonViewerMode(input: Preview3dInput): 'wall' | 'import' | 'no_data' | 'error_stats' | null {
  if (input.surface === 'wall') return 'wall';                       // 1행
  if (input.isImport) return 'import';                               // 2행
  if (input.dir === null || input.file === null) return 'no_data';   // 3행
  if (input.thresholdQ === null) return 'error_stats';               // 4행. 9행(error_format)과 달리 다시 시도가 없다
  return null;
}

/** 분기표를 위에서부터 차례로 검사해 처음 맞는 행의 모드를 돌려준다. 행의 순서가 곧 우선순위다. */
export function resolvePreview3dMode(input: Preview3dInput): Preview3dMode {
  const early = nonViewerMode(input);
  if (early !== null) return early;                                                     // 1~4행
  if (input.support === null) return 'loading';                                         // 5행. load 상태와 무관하다
  if (input.support === 'unsupported' || input.rendererFailed) return 'error_webgl';    // 6행
  if (input.support === 'software' && !input.optedIn) return 'software_prompt';         // 7행
  const current = loadFor(input.load, input.dir);                                       // 표의 L
  if (current.status === 'error') {
    return current.reason === 'fetch' ? 'error_fetch' : 'error_format';                 // 8·9행
  }
  if (input.contextLost) return 'error_context';                                        // 10행
  if (current.status === 'ready') return 'viewer';                                      // 12행
  return 'loading';                                                                     // 11행(idle 또는 loading)
}

// ---- 탐지·적재 요청 여부 (스펙 §7.3 의 2·3번) ----

/** WebGL2 탐지를 해야 하는가. 뷰어 대상(1~4행이 아님)이고 아직 탐지하지 않았을 때만 true. */
export function shouldProbe(input: Preview3dInput): boolean {
  return nonViewerMode(input) === null && input.support === null;
}

/** 점 파일을 받아 달라고 상위에 요청해야 하는가.
 *  모드가 loading 이어도 탐지 전(5행)이면 요청하지 않는다. 소프트웨어 렌더는 "3D로 보기" 전(7행)에 받지 않는다. */
export function shouldRequestLoad(input: Preview3dInput): boolean {
  return resolvePreview3dMode(input) === 'loading'
    && input.support !== null
    && loadFor(input.load, input.dir).status === 'idle';
}
