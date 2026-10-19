// 정밀 편차맵 캔버스(스펙 2·3 §2, 아트보드 docs/design/dark/ScanDeviation.dc.html 74~95행·스크립트 fold/ramp/paint).
// 엔진 residual_grid.json(판정에 쓴 5cm 서브셀 잔차, 0.1mm 정수, 값 없음 null, 행 0 = y 최소)을
// 표시 해상도(5·10·20cm)로 접어 칠한다. 판정과 무관한 보조 시각화다(등급을 계산하지 않는다).
// 아트보드와 다른 점(승인 스펙): 침하는 파랑(초록 아님), 색 범위 R 은 |값|의 98번째 백분위(최소 1mm)다.
import { DEVIATION_RAMP, STAGE_AXIS_TEXT, STAGE_BG, STAGE_GRID } from '@/lib/domain/palette';

export interface ResidualGrid { subcell_m: number; cols: number; rows: number; values: (number | null)[]; }

/** 접은 격자. mm 는 행 우선(행 0 = y 최소), 값 없는 칸은 NaN. n 은 값 있는 칸 수, lo·hi 는 그 최소·최대(mm). */
export interface FoldedGrid { cols: number; rows: number; sizeM: number; mm: Float64Array; n: number; lo: number; hi: number; }

/** 표시 해상도 배수(서브셀 5cm 기준 5·10·20cm). */
export const RESOLUTION_FACTORS = [1, 2, 4] as const;
/** 색 범위 최솟값(mm). 거의 평평한 바닥에서 잡음이 꽉 찬 색으로 부풀지 않게 한다. */
export const MIN_RANGE_MM = 1;
const P98 = 0.98;

const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** residual_grid.json 을 읽는다. 모양이 다르면 null(화면은 엔진 PNG 로 대체한다). */
export function parseResidualGrid(json: unknown): ResidualGrid | null {
  if (!json || typeof json !== 'object') return null;
  const g = json as Partial<ResidualGrid>;
  if (typeof g.subcell_m !== 'number' || !(g.subcell_m > 0) || !Number.isFinite(g.subcell_m)) return null;
  if (!posInt(g.cols) || !posInt(g.rows) || !Array.isArray(g.values)) return null;
  if (g.values.length !== g.cols * g.rows) return null;
  for (const v of g.values) if (v !== null && (typeof v !== 'number' || !Number.isFinite(v))) return null;
  return g as ResidualGrid;
}

/** factor x factor 묶음마다 값 있는 칸만 평균한다(mm). 가장자리 묶음은 남은 칸으로 만든다. */
export function foldGrid(g: ResidualGrid, factor: number): FoldedGrid {
  const cols = Math.ceil(g.cols / factor);
  const rows = Math.ceil(g.rows / factor);
  const mm = new Float64Array(cols * rows).fill(NaN);
  let n = 0, lo = Infinity, hi = -Infinity;
  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      let s = 0, c = 0;
      for (let y = by * factor; y < Math.min(g.rows, (by + 1) * factor); y++) {
        for (let x = bx * factor; x < Math.min(g.cols, (bx + 1) * factor); x++) {
          const q = g.values[y * g.cols + x];
          if (q !== null) { s += q; c += 1; }
        }
      }
      if (!c) continue;
      const m = (s / c) * 0.1;   // 0.1mm 정수 -> mm
      mm[by * cols + bx] = m;
      n += 1;
      if (m < lo) lo = m;
      if (m > hi) hi = m;
    }
  }
  return { cols, rows, sizeM: g.subcell_m * factor, mm, n, lo: n ? lo : 0, hi: n ? hi : 0 };
}

/** 색 범위 R(mm): 원 격자 |값|의 98번째 백분위(nearest-rank), 최소 MIN_RANGE_MM. 해상도를 바꿔도 색 뜻이 같다. */
export function colorRangeMm(g: ResidualGrid): number {
  let n = 0;
  for (const v of g.values) if (v !== null) n += 1;
  if (!n) return MIN_RANGE_MM;
  const abs = new Float64Array(n);   // 형식 배열 정렬은 숫자 순이고 비교 함수 호출이 없다(큰 격자)
  let i = 0;
  for (const v of g.values) if (v !== null) abs[i++] = Math.abs(v);
  abs.sort();
  const p = abs[Math.max(0, Math.ceil(P98 * abs.length) - 1)] * 0.1;
  return Math.max(MIN_RANGE_MM, p);
}

const RAMP_RGB = DEVIATION_RAMP.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));

/** 편차(mm)의 색: −R 과 +R 사이를 다섯 색 RGB 선형 보간(0 = 가운데 짙은 남색), 범위 밖은 끝 색. */
export function deviationRgb(mm: number, rangeMm: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (mm / rangeMm + 1) / 2));
  const x = t * (RAMP_RGB.length - 1);
  const i = Math.min(RAMP_RGB.length - 2, Math.floor(x));
  const k = x - i;
  const a = RAMP_RGB[i], b = RAMP_RGB[i + 1];
  return [0, 1, 2].map((j) => Math.round(a[j] + (b[j] - a[j]) * k)) as [number, number, number];
}

