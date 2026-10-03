// 3D 점군 뷰어의 유일한 WebGL2 접점. 환경 탐지, 셰이더·버퍼·draw·dispose, 컨텍스트 손실/복구를 맡는다.
// lib 의 다른 모듈은 WebGL 과 DOM 을 건드리지 않는다. probeWebgl2 와 createRenderer 는 effect 안에서만 부른다
// (모듈 최상위에서 컨텍스트를 만들지 않는다. 서버 렌더에서 이 모듈을 import 해도 아무 일도 일어나지 않는다).
import { DEV_NO_DEVIATION, hexToRgb01 } from '@/lib/domain/points3d';
import type { Points3dData, Points3dTheme, Webgl2Support } from '@/lib/domain/points3d';

export const CONTEXT_RESTORE_TIMEOUT_MS = 3000; // 컨텍스트 복구 대기(ms). 이 안에 복구되지 않으면 복구 불가로 알린다

export interface FrameParams {
  viewProj: Float32Array;   // 파일-로컬 좌표 -> 클립 좌표(열 우선 16개)
  exaggeration: number;     // 편차 과장 배율 k
  thresholdQ: number;       // 표시 임계값(0.1mm 정수)
  pointWorldM: number;      // 점의 실제 크기(m)
  pxPerUnit: number;        // 드로잉 버퍼 px
  minPx: number;            // 드로잉 버퍼 px
  maxPx: number;            // 드로잉 버퍼 px
  drawCount: number;        // 앞에서부터 그릴 점 수(LOD)
  theme: Points3dTheme;
}

export interface Renderer {
  setData(data: Points3dData, scaffold: { verts: Float32Array; gridVertCount: number; axisVertCount: number }): void;
  resize(bufferW: number, bufferH: number): void;   // 드로잉 버퍼 px. canvas.width·height 와 viewport 를 맞춘다
  draw(frame: FrameParams): void;
  pointSizeLimit(): [number, number];               // ALIASED_POINT_SIZE_RANGE
  dispose(): void;                                  // 버퍼·VAO·프로그램 삭제, 리스너 해제. loseContext 는 부르지 않는다
}

// ---- 셰이더 ----
// GLSL 문자열은 ASCII 만 쓴다. `#version` 은 반드시 첫 줄이어야 한다(백틱 바로 뒤에 붙인다).
// 색은 GLSL 에 상수로 적지 않는다. 전부 테마의 hex 를 uniform 으로 넘긴다.
//
// 점 정점 셰이더가 하는 일:
// - aPos(정규화 UNSIGNED_SHORT, 0~1)에 uExtent 를 곱해 파일-로컬 m 좌표를 만든다.
// - aDev(0.1mm 정수)가 센티널(DEV_NO_DEVIATION 이하)이면 편차 없는 점이다.
// - 표시 높이는 z + dev * (k - 1). 편차만 과장하고 편차 없는 점은 제자리다.
// - 편차 있는 점의 깊이는 과장 전 기준면 위치(z - dev)로 계산한다. 화면 위치는 표시 위치 그대로다.
//   바닥 점들이 같은 면에 놓여, 융기 점이 카메라에 가깝다는 이유로 침하 점을 가리지 않는다.
// - 분류는 정수 비교: dev > T 융기, dev < -T 침하, 그 외 평탄.
const POINT_VS = `#version 300 es
in vec3 aPos;
in int aDev;
uniform vec3 uExtent;
uniform mat4 uViewProj;
uniform float uExag;
uniform int uThresholdQ;
uniform float uPointWorldM;
uniform float uPxPerUnit;
uniform float uMinPx;
uniform float uMaxPx;
uniform vec3 uColFlat;
uniform vec3 uColDep;
uniform vec3 uColPro;
uniform vec3 uColNone;
out vec3 vColor;
void main() {
  vec3 local = aPos * uExtent;
  bool hasDev = aDev > ${DEV_NO_DEVIATION};
  float devM = hasDev ? float(aDev) * 1e-4 : 0.0;
  vec3 shown = local + vec3(0.0, 0.0, devM * (uExag - 1.0));
  vec4 clipS = uViewProj * vec4(shown, 1.0);
  if (hasDev) {
    vec4 clipR = uViewProj * vec4(local - vec3(0.0, 0.0, devM), 1.0);
    gl_Position = vec4(clipS.xy, clipR.z / clipR.w * clipS.w, clipS.w);
  } else {
    gl_Position = clipS;
  }
  gl_PointSize = clamp(uPointWorldM * uPxPerUnit / clipS.w, uMinPx, uMaxPx);
  vColor = !hasDev ? uColNone : aDev > uThresholdQ ? uColPro : aDev < -uThresholdQ ? uColDep : uColFlat;
}`;

