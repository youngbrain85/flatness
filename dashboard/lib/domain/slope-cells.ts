// slope_cells.json 로더 + 픽셀<->미터 변환 (브리프 D1/D3, 스펙 §7.3·§3.5)
//
// 이 파일은 엔진 산출물 slope_cells.json(engine/flatness/outputs/slope_cells.py)의
// 기하 정보(SlopeCell 13필드)만 다룬다. 그 파일에는 판정 결과(grade·dev_pct·
// correction_mm·dir_err_deg)가 없다 - 재판정 때 다시 계산되는 파생값이고 같이
// 담으면 CSV와 이중 진실이 되기 때문이다(브리프 D1). 그래서 이 로더도 등급을
// 계산하거나 다루지 않는다: 화면 조립(Task 5)이 별도로 얻은 grade를 여기서 낸
// 기하 정보와 짝지어 slope-heatmap.ts 렌더러에 넘긴다.
//
// BOM 함정 없음: slope_cells.json은 utf-8이다(CSV만 utf-8-sig로 저장된다).
// CSV는 재판정 입력으로 쓰면 반올림 때문에 판정이 달라지는 것이 실측으로
// 확인됐다(브리프 D1) - 그래서 이 파일은 CSV를 전혀 파싱하지 않는다.
import { dataUrl } from './paths';
import type { SlopeCellRow, SlopeCellsFile, SlopeStats } from './types';

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}

/** 코드리뷰 M4: 최상위 키만 보고 cells 배열 원소는 검증하지 않으면, width_m
 * 누락이나 좌표가 문자열인 행도 그대로 통과해 이후 산술(slope-heatmap.ts의
 * worldToPx 등)에서 문자열이 조용히 숫자로 강제변환되거나 NaN이 퍼진다 - 이
 * 저장소가 가장 경계하는 조용한 실패다. SlopeCell 13필드를 전부 타입 수준까지
 * 확인한다. */
function isValidSlopeCellRow(row: unknown): row is SlopeCellRow {
  if (!row || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  return isFiniteNumber(r.cx) && isFiniteNumber(r.cy)
    && isFiniteNumber(r.center_x) && isFiniteNumber(r.center_y)
    && isFiniteNumber(r.n_subcells)
    && isNumberOrNull(r.slope_pct) && isNumberOrNull(r.downhill_rad)
    && isNumberOrNull(r.rmse_m) && isNumberOrNull(r.se_pct)
    && isFiniteNumber(r.width_m) && isFiniteNumber(r.height_m)
    && typeof r.ok === 'boolean'
    && (r.zone_id === null || isFiniteNumber(r.zone_id));
}

/** slope_cells.json으로 파싱된 원시 객체가 실제로 그 형태인지 내용으로 판별한다.
 *
 * stats.json의 isSlopeStats(stats.ts)와 같은 관례 - 별도 스키마 라이브러리 없이
 * 이 저장소는 최상위 판별 키를 직접 확인하는 가벼운 타입가드를 쓴다. 다만
 * cells 배열은 원소 하나하나가 SlopeCellRow 형태인지까지 확인한다(코드리뷰 M4 -
 * 배열 존재 여부만 보면 원소가 깨져도 통과한다).
 */
export function isSlopeCellsFile(raw: unknown): raw is SlopeCellsFile {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return typeof r.schema_version === 'number'
    && typeof r.engine_version === 'string'
    && typeof r.cell_m === 'number'
    && typeof r.subcell_m === 'number'
    && Array.isArray(r.cells)
    && r.cells.every(isValidSlopeCellRow);
}

/** stats.artifacts.cells_json -> /api/data 경로.
 *
 * 경로 함정(브리프 D3/Task 4): stats.artifacts 값은 이미 버킷-상대 전체 경로다
 * (worker/flatworker/slope.py가 artifacts/{id}/...로 정규화한다). 평활도처럼
 * artifactUrl(artifacts_dir, name)을 쓰면 artifacts/{id}/artifacts/{id}/...로
 * 중복돼 404가 난다 - 그래서 dataUrl()에 값을 그대로 넘긴다.
 *
 * cells_json이 없으면(브리프 D7: 단계 C까지 만들어진 분석) null - 호출부가 이
 * 상태를 명시적으로 다뤄야 한다(히트맵 대신 slope_map.png, 클릭 비활성화).
 */
export function slopeCellsJsonUrl(artifacts: SlopeStats['artifacts']): string | null {
  if (!artifacts.cells_json) return null;
  return dataUrl(artifacts.cells_json);
}

/** 셀들이 차지하는 실좌표(미터) 경계. gridGeometry(lib/viz/heatmap.ts)와 달리
 * 격자 인덱스가 아니라 월드 좌표를 낸다 - 배수구 클릭이 연속 미터 좌표이므로
 * (스펙 §3.5) 격자 인덱스만으로는 클릭 위치를 복원할 수 없다. */
export interface SlopeWorldBounds { xMin: number; xMax: number; yMin: number; yMax: number; }

export function slopeWorldBounds(cells: SlopeCellRow[]): SlopeWorldBounds | null {
  if (cells.length === 0) return null;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const c of cells) {
    const hw = c.width_m / 2;
    const hh = c.height_m / 2;
    if (c.center_x - hw < xMin) xMin = c.center_x - hw;
    if (c.center_x + hw > xMax) xMax = c.center_x + hw;
    if (c.center_y - hh < yMin) yMin = c.center_y - hh;
    if (c.center_y + hh > yMax) yMax = c.center_y + hh;
  }
  return { xMin, xMax, yMin, yMax };
}

