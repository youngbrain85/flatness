// 4x4 행렬 유틸(열 우선 Float32Array(16), m[c * 4 + r]). 순수 함수이고 DOM 과 WebGL 을 건드리지 않는다.
// 카메라 좌표계는 오른손(-z 가 전방), 클립 z 는 [-1, 1] (WebGL 관례).

export type Vec3 = [number, number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a: Vec3): Vec3 => {
  const len = Math.hypot(a[0], a[1], a[2]) || 1; // 길이 0 이면 그대로 둔다(0 으로 나누지 않는다)
  return [a[0] / len, a[1] / len, a[2] / len];
};

// 원근 투영. fovy 는 세로 시야각(rad), aspect 는 가로 / 세로
export function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

// 뷰 행렬. eye 에서 center 를 보고 up 이 화면 위쪽이 된다
export function lookAt(eye: Vec3, center: Vec3, up: Vec3): Float32Array {
  const f = normalize(sub(center, eye)); // 전방
  const s = normalize(cross(f, up)); // 오른쪽
  const u = cross(s, f); // 위
  return new Float32Array([
    s[0], u[0], -f[0], 0,
    s[1], u[1], -f[1], 0,
    s[2], u[2], -f[2], 0,
    -dot(s, eye), -dot(u, eye), dot(f, eye), 1,
  ]);
}

// a x b (b 를 먼저 적용한다)
export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

// 점 (x, y, z, 1) 을 옮긴 클립 좌표 [x, y, z, w]
export function transformPoint(m: Float32Array, p: Vec3): [number, number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  ];
}

// 점을 화면(CSS px, 왼쪽 위 원점, y 는 아래로 증가)으로 옮긴다. 카메라 뒤(w <= 0)면 null.
// w 는 클립 w 로, 원근 투영에서는 카메라 전방 거리다(pick 의 동률 처리에 쓴다).
export function project(
  m: Float32Array, p: Vec3, cssW: number, cssH: number,
): { x: number; y: number; w: number } | null {
  const [cx, cy, , w] = transformPoint(m, p);
  if (w <= 0) return null;
  return { x: (cx / w * 0.5 + 0.5) * cssW, y: (1 - (cy / w * 0.5 + 0.5)) * cssH, w };
}
