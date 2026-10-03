// gl 호출 기록 스텁 (테스트 헬퍼. vitest include 가 `**/__tests__/**/*.test.{ts,tsx}` 라
// 이 파일 자체는 테스트로 수집되지 않는다). components/registration/__tests__/canvas-stub.ts 와 같은 방식이다.
//
// jsdom 에는 WebGL2 컨텍스트가 없다. 이 스텁은 gl 메서드 호출을 순서대로 기록해
// "무엇을 · 어떤 순서로 · 어떤 값으로" 불렀는지를 실제 렌더 경로에서 관찰하게 한다.
// 픽셀은 검증하지 못한다. 실제 그림은 화면 캡처 대조가 맡는다.
//
// 끼우는 법(컴포넌트 테스트도 같다):
//   const rec = recordingGl();
//   vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => rec.gl);
//
// 규약:
// - 아래 목록의 gl 메서드 호출은 전부 calls 에 { name, args } 로 쌓인다. 목록에 없는 메서드를 부르면
//   "is not a function" 으로 시끄럽게 실패한다(그때는 VOID_METHODS 에 이름을 더한다).
// - getUniformLocation(program, name) 은 { uniformName: name, program } 을 돌려준다.
// - getAttribLocation 은 이름별 고정 번호(aPos 0, aDev 1), 모르는 이름은 -1.
// - getShaderParameter·getProgramParameter 는 true. 실패 경로는 테스트가
//   vi.spyOn(rec.gl, 'getShaderParameter').mockReturnValue(false) 로 만든다.
// - WebGL 상수는 실제 값이다.

export interface GlCall { name: string; args: unknown[] }

export interface RecordingGl {
  gl: WebGL2RenderingContext;
  calls: GlCall[];
  callsOf(name: string): GlCall[];               // 그 이름의 호출만(호출 순)
  uniformCalls(uniformName: string): GlCall[];   // 그 uniform 위치로 간 uniform* 호출(호출 순, 두 프로그램 모두)
  attribLocation(name: string): number;          // getAttribLocation 이 돌려주는 번호
  pointDraws(): number[];                        // drawArrays(POINTS, 0, c) 의 c 목록(호출 순)
  loseContextCalls(): number;                    // WEBGL_lose_context.loseContext() 호출 수
}

// 실제 WebGL2 상수 값
const GL_CONSTANTS = {
  POINTS: 0x0000, LINES: 0x0001, TRIANGLES: 0x0004,
  ZERO: 0, ONE: 1,
  DEPTH_BUFFER_BIT: 0x0100, COLOR_BUFFER_BIT: 0x4000,
  LESS: 0x0201, LEQUAL: 0x0203,
  SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303,
  DEPTH_TEST: 0x0b71, BLEND: 0x0be2,
  UNSIGNED_BYTE: 0x1401, SHORT: 0x1402, UNSIGNED_SHORT: 0x1403, INT: 0x1404, FLOAT: 0x1406,
  ALIASED_POINT_SIZE_RANGE: 0x846d,
  ARRAY_BUFFER: 0x8892, STATIC_DRAW: 0x88e4,
  FRAGMENT_SHADER: 0x8b30, VERTEX_SHADER: 0x8b31,
  COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
};

const ATTRIB_LOCATION: Record<string, number> = { aPos: 0, aDev: 1 };

// 반환값이 없는 메서드. 호출만 기록한다
const VOID_METHODS = [
  'shaderSource', 'compileShader', 'attachShader', 'detachShader', 'linkProgram', 'useProgram',
  'deleteShader', 'deleteProgram', 'deleteBuffer', 'deleteVertexArray',
  'bindBuffer', 'bufferData', 'bufferSubData', 'bindVertexArray',
  'enableVertexAttribArray', 'disableVertexAttribArray',
  'vertexAttribPointer', 'vertexAttribIPointer', 'vertexAttribDivisor',
  'uniform1i', 'uniform1f', 'uniform2f', 'uniform3f', 'uniform4f',
  'uniform1iv', 'uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv', 'uniformMatrix4fv',
  'viewport', 'clearColor', 'clearDepth', 'clear', 'enable', 'disable',
  'depthFunc', 'depthMask', 'blendFunc', 'blendFuncSeparate', 'colorMask',
  'drawArrays', 'flush', 'finish',
];

export function recordingGl(opts?: { pointSizeRange?: [number, number] }): RecordingGl {
  const calls: GlCall[] = [];
  const pointSizeRange = opts?.pointSizeRange ?? [1, 1024];
  let nextId = 1;
  let loseCount = 0;

  // 이름과 인자를 기록한 뒤 impl 의 반환값을 돌려주는 함수를 만든다
  const recorded = (name: string, impl: (...args: unknown[]) => unknown = () => undefined) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      return impl(...args);
    };

  const loseContextExt = {
    loseContext: recorded('loseContext', () => { loseCount += 1; }),
    restoreContext: recorded('restoreContext'),
  };

  const gl: Record<string, unknown> = { ...GL_CONSTANTS };
  for (const name of VOID_METHODS) gl[name] = recorded(name);
  // 핸들은 서로 다른 객체다. 테스트가 toBe 로 "같은 버퍼인가"를 본다
  gl.createShader = recorded('createShader', (type) => ({ kind: 'shader', id: nextId++, type }));
  gl.createProgram = recorded('createProgram', () => ({ kind: 'program', id: nextId++ }));
  gl.createBuffer = recorded('createBuffer', () => ({ kind: 'buffer', id: nextId++ }));
  gl.createVertexArray = recorded('createVertexArray', () => ({ kind: 'vao', id: nextId++ }));
  gl.getShaderParameter = recorded('getShaderParameter', () => true);
  gl.getProgramParameter = recorded('getProgramParameter', () => true);
  gl.getShaderInfoLog = recorded('getShaderInfoLog', () => '');
  gl.getProgramInfoLog = recorded('getProgramInfoLog', () => '');
  gl.getUniformLocation = recorded('getUniformLocation', (program, name) => ({ uniformName: name, program }));
  gl.getAttribLocation = recorded('getAttribLocation', (_program, name) => ATTRIB_LOCATION[name as string] ?? -1);
  gl.getParameter = recorded('getParameter', (pname) =>
    (pname === GL_CONSTANTS.ALIASED_POINT_SIZE_RANGE ? new Float32Array(pointSizeRange) : null));
  gl.getExtension = recorded('getExtension', (name) => (name === 'WEBGL_lose_context' ? loseContextExt : null));
  gl.isContextLost = recorded('isContextLost', () => false);
  gl.getError = recorded('getError', () => 0);

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    calls,
    callsOf: (name) => calls.filter((c) => c.name === name),
    uniformCalls: (uniformName) => calls.filter((c) => c.name.startsWith('uniform')
      && (c.args[0] as { uniformName?: string } | null)?.uniformName === uniformName),
    attribLocation: (name) => ATTRIB_LOCATION[name] ?? -1,
    pointDraws: () => calls
      .filter((c) => c.name === 'drawArrays' && c.args[0] === GL_CONSTANTS.POINTS && c.args[1] === 0)
      .map((c) => c.args[2] as number),
    loseContextCalls: () => loseCount,
  };
}
