// gl-renderer.ts 를 gl 호출 기록 스텁으로 검증한다. jsdom 에는 WebGL2 가 없어 픽셀은 볼 수 없으므로
// "어떤 gl 호출을 어떤 순서와 값으로 했는가"만 단언한다. 기대값은 손으로 계산했고 근거를 주석에 적었다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Points3dData, Points3dTheme } from '@/lib/domain/points3d';
import { CONTEXT_RESTORE_TIMEOUT_MS, createRenderer, probeWebgl2 } from '../gl-renderer';
import type { FrameParams } from '../gl-renderer';
import { recordingGl } from './gl-stub';
import type { GlCall, RecordingGl } from './gl-stub';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('gl-stub 규약', () => {
  // 죽이는 변이: 상수를 임의 값으로 둠(실제 브라우저의 값과 달라 컴포넌트 테스트의 단언이 헛돈다)
  it('WebGL 상수는 실제 값이다', () => {
    const { gl } = recordingGl();
    // WebGL 명세의 값. POINTS 0x0000, LINES 0x0001, SHORT 0x1402, UNSIGNED_SHORT 0x1403, FLOAT 0x1406
    expect([gl.POINTS, gl.LINES, gl.SHORT, gl.UNSIGNED_SHORT, gl.FLOAT]).toEqual([0, 1, 5122, 5123, 5126]);
    // ARRAY_BUFFER 0x8892, STATIC_DRAW 0x88E4, COLOR_BUFFER_BIT 0x4000, DEPTH_BUFFER_BIT 0x0100
    expect([gl.ARRAY_BUFFER, gl.STATIC_DRAW, gl.COLOR_BUFFER_BIT, gl.DEPTH_BUFFER_BIT]).toEqual([34962, 35044, 16384, 256]);
    // DEPTH_TEST 0x0B71, BLEND 0x0BE2, LESS 0x0201, SRC_ALPHA 0x0302, ONE_MINUS_SRC_ALPHA 0x0303
    expect([gl.DEPTH_TEST, gl.BLEND, gl.LESS, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA]).toEqual([2929, 3042, 513, 770, 771]);
    // VERTEX_SHADER 0x8B31, FRAGMENT_SHADER 0x8B30, COMPILE_STATUS 0x8B81, LINK_STATUS 0x8B82, ALIASED_POINT_SIZE_RANGE 0x846D
    expect([gl.VERTEX_SHADER, gl.FRAGMENT_SHADER, gl.COMPILE_STATUS, gl.LINK_STATUS, gl.ALIASED_POINT_SIZE_RANGE])
      .toEqual([35633, 35632, 35713, 35714, 33901]);
  });

  // 죽이는 변이: 기록 누락, 인자 누락, 순서 뒤섞임
  it('호출을 순서대로 기록하고 callsOf 가 이름으로 고른다', () => {
    const rec = recordingGl();
    rec.gl.viewport(0, 0, 4, 3);
    rec.gl.clear(rec.gl.COLOR_BUFFER_BIT);
    rec.gl.viewport(0, 0, 8, 6);
    expect(rec.calls.map((c) => c.name)).toEqual(['viewport', 'clear', 'viewport']);
    expect(rec.callsOf('viewport').map((c) => c.args)).toEqual([[0, 0, 4, 3], [0, 0, 8, 6]]);
  });

  // 죽이는 변이: uniformCalls 가 이름을 보지 않음, uniform 이 아닌 호출을 섞음
  it('getUniformLocation 은 이름을 실은 객체를 주고 uniformCalls 는 그 위치로 간 uniform 호출만 준다', () => {
    const rec = recordingGl();
    const program = rec.gl.createProgram();
    const a = rec.gl.getUniformLocation(program, 'uExag');
    const b = rec.gl.getUniformLocation(program, 'uThresholdQ');
    expect(a).toEqual({ uniformName: 'uExag', program });
    rec.gl.uniform1f(a, 50);
    rec.gl.uniform1i(b, 70);
    rec.gl.uniform1f(a, 10);
    expect(rec.uniformCalls('uExag').map((c) => [c.name, c.args[1]])).toEqual([['uniform1f', 50], ['uniform1f', 10]]);
    expect(rec.uniformCalls('uThresholdQ').map((c) => [c.name, c.args[1]])).toEqual([['uniform1i', 70]]);
    expect(rec.uniformCalls('uColFlat')).toEqual([]);
  });

  // 죽이는 변이: 속성 번호가 호출마다 달라짐
  it('getAttribLocation 은 aPos 0, aDev 1, 모르는 이름 -1 이고 attribLocation 이 같은 표를 준다', () => {
    const rec = recordingGl();
    const program = rec.gl.createProgram();
    expect(rec.gl.getAttribLocation(program, 'aPos')).toBe(0);
    expect(rec.gl.getAttribLocation(program, 'aDev')).toBe(1);
    expect(rec.gl.getAttribLocation(program, 'aNope')).toBe(-1);
    expect([rec.attribLocation('aPos'), rec.attribLocation('aDev'), rec.attribLocation('aNope')]).toEqual([0, 1, -1]);
  });

  // 죽이는 변이: LINES 그리기나 first 가 0 이 아닌 호출을 점 그리기로 셈
  it('pointDraws 는 drawArrays(POINTS, 0, c) 의 c 만 호출 순으로 준다', () => {
    const rec = recordingGl();
    rec.gl.drawArrays(rec.gl.LINES, 0, 6);
    rec.gl.drawArrays(rec.gl.POINTS, 0, 150000);
    rec.gl.drawArrays(rec.gl.POINTS, 0, 200000);
    expect(rec.pointDraws()).toEqual([150000, 200000]);
  });

  it('getParameter(ALIASED_POINT_SIZE_RANGE) 는 기본 [1, 1024] 이고 opts 로 바꾼다', () => {
    const a = recordingGl();
    expect(Array.from(a.gl.getParameter(a.gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)).toEqual([1, 1024]);
    const b = recordingGl({ pointSizeRange: [1, 64] });
    expect(Array.from(b.gl.getParameter(b.gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)).toEqual([1, 64]);
  });

  it('컴파일·링크 상태는 true 이고 핸들은 서로 다른 객체다', () => {
    const { gl } = recordingGl();
    const shader = gl.createShader(gl.VERTEX_SHADER);
    const program = gl.createProgram();
    expect(gl.getShaderParameter(shader as WebGLShader, gl.COMPILE_STATUS)).toBe(true);
    expect(gl.getProgramParameter(program, gl.LINK_STATUS)).toBe(true);
    expect(gl.createBuffer()).not.toBe(gl.createBuffer());
  });

  it('WEBGL_lose_context 의 loseContext 호출을 세고 다른 확장은 null 이다', () => {
    const rec = recordingGl();
    expect(rec.gl.getExtension('OES_texture_float_linear')).toBeNull();
    expect(rec.loseContextCalls()).toBe(0);
    rec.gl.getExtension('WEBGL_lose_context')?.loseContext();
    expect(rec.loseContextCalls()).toBe(1);
  });
});

describe('probeWebgl2', () => {
  // getContext 가 answers 를 차례로 돌려준다. 다 쓰면 null
  function stubGetContext(answers: Array<WebGL2RenderingContext | null>) {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    for (const answer of answers) spy.mockReturnValueOnce(answer);
    return spy;
  }

  // 죽이는 변이: 첫 시도에서 failIfMajorPerformanceCaveat 누락(소프트웨어 렌더를 hardware 로 판정), 탐지 컨텍스트 미반납
  it('성능 저하 없이 만들어지면 hardware 이고 탐지 컨텍스트를 반납한다', () => {
    const rec = recordingGl();
    const spy = stubGetContext([rec.gl]);
    expect(probeWebgl2()).toBe('hardware');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual(['webgl2', { failIfMajorPerformanceCaveat: true }]);
    expect(rec.loseContextCalls()).toBe(1);
  });

  // 죽이는 변이: 둘째 시도에도 옵션을 넘김(software 가 unsupported 로 떨어진다), 같은 canvas 재사용, 반납 누락
  it('첫 시도가 실패하고 옵션 없는 둘째 시도가 되면 software 다(새 canvas, 반납)', () => {
    const rec = recordingGl();
    const spy = stubGetContext([null, rec.gl]);
    expect(probeWebgl2()).toBe('software');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0]).toEqual(['webgl2', { failIfMajorPerformanceCaveat: true }]);
    expect(spy.mock.calls[1]).toEqual(['webgl2']);   // 옵션 인자 자체가 없다
    expect(spy.mock.contexts[0]).not.toBe(spy.mock.contexts[1]);
    expect(rec.loseContextCalls()).toBe(1);
  });

  // 죽이는 변이: 둘째 시도 생략, 실패를 software 로 뭉갬
  it('둘 다 실패하면 unsupported 다', () => {
    const spy = stubGetContext([null, null]);
    expect(probeWebgl2()).toBe('unsupported');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  // 죽이는 변이: 탐지용 canvas 를 문서에 붙임
  it('탐지용 canvas 는 문서에 붙이지 않는다', () => {
    const rec = recordingGl();
    const spy = stubGetContext([null, rec.gl]);
    probeWebgl2();
    expect(spy.mock.contexts.map((c) => (c as HTMLCanvasElement).isConnected)).toEqual([false, false]);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });

  // 죽이는 변이: 모듈 최상위에서 탐지(서버 렌더에서 import 하는 순간 document 가 없어 죽는다)
  it('모듈을 import 하는 것만으로는 컨텍스트를 만들지 않는다', async () => {
    const spy = stubGetContext([]);
    vi.resetModules();
    await import('../gl-renderer');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ---- 여기부터 createRenderer ----

// 점 5개. 좌표·편차 값은 렌더러가 해석하지 않고 그대로 GPU 에 올린다
function makeData(): Points3dData {
  return {
    meta: {
      schema_version: 1, n_points: 5, units: 'm',
      origin_m: [254012.8371, 4180045.1626, 31.6052],
      extent_m: [4.0, 2.5, 0.3125],
      deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
      sample_cell_m: 0.0125,
      fit_bounds: { min: [0, 0, 0], max: [4.0, 2.5, 0.3125] },
      sampling: { method: 'cell min-hash stratified', source_points: 12345, cap: 500000 },
      order: 'hash',
    },
    xyz: new Uint16Array([0, 0, 0, 65535, 65535, 4096, 258, 772, 1286, 32768, 16384, 8192, 100, 200, 65535]),
    dev: new Int16Array([0, 32, -105, 71, -32768]),
  };
}

// 격자 정점 6개(선 3개) 뒤에 축 정점 4개(선 2개). buildScaffold 가 주는 배치와 같다
function makeScaffold() {
  return { verts: new Float32Array(30).map((_, i) => i * 0.25), gridVertCount: 6, axisVertCount: 4 };
}

// 채널마다 값이 다른 색을 쓴다(검정·흰색은 채널을 바꿔 넣어도 같아서 변이를 못 잡는다)
const THEME_A: Points3dTheme = {
  background: '#102030', flat: '#4cc96f', depression: '#f5c33b', protrusion: '#f06464', none: '#4a4f57',
  line: '#336699', gridAlpha: 0.09, axisAlpha: 0.28,
  text: '#f2f4f7', textSecondary: '#9aa3ad', readoutBackground: '#000000', readoutAlpha: 0.8,
};
const THEME_B: Points3dTheme = {
  ...THEME_A,
  background: '#ffffff', flat: '#1e9e50', depression: '#b88700', protrusion: '#d93636', none: '#b4bac2',
  line: '#000716',
};

function makeFrame(over: Partial<FrameParams> = {}): FrameParams {
  return {
    viewProj: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    exaggeration: 50,
    thresholdQ: 70,
    pointWorldM: 0.006875,   // 0.55 x 0.0125
    pxPerUnit: 1318.5,
    minPx: 3,
    maxPx: 64,
    drawCount: 3,
    theme: THEME_A,
    ...over,
  };
}

function mount(opts?: { pointSizeRange?: [number, number] }) {
  const rec = recordingGl(opts);
  const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
  const canvas = document.createElement('canvas');
  const on = { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() };
  const renderer = createRenderer(canvas, on);
  if (!renderer) throw new Error('createRenderer 가 null 을 돌려줬다');
  return { rec, getContext, canvas, on, renderer };
}

// uniform 호출의 값(위치 인자 뒤의 숫자들). uniform3f 로 부르든 uniform3fv 로 부르든 같은 배열이 된다
function valuesOf(call: GlCall): number[] {
  return call.args.slice(1).flatMap((a) => {
    if (typeof a === 'number') return [a];
    if (ArrayBuffer.isView(a) || Array.isArray(a)) return Array.from(a as ArrayLike<number>);
    return [];
  });
}

// calls[index] 보다 앞에서 조건에 맞는 마지막 호출
function lastBefore(rec: RecordingGl, index: number, match: (c: GlCall) => boolean): GlCall | undefined {
  for (let i = index - 1; i >= 0; i--) if (match(rec.calls[i])) return rec.calls[i];
  return undefined;
}

// calls[index] 시점에 cap 이 켜져 있는가(마지막 enable/disable 기준. WebGL 기본값은 꺼짐)
function enabledAt(rec: RecordingGl, index: number, cap: number): boolean {
  return lastBefore(rec, index, (c) => (c.name === 'enable' || c.name === 'disable') && c.args[0] === cap)?.name === 'enable';
}

// calls[index] 시점에 묶여 있는 것(bindBuffer·bindVertexArray·useProgram 의 마지막 인자)
function boundAt(rec: RecordingGl, index: number, binder: 'bindBuffer' | 'bindVertexArray' | 'useProgram'): unknown {
  const call = lastBefore(rec, index, (c) => c.name === binder);
  return call?.args[call.args.length - 1];
}

// calls[index] 시점의 uColor 값
function lineColorAt(rec: RecordingGl, index: number): number[] {
  const call = lastBefore(rec, index, (c) => c.name.startsWith('uniform')
    && (c.args[0] as { uniformName?: string } | null)?.uniformName === 'uColor');
  return call ? valuesOf(call) : [];
}

const indexOf = (rec: RecordingGl, call: GlCall) => rec.calls.indexOf(call);
const lineDraws = (rec: RecordingGl) => rec.callsOf('drawArrays').filter((c) => c.args[0] === rec.gl.LINES);
const pointDrawCalls = (rec: RecordingGl) => rec.callsOf('drawArrays').filter((c) => c.args[0] === rec.gl.POINTS);
const fire = (canvas: HTMLCanvasElement, type: string) => {
  const event = new Event(type, { cancelable: true });
  canvas.dispatchEvent(event);
  return event;
};

describe('createRenderer: 생성', () => {
  // 죽이는 변이: 컨텍스트 옵션 변경(antialias 를 켜면 점 가장자리와 성능이 달라진다), null 검사 누락
  it("canvas.getContext('webgl2', { antialias: false, alpha: false }) 를 한 번 부른다", () => {
    const { getContext } = mount();
    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext.mock.calls[0]).toEqual(['webgl2', { antialias: false, alpha: false }]);
  });

  it('getContext 가 null 이면 null 을 돌려준다', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const on = { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() };
    expect(createRenderer(document.createElement('canvas'), on)).toBeNull();
  });

  // 죽이는 변이: `#version` 앞에 줄바꿈(실제 브라우저에서 컴파일 실패), GLSL 에 비 ASCII 문자
  it('셰이더 4개는 전부 첫 줄이 #version 300 es 이고 ASCII 만 쓴다', () => {
    const { rec } = mount();
    const sources = rec.callsOf('shaderSource').map((c) => c.args[1] as string);
    expect(sources).toHaveLength(4);
    for (const source of sources) {
      expect(source.startsWith('#version 300 es\n')).toBe(true);
      expect([...source].every((ch) => ch.charCodeAt(0) < 128)).toBe(true);
    }
  });

  // jsdom 은 GLSL 을 실행하지 못하므로 gl 호출과 맞물리는 선언만 소스로 확인한다.
  // 죽이는 변이: aDev 를 float 로 선언(vertexAttribIPointer 와 어긋나 값이 정의되지 않는다),
  // uThresholdQ 를 float 로 선언(uniform1i 와 어긋나 값이 들어가지 않는다), 센티널 경계 변경,
  // 과장을 z 전체에 적용, 깊이를 표시 위치로 계산, 네모 점
  it('점 셰이더의 선언과 식이 스펙 §7.5 와 맞는다', () => {
    const { rec } = mount();
    const sources = rec.callsOf('shaderSource').map((c) => c.args[1] as string);
    const pointVs = sources.find((s) => s.includes('aDev'));
    const pointFs = sources.find((s) => s.includes('gl_PointCoord'));
    expect(pointVs).toBeDefined();
    expect(pointFs).toBeDefined();
    expect(pointVs).toMatch(/\bin\s+int\s+aDev\s*;/);
    expect(pointVs).toMatch(/\bin\s+vec3\s+aPos\s*;/);
    expect(pointVs).toMatch(/\buniform\s+int\s+uThresholdQ\s*;/);
    expect(pointVs).toMatch(/aDev\s*>\s*-32767\b/);                        // 센티널 2종(-32768, -32767)은 편차 없음
    expect(pointVs).toMatch(/devM\s*\*\s*\(\s*uExag\s*-\s*1\.0\s*\)/);       // 편차만 과장: dev x (k - 1)
    expect(pointVs).toMatch(/clipR\.z\s*\/\s*clipR\.w\s*\*\s*clipS\.w/);     // 깊이는 기준면 위치
    expect(pointVs).toMatch(/aDev\s*>\s*uThresholdQ/);
    expect(pointVs).toMatch(/aDev\s*<\s*-\s*uThresholdQ/);
    expect(pointFs).toMatch(/length\(\s*gl_PointCoord\s*-\s*0\.5\s*\)\s*>\s*0\.5\s*\)\s*discard/);   // 둥근 점
  });

  // 죽이는 변이: 링크 뒤 셰이더 객체를 지우지 않음(누수)
  it('링크가 끝난 셰이더 객체 4개를 지운다', () => {
    const rec = recordingGl();
    const made = vi.spyOn(rec.gl, 'createShader');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
    createRenderer(document.createElement('canvas'), { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() });
    const created = made.mock.results.map((r) => r.value);
    const deleted = rec.callsOf('deleteShader').map((c) => c.args[0]);
    expect(created).toHaveLength(4);
    for (const shader of created) expect(deleted).toContain(shader);
  });

  // 죽이는 변이: 컴파일 실패를 무시하고 렌더러를 돌려줌(빈 캔버스), 리스너를 먼저 달고 떼지 않음,
  // 실패한 셰이더 객체를 지우지 않음(실패 경로에서 자원을 흘린다)
  it('셰이더 컴파일이 실패하면 null 이고 리스너를 남기지 않는다', () => {
    const rec = recordingGl();
    vi.spyOn(rec.gl, 'getShaderParameter').mockReturnValue(false);
    const shaders = vi.spyOn(rec.gl, 'createShader');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
    const canvas = document.createElement('canvas');
    const on = { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() };
    expect(createRenderer(canvas, on)).toBeNull();
    expect(logged).toHaveBeenCalled();
    expect(fire(canvas, 'webglcontextlost').defaultPrevented).toBe(false);
    expect(on.lost).not.toHaveBeenCalled();
    // 컴파일에 실패한 셰이더도 전부 지운다
    const deletedShaders = rec.callsOf('deleteShader').map((c) => c.args[0]);
    expect(shaders.mock.results.length).toBeGreaterThan(0);
    for (const r of shaders.mock.results) expect(deletedShaders).toContain(r.value);
  });

  // 죽이는 변이: 링크 실패를 무시, 실패 경로에서 만든 프로그램·버퍼·VAO 를 지우지 않음,
  // 링크 실패를 조용히 넘김(info log 를 남기지 않는다)
  it('프로그램 링크가 실패하면 null 이고 만든 프로그램·버퍼·VAO 를 전부 지운다', () => {
    const rec = recordingGl();
    vi.spyOn(rec.gl, 'getProgramParameter').mockReturnValue(false);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const programs = vi.spyOn(rec.gl, 'createProgram');
    const buffers = vi.spyOn(rec.gl, 'createBuffer');
    const vaos = vi.spyOn(rec.gl, 'createVertexArray');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
    const on = { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() };
    expect(createRenderer(document.createElement('canvas'), on)).toBeNull();
    expect(logged).toHaveBeenCalled();   // 컴파일은 통과했으므로 이 로그는 링크 실패 경로에서만 나온다
    const deleted = (name: string) => rec.callsOf(name).map((c) => c.args[0]);
    expect(programs.mock.results.length).toBeGreaterThan(0);
    for (const r of programs.mock.results) expect(deleted('deleteProgram')).toContain(r.value);
    for (const r of buffers.mock.results) expect(deleted('deleteBuffer')).toContain(r.value);
    for (const r of vaos.mock.results) expect(deleted('deleteVertexArray')).toContain(r.value);
  });
});

describe('createRenderer: setData', () => {
  // 죽이는 변이: xyz 를 Float32Array 로 바꿔 올림(사본), 배열을 잘라 올림
  it('받은 배열 세 개를 사본 없이 그대로 올린다', () => {
    const { rec, renderer } = mount();
    const data = makeData();
    const scaffold = makeScaffold();
    renderer.setData(data, scaffold);
    const uploads = rec.callsOf('bufferData');
    expect(uploads).toHaveLength(3);
    for (const call of uploads) {
      expect(call.args[0]).toBe(rec.gl.ARRAY_BUFFER);
      expect(call.args[2]).toBe(rec.gl.STATIC_DRAW);
    }
    const uploaded = uploads.map((c) => c.args[1]);
    expect(uploaded).toContain(data.xyz);       // toContain 은 === 비교다. 같은 객체여야 한다
    expect(uploaded).toContain(data.dev);
    expect(uploaded).toContain(scaffold.verts);
  });

  // 죽이는 변이: aPos 정규화 플래그 false(좌표가 0~65535 로 들어가 화면 밖으로 나간다), FLOAT 로 선언,
  // 크기 3 이 아님, 다른 버퍼가 묶인 채 포인터를 잡음
  it('aPos 는 xyz 버퍼를 정규화 UNSIGNED_SHORT 3개로 읽는다', () => {
    const { rec, renderer } = mount();
    const data = makeData();
    renderer.setData(data, makeScaffold());
    const xyzUpload = rec.callsOf('bufferData').find((c) => c.args[1] === data.xyz) as GlCall;
    const xyzBuffer = boundAt(rec, indexOf(rec, xyzUpload), 'bindBuffer');
    const pointer = rec.callsOf('vertexAttribPointer').find((c) => c.args[2] === rec.gl.UNSIGNED_SHORT) as GlCall;
    expect(pointer).toBeDefined();
    expect(pointer.args).toEqual([rec.attribLocation('aPos'), 3, rec.gl.UNSIGNED_SHORT, true, 0, 0]);
    expect(boundAt(rec, indexOf(rec, pointer), 'bindBuffer')).toBe(xyzBuffer);
  });

  // 죽이는 변이: aDev 를 vertexAttribPointer(float)로(셰이더의 int 속성과 어긋난다), 크기·타입 변경,
  // dev 버퍼가 아닌 버퍼가 묶인 채 포인터를 잡음
  it('aDev 는 dev 버퍼를 vertexAttribIPointer(SHORT 1개)로 읽는다', () => {
    const { rec, renderer } = mount();
    const data = makeData();
    renderer.setData(data, makeScaffold());
    const devUpload = rec.callsOf('bufferData').find((c) => c.args[1] === data.dev) as GlCall;
    const devBuffer = boundAt(rec, indexOf(rec, devUpload), 'bindBuffer');
    const integerPointers = rec.callsOf('vertexAttribIPointer');
    expect(integerPointers).toHaveLength(1);
    expect(integerPointers[0].args).toEqual([rec.attribLocation('aDev'), 1, rec.gl.SHORT, 0, 0]);
    expect(boundAt(rec, indexOf(rec, integerPointers[0]), 'bindBuffer')).toBe(devBuffer);
    const xyzUpload = rec.callsOf('bufferData').find((c) => c.args[1] === data.xyz) as GlCall;
    expect(devBuffer).not.toBe(boundAt(rec, indexOf(rec, xyzUpload), 'bindBuffer'));   // xyz 와 다른 버퍼다
    // float 포인터로는 aDev 를 잡지 않는다. float 포인터 2개는 점 aPos(UNSIGNED_SHORT)와 선 aPos(FLOAT)뿐이다
    expect(rec.callsOf('vertexAttribPointer').map((c) => c.args[2]).sort()).toEqual([rec.gl.UNSIGNED_SHORT, rec.gl.FLOAT].sort());
  });

  // 죽이는 변이: enableVertexAttribArray 누락(속성이 꺼진 채라 모든 점이 같은 값으로 읽힌다),
  // 점 aPos 포인터를 선 VAO 에 잡음
  it('점 VAO 에서 aPos·aDev 를, 선 VAO 에서 aPos 를 켠다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    const vaoAt = (call: GlCall) => boundAt(rec, indexOf(rec, call), 'bindVertexArray');
    const pointVao = vaoAt(rec.callsOf('vertexAttribIPointer')[0]);
    const lineVao = vaoAt(rec.callsOf('vertexAttribPointer').find((c) => c.args[2] === rec.gl.FLOAT) as GlCall);
    const enabledIn = (vao: unknown) => rec.callsOf('enableVertexAttribArray')
      .filter((c) => vaoAt(c) === vao).map((c) => c.args[0]).sort();
    expect(enabledIn(pointVao)).toEqual([0, 1]);   // aPos 0, aDev 1
    expect(enabledIn(lineVao)).toEqual([0]);       // 선 프로그램의 aPos
    expect(vaoAt(rec.callsOf('vertexAttribPointer').find((c) => c.args[2] === rec.gl.UNSIGNED_SHORT) as GlCall)).toBe(pointVao);
  });

  // 죽이는 변이: 선 정점을 정규화 속성으로 올림, 점 VAO 에 선 포인터를 섞음
  it('선 aPos 는 scaffold.verts 버퍼를 FLOAT 3개로 읽고 점과 다른 VAO 에 둔다', () => {
    const { rec, renderer } = mount();
    const scaffold = makeScaffold();
    renderer.setData(makeData(), scaffold);
    const lineUpload = rec.callsOf('bufferData').find((c) => c.args[1] === scaffold.verts) as GlCall;
    const linePointer = rec.callsOf('vertexAttribPointer').find((c) => c.args[2] === rec.gl.FLOAT) as GlCall;
    expect(linePointer.args).toEqual([0, 3, rec.gl.FLOAT, false, 0, 0]);
    expect(boundAt(rec, indexOf(rec, linePointer), 'bindBuffer')).toBe(boundAt(rec, indexOf(rec, lineUpload), 'bindBuffer'));
    const lineVao = boundAt(rec, indexOf(rec, linePointer), 'bindVertexArray');
    const pointVao = boundAt(rec, indexOf(rec, rec.callsOf('vertexAttribIPointer')[0]), 'bindVertexArray');
    expect(lineVao).toBeTruthy();
    expect(pointVao).toBeTruthy();
    expect(lineVao).not.toBe(pointVao);
  });
});

describe('createRenderer: draw', () => {
  // 죽이는 변이: uThresholdQ 를 float uniform 으로(uniform1f), 임계값을 mm 로 나눠 넘김
  it('uThresholdQ 는 정수 uniform(uniform1i)으로 프레임 값 그대로 넘어간다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame({ thresholdQ: 70 }));
    renderer.draw(makeFrame({ thresholdQ: 15 }));
    expect(rec.uniformCalls('uThresholdQ').map((c) => [c.name, c.args[1]])).toEqual([['uniform1i', 70], ['uniform1i', 15]]);
  });

  // 죽이는 변이: uExag 에 (k - 1)을 넘김, uPxPerUnit·uMinPx·uMaxPx·uPointWorldM 를 서로 바꿔 넘김, 값 가공
  it('uExag·uPointWorldM·uPxPerUnit·uMinPx·uMaxPx 는 FrameParams 값 그대로다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame());
    const last = (name: string) => valuesOf(rec.uniformCalls(name).slice(-1)[0]);
    expect(last('uExag')).toEqual([50]);
    expect(last('uPointWorldM')).toEqual([0.006875]);
    expect(last('uPxPerUnit')).toEqual([1318.5]);
    expect(last('uMinPx')).toEqual([3]);
    expect(last('uMaxPx')).toEqual([64]);
  });

  // 죽이는 변이: uExtent 에 fit 범위나 origin 을 넘김, 축 순서 바꿈
  it('uExtent 는 메타의 extent_m 이다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame());
    expect(valuesOf(rec.uniformCalls('uExtent').slice(-1)[0])).toEqual([4.0, 2.5, 0.3125]);
  });

  // 죽이는 변이: 분류 색을 서로 바꿔 넘김, 색을 생성 시점에 고정(배경 전환이 반영되지 않는다)
  it('색 uniform 4개는 프레임 테마의 hex 를 0~1 로 바꾼 값이다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    const last = (name: string) => valuesOf(rec.uniformCalls(name).slice(-1)[0]);
    renderer.draw(makeFrame({ theme: THEME_A }));
    expect(last('uColFlat')).toEqual([76 / 255, 201 / 255, 111 / 255]);    // #4cc96f
    expect(last('uColDep')).toEqual([245 / 255, 195 / 255, 59 / 255]);     // #f5c33b
    expect(last('uColPro')).toEqual([240 / 255, 100 / 255, 100 / 255]);    // #f06464
    expect(last('uColNone')).toEqual([74 / 255, 79 / 255, 87 / 255]);      // #4a4f57
    renderer.draw(makeFrame({ theme: THEME_B }));
    expect(last('uColFlat')).toEqual([30 / 255, 158 / 255, 80 / 255]);     // #1e9e50
    expect(last('uColDep')).toEqual([184 / 255, 135 / 255, 0]);            // #b88700
    expect(last('uColPro')).toEqual([217 / 255, 54 / 255, 54 / 255]);      // #d93636
    expect(last('uColNone')).toEqual([180 / 255, 186 / 255, 194 / 255]);   // #b4bac2
  });

  // 죽이는 변이: 한쪽 프로그램에 행렬을 넘기지 않음(선이나 점이 제자리에 안 그려진다), 전치 플래그 true
  it('uViewProj 는 선 프로그램과 점 프로그램 양쪽에 전치 없이 넘어간다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame());
    const calls = rec.uniformCalls('uViewProj');
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.name).toBe('uniformMatrix4fv');
      expect(call.args[1]).toBe(false);
      expect(valuesOf(call)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    }
    const programs = calls.map((c) => (c.args[0] as { program: unknown }).program);
    expect(programs[0]).not.toBe(programs[1]);
  });

  // 죽이는 변이: drawCount 무시(항상 n), 버퍼보다 많이 그림(실제 GL 에서는 아무것도 안 그려진다),
  // 음수를 그대로 넘김(실제 GL 에서는 INVALID_VALUE 라 아무것도 그려지지 않는다. 0 으로 막는다)
  it('점은 drawArrays(POINTS, 0, drawCount) 로 앞 drawCount 개만 그리고 n 을 넘지 않는다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());   // n = 5
    renderer.draw(makeFrame({ drawCount: 3 }));
    renderer.draw(makeFrame({ drawCount: 5 }));
    renderer.draw(makeFrame({ drawCount: 9 }));
    renderer.draw(makeFrame({ drawCount: -4 }));
    expect(rec.pointDraws()).toEqual([3, 5, 5, 0]);
    expect(pointDrawCalls(rec)).toHaveLength(4);   // first 가 0 이 아닌 점 그리기는 없다
  });

  // 죽이는 변이: 격자와 축을 한 번에 그림(축선 알파가 격자와 같아진다), 구간 시작·개수 틀림, 알파 바꿔 넘김
  it('선은 격자 구간과 축 구간을 두 번에 나눠 그리고 uColor 알파가 gridAlpha, axisAlpha 다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());   // 격자 6, 축 4
    renderer.draw(makeFrame({ theme: THEME_A }));
    const draws = lineDraws(rec);
    expect(draws.map((c) => c.args)).toEqual([[rec.gl.LINES, 0, 6], [rec.gl.LINES, 6, 4]]);
    // #336699 = (51, 102, 153) / 255 = (0.2, 0.4, 0.6)
    expect(lineColorAt(rec, indexOf(rec, draws[0]))).toEqual([51 / 255, 102 / 255, 153 / 255, 0.09]);
    expect(lineColorAt(rec, indexOf(rec, draws[1]))).toEqual([51 / 255, 102 / 255, 153 / 255, 0.28]);
  });

  // 죽이는 변이: 배경색 고정, 깊이 버퍼를 지우지 않음, 채널 순서 바꿈
  it('테마 배경색으로 색과 깊이를 지운다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame({ theme: THEME_A }));
    renderer.draw(makeFrame({ theme: THEME_B }));
    const clears = rec.callsOf('clear');
    expect(clears.map((c) => c.args)).toEqual([[0x4100], [0x4100]]);   // COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT
    const colorAt = (call: GlCall) => lastBefore(rec, indexOf(rec, call), (c) => c.name === 'clearColor')?.args;
    expect(colorAt(clears[0])).toEqual([16 / 255, 32 / 255, 48 / 255, 1]);   // #102030
    expect(colorAt(clears[1])).toEqual([1, 1, 1, 1]);                        // #ffffff
  });

  // 죽이는 변이: 점을 먼저 그림, 선에서 깊이를 씀(점이 선에 가려진다), 선 블렌딩 누락(알파가 무시된다),
  // 점에서 블렌딩을 끄지 않음, 깊이 테스트 누락, 점 단계가 깊이 쓰기를 되돌리지 않음(다음 프레임에 깊이가 안 지워진다)
  it('그리기 순서와 상태: clear -> 선(블렌딩 켬, 깊이 쓰기 끔) -> 점(블렌딩 끔, 깊이 테스트 LESS, 깊이 쓰기 켬)', () => {
    const { rec, renderer } = mount();
    const { gl } = rec;
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame());
    renderer.draw(makeFrame());
    const steps = rec.calls.filter((c) => c.name === 'clear' || c.name === 'drawArrays');
    expect(steps.map((c) => (c.name === 'clear' ? 'clear' : c.args[0] === gl.LINES ? 'LINES' : 'POINTS')))
      .toEqual(['clear', 'LINES', 'LINES', 'POINTS', 'clear', 'LINES', 'LINES', 'POINTS']);

    const depthMaskAt = (index: number) => lastBefore(rec, index, (c) => c.name === 'depthMask')?.args[0] ?? true;
    for (const line of lineDraws(rec)) {
      const at = indexOf(rec, line);
      expect(enabledAt(rec, at, gl.BLEND)).toBe(true);
      expect(lastBefore(rec, at, (c) => c.name === 'blendFunc')?.args).toEqual([gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA]);
      expect(depthMaskAt(at)).toBe(false);
    }
    for (const point of pointDrawCalls(rec)) {
      const at = indexOf(rec, point);
      expect(enabledAt(rec, at, gl.BLEND)).toBe(false);
      expect(enabledAt(rec, at, gl.DEPTH_TEST)).toBe(true);
      expect(lastBefore(rec, at, (c) => c.name === 'depthFunc')?.args[0] ?? gl.LESS).toBe(gl.LESS);
      expect(depthMaskAt(at)).toBe(true);
    }
    // 둘째 프레임의 clear 시점에 깊이 쓰기가 켜져 있어야 깊이 버퍼가 지워진다
    expect(depthMaskAt(indexOf(rec, rec.callsOf('clear')[1]))).toBe(true);
  });

  // 죽이는 변이: draw 에서 useProgram·bindVertexArray 누락(다른 프로그램·VAO 로 그린다)
  it('선과 점을 각자의 프로그램과 VAO 로 그린다', () => {
    const { rec, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    renderer.draw(makeFrame());
    const programOf = (uniformName: string) => (rec.uniformCalls(uniformName)[0].args[0] as { program: unknown }).program;
    const pointVao = boundAt(rec, indexOf(rec, rec.callsOf('vertexAttribIPointer')[0]), 'bindVertexArray');
    const linePointer = rec.callsOf('vertexAttribPointer').find((c) => c.args[2] === rec.gl.FLOAT) as GlCall;
    const lineVao = boundAt(rec, indexOf(rec, linePointer), 'bindVertexArray');
    for (const line of lineDraws(rec)) {
      expect(boundAt(rec, indexOf(rec, line), 'useProgram')).toBe(programOf('uColor'));
      expect(boundAt(rec, indexOf(rec, line), 'bindVertexArray')).toBe(lineVao);
    }
    const point = pointDrawCalls(rec)[0];
    expect(boundAt(rec, indexOf(rec, point), 'useProgram')).toBe(programOf('uThresholdQ'));
    expect(boundAt(rec, indexOf(rec, point), 'bindVertexArray')).toBe(pointVao);
  });

  it('setData 전에는 아무것도 그리지 않는다', () => {
    const { rec, renderer } = mount();
    renderer.draw(makeFrame());
    expect(rec.callsOf('drawArrays')).toEqual([]);
    expect(rec.callsOf('clear')).toEqual([]);
  });
});

