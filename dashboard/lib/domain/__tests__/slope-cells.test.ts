import { describe, expect, it } from 'vitest';
import {
  isSlopeCellsFile, pxToWorld, slopeCellsJsonUrl, slopeTransformFor, slopeWorldBounds, worldToPx,
} from '../slope-cells';
import type { SlopeCellRow, SlopeCellsFile, SlopeStats } from '../types';

function cell(over: Partial<SlopeCellRow> = {}): SlopeCellRow {
  return {
    cx: 0, cy: 0, center_x: 0.975, center_y: 0.975, n_subcells: 1600,
    slope_pct: 2.24, downhill_rad: -2.68, rmse_m: 0.0001, se_pct: 0.0006,
    width_m: 2.0, height_m: 2.0, ok: true, zone_id: null, ...over,
  };
}

describe('isSlopeCellsFile (slope_cells.json 판별 - stats.ts isSlopeStats와 같은 관례)', () => {
  it('실제 analyze-slope CLI 산출물 형태를 인식한다', () => {
    const payload: SlopeCellsFile = {
      schema_version: 2, engine_version: 'p4-0.5.0', cell_m: 2.0, subcell_m: 0.05, cells: [cell()],
    };
    expect(isSlopeCellsFile(payload)).toBe(true);
  });

  it('null/배열/필드 누락은 거부한다', () => {
    expect(isSlopeCellsFile(null)).toBe(false);
    expect(isSlopeCellsFile([])).toBe(false);
    expect(isSlopeCellsFile({ schema_version: 2 })).toBe(false); // cells 없음
    expect(isSlopeCellsFile({ cells: [] })).toBe(false); // schema_version 없음
  });

  // ★ 코드리뷰 M4: 최상위 키만 보면 cells 원소가 깨져도 통과한다 - 배열
  // 원소 하나하나가 SlopeCellRow 형태인지까지 확인해야 한다.
  it('cells 원소 중 하나라도 width_m이 없으면 거부한다', () => {
    const { width_m, ...broken } = cell();
    void width_m;
    const payload = {
      schema_version: 2, engine_version: 'p4-0.5.0', cell_m: 2.0, subcell_m: 0.05,
      cells: [cell(), broken],
    };
    expect(isSlopeCellsFile(payload)).toBe(false);
  });

  it('좌표가 문자열인 셀은 거부한다(조용한 숫자 강제변환 방지)', () => {
    const payload = {
      schema_version: 2, engine_version: 'p4-0.5.0', cell_m: 2.0, subcell_m: 0.05,
      cells: [{ ...cell(), center_x: '0.975' }],
    };
    expect(isSlopeCellsFile(payload)).toBe(false);
  });

  it('빈 cells 배열은 통과한다(원소 검증은 vacuous truth)', () => {
    const payload: SlopeCellsFile = {
      schema_version: 2, engine_version: 'p4-0.5.0', cell_m: 2.0, subcell_m: 0.05, cells: [],
    };
    expect(isSlopeCellsFile(payload)).toBe(true);
  });
});

describe('slopeCellsJsonUrl (경로 함정: artifactUrl 쓰면 artifacts/{id}가 중복된다)', () => {
  it('artifacts.cells_json 값을 dataUrl에 그대로 넘긴다(artifacts_dir과 합치지 않음)', () => {
    // stats.artifacts 값은 이미 버킷-상대 전체 경로다(worker/flatworker/slope.py가
    // artifacts/{id}/...로 정규화). artifactUrl(artifacts_dir, name)을 쓰면
    // artifacts/{analysis_id}/artifacts/{analysis_id}/slope_cells.json으로
    // 중복돼 404가 난다 - 이 테스트는 그 중복이 생기지 않는지 확인한다.
    const artifacts: SlopeStats['artifacts'] = {
      cells_json: 'artifacts/11111111-1111-1111-1111-111111111111/slope_cells.json',
      cells_csv: 'artifacts/11111111-1111-1111-1111-111111111111/slope_cells.csv',
      map_png: 'artifacts/11111111-1111-1111-1111-111111111111/slope_map.png',
    };
    const url = slopeCellsJsonUrl(artifacts);
    expect(url).toBe('/api/data/artifacts/11111111-1111-1111-1111-111111111111/slope_cells.json');
    expect(url).not.toContain('artifacts/artifacts');
    // 정확히 "artifacts/{id}"가 한 번만 나타나야 한다(중복 시 2회 등장)
    expect(url!.split('artifacts/').length - 1).toBe(1);
  });

  it('artifacts.cells_json이 없으면 null이다(브리프 D7: 단계 C 분석은 재판정 불가)', () => {
    const artifacts: SlopeStats['artifacts'] = {
      cells_csv: 'artifacts/x/slope_cells.csv', map_png: 'artifacts/x/slope_map.png',
    };
    expect(slopeCellsJsonUrl(artifacts)).toBeNull();
  });
});

