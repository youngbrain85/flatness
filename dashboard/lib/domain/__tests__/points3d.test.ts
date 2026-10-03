// points3d.bin 리더·분류·좌표 복원·읽기 창 문자열·색 표
// (스펙 2026-10-02-pointcloud-viewer-design.md §5.5, §5.6, §7.4, §7.6, §7.9)
//
// 골든 파일(engine/tests/fixtures/points3d_golden.bin)은 엔진이 쓴 것을 그대로 읽는다(pytest 와 공용).
// 아래 기대값은 골든 표본의 정의(engine/tests/fixtures/points3d_golden.py)를 손으로 옮긴 표에서 나온다.
// 구현이나 파이썬 출력을 복사한 값이 아니다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEV_NO_DEVIATION, DEV_NOT_FLOOR, DEV_UNIT_MM, EXAGGERATIONS, POINT_CLASS_LABEL, POINTS3D_MAGIC,
  POINTS3D_SCHEMA_VERSION, POINTS3D_THEME, THRESHOLD_Q_MAX, THRESHOLD_Q_MIN, THRESHOLD_Q_STEP,
  absoluteOf, classifyDev, fmtThresholdMm, hexToRgb01, isLittleEndianHost, localOf, parsePoints3d,
  readoutLines,
} from '../points3d';
import type { PointClass, Points3dData, Points3dError } from '../points3d';
import { defaultThresholdQ, loadFor, points3dFile } from '../points3d';
import type { Points3dLoad } from '../points3d';
import { resolvePreview3dMode } from '../points3d';
import type { Preview3dInput, Preview3dMode } from '../points3d';
import { shouldProbe, shouldRequestLoad } from '../points3d';

// vitest 는 __dirname 을 준다. __tests__ -> domain -> lib -> dashboard -> 저장소 루트
const GOLDEN_PATH = join(__dirname, '../../../../engine/tests/fixtures/points3d_golden.bin');

// ---- 골든 표본의 정의(손으로 옮긴 표) ----
const ORIGIN_ABS = [254012.3371, 4180044.9126, 31.4802]; // 표본의 origin_abs (UTM 급 대좌표)
const MN = [0.5, 0.25, 0.125];                            // 표본 로컬 좌표의 최솟값
const EXT = [4.0, 2.5, 0.3125];                           // 축별 범위. 셋이 서로 달라 축 전치 변이가 죽는다
// 행 = 점, 열 = qx, qy, qz. 258 = 0x0102, 772 = 0x0304, 1286 = 0x0506 (상·하위 바이트가 다르다)
const Q: [number, number, number][] = [
  [0, 0, 0],
  [65535, 65535, 4096],
  [258, 772, 1286],
  [32768, 16384, 8192],
  [1, 65534, 2],
  [40000, 20000, 10000],
  [12345, 54321, 23456],
  [100, 200, 65535],
  [50000, 60000, 300],
  [65280, 255, 4660],
  [4660, 43981, 291],
  [21845, 43690, 13107],
];
const DEV = [0, 32, -105, 70, 71, -70, -71, -32768, -32767, 32767, -32766, 1];
const JSON_LEN = 384;   // 패딩 전 382바이트 + 공백 2바이트
const FILE_SIZE = 488;  // 8 + 384 + 8 * 12