describe('createRenderer: resize·pointSizeLimit·dispose', () => {
  // 죽이는 변이: viewport 누락(캔버스 크기가 바뀌어도 그림이 옛 크기로 나온다), 폭·높이 바꿔 넣음,
  // 같은 크기에도 canvas.width·height 를 다시 대입함(대입하면 드로잉 버퍼가 지워진다)
  it('resize 는 canvas.width·height 와 viewport 를 맞춘다', () => {
    const { rec, canvas, renderer } = mount();
    renderer.resize(1280, 960);
    expect([canvas.width, canvas.height]).toEqual([1280, 960]);
    expect(rec.callsOf('viewport').slice(-1)[0].args).toEqual([0, 0, 1280, 960]);

    // 같은 크기를 다시 받으면 canvas 크기는 건드리지 않고 viewport 만 맞춘다. 한 축만 바뀌면 그 축만 대입한다
    const widthWrites = vi.spyOn(canvas, 'width', 'set');
    const heightWrites = vi.spyOn(canvas, 'height', 'set');
    renderer.resize(1280, 960);
    expect(widthWrites).not.toHaveBeenCalled();
    expect(heightWrites).not.toHaveBeenCalled();
    renderer.resize(1280, 720);
    expect(widthWrites).not.toHaveBeenCalled();
    expect(heightWrites).toHaveBeenCalledTimes(1);
    expect([canvas.width, canvas.height]).toEqual([1280, 720]);
    expect(rec.callsOf('viewport').slice(-1)[0].args).toEqual([0, 0, 1280, 720]);
  });

  // 죽이는 변이: 고정값 반환, 다른 파라미터를 읽음, 매번 다시 읽음(컨텍스트가 끊긴 동안 getParameter 는 null 을 준다)
  it('pointSizeLimit 은 ALIASED_POINT_SIZE_RANGE 다', () => {
    const { rec, renderer } = mount({ pointSizeRange: [1, 64] });
    expect(renderer.pointSizeLimit()).toEqual([1, 64]);
    expect(rec.callsOf('getParameter').map((c) => c.args[0])).toContain(rec.gl.ALIASED_POINT_SIZE_RANGE);
    // 생성 때 한 번 읽은 값을 돌려준다. 끊긴 컨텍스트처럼 getParameter 가 null 을 줘도 같은 값이고 다시 읽지 않는다
    const reread = vi.spyOn(rec.gl, 'getParameter').mockReturnValue(null);
    expect(renderer.pointSizeLimit()).toEqual([1, 64]);
    expect(reread).not.toHaveBeenCalled();
  });

  // 죽이는 변이: dispose 에서 loseContext 호출, 버퍼·VAO·프로그램 삭제 누락, 리스너를 떼지 않음
  it('dispose 는 버퍼 3·VAO 2·프로그램 2를 지우고 리스너를 떼며 loseContext 를 부르지 않는다', () => {
    const rec = recordingGl();
    const programs = vi.spyOn(rec.gl, 'createProgram');
    const buffers = vi.spyOn(rec.gl, 'createBuffer');
    const vaos = vi.spyOn(rec.gl, 'createVertexArray');
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
    const canvas = document.createElement('canvas');
    const on = { lost: vi.fn(), restored: vi.fn(), unrecoverable: vi.fn() };
    const renderer = createRenderer(canvas, on);
    renderer?.setData(makeData(), makeScaffold());
    renderer?.dispose();

    const made = (spy: { mock: { results: Array<{ value: unknown }> } }) => spy.mock.results.map((r) => r.value);
    const deleted = (name: string) => rec.callsOf(name).map((c) => c.args[0]);
    expect(made(buffers)).toHaveLength(3);
    expect(made(vaos)).toHaveLength(2);
    expect(made(programs)).toHaveLength(2);
    for (const buffer of made(buffers)) expect(deleted('deleteBuffer')).toContain(buffer);
    for (const vao of made(vaos)) expect(deleted('deleteVertexArray')).toContain(vao);
    for (const program of made(programs)) expect(deleted('deleteProgram')).toContain(program);
    expect(rec.loseContextCalls()).toBe(0);

    // 리스너가 떨어졌다: 손실 이벤트의 기본 동작을 막지 않고 콜백도 부르지 않는다
    expect(fire(canvas, 'webglcontextlost').defaultPrevented).toBe(false);
    expect(on.lost).not.toHaveBeenCalled();
    // dispose 뒤의 draw 는 아무것도 하지 않는다
    const before = rec.calls.length;
    renderer?.draw(makeFrame());
    expect(rec.calls.length).toBe(before);
  });
});

