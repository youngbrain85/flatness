// 판정 히트맵(cells.json)을 검정 스테이지 캔버스에 그리는 순수 함수 묶음
// (아트보드 docs/design/dark/ScanDone.dc.html 의 paint 를 옮겼다. 외부 라이브러리 없이 Canvas 2D 만 쓴다).
// - 색은 lib/domain/palette.ts 상수만 쓴다(화면 등급 색·스테이지 색). 엔진 hex(labels.ts 의 PDF 색)는
//   PDF·엔진 PNG 몫이라 여기서 쓰지 않는다(스펙 2026-10-17 §3).
// - 판정하지 않는다: 칸 색은 엔진이 cells.json 에 적은 grade 를 그대로 칠하고, 최댓값 칸은 값(mm) 비교로만
//   고른다(엔진 build_stats 의 worst 와 같은 규칙). 판정 기준 필드는 이 파일에 나오지 않는다(테스트가 막는다).
// - 좌표는 CSS px 다. 드로잉 버퍼 배율(setTransform)은 호출부(components/analysis/heatmap-view.tsx)가 맞춘다.
import {
  CELL_GAP_COLOR, CELL_INK, SCREEN_GRADE_COLOR, STAGE_AXIS_TEXT, STAGE_BG, STAGE_GRID, STAGE_INK,
} from '@/lib/domain/palette';
import { GRADE_LABEL, fmtMm } from '@/lib/domain/labels';
import type { CellRow, Grade } from '@/lib/domain/types';

export interface GridGeometry { minIx: number; minIy: number; cols: number; rows: number; }

export function gridGeometry(cells: CellRow[]): GridGeometry | null {
  if (cells.length === 0) return null;
  let minIx = Infinity, maxIx = -Infinity, minIy = Infinity, maxIy = -Infinity;
  for (const c of cells) {
    if (c.ix < minIx) minIx = c.ix;
    if (c.ix > maxIx) maxIx = c.ix;
    if (c.iy < minIy) minIy = c.iy;
    if (c.iy > maxIy) maxIy = c.iy;
  }
  return { minIx, minIy, cols: maxIx - minIx + 1, rows: maxIy - minIy + 1 };
}

/** 둘레 여백(CSS px, 아트보드 값). left 는 y축 숫자, bottom 은 x축 숫자와 HUD 자리, 오른쪽 위 legendW x legendH 는 범례 자리다. */
export const STAGE_MARGIN = { left: 44, right: 22, top: 24, bottom: 60, legendW: 112, legendH: 150 } as const;
/** 칸 한 변이 이보다 작으면 칸을 그리지 않는다(바탕만 칠한다). */
export const MIN_CELL_PX = 8;
/** 칸 한 변이 이 값 이상일 때만 칸 가운데에 값(mm)을 쓴다. */
export const CELL_TEXT_MIN_PX = 30;

const GRADE_ORDER: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];
const MONO_FALLBACK = 'ui-monospace, monospace';

/** 칸 묶음의 배치(CSS px). c 는 칸 한 변(정수), (x0, y0) 은 칸 묶음 왼쪽 위, side 는 범례가 오른쪽에 있는 배치인가. */
export interface HeatmapLayout { c: number; x0: number; y0: number; gw: number; gh: number; side: boolean; }

/**
 * 스테이지(w x h) 안의 칸 배치. 칸은 정사각형이고, 범례를 칸 묶음 오른쪽에 두는 배치(넓은 화면)와 위에 두는
 * 배치(휴대폰) 중 칸이 큰 쪽을 고른다. 크기가 0 이거나 칸이 MIN_CELL_PX 보다 작아지면 null 이다.
 */
export function heatmapLayout(geom: GridGeometry, w: number, h: number): HeatmapLayout | null {
  if (!(w > 0) || !(h > 0)) return null;
  const M = STAGE_MARGIN;
  const cSide = Math.floor(Math.min((w - M.left - M.right - M.legendW) / geom.cols, (h - M.top - M.bottom) / geom.rows));
  const cBelow = Math.floor(Math.min((w - M.left - M.right) / geom.cols, (h - M.legendH - M.bottom) / geom.rows));
  const side = cSide >= cBelow;
  const c = side ? cSide : cBelow;
  if (c < MIN_CELL_PX) return null;
  const gw = c * geom.cols;
  const gh = c * geom.rows;
  const limit = side ? w - M.right - M.legendW : w - M.right;   // 칸 묶음 오른쪽 끝이 넘으면 안 되는 선
  const top = side ? M.top : M.legendH;
  const x0 = Math.round(Math.max(M.left, Math.min((w - gw) / 2, limit - gw)));
  const y0 = Math.round(top + (h - M.bottom - top - gh) / 2);
  return { c, x0, y0, gw, gh, side };
}