// 둥근 점: 점 사각형의 중심에서 반지름 0.5 밖은 버린다
const POINT_FS = `#version 300 es
precision mediump float;
in vec3 vColor;
out vec4 outColor;
void main() {
  if (length(gl_PointCoord - 0.5) > 0.5) discard;
  outColor = vec4(vColor, 1.0);
}`;

// 격자·축선: 파일-로컬 float 좌표를 그대로 변환한다. 색은 알파를 포함한 uniform 하나다
const LINE_VS = `#version 300 es
in vec3 aPos;
uniform mat4 uViewProj;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

const POINT_UNIFORMS = [
  'uExtent', 'uViewProj', 'uExag', 'uThresholdQ', 'uPointWorldM', 'uPxPerUnit', 'uMinPx', 'uMaxPx',
  'uColFlat', 'uColDep', 'uColPro', 'uColNone',
] as const;
const LINE_UNIFORMS = ['uViewProj', 'uColor'] as const;

type Locations<K extends string> = Record<K, WebGLUniformLocation | null>;
type Scaffold = { verts: Float32Array; gridVertCount: number; axisVertCount: number };

// GPU 쪽 자원 한 벌. 컨텍스트가 끊기면 전부 무효가 되므로 복구 때 통째로 다시 만든다
interface Gpu {
  pointProg: WebGLProgram;
  lineProg: WebGLProgram;
  pointU: Locations<(typeof POINT_UNIFORMS)[number]>;
  lineU: Locations<(typeof LINE_UNIFORMS)[number]>;
  aPos: number;
  aDev: number;
  lineAPos: number;
  pointVao: WebGLVertexArrayObject;
  lineVao: WebGLVertexArrayObject;
  xyzBuf: WebGLBuffer;
  devBuf: WebGLBuffer;
  lineBuf: WebGLBuffer;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(`[points3d] shader compile failed: ${gl.getShaderInfoLog(shader) ?? ''}`);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = vs && fs ? gl.createProgram() : null;
  if (program && vs && fs) {
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
  }
  // 링크가 끝나면 셰이더 객체는 필요 없다(프로그램이 결과를 들고 있다). delete* 는 null 을 받아도 된다
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (program && !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(`[points3d] program link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function locate<K extends string>(gl: WebGL2RenderingContext, program: WebGLProgram, names: readonly K[]): Locations<K> {
  const out = {} as Locations<K>;
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}

function destroy(gl: WebGL2RenderingContext, gpu: Gpu): void {
  gl.deleteBuffer(gpu.xyzBuf);
  gl.deleteBuffer(gpu.devBuf);
  gl.deleteBuffer(gpu.lineBuf);
  gl.deleteVertexArray(gpu.pointVao);
  gl.deleteVertexArray(gpu.lineVao);
  gl.deleteProgram(gpu.pointProg);
  gl.deleteProgram(gpu.lineProg);
}