/** 월드(미터) <-> Canvas 픽셀 변환 계수. scale은 미터당 픽셀 수. */
export interface SlopeTransform { scale: number; xMin: number; yMax: number; }

/** 경계를 maxW x maxH 픽셀 안에 맞추는 스케일을 구한다(가로세로 비율 유지). */
export function slopeTransformFor(bounds: SlopeWorldBounds, maxW: number, maxH: number): SlopeTransform {
  const w = Math.max(bounds.xMax - bounds.xMin, 1e-6);
  const h = Math.max(bounds.yMax - bounds.yMin, 1e-6);
  const scale = Math.max(Math.min(maxW / w, maxH / h), 1e-6);
  return { scale, xMin: bounds.xMin, yMax: bounds.yMax };
}

/** 월드 좌표(미터, y 위로 증가) -> Canvas 픽셀(y 아래로 증가).
 *
 * ★ y축 함정(브리프 D3): 엔진 downhill_rad·center_y는 matplotlib 데이터 좌표계
 * (y 위로 증가) 기준이다. Canvas는 y가 아래로 증가하므로 여기서 반드시 뒤집는다.
 * lib/viz/heatmap.ts의 cellRect가 격자 행(iy)만 뒤집는 선례를 실좌표(미터)에도
 * 그대로 적용한 것이다. */
export function worldToPx(t: SlopeTransform, x: number, y: number): { px: number; py: number } {
  return { px: (x - t.xMin) * t.scale, py: (t.yMax - y) * t.scale };
}

/** Canvas 픽셀 -> 월드 좌표(미터). worldToPx의 역함수.
 *
 * 배수구 클릭(Task 5)이 이 함수를 쓴다. 스펙 §3.5의 배수구 좌표는 연속 미터
 * 좌표({"x":3.2,"y":5.1})이므로 셀 중심으로 스냅하지 않고 이 값을 그대로 잡 payload에
 * 싣는다(2m 해상도로 스냅하면 배수구 위치가 지나치게 굵어진다). */
export function pxToWorld(t: SlopeTransform, px: number, py: number): { x: number; y: number } {
  return { x: t.xMin + px / t.scale, y: t.yMax - py / t.scale };
}