/** 셀이 차지하는 정사각형의 왼쪽 위(CSS px). iy 는 실좌표에서 위로 증가하므로 캔버스(아래로 증가)에서는 행을 뒤집는다. */
export function cellSquare(
  layout: HeatmapLayout, geom: GridGeometry, cell: Pick<CellRow, 'ix' | 'iy'>,
): { x: number; y: number } {
  return {
    x: layout.x0 + (cell.ix - geom.minIx) * layout.c,
    y: layout.y0 + (geom.rows - 1 - (cell.iy - geom.minIy)) * layout.c,
  };
}

/** 누른 자리(CSS px, 캔버스 왼쪽 위 기준)의 셀. cellSquare 의 역이다. 칸 묶음 밖이나 빈 자리는 null. */
export function cellAtPoint(
  layout: HeatmapLayout, geom: GridGeometry, cells: CellRow[], x: number, y: number,
): CellRow | null {
  const col = Math.floor((x - layout.x0) / layout.c);
  const row = Math.floor((y - layout.y0) / layout.c);
  if (col < 0 || row < 0 || col >= geom.cols || row >= geom.rows) return null;
  const ix = geom.minIx + col;
  const iy = geom.minIy + (geom.rows - 1 - row);
  return cells.find((c) => c.ix === ix && c.iy === iy) ?? null;
}

/** 값(mm)이 가장 큰 칸. 값 없는 칸은 건너뛰고 같은 값이면 앞의 칸(엔진 build_stats 의 worst 와 같은 규칙). */
export function maxValueCell(cells: CellRow[]): CellRow | null {
  let top: CellRow | null = null;
  let topValue = -Infinity;
  for (const c of cells) {
    if (c.value_mm === null || c.value_mm <= topValue) continue;
    top = c;
    topValue = c.value_mm;
  }
  return top;
}

/** HUD·캔버스 이름의 셀 크기 표기. stats.meta.cell_m 이 없으면(옛 분석) 크기를 말하지 않는다. */
export function heatmapCellTag(cellM: number | null): string {
  return cellM !== null ? `${cellM}m 셀` : '판정 셀';
}

function maxText(cells: CellRow[]): string {
  const top = maxValueCell(cells);
  return top ? `${fmtMm(top.value_mm)} mm` : '-';
}

/** 스테이지 왼쪽 아래 HUD: 셀 크기 · 칸 수(유효) · 최댓값. */
export function heatmapHud(cells: CellRow[], cellM: number | null): string {
  const valid = cells.filter((c) => c.value_mm !== null).length;
  return `${heatmapCellTag(cellM)} · ${cells.length}칸(유효 ${valid}) · 최댓값 ${maxText(cells)}`;
}

/** 캔버스의 접근성 이름: 열·행·칸 수, 칸이 있는 등급별 개수(엔진 grade 를 셀 뿐이다), 최댓값. */
export function heatmapAriaLabel(cells: CellRow[], geom: GridGeometry, cellM: number | null): string {
  const counts = new Map<Grade, number>();
  for (const c of cells) counts.set(c.grade, (counts.get(c.grade) ?? 0) + 1);
  const parts = GRADE_ORDER
    .filter((g) => (counts.get(g) ?? 0) > 0)
    .map((g) => `${GRADE_LABEL[g]} ${counts.get(g)}칸`);
  return `판정 히트맵 평면도. ${heatmapCellTag(cellM)} ${geom.cols}열 ${geom.rows}행 ${cells.length}칸, `
    + [...parts, `최댓값 ${maxText(cells)}`].join(', ');
}

/** 캔버스 글꼴. next/font 가 만든 IBM Plex Mono 이름은 CSS 변수(--font-plex-mono)에만 있다. 못 읽으면 시스템 고정폭. */
export function canvasMonoFamily(): string {
  if (typeof document === 'undefined' || !document.body) return MONO_FALLBACK;
  const v = getComputedStyle(document.body).getPropertyValue('--font-plex-mono').trim();
  return v ? `${v}, ${MONO_FALLBACK}` : MONO_FALLBACK;
}

