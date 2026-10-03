// 읽기 창용 최근접 점 탐색(순수 함수). 커서 아래에서 화면상 가장 가까운 점 하나를 찾는다.
// 점 50만 개를 프레임당 한 번 도는 함수라 점마다 배열·객체를 만들지 않고 행렬 원소를 꺼내 직접 계산한다.
import { DEV_NO_DEVIATION, type Points3dData } from '@/lib/domain/points3d';

export const PICK_RADIUS_PX = 12; // 읽기 창 반경(CSS px)

const DEV_Q_TO_M = 1e-4; // 편차 정수(0.1mm) -> m

// 점 인덱스 또는 null. cssW·cssH·cursorX·cursorY·radiusPx 는 전부 CSS px 이고 커서는 캔버스 왼쪽 위 기준이다.
// 점의 화면 위치는 표시 위치(z + dev * (k - 1))다. 편차 없는 점(두 센티널)은 과장하지 않는다.
// 화면 거리가 같으면 카메라에 가까운 점(클립 w 가 작은 점)을 고른다. 카메라 뒤(w <= 0)의 점은 건너뛴다.
export function pickNearest(
  data: Points3dData, viewProj: Float32Array, exaggeration: number,
  cssW: number, cssH: number, cursorX: number, cursorY: number,
  radiusPx: number = PICK_RADIUS_PX,
): number | null {
  const { xyz, dev } = data;
  const n = dev.length;
  // 복원 식 local = q * extent_m / 65535 의 축별 계수
  const sx = data.meta.extent_m[0] / 65535;
  const sy = data.meta.extent_m[1] / 65535;
  const sz = data.meta.extent_m[2] / 65535;
  const lift = (exaggeration - 1) * DEV_Q_TO_M; // dev 정수 1 당 올릴 높이(m)
  const noDev = DEV_NO_DEVIATION; // 루프 안에서 모듈 바인딩을 매번 읽지 않도록 지역 변수로 꺼낸다
  // 열 우선 행렬에서 clip.x, clip.y, clip.w 행만 쓴다(깊이 행은 필요 없다)
  const m0 = viewProj[0], m4 = viewProj[4], m8 = viewProj[8], m12 = viewProj[12];
  const m1 = viewProj[1], m5 = viewProj[5], m9 = viewProj[9], m13 = viewProj[13];
  const m3 = viewProj[3], m7 = viewProj[7], m11 = viewProj[11], m15 = viewProj[15];
  const halfW = cssW / 2;
  const halfH = cssH / 2;

  let best = -1;
  let bestD2 = radiusPx * radiusPx; // 제곱 거리로 비교한다. 반경 경계는 포함
  let bestW = Infinity;
  for (let i = 0, j = 0; i < n; i++, j += 3) {
    const x = xyz[j] * sx;
    const y = xyz[j + 1] * sy;
    let z = xyz[j + 2] * sz;
    const d = dev[i];
    if (d > noDev) z += d * lift; // 편차만 과장한다
    const w = m3 * x + m7 * y + m11 * z + m15;
    if (w <= 0) continue; // 카메라 뒤
    const dx = ((m0 * x + m4 * y + m8 * z + m12) / w + 1) * halfW - cursorX;
    const dy = (1 - (m1 * x + m5 * y + m9 * z + m13) / w) * halfH - cursorY; // 화면 y 는 아래로 증가
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2) continue;
    if (d2 < bestD2 || w < bestW) {
      best = i;
      bestD2 = d2;
      bestW = w;
    }
  }
  return best < 0 ? null : best;
}
