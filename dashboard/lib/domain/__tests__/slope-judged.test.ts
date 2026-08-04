import { describe, expect, it } from 'vitest';
import { isSlopeJudgedFile, joinSlopeCells, slopeJudgedJsonUrl } from '../slope-judged';
import type { SlopeCellRow, SlopeJudgedFile, SlopeJudgedRow, SlopeStats } from '../types';

function cell(over: Partial<SlopeCellRow> = {}): SlopeCellRow {
  return {
    cx: 0, cy: 0, center_x: 0.975, center_y: 0.975, n_subcells: 1600,
    slope_pct: 2.24, downhill_rad: -2.68, rmse_m: 0.0001, se_pct: 0.0006,
    width_m: 2.0, height_m: 2.0, ok: true, zone_id: null, ...over,
  };
}

function judgedRow(over: Partial<SlopeJudgedRow> = {}): SlopeJudgedRow {
  return {
    cx: 0, cy: 0, grade: '적합', reason: '크기·방향 모두 허용 안',
    dev_pct: 0.24, dir_err_deg: 5, correction_mm: 4.8, ...over,
  };
}

describe('isSlopeJudgedFile (slope_judged.json 판별 - isSlopeCellsFile과 같은 관례)', () => {
  it('실제 judge_slope_cells 산출물 형태를 인식한다', () => {
    const payload: SlopeJudgedFile = {
      schema_version: 1, direction_judged: true, cells: [judgedRow()],
    };
    expect(isSlopeJudgedFile(payload)).toBe(true);
  });

  it('null/배열/필드 누락은 거부한다', () => {
    expect(isSlopeJudgedFile(null)).toBe(false);
    expect(isSlopeJudgedFile([])).toBe(false);
    expect(isSlopeJudgedFile({ schema_version: 1 })).toBe(false); // cells·direction_judged 없음
    expect(isSlopeJudgedFile({ cells: [], direction_judged: true })).toBe(false); // schema_version 없음
  });
});

describe('slopeJudgedJsonUrl (경로 함정: artifactUrl 쓰면 artifacts/{id}가 중복된다)', () => {
  it('artifacts.judged_json 값을 dataUrl에 그대로 넘긴다', () => {
    const artifacts: SlopeStats['artifacts'] = {
      cells_json: 'artifacts/a1/slope_cells.json',
      judged_json: 'artifacts/a1/slope_judged.json',
      cells_csv: 'artifacts/a1/slope_cells.csv',
      map_png: 'artifacts/a1/slope_map.png',
    };
    expect(slopeJudgedJsonUrl(artifacts)).toBe('/api/data/artifacts/a1/slope_judged.json');
  });

  it('artifacts.judged_json이 없으면 null이다(브리프 D7: 단계 C 분석은 재판정 불가)', () => {
    const artifacts: SlopeStats['artifacts'] = {
      cells_csv: 'artifacts/x/slope_cells.csv', map_png: 'artifacts/x/slope_map.png',
    };
    expect(slopeJudgedJsonUrl(artifacts)).toBeNull();
  });
});

describe('joinSlopeCells ((cx,cy) 명시 키 조인 - 브리프 D1: 배열 순서 의존 금지)', () => {
  it('cells·judged 배열 순서가 정반대여도 올바르게 짝짓는다', () => {
    const cells = [cell({ cx: 0, cy: 0 }), cell({ cx: 1, cy: 0 }), cell({ cx: 0, cy: 1 })];
    // 일부러 순서를 뒤섞고, cx=1,cy=0에는 재시공 등급을 넣어 인덱스 기반 조인이었다면
    // 틀린 셀에 붙을 값을 만든다.
    const judged = [
      judgedRow({ cx: 0, cy: 1, grade: '보수' }),
      judgedRow({ cx: 1, cy: 0, grade: '재시공', reason: '설계 구배와의 편차가 재시공 기준을 넘음' }),
      judgedRow({ cx: 0, cy: 0, grade: '적합' }),
    ];
    const out = joinSlopeCells(cells, judged, true);
    expect(out).toHaveLength(3);
    const byPos = new Map(out.map((r) => [`${r.cell.cx},${r.cell.cy}`, r]));
    expect(byPos.get('0,0')!.grade).toBe('적합');
    expect(byPos.get('1,0')!.grade).toBe('재시공');
    expect(byPos.get('0,1')!.grade).toBe('보수');
  });

  it('짝이 없는 셀은 결과에서 제외한다(억지로 합치지 않음)', () => {
    const cells = [cell({ cx: 0, cy: 0 }), cell({ cx: 9, cy: 9 })];
    const judged = [judgedRow({ cx: 0, cy: 0 })];
    const out = joinSlopeCells(cells, judged, true);
    expect(out).toHaveLength(1);
    expect(out[0].cell.cx).toBe(0);
  });

  it('reason이 "역구배"로 시작하고 direction_judged=true면 reverse=true다', () => {
    const cells = [cell({ cx: 0, cy: 0 })];
    const judged = [judgedRow({ cx: 0, cy: 0, grade: '재시공', reason: '역구배(물이 배수구 반대로 흐름)' })];
    const out = joinSlopeCells(cells, judged, true);
    expect(out[0].reverse).toBe(true);
  });

  // ★ 브리프 변이 7: direction_judged=false인데 역구배를 표시하면 안 된다(근거 없음).
  it('reason이 "역구배"로 시작해도 direction_judged=false면 reverse=false로 강제한다', () => {
    const cells = [cell({ cx: 0, cy: 0 })];
    // 실제로는 엔진이 이 조합을 내지 않지만(drain_points 없이는 역구배 분기를
    // 타지 않음), jsonb는 무결성을 보장하지 않으므로 방어가 실제로 동작하는지
    // 직접 확인한다.
    const judged = [judgedRow({ cx: 0, cy: 0, grade: '재시공', reason: '역구배(물이 배수구 반대로 흐름)' })];
    const out = joinSlopeCells(cells, judged, false);
    expect(out[0].reverse).toBe(false);
  });

  it('reason이 다른 사유면 reverse=false다', () => {
    const cells = [cell({ cx: 0, cy: 0 })];
    const judged = [judgedRow({ cx: 0, cy: 0, grade: '보수', reason: '허용을 벗어났으나 국소 보정 가능' })];
    const out = joinSlopeCells(cells, judged, true);
    expect(out[0].reverse).toBe(false);
  });
});