export interface StageHeatmapInput {
  w: number;                       // 캔버스 CSS 폭
  h: number;                       // 캔버스 CSS 높이
  cells: CellRow[];
  geom: GridGeometry;
  layout: HeatmapLayout | null;    // heatmapLayout(geom, w, h)
  cellM: number | null;            // stats.meta.cell_m. null 이면 축 숫자를 쓰지 않는다
  fontFamily: string;              // canvasMonoFamily()
}

function axisLabel(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * 스테이지 히트맵 한 장(아트보드 paint 순서): 바탕 → 격자선 → 칸 묶음 검정 → 칸 → 칸 숫자 → 최댓값 테두리 → 축 숫자.
 */
export function drawStageHeatmap(ctx: CanvasRenderingContext2D, input: StageHeatmapInput): void {
  const { w, h, cells, geom, layout, cellM, fontFamily } = input;
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, w, h);
  if (!layout) return;   // 너무 좁으면 바탕만 둔다. 칸 정보는 HUD 와 캔버스 이름이 말한다
  const { c, x0, y0, gw, gh } = layout;
  // 격자선·축 숫자 간격: 1m(셀이 1m 보다 크면 셀 한 변). 셀 크기를 모르면 칸마다 선을 긋고 축 숫자는 쓰지 않는다
  const stepM = cellM === null ? null : Math.max(1, cellM);
  const k = cellM === null || stepM === null ? 1 : Math.max(1, Math.round(stepM / cellM));
  const pitch = c * k;
  ctx.strokeStyle = STAGE_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0 - Math.floor(x0 / pitch) * pitch; x <= w; x += pitch) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
  for (let y = y0 - Math.floor(y0 / pitch) * pitch; y <= h; y += pitch) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  ctx.stroke();
  // 칸 묶음 자리는 다시 검정으로 덮어 칸 사이 틈이 온전히 검정이게 한다
  ctx.fillStyle = CELL_GAP_COLOR;
  ctx.fillRect(x0 - 1, y0 - 1, gw + 2, gh + 2);
  // 칸: 사방 1px 씩 줄여 칠하면 이웃 칸 사이에 2px 틈이 남는다. 모르는 grade 문자열은 판정 불가 색
  for (const cell of cells) {
    const s = cellSquare(layout, geom, cell);
    ctx.fillStyle = SCREEN_GRADE_COLOR[cell.grade] ?? SCREEN_GRADE_COLOR.na;
    ctx.fillRect(s.x + 1, s.y + 1, c - 2, c - 2);
  }
  // 칸 가운데 값(mm, 등급 색 칸 위의 글자 색 CELL_INK). 칸이 작으면 생략하고, 값이 없는 칸(판정 불가)에는 쓰지 않는다
  if (c >= CELL_TEXT_MIN_PX) {
    const fs = Math.max(9, Math.min(15, Math.round(c * 0.17)));
    ctx.fillStyle = CELL_INK;
    ctx.font = `500 ${fs}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const cell of cells) {
      if (cell.value_mm === null) continue;
      const s = cellSquare(layout, geom, cell);
      ctx.fillText(fmtMm(cell.value_mm), s.x + c / 2, s.y + c / 2);
    }
  }
  // 최댓값 칸에 2px 테두리. 선 두께가 칸 안쪽에 들어오게 2px 안으로 그린다
  const top = maxValueCell(cells);
  if (top) {
    const s = cellSquare(layout, geom, top);
    ctx.strokeStyle = STAGE_INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(s.x + 2, s.y + 2, c - 4, c - 4);
  }
  if (stepM === null) return;
  // 축 숫자(m). x 는 아래, y 는 왼쪽. 마지막 x 숫자에만 단위를 붙이고 숫자는 다른 숫자처럼 선 가운데에 둔다
  ctx.fillStyle = STAGE_AXIS_TEXT;
  ctx.font = `11px ${fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const nX = Math.round(geom.cols / k);
  const nY = Math.round(geom.rows / k);
  for (let q = 0; q < nX; q++) ctx.fillText(axisLabel(q * stepM), x0 + q * pitch, y0 + gh + 14);
  const lastX = axisLabel(nX * stepM);
  ctx.textAlign = 'left';
  ctx.fillText(`${lastX} m`, x0 + nX * pitch - ctx.measureText(lastX).width / 2, y0 + gh + 14);
  ctx.textAlign = 'right';
  for (let q = 0; q <= nY; q++) ctx.fillText(axisLabel(q * stepM), x0 - 10, y0 + gh - q * pitch);
}
