// slope_cells.json 기반 Canvas 구배 히트맵 렌더러 (브리프 D3, 스펙 §7.2)
//
// ★ 판정 이중화 금지(스펙 §7.3): 이 파일은 엔진이 이미 낸 grade 문자열(적합·경계·
// 보수·재시공·판정불가)을 색으로 바꿔 칠할 뿐이다. 기준 스키마의 판정 임계값
// 필드는 이 파일 어디에도 등장하지 않는다 - 등장하면 판정이 파이썬과 브라우저
// 두 곳에 생기는 것이고, 세부과업 1에서 실제로 그런 결함이 있었다.
//
// PNG(엔진 outputs/slope_map.py)를 화면에서 다시 쓰지 않고 Canvas로 다시 그리는
// 이유: PNG에는 좌표계 정보가 없고 tight_layout·dpi=120으로 여백이 가변이라 클릭
// 좌표를 미터로 환산할 수 없다. 화살표 굵기(역구배 강조)도 상호작용적으로 못
// 바꾼다.
import { worldToPx } from './slope-cells';
import type { SlopeTransform } from './slope-cells';
import type { SlopeCellRow, SlopeGrade } from './types';

// 엔진 engine/flatness/outputs/slope_map.py의 _COLOR와 반드시 일치시킨다. 같은
// 데이터를 matplotlib PNG와 Canvas가 서로 다른 색으로 그리면 같은 스캔의 두
// 그림이 나란히 뜰 때 혼란을 준다(브리프 D3) - GRADE_COLOR(labels.ts)의 평활도
// 색과는 다른 값이므로 절대 재사용하지 않는다.
export const SLOPE_GRADE_COLOR: Record<SlopeGrade, string> = {
  적합: '#3d8b3d', 경계: '#d6c11e', 보수: '#e07b1a', 재시공: '#c0392b', 판정불가: '#9e9e9e',
};

/** Canvas에 그릴 셀 하나 - 기하(slope_cells.json에서 온 SlopeCellRow) + 등급.
 *
 * grade가 어디서 왔는지는 이 파일의 관심사가 아니다(호출부가 이미 판정된 값을
 * 그대로 넘긴다). reverse는 역구배 강조 여부다 - 스펙 §7.2가 "역구배는 색만으로
 * 드러나지 않는다"고 경계하므로 화살표를 굵게 그리는 신호로만 쓴다. */
export interface GradedSlopeCell {
  cell: SlopeCellRow;
  grade: SlopeGrade;
  reverse?: boolean;
}

/** 실제로 칠할 색을 결정한다. ok=false 셀은 slope_pct·downhill_rad가 없어
 * 측정값 자체가 없으므로, 호출부가 무슨 grade를 넘기든 판정불가로 강제한다.
 * 이건 엔진 grade_slope_cells도 그대로 따르는 규칙이다(slope.py: "if not c.ok:
 * out.append({grade: GRADE_NA, ...})") - 임계값 비교가 아니라 유효성 플래그를
 * 그대로 따르는 것뿐이므로 §7.3의 판정 이중화가 아니다. */
export function slopeCellFillColor(cell: SlopeCellRow, grade: SlopeGrade): string {
  const effective = cell.ok ? grade : '판정불가';
  return SLOPE_GRADE_COLOR[effective] ?? SLOPE_GRADE_COLOR.판정불가;
}

/** 셀 사각형의 Canvas 픽셀 좌표(좌상단 x,y + 폭·높이). */
export function slopeCellRectPx(
  t: SlopeTransform, cell: SlopeCellRow,
): { x: number; y: number; w: number; h: number } {
  const topLeft = worldToPx(t, cell.center_x - cell.width_m / 2, cell.center_y + cell.height_m / 2);
  const bottomRight = worldToPx(t, cell.center_x + cell.width_m / 2, cell.center_y - cell.height_m / 2);
  return { x: topLeft.px, y: topLeft.py, w: bottomRight.px - topLeft.px, h: bottomRight.py - topLeft.py };
}

/** 내리막 화살표의 Canvas 벡터(dx, dy)를 구한다.
 *
 * ★★ 이 태스크의 핵심 함정(브리프 D3): 엔진은 ax.arrow(cx, cy, L*cos(θ), L*sin(θ))
 * 로 화살표를 그리는데, matplotlib 데이터 좌표는 y가 위로 증가한다. Canvas는 y가
 * 아래로 증가하므로 sin의 부호를 뒤집지 않으면 모든 화살표가 상하 반전된다.
 * 색은 정상이라 화면상 아무 경고가 없다 - 스펙이 "역구배는 색으로 안 드러난다"고
 * 경계한 바로 그 실패 양식이 렌더러 버그로 재현되는 지점이다. 회귀 테스트로
 * 반드시 고정한다(__tests__/slope-heatmap.test.ts). */
export function downhillArrowPx(downhillRad: number, lengthPx: number): { dx: number; dy: number } {
  return { dx: lengthPx * Math.cos(downhillRad), dy: -lengthPx * Math.sin(downhillRad) };
}

/** 셀 배경(등급 색) + 내리막 화살표를 Canvas에 그린다.
 *
 * cellM은 화살표 길이 산정에 쓴다(엔진 render_slope_map과 같은 비율: cell_m*0.35).
 * ok=false 셀이나 downhill_rad가 없는 셀(재판정 전 등)은 화살표를 그리지 않는다. */
export function drawSlopeHeatmap(
  ctx: CanvasRenderingContext2D, cells: GradedSlopeCell[], t: SlopeTransform, cellM: number,
): void {
  const arrowLenPx = cellM * 0.35 * t.scale;
  for (const g of cells) {
    const r = slopeCellRectPx(t, g.cell);
    ctx.fillStyle = slopeCellFillColor(g.cell, g.grade);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(r.x, r.y, r.w, r.h);

    if (!g.cell.ok || g.cell.downhill_rad === null) continue;
    const center = worldToPx(t, g.cell.center_x, g.cell.center_y);
    const { dx, dy } = downhillArrowPx(g.cell.downhill_rad, arrowLenPx);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = g.reverse ? 2.2 : 0.9;
    ctx.beginPath();
    ctx.moveTo(center.px, center.py);
    ctx.lineTo(center.px + dx, center.py + dy);
    ctx.stroke();
  }
}