/** 한 칸 = 1px RGBA. 행 0(y 최소)이 그림 맨 아래 줄이고, 값 없는 칸은 투명(검정 스테이지가 비친다). */
export function rasterize(f: FoldedGrid, rangeMm: number): Uint8ClampedArray {
  const px = new Uint8ClampedArray(f.cols * f.rows * 4);
  for (let by = 0; by < f.rows; by++) {
    const py = f.rows - 1 - by;
    for (let bx = 0; bx < f.cols; bx++) {
      const m = f.mm[by * f.cols + bx];
      if (Number.isNaN(m)) continue;
      const [r, g, b] = deviationRgb(m, rangeMm);
      const o = (py * f.cols + bx) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  return px;
}

/** 둘레 여백(CSS px, 아트보드 값). 오른쪽 위 legendW x legendH 는 색 막대 범례 자리다. */
const M = { left: 44, right: 22, top: 24, bottom: 60, legendW: 208, legendH: 92 } as const;
const MIN_W = 40, MIN_H = 30;

export interface DeviationLayout { x0: number; y0: number; gw: number; gh: number; ppm: number; }

/** 정사각 칸으로 스테이지에 맞춘다. 범례 왼쪽 배치(넓은 화면)와 범례 아래 배치(휴대폰) 중 그림이 큰 쪽. */
export function deviationLayout(f: FoldedGrid, w: number, h: number): DeviationLayout | null {
  const cSide = Math.min((w - M.left - M.right - M.legendW) / f.cols, (h - M.top - M.bottom) / f.rows);
  const cBelow = Math.min((w - M.left - M.right) / f.cols, (h - M.legendH - M.bottom) / f.rows);
  const side = cSide >= cBelow;
  const c = side ? cSide : cBelow;
  if (!(c > 0)) return null;
  const gw = Math.round(c * f.cols), gh = Math.round(c * f.rows);
  if (gw < MIN_W || gh < MIN_H) return null;
  const limit = side ? w - M.right - M.legendW : w - M.right;
  const top = side ? M.top : M.legendH;
  const x0 = Math.round(Math.max(M.left, Math.min((w - gw) / 2, limit - gw)));
  const y0 = Math.round(top + (h - M.bottom - top - gh) / 2);
  return { x0, y0, gw, gh, ppm: gw / (f.cols * f.sizeM) };
}

// 격자선·축 숫자 간격(m) 후보. 숫자 사이가 AXIS_MIN_PX 이상인 가장 작은 간격을 쓴다(43cm 시험판은 10cm, 방은 1m 남짓)
const PITCHES_M = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
const AXIS_MIN_PX = 56;

export function axisPitchM(ppm: number): number {
  return PITCHES_M.find((p) => p * ppm >= AXIS_MIN_PX) ?? PITCHES_M[PITCHES_M.length - 1];
}

const tick = (v: number) => String(Number(v.toFixed(2)));

/** 스테이지 그리기: 검정 바탕 → 격자선 → 그림 자리 검정 → 칸 그림(raster, 확대) → 축 숫자(m). */
export function drawDeviation(ctx: CanvasRenderingContext2D, o: {
  w: number; h: number; f: FoldedGrid; raster: CanvasImageSource | null; fontFamily: string;
}): void {
  const { w, h, f } = o;
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, w, h);
  if (!f.n) return;
  const L = deviationLayout(f, w, h);
  if (!L) return;
  const pitch = axisPitchM(L.ppm);
  const step = pitch * L.ppm;
  ctx.strokeStyle = STAGE_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = L.x0 - Math.floor(L.x0 / step) * step; x <= w; x += step) {
    const X = Math.round(x) + 0.5; ctx.moveTo(X, 0); ctx.lineTo(X, h);
  }
  const yb = L.y0 + L.gh;
  for (let y = yb - Math.floor(yb / step) * step; y <= h; y += step) {
    const Y = Math.round(y) + 0.5; ctx.moveTo(0, Y); ctx.lineTo(w, Y);
  }
  ctx.stroke();
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(L.x0, L.y0, L.gw, L.gh);
  if (o.raster) {
    ctx.imageSmoothingEnabled = false;   // 칸 경계를 흐리지 않고 그대로 키운다
    ctx.drawImage(o.raster, L.x0, L.y0, L.gw, L.gh);
  }
  // 축 숫자. x 는 아래, y 는 왼쪽. 마지막 x 숫자에만 단위를 붙인다
  ctx.fillStyle = STAGE_AXIS_TEXT;
  ctx.font = `11px ${o.fontFamily}`;
  ctx.textBaseline = 'middle';
  const wm = f.cols * f.sizeM, hm = f.rows * f.sizeM;
  const nX = Math.floor(wm / pitch + 1e-6), nY = Math.floor(hm / pitch + 1e-6);
  ctx.textAlign = 'center';
  for (let q = 0; q < nX; q++) ctx.fillText(tick(q * pitch), L.x0 + q * step, yb + 14);
  ctx.textAlign = 'left';
  const last = tick(nX * pitch);
  ctx.fillText(`${last} m`, L.x0 + nX * step - ctx.measureText(last).width / 2, yb + 14);
  ctx.textAlign = 'right';
  for (let q = 0; q <= nY; q++) ctx.fillText(tick(q * pitch), L.x0 - 10, yb - q * step);
}

/** 부호 붙인 소수 한 자리. 음수는 빼기 기호(−). */
export function signedMm(v: number): string {
  const s = Math.abs(v).toFixed(1);
  return s === '0.0' ? s : (v < 0 ? '−' : '+') + s;
}

/** HUD: '5cm 격자 · 9 × 7칸 · −1.2 ~ +0.8 mm'. 값이 하나도 없으면 안내 문구. */
export function deviationHud(f: FoldedGrid, resLabel: string): string {
  if (!f.n) return '표시할 편차 값이 없습니다';
  return `${resLabel} 격자 · ${f.cols} × ${f.rows}칸 · ${signedMm(f.lo)} ~ ${signedMm(f.hi)} mm`;
}

/** 해상도 이름: 서브셀(m) x 배수 -> 'Ncm'. */
export function resolutionLabel(subcellM: number, factor: number): string {
  return `${Math.round(subcellM * factor * 100)}cm`;
}
