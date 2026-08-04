// slope_judged.json 로더 + slope_cells.json과의 (cx, cy) 조인 (브리프 D1, 스펙 §7.2)
//
// 판정 결과(grade·dev_pct·correction_mm·dir_err_deg·reason)는 slope_cells.json에는
// 없다(브리프 D1 - 재판정 때마다 다시 계산되는 파생값이라 입력 파일에 같이 담으면
// 이중 진실이 된다). engine/flatness/outputs/slope_judged.py가 이 값들만 담은
// 별도 산출물을 낸다. 이 파일은 그 산출물의 타입가드·URL 헬퍼와, slope_cells.json
// (기하)과의 조인 로직을 담는다.
import { dataUrl } from './paths';
import type { SlopeCellRow, SlopeGrade, SlopeJudgedFile, SlopeJudgedRow, SlopeStats } from './types';

/** slope_judged.json으로 파싱된 원시 객체가 실제로 그 형태인지 내용으로 판별한다.
 * isSlopeCellsFile(slope-cells.ts)·isSlopeStats(stats.ts)와 같은 관례다. */
export function isSlopeJudgedFile(raw: unknown): raw is SlopeJudgedFile {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  return typeof r.schema_version === 'number'
    && typeof r.direction_judged === 'boolean'
    && Array.isArray(r.cells);
}

/** stats.artifacts.judged_json -> /api/data 경로. slopeCellsJsonUrl(slope-cells.ts)과
 * 같은 이유로 dataUrl에 값을 그대로 넘긴다(이미 버킷-상대 전체 경로다).
 *
 * judged_json이 없으면(브리프 D7: 단계 C까지 만들어진 분석) null. */
export function slopeJudgedJsonUrl(artifacts: SlopeStats['artifacts']): string | null {
  if (!artifacts.judged_json) return null;
  return dataUrl(artifacts.judged_json);
}

/** 셀 하나의 기하(slope_cells.json) + 판정 결과(slope_judged.json)를 합친 것.
 * 히트맵(slope-heatmap.ts의 GradedSlopeCell 형태로 변환)과 결과표가 함께 쓴다. */
export interface SlopeCellResult {
  cell: SlopeCellRow;
  grade: SlopeGrade;
  reason: string;
  dev_pct: number | null;
  dir_err_deg: number | null;
  correction_mm: number | null;
  // 역구배 강조 여부(스펙 §7.2: "색만으로 드러나지 않는다"). reason이 "역구배"로
  // 시작하고 방향이 실제로 판정된 경우에만 true다 - direction_judged=false인
  // 기존 분석(drain_points 없이 크기만 판정된 것)에서 역구배를 잘못 표시하지
  // 않도록 이중으로 방어한다. 엔진도 drain_points 없이는 이 reason을 내지 않지만
  // (grade_slope_cells는 drain_points가 있을 때만 역구배 분기를 탄다), stats는
  // jsonb 컬럼이라 무결성을 보장하지 않으므로 방어를 한 번 더 겹친다.
  reverse: boolean;
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** slope_cells.json cells + slope_judged.json cells를 (cx, cy)로 조인한다.
 *
 * ★ 배열 순서가 같다는 가정에 기대지 않는다(브리프 D1 경고 - Task 1이 그 가정을
 * 막으려고 두 파일 모두에 명시 키를 넣었다). Map을 만들어 명시적 키로 짝짓는다.
 * 어느 한쪽에만 있는 키는 결과에서 제외한다(정상 상황에서는 두 파일이 같은
 * judge_slope_cells 호출에서 함께 나오므로 발생하지 않지만, 짝 없는 행을 억지로
 * 합치는 것보다는 조용히 빼는 편이 안전하다).
 */
export function joinSlopeCells(
  cells: SlopeCellRow[],
  judged: SlopeJudgedRow[],
  directionJudged: boolean,
): SlopeCellResult[] {
  const byKey = new Map<string, SlopeJudgedRow>(judged.map((j) => [cellKey(j.cx, j.cy), j]));
  const out: SlopeCellResult[] = [];
  for (const cell of cells) {
    const j = byKey.get(cellKey(cell.cx, cell.cy));
    if (!j) continue;
    out.push({
      cell, grade: j.grade, reason: j.reason, dev_pct: j.dev_pct,
      dir_err_deg: j.dir_err_deg, correction_mm: j.correction_mm,
      reverse: directionJudged && j.reason.startsWith('역구배'),
    });
  }
  return out;
}