/** 골든 파일을 새 ArrayBuffer 로 읽는다. 작은 Buffer 는 풀링된 ArrayBuffer 의 임의 오프셋을 가리키므로 반드시 잘라 낸다. */
function golden(): ArrayBufferLike {
  const buf = readFileSync(GOLDEN_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** 골든의 바이트 사본(변조용). */
function goldenBytes(): Uint8Array {
  return new Uint8Array(golden());
}

/** 메타 JSON 문자열과 본문 바이트로 파일을 조립한다(공백 패딩, little-endian json_len). */
function buildFile(json: string, body: Uint8Array): ArrayBufferLike {
  const js = new TextEncoder().encode(json);
  const pad = (4 - ((8 + js.length) % 4)) % 4;
  const out = new Uint8Array(8 + js.length + pad + body.length);
  out.set([0x46, 0x50, 0x33, 0x44], 0); // 'FP3D'
  new DataView(out.buffer).setUint32(4, js.length + pad, true);
  out.set(js, 8);
  out.fill(0x20, 8 + js.length, 8 + js.length + pad);
  out.set(body, 8 + js.length + pad);
  return out.buffer;
}

type Json = Record<string, unknown>;

/** 골든의 메타만 고쳐 다시 조립한다. 본문은 그대로라 크기 검사(7번)에는 걸리지 않는다. */
function withMeta(edit: (m: Json) => void): ArrayBufferLike {
  const src = goldenBytes();
  const meta = JSON.parse(new TextDecoder().decode(src.subarray(8, 8 + JSON_LEN))) as Json;
  edit(meta);
  return buildFile(JSON.stringify(meta), src.subarray(8 + JSON_LEN));
}

/** 골든의 본문(96바이트)에 임의의 메타 문자열을 붙인다. */
function withRawMeta(json: string): ArrayBufferLike {
  return buildFile(json, goldenBytes().subarray(8 + JSON_LEN));
}

function parseOk(buf: ArrayBufferLike): Points3dData {
  const r = parsePoints3d(buf);
  if (!r.ok) throw new Error(`parse 실패: ${r.reason}`);
  return r.data;
}

function reasonOf(buf: ArrayBufferLike, hostIsLittleEndian?: boolean): Points3dError | 'ok' {
  const r = hostIsLittleEndian === undefined ? parsePoints3d(buf) : parsePoints3d(buf, hostIsLittleEndian);
  return r.ok ? 'ok' : r.reason;
}

/** 읽기 창·복원 테스트용 한 점짜리 데이터(파일을 거치지 않는다). */
function onePoint(origin: [number, number, number], dev: number): Points3dData {
  return {
    meta: {
      schema_version: 1, n_points: 1, units: 'm', origin_m: origin, extent_m: [1, 1, 1],
      deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
      sample_cell_m: 0.01, fit_bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      sampling: { method: 'cell min-hash stratified', source_points: 1, cap: 500000 }, order: 'hash',
    },
    xyz: new Uint16Array([0, 0, 0]),
    dev: new Int16Array([dev]),
  };
}

describe('상수 (엔진과 맞춘 값은 engine/tests/test_points3d.py 가 대조한다)', () => {
  it('magic·schema version·센티널·단위', () => {
    expect(POINTS3D_MAGIC).toBe('FP3D');
    expect(POINTS3D_SCHEMA_VERSION).toBe(1);
    expect(DEV_NOT_FLOOR).toBe(-32768);
    expect(DEV_NO_DEVIATION).toBe(-32767);
    expect(DEV_UNIT_MM).toBe(0.1);
  });

  it('슬라이더 범위는 1~30mm, 0.5mm 단계(0.1mm 정수)이고 과장 배율은 1/10/50/100 이다', () => {
    expect([THRESHOLD_Q_MIN, THRESHOLD_Q_MAX, THRESHOLD_Q_STEP]).toEqual([10, 300, 5]);
    expect([...EXAGGERATIONS]).toEqual([1, 10, 50, 100]);
  });

  it('분류 이름은 범례·읽기 창 문구 그대로다', () => {
    expect(POINT_CLASS_LABEL).toEqual({
      flat: 'FLAT', depression: 'DEPRESSION', protrusion: 'PROTRUSION', none: '편차 없음',
    });
  });
});

describe('parsePoints3d: 골든 파일', () => {
  it('골든은 488바이트이고 parse 가 성공한다', () => {
    const buf = golden();
    expect(buf.byteLength).toBe(FILE_SIZE);
    expect(reasonOf(buf)).toBe('ok');
  });

  // 죽이는 변이: 메타 필드 누락·이름 오타, origin 을 float32 로 줄이기(4180045.1626 -> 4180045.25)
  it('메타가 골든 표본의 정의와 같다', () => {
    const { meta } = parseOk(golden());
    expect(meta).toEqual({
      schema_version: 1,
      n_points: 12,
      units: 'm',
      origin_m: [254012.8371, 4180045.1626, 31.6052], // origin_abs + MN
      extent_m: [4.0, 2.5, 0.3125],
      deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
      sample_cell_m: 0.0125,
      // 편차 있는 점의 범위. z 최댓값은 6번 점(qz 23456)이다. qz 65535 인 7번 점은 센티널이라 빠진다
      fit_bounds: { min: [0, 0, 0], max: [4.0, 2.5, (23456 * 0.3125) / 65535] },
      sampling: { method: 'cell min-hash stratified', source_points: 12345, cap: 500000 },
      order: 'hash',
    });
  });

  // 죽이는 변이: 본문 오프셋에서 json_len 누락(8 부터 읽으면 JSON 글자가 좌표로 읽힌다),
  //             dev 시작을 6n 이 아니라 3n 으로, xyz 를 Int16 으로(65535 -> -1), dev 를 Uint16 으로(-105 -> 65431)
  it('xyz 와 dev 가 표의 값 그대로다', () => {
    const data = parseOk(golden());
    expect(Array.from(data.xyz)).toEqual(Q.flat());
    expect(Array.from(data.dev)).toEqual(DEV);
  });

  // 죽이는 변이: 버퍼를 복사해 뷰를 만든다(50만 점에서 4MB 사본), 오프셋 계산 오류
  it('뷰는 받은 버퍼를 복사 없이 가리킨다', () => {
    const buf = golden();
    const data = parseOk(buf);
    expect(data.xyz.buffer).toBe(buf);
    expect(data.dev.buffer).toBe(buf);
    expect(data.xyz.byteOffset).toBe(8 + JSON_LEN);             // 392
    expect(data.xyz.length).toBe(36);
    expect(data.dev.byteOffset).toBe(8 + JSON_LEN + 6 * 12);    // 464
    expect(data.dev.length).toBe(12);
  });

  it('모르는 메타 키는 무시하고, 키 순서에 기대지 않는다', () => {
    expect(reasonOf(withMeta((m) => { m.future_key = { a: 1 }; }))).toBe('ok');
    const reversed = withMeta((m) => {
      const entries = Object.entries(m).reverse();
      for (const k of Object.keys(m)) delete m[k];
      for (const [k, v] of entries) m[k] = v;
    });
    const data = parseOk(reversed);
    expect(data.meta.n_points).toBe(12);
    expect(Array.from(data.dev)).toEqual(DEV);
  });
});

describe('localOf / absoluteOf: 좌표 복원 (§5.5)', () => {
  // 죽이는 변이: y·z 전치(범위가 축마다 달라 값이 달라진다), 65535 대신 65536 으로 나누기
  it('localOf 는 q * extent_m / 65535 다(전 점, 전 축)', () => {
    const data = parseOk(golden());
    for (let i = 0; i < 12; i++) {
      const got = localOf(data, i);
      for (let a = 0; a < 3; a++) {
        expect(Math.abs(got[a] - (Q[i][a] * EXT[a]) / 65535)).toBeLessThan(1e-12);
      }
    }
  });

  // 손 계산: 32768*4/65535 = 2 + 2/65535, 16384*2.5/65535 = 0.625 + 0.625/65535,
  //          8192*0.3125/65535 = 0.0390625 + 0.0390625/65535
  it('3번 점 (32768, 16384, 8192) 의 로컬 좌표', () => {
    const [x, y, z] = localOf(parseOk(golden()), 3);
    expect(x).toBeCloseTo(2.0000305180, 9);
    expect(y).toBeCloseTo(0.6250095369, 9);
    expect(z).toBeCloseTo(0.0390630961, 9);
  });

  it('양 끝값: q = 0 은 0, q = 65535 는 축 범위 그대로', () => {
    const data = parseOk(golden());
    expect(localOf(data, 0)).toEqual([0, 0, 0]);
    const p1 = localOf(data, 1);
    expect(p1[0]).toBe(4.0);
    expect(p1[1]).toBe(2.5);
    expect(localOf(data, 7)[2]).toBe(0.3125);
  });

  // 죽이는 변이: origin 을 float32 로 다루기(y 축 4180045.1626 은 float32 에서 0.25 단위로 뭉개진다),
  //             origin_m 을 더하지 않기, y·z 전치
  it('absoluteOf 는 origin_abs + MN + local 이고 1e-6 m 이내다(전 점, 전 축)', () => {
    const data = parseOk(golden());
    for (let i = 0; i < 12; i++) {
      const got = absoluteOf(data, i);
      for (let a = 0; a < 3; a++) {
        const want = ORIGIN_ABS[a] + MN[a] + (Q[i][a] * EXT[a]) / 65535;
        expect(Math.abs(got[a] - want)).toBeLessThan(1e-6);
      }
    }
  });

  // 손 계산: x = 254012.3371 + 0.5 + 4.0, y = 4180044.9126 + 0.25 + 2.5, z = 31.4802 + 0.125 + 1280/65535
  it('1번 점 (65535, 65535, 4096) 의 절대 좌표', () => {
    const [x, y, z] = absoluteOf(parseOk(golden()), 1);
    expect(Math.abs(x - 254016.8371)).toBeLessThan(1e-6);
    expect(Math.abs(y - 4180047.6626)).toBeLessThan(1e-6);
    expect(Math.abs(z - 31.6247315)).toBeLessThan(1e-6);
  });
});

describe('parsePoints3d: 실패 사유 8종 (§5.6 리더 규칙)', () => {
  it('1. too_short: 8바이트 미만', () => {
    expect(reasonOf(new ArrayBuffer(0))).toBe('too_short');
    expect(reasonOf(golden().slice(0, 7))).toBe('too_short');
  });

  it('2. bad_magic: 앞 4바이트가 FP3D 가 아니다(한 글자만 달라도, 소문자여도)', () => {
    for (const idx of [0, 1, 2, 3]) {
      const b = goldenBytes();
      b[idx] ^= 0x20; // 대소문자 비트를 뒤집는다(F -> f, 3 -> 0x13)
      expect(reasonOf(b.buffer)).toBe('bad_magic');
    }
  });

  it('3. bad_header: 8 + json_len 이 파일보다 크다(RangeError 를 던지지 않는다)', () => {
    const b = goldenBytes();
    new DataView(b.buffer).setUint32(4, 0xfffffff8, true);
    expect(reasonOf(b.buffer)).toBe('bad_header');
    const c = goldenBytes();
    new DataView(c.buffer).setUint32(4, FILE_SIZE - 8 + 4, true); // 파일 끝을 4바이트 넘긴다(4의 배수는 유지)
    expect(reasonOf(c.buffer)).toBe('bad_header');
  });

  it('3. bad_header: 8 + json_len 이 4의 배수가 아니다', () => {
    const b = goldenBytes();
    new DataView(b.buffer).setUint32(4, JSON_LEN - 1, true); // 383: 파일 안이지만 391 은 4의 배수가 아니다
    expect(reasonOf(b.buffer)).toBe('bad_header');
  });

  it('4. bad_json: JSON 이 깨졌다', () => {
    const b = goldenBytes();
    b[8] = 0x78; // 여는 중괄호를 x 로
    expect(reasonOf(b.buffer)).toBe('bad_json');
  });

  it('4. bad_json: UTF-8 이 아니다', () => {
    const b = goldenBytes();
    const at = 8 + JSON_LEN - 2 - 3; // 패딩 2바이트 앞의 `h"}` 에서 h (order 값의 마지막 글자)
    expect(String.fromCharCode(b[at])).toBe('h');
    b[at] = 0xff;
    expect(reasonOf(b.buffer)).toBe('bad_json');
  });

  it.each([['배열', '[1,2,3]'], ['숫자', '12'], ['null', 'null'], ['문자열', '"FP3D"']])(
    '4. bad_json: 결과가 객체가 아니다 (%s)',
    (_name, json) => {
      expect(reasonOf(withRawMeta(json))).toBe('bad_json');
    },
  );

  it.each<[string, (m: Json) => void]>([
    ['2', (m) => { m.schema_version = 2; }],
    ['0', (m) => { m.schema_version = 0; }],
    ['문자열 "1"', (m) => { m.schema_version = '1'; }],
    ['키 없음', (m) => { delete m.schema_version; }],
  ])('5. unsupported_version: schema_version 이 %s', (_name, edit) => {
    expect(reasonOf(withMeta(edit))).toBe('unsupported_version');
  });

  // 한 번에 필드 하나만 망가뜨린다. 가드 하나를 지우면 그 행만 죽는다(가드마다 하중이 있다)
  it.each<[string, (m: Json) => void]>([
    ['n_points 0', (m) => { m.n_points = 0; }],
    ['n_points 음수', (m) => { m.n_points = -12; }],
    ['n_points 소수', (m) => { m.n_points = 12.5; }],
    ['n_points 문자열', (m) => { m.n_points = '12'; }],
    ['n_points 없음', (m) => { delete m.n_points; }],
    ['units mm', (m) => { m.units = 'mm'; }],
    ['origin_m 2개', (m) => { m.origin_m = [1, 2]; }],
    ['origin_m 에 null', (m) => { m.origin_m = [1, null, 3]; }],
    ['origin_m 에 문자열', (m) => { m.origin_m = [1, '2', 3]; }],
    ['origin_m 없음', (m) => { delete m.origin_m; }],
    ['extent_m 4개', (m) => { m.extent_m = [4, 2.5, 0.3125, 1]; }],
    ['extent_m 음수', (m) => { m.extent_m = [4, -2.5, 0.3125]; }],
    ['extent_m 배열 아님', (m) => { m.extent_m = 4; }],
    ['deviation 없음', (m) => { delete m.deviation; }],
    ['deviation.unit_mm 1', (m) => { m.deviation = { unit_mm: 1, not_floor: -32768, no_deviation: -32767 }; }],
    ['deviation.not_floor 다름', (m) => { m.deviation = { unit_mm: 0.1, not_floor: -32767, no_deviation: -32767 }; }],
    ['deviation.no_deviation 다름', (m) => { m.deviation = { unit_mm: 0.1, not_floor: -32768, no_deviation: -32768 }; }],
    ['sample_cell_m 0', (m) => { m.sample_cell_m = 0; }],
    ['sample_cell_m 음수', (m) => { m.sample_cell_m = -0.0125; }],
    ['sample_cell_m 문자열', (m) => { m.sample_cell_m = '0.0125'; }],
    ['fit_bounds 없음', (m) => { delete m.fit_bounds; }],
    ['fit_bounds.min 2개', (m) => { m.fit_bounds = { min: [0, 0], max: [4, 2.5, 0.1] }; }],
    ['fit_bounds.max 없음', (m) => { m.fit_bounds = { min: [0, 0, 0] }; }],
    ['fit_bounds x 축 min > max', (m) => { m.fit_bounds = { min: [5, 0, 0], max: [4, 2.5, 0.1] }; }],
    ['fit_bounds z 축 min > max', (m) => { m.fit_bounds = { min: [0, 0, 0.2], max: [4, 2.5, 0.1] }; }],
    ['order 다름', (m) => { m.order = 'cell'; }],
    ['order 없음', (m) => { delete m.order; }],
  ])('6. bad_meta: %s', (_name, edit) => {
    expect(reasonOf(withMeta(edit))).toBe('bad_meta');
  });

  it('6. 경계: 범위 0 인 축(extent_m 0, fit min == max)은 유효하다', () => {
    const buf = withMeta((m) => {
      m.extent_m = [4, 2.5, 0];
      m.fit_bounds = { min: [0, 0, 0], max: [4, 2.5, 0] };
    });
    expect(reasonOf(buf)).toBe('ok');
  });

  // 죽이는 변이: size_mismatch 검사 제거(남는 바이트는 조용히 통과하고, 모자라면 TypedArray 생성이 예외를 던진다)
  it('7. size_mismatch: 본문이 남거나 모자라다', () => {
    const src = goldenBytes();
    const longer = new Uint8Array(FILE_SIZE + 8);
    longer.set(src);
    expect(reasonOf(longer.buffer)).toBe('size_mismatch');
    expect(reasonOf(golden().slice(0, FILE_SIZE - 2))).toBe('size_mismatch');
    expect(reasonOf(golden().slice(0, 8 + JSON_LEN))).toBe('size_mismatch');
  });

  it('7. size_mismatch: n_points 가 본문 길이와 맞지 않는다', () => {
    expect(reasonOf(withMeta((m) => { m.n_points = 11; }))).toBe('size_mismatch');
    expect(reasonOf(withMeta((m) => { m.n_points = 13; }))).toBe('size_mismatch');
  });

  // 호스트의 성질이라 버퍼 변조로는 만들 수 없다. 둘째 인자로 주입한다
  it('8. big_endian_host: 정상 버퍼라도 호스트가 big-endian 이면 거부한다', () => {
    expect(reasonOf(golden(), false)).toBe('big_endian_host');
    expect(reasonOf(golden(), true)).toBe('ok');
  });

  it('isLittleEndianHost: 테스트 호스트(x86·ARM)는 little-endian 이고 둘째 인자의 기본값이 이 값이다', () => {
    expect(isLittleEndianHost()).toBe(true);
    expect(reasonOf(golden())).toBe('ok');
  });

  // 표의 위에서부터 검사하고 처음 어긴 항목의 사유로 실패한다
  it('검사 순서: 두 항목을 함께 어기면 앞 항목의 사유다', () => {
    // 1 < 2: 7바이트이고 magic 도 틀림
    expect(reasonOf(new Uint8Array(7).buffer)).toBe('too_short');
    // 2 < 3: magic 이 틀리고 json_len 도 파일보다 큼
    const a = goldenBytes();
    a[0] = 0x58;
    new DataView(a.buffer).setUint32(4, 0xfffffff8, true);
    expect(reasonOf(a.buffer)).toBe('bad_magic');
    // 3 < 4: json_len 이 4의 배수가 아니고 JSON 도 깨짐
    const b = goldenBytes();
    b[8] = 0x78;
    new DataView(b.buffer).setUint32(4, JSON_LEN - 1, true);
    expect(reasonOf(b.buffer)).toBe('bad_header');
    // 5 < 6: 버전이 다르고 메타도 틀림
    expect(reasonOf(withMeta((m) => { m.schema_version = 2; m.units = 'mm'; }))).toBe('unsupported_version');
    // 6 < 7: 메타가 틀리고 크기도 안 맞음(n_points 0 이면 본문 96바이트가 남는다)
    expect(reasonOf(withMeta((m) => { m.n_points = 0; }))).toBe('bad_meta');
    // 7 < 8: 크기가 안 맞고 호스트도 big-endian
    expect(reasonOf(golden().slice(0, FILE_SIZE - 2), false)).toBe('size_mismatch');
    // 1 < 8
    expect(reasonOf(new ArrayBuffer(3), false)).toBe('too_short');
  });
});

describe('classifyDev: 0.1mm 정수 비교 (§7.4 분류 표)', () => {
  // 죽이는 변이: > 를 >= 로(70 이 PROTRUSION 이 된다), < 를 <= 로(-70 이 DEPRESSION 이 된다),
  //             센티널 가드 제거(두 센티널이 DEPRESSION 이 된다), 센티널 비교를 < 로(-32767 이 DEPRESSION)
  it.each<[number, number, PointClass]>([
    [70, 70, 'flat'],
    [71, 70, 'protrusion'],
    [-70, 70, 'flat'],
    [-71, 70, 'depression'],
    [0, 70, 'flat'],
    [0, 10, 'flat'],
    [-32768, 70, 'none'],
    [-32767, 70, 'none'],
    [-32768, 300, 'none'],
    [-32767, 10, 'none'],
    [-32766, 70, 'depression'],  // 유효 편차의 최솟값(DEV_MIN)은 센티널이 아니다
    [32767, 300, 'protrusion'],
    [32, 30, 'protrusion'],      // 같은 점이 임계값에 따라 달라진다
    [32, 35, 'flat'],
    [-105, 100, 'depression'],
    [-105, 105, 'flat'],
  ])('classifyDev(%i, %i) = %s', (d, t, want) => {
    expect(classifyDev(d, t)).toBe(want);
  });

  it('골든의 점별 분류(T_q = 70)와 분류 수: flat 5 / depression 3 / protrusion 2 / none 2', () => {
    const data = parseOk(golden());
    const classes = Array.from(data.dev, (d) => classifyDev(d, 70));
    // dev: 0, 32, -105, 70, 71, -70, -71, -32768, -32767, 32767, -32766, 1
    expect(classes).toEqual([
      'flat', 'flat', 'depression', 'flat', 'protrusion', 'flat', 'depression',
      'none', 'none', 'protrusion', 'depression', 'flat',
    ]);
    const count = { flat: 0, depression: 0, protrusion: 0, none: 0 };
    for (const c of classes) count[c] += 1;
    expect(count).toEqual({ flat: 5, depression: 3, protrusion: 2, none: 2 });
  });
});

describe('fmtThresholdMm: 0.1mm 정수 -> mm 표기', () => {
  it.each<[number, string]>([
    [70, '7'], [75, '7.5'], [63, '6.3'], [10, '1'], [15, '1.5'], [100, '10'], [105, '10.5'], [300, '30'],
  ])('%i -> %s', (q, want) => {
    expect(fmtThresholdMm(q)).toBe(want);
  });
});

describe('readoutLines: 읽기 창의 줄 (§7.9)', () => {
  const MINUS = '\u2212'; // 음수 부호. ASCII 하이픈(U+002D)이 아니다

  // 손 계산: 1번 점 q = (65535, 65535, 4096), dev = 32
  //   X = 254012.8371 + 4.0 = 254016.8371, Y = 4180045.1626 + 2.5 = 4180047.6626,
  //   Z = 31.6052 + 1280/65535 = 31.6247...
  // 죽이는 변이: 소수 자릿수, origin 을 float32 로(Y 가 4180047.750 이 된다), y·z 전치
  it('편차 있는 점은 5줄: 절대 좌표 소수 3자리, 편차 부호와 소수 1자리, 분류 이름', () => {
    const data = parseOk(golden());
    expect(readoutLines(data, 1, 70)).toEqual([
      'X 254016.837 m',
      'Y 4180047.663 m',
      'Z 31.625 m',
      '편차 +3.2 mm',
      'FLAT',
    ]);
  });

  it('분류 이름은 넘겨준 임계값을 따른다(같은 점, 임계값 3mm 에서는 PROTRUSION)', () => {
    const data = parseOk(golden());
    expect(readoutLines(data, 1, 30)[4]).toBe('PROTRUSION');
    expect(readoutLines(data, 1, 30).slice(0, 4)).toEqual(readoutLines(data, 1, 70).slice(0, 4));
  });

  // 손 계산: 2번 점 q = (258, 772, 1286), dev = -105
  //   X = 254012.8371 + 1032/65535 = 254012.8528..., Y = 4180045.1626 + 1930/65535 = 4180045.1920...,
  //   Z = 31.6052 + 401.875/65535 = 31.6113...
  // 죽이는 변이: 음수 부호를 ASCII 하이픈으로
  it('음수 편차는 U+2212 로 적는다', () => {
    const lines = readoutLines(parseOk(golden()), 2, 70);
    expect(lines).toEqual([
      'X 254012.853 m',
      'Y 4180045.192 m',
      'Z 31.611 m',
      `편차 ${MINUS}10.5 mm`,
      'DEPRESSION',
    ]);
    expect(lines.join('\n')).not.toContain('-');
  });

  // 죽이는 변이: 0 을 +0.0 으로
  it('편차 0 은 부호 없이 0.0', () => {
    const lines = readoutLines(parseOk(golden()), 0, 70);
    expect(lines).toEqual(['X 254012.837 m', 'Y 4180045.163 m', 'Z 31.605 m', '편차 0.0 mm', 'FLAT']);
  });

  // dev 정수에서 직접 만든 문자열이다. 3번 70, 4번 71, 5번 -70, 6번 -71, 9번 32767, 10번 -32766, 11번 1
  it.each<[number, string, string]>([
    [3, '편차 +7.0 mm', 'FLAT'],
    [4, '편차 +7.1 mm', 'PROTRUSION'],
    [5, `편차 ${MINUS}7.0 mm`, 'FLAT'],
    [6, `편차 ${MINUS}7.1 mm`, 'DEPRESSION'],
    [9, '편차 +3276.7 mm', 'PROTRUSION'],
    [10, `편차 ${MINUS}3276.6 mm`, 'DEPRESSION'],
    [11, '편차 +0.1 mm', 'FLAT'],
  ])('골든 %i번 점: %s / %s', (i, devLine, cls) => {
    const lines = readoutLines(parseOk(golden()), i, 70);
    expect(lines).toHaveLength(5);
    expect(lines[3]).toBe(devLine);
    expect(lines[4]).toBe(cls);
  });

  // 죽이는 변이: 부호를 정수부에서 얻기(절댓값 1mm 미만이면 정수부가 0 이라 부호가 사라진다)
  it.each<[number, string]>([
    [-5, `편차 ${MINUS}0.5 mm`], [5, '편차 +0.5 mm'], [-9, `편차 ${MINUS}0.9 mm`], [-10, `편차 ${MINUS}1.0 mm`],
    [1000, '편차 +100.0 mm'],
  ])('dev %i -> %s', (dev, want) => {
    expect(readoutLines(onePoint([0, 0, 0], dev), 0, 70)[3]).toBe(want);
  });

  // 손 계산: 7번 점 q = (100, 200, 65535): X = 254012.8371 + 400/65535 = 254012.8432...,
  //   Y = 4180045.1626 + 500/65535 = 4180045.1702..., Z = 31.6052 + 0.3125 = 31.9177
  // 8번 점 q = (50000, 60000, 300): X = 254012.8371 + 200000/65535 = 254015.8889...,
  //   Y = 4180045.1626 + 150000/65535 = 4180047.4514..., Z = 31.6052 + 93.75/65535 = 31.6066...
  // 죽이는 변이: 센티널을 DEPRESSION 으로 분류(5줄이 되고 "편차 −3276.8 mm" 가 찍힌다)
  it('두 센티널은 각각 4줄이고 마지막 줄이 "편차 없음" 이다(둘을 구분하지 않는다)', () => {
    const data = parseOk(golden());
    expect(readoutLines(data, 7, 70)).toEqual([
      'X 254012.843 m', 'Y 4180045.170 m', 'Z 31.918 m', '편차 없음',
    ]);
    expect(readoutLines(data, 8, 70)).toEqual([
      'X 254015.889 m', 'Y 4180047.451 m', 'Z 31.607 m', '편차 없음',
    ]);
    expect(readoutLines(data, 7, 300)).toHaveLength(4);
  });

  // 스캐너 원점 좌표계에서는 절대 좌표가 음수다. 화면 문구의 음수 부호는 U+2212 다(§7.12)
  it('음수 좌표도 U+2212 로 적고, 반올림해 0 이 되는 음수는 부호 없이 0.000', () => {
    const lines = readoutLines(onePoint([-2.5, -0.0004, -1234.5678], 5), 0, 70);
    expect(lines.slice(0, 3)).toEqual([`X ${MINUS}2.500 m`, 'Y 0.000 m', `Z ${MINUS}1234.568 m`]);
    expect(lines.join('\n')).not.toContain('-');
  });
});

describe('색 표 (§7.6)', () => {
  it('테마는 dark 와 light 둘뿐이다', () => {
    expect(Object.keys(POINTS3D_THEME).sort()).toEqual(['dark', 'light']);
  });

  it('dark: 검정 배경(기본)', () => {
    expect(POINTS3D_THEME.dark).toEqual({
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
    });
  });

  it('light: 밝은 배경(전환 시)', () => {
    expect(POINTS3D_THEME.light).toEqual({
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
    });
  });

  // 죽이는 변이: 채널 순서 바꾸기(r·b 전치), 255 대신 256 으로 나누기
  it('hexToRgb01: #rrggbb -> 0~1 세 값', () => {
    expect(hexToRgb01('#000000')).toEqual([0, 0, 0]);
    expect(hexToRgb01('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb01('#4cc96f')).toEqual([76 / 255, 201 / 255, 111 / 255]);
    expect(hexToRgb01('#000716')).toEqual([0, 7 / 255, 22 / 255]);
    expect(hexToRgb01('#F06464')).toEqual([240 / 255, 100 / 255, 100 / 255]);
  });
});

// ---------------------------------------------------------------------------
// Task 7: stats 접근과 적재 상태 (스펙 §7.2, §7.3, §8)
// ---------------------------------------------------------------------------

// Stats 와 Points3dData 타입은 함수·타입 시그니처에서 꺼낸다.
// 이 파일의 기존 import 와 이름이 겹쳐 중복 선언이 되는 일을 피하기 위해서다.
type TabStats = Parameters<typeof points3dFile>[0];
type TabData = Extract<Points3dLoad, { status: 'ready' }>['data'];

const TAB_DIR = 'artifacts/an1';        // 지금 보는 분석의 artifacts_dir
const TAB_OTHER_DIR = 'artifacts/an2';  // 직전에 보던 다른 분석의 artifacts_dir

// 상태 결정 함수는 점 데이터의 내용을 보지 않는다. 타입만 맞춘 빈 데이터면 충분하다.
const TAB_DATA: TabData = {
  meta: {
    schema_version: 1, n_points: 0, units: 'm',
    origin_m: [0, 0, 0], extent_m: [0, 0, 0],
    deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
    sample_cell_m: 0.0125,
    fit_bounds: { min: [0, 0, 0], max: [0, 0, 0] },
    sampling: { method: 'cell min-hash stratified', source_points: 0, cap: 500000 },
    order: 'hash',
  },
  xyz: new Uint16Array(0),
  dev: new Int16Array(0),
};

/** 평활도 stats 의 최소 픽스처. 적용 기준의 허용치는 7mm 로 고정해 둔다.
 *  표시 임계값 키가 없을 때 구현이 이 값에서 70 을 만들어 내면 아래 null 단언이 죽는다. */
function tabStats(extra: Record<string, unknown> = {}): TabStats {
  return {
    n_cells: 0, n_valid: 0,
    grade_counts: { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 },
    grade_pct: { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 },
    value_max_mm: null, value_min_mm: null, value_mean_mm: null, value_p95_mm: null,
    worst: null, coverage_pct: 0, reduced_span_cells: 0,
    applied_criteria: { name: 'x', source: 'y', span_m: 3, pass_mm: 7, rework_mm: 21, u_mm: 5 },
    warnings: [], zones: [], auto_summary: '',
    meta: { file: 'f', n_points: 0 },
    ...extra,
  } as TabStats;
}

describe('points3dFile (stats 가 준 점 파일 이름)', () => {
  it('키가 없으면 null', () => {
    expect(points3dFile(tabStats())).toBeNull();
  });

  it('빈 목록이면 null', () => {
    expect(points3dFile(tabStats({ points3d_paths: [] }))).toBeNull();
  });

  it('목록의 첫 이름을 그대로 돌려준다(파일명을 코드에 박지 않는다)', () => {
    expect(points3dFile(tabStats({ points3d_paths: ['points3d.bin'] }))).toBe('points3d.bin');
    expect(points3dFile(tabStats({ points3d_paths: ['custom3d.bin', 'other.bin'] }))).toBe('custom3d.bin');
  });

  it('다른 *_paths 키를 대신 읽지 않는다', () => {
    const stats = tabStats({ preview3d_paths: ['preview3d.png'], deviation_paths: ['deviation.png'] });
    expect(points3dFile(stats)).toBeNull();
  });
});

describe('defaultThresholdQ (엔진이 준 표시 임계값, 0.1mm 정수)', () => {
  it.each<[number, number]>([
    [70, 70], [60, 60], [100, 100],          // 탑재 기준 7·6·10mm 는 그대로
    [63, 63],                                // 5 의 배수로 맞추지 않는다
    [10, 10], [300, 300],                    // 범위의 양 끝은 그대로
    [9, 10], [5, 10], [0, 10], [-70, 10],    // 하한 10(1mm)
    [301, 300], [999, 300],                  // 상한 300(30mm)
  ])('points3d_threshold_q 가 %d 이면 %d', (q, expected) => {
    expect(defaultThresholdQ(tabStats({ points3d_threshold_q: q }))).toBe(expected);
  });

  it.each<[string, unknown]>([
    ['소수 7.5', 7.5],
    ['소수 70.5', 70.5],
    ['문자열 "70"', '70'],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('정수가 아니면 null: %s', (_label, q) => {
    expect(defaultThresholdQ(tabStats({ points3d_threshold_q: q }))).toBeNull();
  });

  it('키가 없으면 null 이다(적용 기준의 허용치 7mm 에서 70 을 만들어 내지 않는다)', () => {
    expect(defaultThresholdQ(tabStats())).toBeNull();
  });

  it('적용 기준과 값이 달라도 stats 의 표시 임계값을 그대로 쓴다', () => {
    // 픽스처의 허용치는 7mm(70)인데 키에는 60 을 줬다. 70 이 나오면 다른 필드를 읽은 것이다
    expect(defaultThresholdQ(tabStats({ points3d_threshold_q: 60 }))).toBe(60);
  });
});

describe('loadFor (지금 보는 분석의 적재 상태)', () => {
  const NOT_IDLE: [string, Points3dLoad][] = [
    ['loading', { status: 'loading', dir: TAB_DIR }],
    ['ready', { status: 'ready', dir: TAB_DIR, data: TAB_DATA }],
    ['error', { status: 'error', dir: TAB_DIR, reason: 'fetch' }],
  ];

  it.each(NOT_IDLE)('dir 이 같으면 %s 상태를 그대로(같은 객체) 돌려준다', (_status, load) => {
    expect(loadFor(load, TAB_DIR)).toBe(load);
  });

  it.each(NOT_IDLE)('dir 이 다르면 %s 상태를 idle 로 본다', (_status, load) => {
    expect(loadFor(load, TAB_OTHER_DIR)).toEqual({ status: 'idle' });
  });

  it.each(NOT_IDLE)('지금 분석의 dir 이 null 이면 %s 상태를 idle 로 본다', (_status, load) => {
    expect(loadFor(load, null)).toEqual({ status: 'idle' });
  });

  it('idle 은 dir 과 무관하게 그대로다', () => {
    const idle: Points3dLoad = { status: 'idle' };
    expect(loadFor(idle, TAB_DIR)).toBe(idle);
    expect(loadFor(idle, null)).toBe(idle);
  });

  it('입력 객체를 바꾸지 않는다', () => {
    const load: Points3dLoad = { status: 'ready', dir: TAB_DIR, data: TAB_DATA };
    loadFor(load, TAB_OTHER_DIR);
    expect(load).toEqual({ status: 'ready', dir: TAB_DIR, data: TAB_DATA });
  });
});

// ---------------------------------------------------------------------------
// Task 7: 3D 탭 모드 결정 (스펙 §7.11 분기표)
// ---------------------------------------------------------------------------

const TAB_IDLE: Points3dLoad = { status: 'idle' };
const TAB_LOADING: Points3dLoad = { status: 'loading', dir: TAB_DIR };
const TAB_READY: Points3dLoad = { status: 'ready', dir: TAB_DIR, data: TAB_DATA };
const TAB_FETCH_ERROR: Points3dLoad = { status: 'error', dir: TAB_DIR, reason: 'fetch' };
const TAB_FORMAT_ERROR: Points3dLoad = { status: 'error', dir: TAB_DIR, reason: 'format' };

/** 기준 입력: 뷰어 대상인 바닥 분석, 하드웨어 가속, 지금 분석의 점 데이터가 준비됨. 12행(viewer)이다.
 *  각 테스트는 여기에 그 행의 조건만 덮어쓴다. 기준이 viewer 이므로 모드가 달라지면 덮어쓴 조건 때문이다. */
function tabInput(over: Partial<Preview3dInput> = {}): Preview3dInput {
  return {
    surface: 'floor', isImport: false, dir: TAB_DIR, file: 'points3d.bin', thresholdQ: 70,
    support: 'hardware', optedIn: false, load: TAB_READY,
    rendererFailed: false, contextLost: false,
    ...over,
  };
}

type TabRow = [string, Partial<Preview3dInput>, Preview3dMode];

// 각 행의 조건만 만족하는 최소 입력(§7.11 표 12행. 조건이 '또는'인 행은 갈래마다 한 줄)
const TAB_ROWS: TabRow[] = [
  ['1행: 벽면 분석', { surface: 'wall' }, 'wall'],
  ['2행: 임포트 분석', { isImport: true }, 'import'],
  ['3행: dir 없음', { dir: null }, 'no_data'],
  ['3행: 점 파일 없음', { file: null }, 'no_data'],
  ['4행: 표시 임계값 없음', { thresholdQ: null }, 'error_stats'],
  ['5행: 탐지 전(load 는 ready)', { support: null }, 'loading'],
  ['6행: WebGL2 불가', { support: 'unsupported' }, 'error_webgl'],
  ['6행: 렌더러 생성 실패', { rendererFailed: true }, 'error_webgl'],
  ['7행: 소프트웨어 렌더, 선택 전(load 는 ready)', { support: 'software', optedIn: false }, 'software_prompt'],
  ['8행: fetch 오류', { load: TAB_FETCH_ERROR }, 'error_fetch'],
  ['9행: 형식 오류', { load: TAB_FORMAT_ERROR }, 'error_format'],
  ['10행: 컨텍스트 손실', { contextLost: true }, 'error_context'],
  ['11행: 적재 전(idle)', { load: TAB_IDLE }, 'loading'],
  ['11행: 받는 중(loading)', { load: TAB_LOADING }, 'loading'],
  ['12행: 하드웨어 + ready', {}, 'viewer'],
  ['12행: 소프트웨어 렌더 + 선택함 + ready', { support: 'software', optedIn: true }, 'viewer'],
  ['12행: 하드웨어는 optedIn 과 무관', { optedIn: true }, 'viewer'],
];

// 우선순위: 위 행의 조건과 아래 행의 조건을 함께 만족하면 위 행이 이긴다
const TAB_PRIORITY: TabRow[] = [
  ['1 > 2: 벽면이 임포트보다 먼저', { surface: 'wall', isImport: true }, 'wall'],
  ['1 > 3·4', { surface: 'wall', dir: null, file: null, thresholdQ: null }, 'wall'],
  ['2 > 3', { isImport: true, dir: null, file: null }, 'import'],
  ['2 > 4', { isImport: true, thresholdQ: null }, 'import'],
  ['3 > 4', { file: null, thresholdQ: null }, 'no_data'],
  ['3 > 5', { dir: null, support: null }, 'no_data'],
  ['4 > 5', { thresholdQ: null, support: null }, 'error_stats'],
  ['4 > 6', { thresholdQ: null, support: 'unsupported' }, 'error_stats'],
  ['4 > 9: 표시 임계값 없음은 형식 오류와 다른 모드', { thresholdQ: null, load: TAB_FORMAT_ERROR }, 'error_stats'],
  ['5 > 6', { support: null, rendererFailed: true }, 'loading'],
  ['5 > 8', { support: null, load: TAB_FETCH_ERROR }, 'loading'],
  ['5 > 10', { support: null, contextLost: true }, 'loading'],
  ['6 > 7: 렌더러 실패가 선택 안내보다 먼저', { support: 'software', optedIn: false, rendererFailed: true }, 'error_webgl'],
  ['6 > 8', { support: 'unsupported', load: TAB_FETCH_ERROR }, 'error_webgl'],
  ['6 > 10', { rendererFailed: true, contextLost: true }, 'error_webgl'],
  ['7 > 8', { support: 'software', optedIn: false, load: TAB_FETCH_ERROR }, 'software_prompt'],
  ['7 > 9', { support: 'software', optedIn: false, load: TAB_FORMAT_ERROR }, 'software_prompt'],
  ['7 > 10', { support: 'software', optedIn: false, contextLost: true }, 'software_prompt'],
  ['7 > 11', { support: 'software', optedIn: false, load: TAB_IDLE }, 'software_prompt'],
  ['8 > 10: fetch 오류가 컨텍스트 손실보다 먼저', { load: TAB_FETCH_ERROR, contextLost: true }, 'error_fetch'],
  ['9 > 10', { load: TAB_FORMAT_ERROR, contextLost: true }, 'error_format'],
  ['10 > 11(idle)', { contextLost: true, load: TAB_IDLE }, 'error_context'],
  ['10 > 11(loading)', { contextLost: true, load: TAB_LOADING }, 'error_context'],
];

describe('resolvePreview3dMode (§7.11 분기표)', () => {
  it.each(TAB_ROWS)('%s', (_label, over, expected) => {
    expect(resolvePreview3dMode(tabInput(over))).toBe(expected);
  });

  it('표의 입력이 11개 모드를 전부 지난다', () => {
    const seen = new Set(TAB_ROWS.map((row) => resolvePreview3dMode(tabInput(row[1]))));
    expect([...seen].sort()).toEqual([
      'error_context', 'error_fetch', 'error_format', 'error_stats', 'error_webgl',
      'import', 'loading', 'no_data', 'software_prompt', 'viewer', 'wall',
    ]);
  });

  it.each(TAB_PRIORITY)('우선순위 %s', (_label, over, expected) => {
    expect(resolvePreview3dMode(tabInput(over))).toBe(expected);
  });

  it.each<[string, Points3dLoad]>([
    ['ready', { status: 'ready', dir: TAB_OTHER_DIR, data: TAB_DATA }],
    ['fetch 오류', { status: 'error', dir: TAB_OTHER_DIR, reason: 'fetch' }],
    ['형식 오류', { status: 'error', dir: TAB_OTHER_DIR, reason: 'format' }],
  ])('다른 분석의 %s 상태는 idle 로 읽는다: loading', (_label, load) => {
    expect(resolvePreview3dMode(tabInput({ load }))).toBe('loading');
  });
});

// ---------------------------------------------------------------------------
// Task 7: 탐지·적재 요청 여부 (스펙 §7.2, §7.3 의 2·3번)
// ---------------------------------------------------------------------------

describe('shouldProbe · shouldRequestLoad (탐지와 적재 요청 여부)', () => {
  // 하중 확인용 대조군. 1~4행 조건이 없을 때 아래 두 입력은 각각 true 여야 한다.
  // 이 전제가 깨지면 '뷰어 대상이 아니면 false' 단언이 가드 없이도 통과해 버린다.
  const PROBE_WOULD_FIRE: Partial<Preview3dInput> = { support: null, load: TAB_IDLE };
  const REQUEST_WOULD_FIRE: Partial<Preview3dInput> = { support: 'hardware', load: TAB_IDLE };

  it('대조군: 뷰어 대상이고 탐지 전이면 probe, 하드웨어 + idle 이면 request', () => {
    expect(shouldProbe(tabInput(PROBE_WOULD_FIRE))).toBe(true);
    expect(shouldRequestLoad(tabInput(REQUEST_WOULD_FIRE))).toBe(true);
  });

  it.each<[string, Partial<Preview3dInput>]>([
    ['1행 벽면', { surface: 'wall' }],
    ['2행 임포트', { isImport: true }],
    ['3행 dir 없음', { dir: null }],
    ['3행 점 파일 없음', { file: null }],
    ['4행 표시 임계값 없음', { thresholdQ: null }],
  ])('뷰어 대상이 아니면 탐지도 요청도 하지 않는다: %s', (_label, over) => {
    expect(shouldProbe(tabInput({ ...PROBE_WOULD_FIRE, ...over }))).toBe(false);
    expect(shouldRequestLoad(tabInput({ ...PROBE_WOULD_FIRE, ...over }))).toBe(false);
    expect(shouldProbe(tabInput({ ...REQUEST_WOULD_FIRE, ...over }))).toBe(false);
    expect(shouldRequestLoad(tabInput({ ...REQUEST_WOULD_FIRE, ...over }))).toBe(false);
  });

  it.each<[string, Points3dLoad]>([
    ['idle', TAB_IDLE],
    ['loading', TAB_LOADING],
    ['ready', TAB_READY],
    ['fetch 오류', TAB_FETCH_ERROR],
    ['형식 오류', TAB_FORMAT_ERROR],
  ])('탐지 전(support null)에는 probe 만 true 다: load %s', (_label, load) => {
    expect(shouldProbe(tabInput({ support: null, load }))).toBe(true);
    expect(shouldRequestLoad(tabInput({ support: null, load }))).toBe(false);
  });

  it.each<[Preview3dInput['support']]>([['hardware'], ['software'], ['unsupported']])(
    '탐지가 끝났으면(%s) 다시 탐지하지 않는다',
    (support) => {
      expect(shouldProbe(tabInput({ support, load: TAB_IDLE }))).toBe(false);
      expect(shouldProbe(tabInput({ support, load: TAB_READY }))).toBe(false);
    },
  );

  it('소프트웨어 렌더는 "3D로 보기" 전에는 요청하지 않고 누른 뒤에 요청한다', () => {
    expect(shouldRequestLoad(tabInput({ support: 'software', optedIn: false, load: TAB_IDLE }))).toBe(false);
    expect(shouldRequestLoad(tabInput({ support: 'software', optedIn: true, load: TAB_IDLE }))).toBe(true);
  });

  it.each<[string, Points3dLoad]>([
    ['loading', TAB_LOADING],
    ['ready', TAB_READY],
    ['fetch 오류', TAB_FETCH_ERROR],
    ['형식 오류', TAB_FORMAT_ERROR],
  ])('지금 분석의 적재 상태가 %s 이면 요청하지 않는다', (_label, load) => {
    expect(shouldRequestLoad(tabInput({ support: 'hardware', load }))).toBe(false);
  });

  it.each<[string, Partial<Preview3dInput>]>([
    ['WebGL2 불가', { support: 'unsupported' }],
    ['렌더러 생성 실패', { rendererFailed: true }],
    ['컨텍스트 손실', { contextLost: true }],
  ])('idle 이어도 모드가 loading 이 아니면 요청하지 않는다: %s', (_label, over) => {
    expect(shouldRequestLoad(tabInput({ load: TAB_IDLE, ...over }))).toBe(false);
  });

  it.each<[string, Points3dLoad]>([
    ['ready', { status: 'ready', dir: TAB_OTHER_DIR, data: TAB_DATA }],
    ['loading', { status: 'loading', dir: TAB_OTHER_DIR }],
    ['error', { status: 'error', dir: TAB_OTHER_DIR, reason: 'fetch' }],
  ])('다른 분석의 %s 상태가 남아 있으면 새로 요청한다(분석 전환)', (_label, load) => {
    expect(shouldRequestLoad(tabInput({ support: 'hardware', load }))).toBe(true);
  });

  it('분석을 바꿔도 소프트웨어 렌더의 선택 전에는 요청하지 않는다', () => {
    const load: Points3dLoad = { status: 'ready', dir: TAB_OTHER_DIR, data: TAB_DATA };
    expect(shouldRequestLoad(tabInput({ support: 'software', optedIn: false, load }))).toBe(false);
  });
});