// 프로그램 2개, VAO 2개, 버퍼 3개를 만든다. 하나라도 실패하면 만든 것을 지우고 null 을 돌려준다
function build(gl: WebGL2RenderingContext): Gpu | null {
  const pointProg = link(gl, POINT_VS, POINT_FS);
  const lineProg = link(gl, LINE_VS, LINE_FS);
  const pointVao = gl.createVertexArray();
  const lineVao = gl.createVertexArray();
  const xyzBuf = gl.createBuffer();
  const devBuf = gl.createBuffer();
  const lineBuf = gl.createBuffer();
  if (!pointProg || !lineProg || !pointVao || !lineVao || !xyzBuf || !devBuf || !lineBuf) {
    gl.deleteProgram(pointProg);
    gl.deleteProgram(lineProg);
    gl.deleteVertexArray(pointVao);
    gl.deleteVertexArray(lineVao);
    gl.deleteBuffer(xyzBuf);
    gl.deleteBuffer(devBuf);
    gl.deleteBuffer(lineBuf);
    return null;
  }
  return {
    pointProg,
    lineProg,
    pointU: locate(gl, pointProg, POINT_UNIFORMS),
    lineU: locate(gl, lineProg, LINE_UNIFORMS),
    aPos: gl.getAttribLocation(pointProg, 'aPos'),
    aDev: gl.getAttribLocation(pointProg, 'aDev'),
    lineAPos: gl.getAttribLocation(lineProg, 'aPos'),
    pointVao,
    lineVao,
    xyzBuf,
    devBuf,
    lineBuf,
  };
}