describe('createRenderer: 컨텍스트 손실과 복구', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('복구 대기 시간은 3,000ms 다', () => {
    expect(CONTEXT_RESTORE_TIMEOUT_MS).toBe(3000);
  });

  // 죽이는 변이: preventDefault 누락(브라우저가 복구 이벤트를 보내지 않는다), on.lost 누락, 손실 중에 그림
  it('손실: 기본 동작을 막고 on.lost 를 한 번 부르며 손실 중 draw 는 아무것도 하지 않는다', () => {
    const { rec, canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    const event = fire(canvas, 'webglcontextlost');
    expect(event.defaultPrevented).toBe(true);
    expect(on.lost).toHaveBeenCalledTimes(1);
    const before = rec.calls.length;
    renderer.draw(makeFrame());
    expect(rec.calls.length).toBe(before);
  });

  // 죽이는 변이: 복구 때 재업로드 누락(빈 캔버스), 프로그램을 다시 만들지 않음(끊긴 핸들로 그린다),
  // 복구돼도 타이머를 지우지 않음(3초 뒤 복구 불가를 잘못 알린다), on.restored 누락
  it('3,000ms 안에 복구되면 프로그램을 다시 만들고 보관한 배열을 다시 올린 뒤 on.restored 를 부른다', () => {
    const { rec, canvas, on, renderer } = mount();
    const data = makeData();
    const scaffold = makeScaffold();
    renderer.setData(data, scaffold);
    renderer.resize(1280, 960);
    renderer.draw(makeFrame());
    const oldProgram = (rec.uniformCalls('uThresholdQ')[0].args[0] as { program: unknown }).program;
    const oldXyzBuffer = boundAt(rec, indexOf(rec, rec.callsOf('bufferData')[0]), 'bindBuffer');

    fire(canvas, 'webglcontextlost');
    vi.advanceTimersByTime(2999);
    const seen = { programs: rec.callsOf('createProgram').length, uploads: rec.callsOf('bufferData').length, viewports: rec.callsOf('viewport').length };
    fire(canvas, 'webglcontextrestored');

    expect(rec.callsOf('createProgram')).toHaveLength(seen.programs + 2);
    const uploads = rec.callsOf('bufferData').slice(seen.uploads);
    expect(uploads).toHaveLength(3);
    const uploaded = uploads.map((c) => c.args[1]);
    expect(uploaded).toContain(data.xyz);
    expect(uploaded).toContain(data.dev);
    expect(uploaded).toContain(scaffold.verts);
    // 새로 만든 버퍼에 올린다(끊긴 컨텍스트의 버퍼 핸들을 다시 쓰지 않는다)
    const xyzUpload = uploads.find((c) => c.args[1] === data.xyz) as GlCall;
    expect(boundAt(rec, indexOf(rec, xyzUpload), 'bindBuffer')).not.toBe(oldXyzBuffer);
    expect(rec.callsOf('vertexAttribIPointer')).toHaveLength(2);
    // viewport 도 다시 맞춘다
    expect(rec.callsOf('viewport').slice(seen.viewports).map((c) => c.args)).toEqual([[0, 0, 1280, 960]]);
    expect(on.restored).toHaveBeenCalledTimes(1);

    // 복구 뒤에는 다시 그리고, 새 프로그램을 쓴다
    renderer.draw(makeFrame({ drawCount: 5 }));
    expect(rec.pointDraws()).toEqual([3, 5]);
    const newProgram = (rec.uniformCalls('uThresholdQ').slice(-1)[0].args[0] as { program: unknown }).program;
    expect(newProgram).not.toBe(oldProgram);

    // 복구됐으므로 3초가 지나도 복구 불가를 알리지 않는다
    vi.advanceTimersByTime(10_000);
    expect(on.unrecoverable).not.toHaveBeenCalled();
  });

  // 죽이는 변이: 3초 미복구 타이머 제거, 대기 시간을 다른 값으로, 두 번 알림
  it('3,000ms 가 지나도 복구되지 않으면 on.unrecoverable 을 한 번 부른다', () => {
    const { canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    fire(canvas, 'webglcontextlost');
    vi.advanceTimersByTime(2999);
    expect(on.unrecoverable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);
    expect(on.restored).not.toHaveBeenCalled();
  });

  // 죽이는 변이: 복구 불가를 알린 뒤 늦게 온 복구를 받아들임(화면은 이미 오류 안내로 넘어갔다)
  it('복구 불가를 알린 뒤 늦게 온 복구 이벤트는 무시한다', () => {
    const { rec, canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    fire(canvas, 'webglcontextlost');
    vi.advanceTimersByTime(3000);
    const before = rec.calls.length;
    fire(canvas, 'webglcontextrestored');
    renderer.draw(makeFrame());
    expect(rec.calls.length).toBe(before);
    expect(on.restored).not.toHaveBeenCalled();
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);
  });

  // 죽이는 변이: 손실 이벤트가 겹쳐 올 때 타이머를 여러 개 걺(복구 뒤에도 남은 타이머가 복구 불가를 알린다)
  it('손실 이벤트가 겹쳐 와도 on.lost 는 한 번이고, 복구 뒤 다시 끊기면 그때부터 3,000ms 를 다시 센다', () => {
    const { canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    fire(canvas, 'webglcontextlost');
    expect(fire(canvas, 'webglcontextlost').defaultPrevented).toBe(true);
    expect(on.lost).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    fire(canvas, 'webglcontextrestored');
    vi.advanceTimersByTime(500);
    fire(canvas, 'webglcontextlost');            // t = 1500ms 에 다시 끊김
    expect(on.lost).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2999);                // t = 4499ms
    expect(on.unrecoverable).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);                   // t = 4500ms = 1500 + 3000
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);
  });

  // 죽이는 변이: 손실 중 setData 를 끊긴 컨텍스트에 올리고 잊음(복구 뒤 옛 데이터나 빈 버퍼로 그린다)
  it('손실 중에 받은 setData 는 복구 때 올린다', () => {
    const { rec, canvas, renderer } = mount();
    fire(canvas, 'webglcontextlost');
    const data = makeData();
    const scaffold = makeScaffold();
    renderer.setData(data, scaffold);
    expect(rec.callsOf('bufferData')).toEqual([]);
    fire(canvas, 'webglcontextrestored');
    const uploaded = rec.callsOf('bufferData').map((c) => c.args[1]);
    expect(uploaded).toHaveLength(3);
    expect(uploaded).toContain(data.xyz);
    renderer.draw(makeFrame({ drawCount: 4 }));
    expect(rec.pointDraws()).toEqual([4]);
  });

  // 죽이는 변이: 복구 때 다시 만들기가 실패해도 on.restored 를 부름(빈 캔버스를 정상으로 알린다)
  it('복구 때 셰이더를 다시 만들지 못하면 on.unrecoverable 을 부르고 on.restored 는 부르지 않는다', () => {
    const { rec, canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    fire(canvas, 'webglcontextlost');
    vi.spyOn(rec.gl, 'getShaderParameter').mockReturnValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fire(canvas, 'webglcontextrestored');
    expect(on.restored).not.toHaveBeenCalled();
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10_000);
    expect(on.unrecoverable).toHaveBeenCalledTimes(1);   // 타이머가 한 번 더 알리지 않는다
  });

  // 죽이는 변이: dispose 가 타이머를 지우지 않음(언마운트된 컴포넌트에 복구 불가를 알린다),
  // dispose 가 복구 리스너를 떼지 않음(늦게 온 복구가 해제된 렌더러를 되살려 자원을 새로 만들고 알린다)
  it('손실 대기 중에 dispose 하면 타이머가 지워져 on.unrecoverable 이 불리지 않는다', () => {
    const { rec, canvas, on, renderer } = mount();
    renderer.setData(makeData(), makeScaffold());
    fire(canvas, 'webglcontextlost');
    renderer.dispose();
    vi.advanceTimersByTime(10_000);
    expect(on.unrecoverable).not.toHaveBeenCalled();
    // 복구 리스너도 떨어졌다: dispose 뒤에 온 복구 이벤트는 자원을 새로 만들지 않고 알리지도 않는다
    const programs = rec.callsOf('createProgram').length;
    fire(canvas, 'webglcontextrestored');
    expect(rec.callsOf('createProgram')).toHaveLength(programs);
    expect(on.restored).not.toHaveBeenCalled();
  });
});
