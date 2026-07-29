// cells.json을 판정 5색으로 Canvas 렌더 (외부 라이브러리 금지)
import { GRADE_COLOR } from '@/lib/domain/labels';
import type { CellRow } from '@/lib/domain/types';

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

export function cellPxFor(geom: GridGeometry, maxW: number, maxH: number): number {
  return Math.max(4, Math.floor(Math.min(maxW / geom.cols, maxH / geom.rows)));
}

// iy는 실좌표에서 위로 증가하므로 캔버스(아래로 증가)에서는 행을 뒤집는다
export function cellRect(geom: GridGeometry, cell: CellRow, cellPx: number) {
  return {
    x: (cell.ix - geom.minIx) * cellPx,
    y: (geom.rows - 1 - (cell.iy - geom.minIy)) * cellPx,
    w: cellPx,
    h: cellPx,
  };
}

export function cellAt(
  geom: GridGeometry, cells: CellRow[], cellPx: number, px: number, py: number,
): CellRow | null {
  const ix = Math.floor(px / cellPx) + geom.minIx;
  const iy = geom.rows - 1 - Math.floor(py / cellPx) + geom.minIy;
  return cells.find((c) => c.ix === ix && c.iy === iy) ?? null;
}

export function drawHeatmap(
  ctx: CanvasRenderingContext2D, cells: CellRow[], geom: GridGeometry, cellPx: number,
): void {
  ctx.clearRect(0, 0, geom.cols * cellPx, geom.rows * cellPx);
  for (const c of cells) {
    const r = cellRect(geom, c, cellPx);
    ctx.fillStyle = GRADE_COLOR[c.grade];
    ctx.fillRect(r.x, r.y, Math.max(1, r.w - 1), Math.max(1, r.h - 1)); // 1px 셀 경계
  }
}