// 받은 배열을 그대로 올린다. xyz 는 Uint16Array 를 정규화 속성으로 넘긴다(Float32Array 사본을 만들지 않는다)
function upload(gl: WebGL2RenderingContext, gpu: Gpu, data: Points3dData, scaffold: Scaffold): void {
  gl.bindVertexArray(gpu.pointVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.xyzBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data.xyz, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(gpu.aPos);
  gl.vertexAttribPointer(gpu.aPos, 3, gl.UNSIGNED_SHORT, true, 0, 0);   // 정규화: 0~65535 -> 0~1
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.devBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data.dev, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(gpu.aDev);
  gl.vertexAttribIPointer(gpu.aDev, 1, gl.SHORT, 0, 0);                 // 정수 속성: 셰이더가 int 로 받는다
  gl.bindVertexArray(gpu.lineVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.lineBuf);
  gl.bufferData(gl.ARRAY_BUFFER, scaffold.verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(gpu.lineAPos);
  gl.vertexAttribPointer(gpu.lineAPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
}

// 탐지용 컨텍스트를 하나 만들어 보고 곧바로 반납한다. canvas 는 문서에 붙이지 않고 버린다
function canCreateContext(attributes?: WebGLContextAttributes): boolean {
  const canvas = document.createElement('canvas');
  const gl = attributes ? canvas.getContext('webgl2', attributes) : canvas.getContext('webgl2');
  if (!gl) return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

// WebGL2 환경 탐지. 성능 저하 없이 만들 수 있으면 'hardware', 옵션 없이만 만들어지면 'software'(소프트웨어 렌더)
export function probeWebgl2(): Webgl2Support {
  if (canCreateContext({ failIfMajorPerformanceCaveat: true })) return 'hardware';
  if (canCreateContext()) return 'software';
  return 'unsupported';
}

export function createRenderer(
  canvas: HTMLCanvasElement,
  on: { lost(): void; restored(): void; unrecoverable(): void },
): Renderer | null {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return null;
  let gpu = build(gl);
  if (!gpu) return null;   // 셰이더 컴파일·링크 실패. 호출자가 WebGL2 불가 화면으로 사유를 드러낸다

  // 기기의 성질이라 한 번만 읽는다(컨텍스트가 끊긴 동안에는 getParameter 가 null 을 준다)
  const sizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
  const sizeLimit: [number, number] = sizeRange ? [sizeRange[0], sizeRange[1]] : [1, 1];

  let held: { data: Points3dData; scaffold: Scaffold } | null = null;   // 복구 때 다시 올릴 배열 참조
  let lost = false;
  let unrecoverable = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const onLost = (event: Event) => {
    event.preventDefault();   // 기본 동작을 막아야 webglcontextrestored 가 온다
    if (lost) return;
    lost = true;
    gpu = null;               // 끊긴 컨텍스트의 자원은 이미 무효다
    timer = setTimeout(() => {
      timer = null;
      unrecoverable = true;
      on.unrecoverable();
    }, CONTEXT_RESTORE_TIMEOUT_MS);
    on.lost();
  };

  const onRestored = () => {
    if (!lost || unrecoverable) return;   // 복구 불가를 알린 뒤 늦게 온 복구는 무시한다
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    gpu = build(gl);
    if (!gpu) {               // 다시 만들지 못하면 조용히 빈 캔버스로 두지 않고 복구 불가로 알린다
      unrecoverable = true;
      on.unrecoverable();
      return;
    }
    lost = false;
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (held) upload(gl, gpu, held.data, held.scaffold);
    on.restored();
  };

  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    setData(data, scaffold) {
      held = { data, scaffold };
      if (gpu) upload(gl, gpu, data, scaffold);   // 손실 중이면 복구 때 올린다
    },

    resize(bufferW, bufferH) {
      if (canvas.width !== bufferW) canvas.width = bufferW;
      if (canvas.height !== bufferH) canvas.height = bufferH;
      gl.viewport(0, 0, bufferW, bufferH);
    },

    draw(frame) {
      if (!gpu || !held) return;   // 손실 중이거나 데이터가 아직 없다
      const theme = frame.theme;
      const scaffold = held.scaffold;

      // (1) 배경색으로 지운다. 깊이 쓰기는 직전 프레임의 점 단계가 켜 둔 채다(끄면 깊이 버퍼가 지워지지 않는다)
      const [bgR, bgG, bgB] = hexToRgb01(theme.background);
      gl.clearColor(bgR, bgG, bgB, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // (2) 격자·축선: 블렌딩 켬, 깊이 쓰기 끔. 같은 정점 버퍼의 두 구간을 색만 바꿔 그린다
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(gpu.lineProg);
      gl.bindVertexArray(gpu.lineVao);
      gl.uniformMatrix4fv(gpu.lineU.uViewProj, false, frame.viewProj);
      const [lineR, lineG, lineB] = hexToRgb01(theme.line);
      gl.uniform4f(gpu.lineU.uColor, lineR, lineG, lineB, theme.gridAlpha);
      gl.drawArrays(gl.LINES, 0, scaffold.gridVertCount);
      gl.uniform4f(gpu.lineU.uColor, lineR, lineG, lineB, theme.axisAlpha);
      gl.drawArrays(gl.LINES, scaffold.gridVertCount, scaffold.axisVertCount);

      // (3) 점: 블렌딩 끔, 깊이 테스트 LESS, 깊이 쓰기 켬
      gl.disable(gl.BLEND);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
      gl.useProgram(gpu.pointProg);
      gl.bindVertexArray(gpu.pointVao);
      const u = gpu.pointU;
      const extent = held.data.meta.extent_m;
      gl.uniformMatrix4fv(u.uViewProj, false, frame.viewProj);
      gl.uniform3f(u.uExtent, extent[0], extent[1], extent[2]);
      gl.uniform1f(u.uExag, frame.exaggeration);
      gl.uniform1i(u.uThresholdQ, frame.thresholdQ);   // 정수 uniform. 셰이더의 비교가 정수 비교다
      gl.uniform1f(u.uPointWorldM, frame.pointWorldM);
      gl.uniform1f(u.uPxPerUnit, frame.pxPerUnit);
      gl.uniform1f(u.uMinPx, frame.minPx);
      gl.uniform1f(u.uMaxPx, frame.maxPx);
      gl.uniform3f(u.uColFlat, ...hexToRgb01(theme.flat));
      gl.uniform3f(u.uColDep, ...hexToRgb01(theme.depression));
      gl.uniform3f(u.uColPro, ...hexToRgb01(theme.protrusion));
      gl.uniform3f(u.uColNone, ...hexToRgb01(theme.none));
      // 파일이 해시 순이라 앞 drawCount 개가 고른 표본이다. 버퍼 밖을 그리면 아무것도 나오지 않으므로 n 으로 막는다
      const n = held.data.dev.length;
      gl.drawArrays(gl.POINTS, 0, Math.max(0, Math.min(n, Math.floor(frame.drawCount))));
      gl.bindVertexArray(null);
    },

    pointSizeLimit() {
      return [sizeLimit[0], sizeLimit[1]];
    },

    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (gpu) destroy(gl, gpu);
      gpu = null;
      held = null;
      // WEBGL_lose_context.loseContext() 를 부르지 않는다. React 개발 모드의 effect 이중 실행이 같은 canvas 를
      // 다시 쓰는데, 한 번 끊은 canvas 는 다시 getContext 해도 끊긴 컨텍스트를 돌려준다.
    },
  };
}