describe('slopeWorldBounds (셀 center +- width/height/2 로 실좌표 경계 유도)', () => {
  it('실제 CLI 산출물(8.2m x 8.0m 바닥, 가장자리 조각 셀 포함) 경계를 정확히 낸다', () => {
    // 실측: cx=0..4, cy=0..3, cell_m=2.0. x방향은 8.2m라 cx=4 열이 0.2m 조각 셀이다.
    const cells = [
      cell({ cx: 0, cy: 0, center_x: 0.975, center_y: 0.975, width_m: 2.0, height_m: 2.0 }),
      cell({ cx: 4, cy: 0, center_x: 8.075, center_y: 0.975, width_m: 0.2, height_m: 2.0, ok: false }),
      cell({ cx: 0, cy: 3, center_x: 0.975, center_y: 6.975, width_m: 2.0, height_m: 2.0 }),
    ];
    const b = slopeWorldBounds(cells)!;
    expect(b.xMin).toBeCloseTo(-0.025, 5); // 0.975 - 1.0
    expect(b.xMax).toBeCloseTo(8.175, 5);  // 8.075 + 0.1
    expect(b.yMin).toBeCloseTo(-0.025, 5);
    expect(b.yMax).toBeCloseTo(7.975, 5);  // 6.975 + 1.0
  });

  it('빈 배열은 null', () => {
    expect(slopeWorldBounds([])).toBeNull();
  });
});

describe('slopeTransformFor (경계를 maxW x maxH 픽셀 안에 맞추는 스케일)', () => {
  it('가로세로 비율을 유지하며 더 좁은 축에 맞춘다', () => {
    const t = slopeTransformFor({ xMin: 0, xMax: 8, yMin: 0, yMax: 4 }, 400, 400);
    // 폭 8m -> 400/8=50px/m, 높이 4m -> 400/4=100px/m. 더 작은 쪽(50)을 쓴다.
    expect(t.scale).toBeCloseTo(50, 5);
  });
});

describe('worldToPx / pxToWorld (★ y축 반전 - 브리프 D3, 뒤집지 않으면 클릭이 상하 반전된다)', () => {
  const t = { scale: 10, xMin: 0, yMax: 8 }; // 10px/m

  it('월드 y가 커질수록(북쪽) Canvas py는 작아진다(y축 반전)', () => {
    const low = worldToPx(t, 0, 0);
    const high = worldToPx(t, 0, 8);
    expect(high.py).toBeLessThan(low.py);
    expect(high.py).toBeCloseTo(0, 5);   // yMax 지점은 캔버스 맨 위(py=0)
    expect(low.py).toBeCloseTo(80, 5);   // y=0은 캔버스 맨 아래
  });

  it('월드 x가 커질수록 Canvas px도 커진다(x축은 반전 없음)', () => {
    const a = worldToPx(t, 0, 0);
    const b = worldToPx(t, 5, 0);
    expect(b.px).toBeGreaterThan(a.px);
    expect(b.px).toBeCloseTo(50, 5);
  });

  it('pxToWorld는 worldToPx의 역함수다(왕복 일치) - 배수구 클릭이 이 변환을 쓴다(§3.5)', () => {
    for (const [x, y] of [[3.2, 5.1], [0, 0], [8.175, 7.975]] as const) {
      const { px, py } = worldToPx(t, x, y);
      const back = pxToWorld(t, px, py);
      expect(back.x).toBeCloseTo(x, 6);
      expect(back.y).toBeCloseTo(y, 6);
    }
  });
});
