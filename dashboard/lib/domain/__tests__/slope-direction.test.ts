import { describe, expect, it } from 'vitest';
import { compassLabel, correctionDirectionLabel } from '../slope-direction';
import type { SlopeCellRow } from '../types';

function cell(over: Partial<SlopeCellRow> = {}): SlopeCellRow {
  return {
    cx: 0, cy: 0, center_x: 0.975, center_y: 0.975, n_subcells: 1600,
    slope_pct: 2.24, downhill_rad: -2.68, rmse_m: 0.0001, se_pct: 0.0006,
    width_m: 2.0, height_m: 2.0, ok: true, zone_id: null, ...over,
  };
}

describe('compassLabel (8방위 환산 - 임계값 비교 없음, 리트머스 통과)', () => {
  it('0=동, 90도=북, 180도=서, 270도=남', () => {
    expect(compassLabel(0)).toBe('동');
    expect(compassLabel(Math.PI / 2)).toBe('북');
    expect(compassLabel(Math.PI)).toBe('서');
    expect(compassLabel((3 * Math.PI) / 2)).toBe('남');
  });

  it('45도 단위 대각 방향', () => {
    expect(compassLabel(Math.PI / 4)).toBe('북동');
    expect(compassLabel((3 * Math.PI) / 4)).toBe('북서');
    expect(compassLabel((5 * Math.PI) / 4)).toBe('남서');
    expect(compassLabel((7 * Math.PI) / 4)).toBe('남동');
  });

  it('음수 각도(atan2 반환 범위)도 정규화해 처리한다', () => {
    // -pi/2 == 3pi/2 (남)
    expect(compassLabel(-Math.PI / 2)).toBe('남');
    // engine의 실제 downhill_rad 예시값(-2.6779...)은 서남(약 -153.4도 == 206.6도)에 가깝다
    expect(compassLabel(-2.6779450469426633)).toBe('남서');
  });

  it('경계(22.5도)는 가까운 방위로 반올림한다', () => {
    expect(compassLabel(Math.PI / 8 - 0.01)).toBe('동'); // 22.5도 살짝 못 미침 -> 동
    expect(compassLabel(Math.PI / 8 + 0.01)).toBe('북동'); // 22.5도 살짝 넘음 -> 북동
  });
});

describe('correctionDirectionLabel (스펙 §5.3 "북동쪽 끝을 10mm 낮춤" 형태)', () => {
  it('실측이 설계보다 완만하면(경사 부족) 낮춤으로 표기한다', () => {
    const c = cell({ slope_pct: 1.5, downhill_rad: 0 }); // 동쪽, design 2.0%보다 완만
    const label = correctionDirectionLabel(c, 10.0, 2.0, false);
    expect(label).toBe('동쪽 끝을 10.0mm 낮춤');
  });

  it('실측이 설계보다 가파르면(경사 초과) 높임으로 표기한다', () => {
    const c = cell({ slope_pct: 2.5, downhill_rad: Math.PI / 2 }); // 북쪽, design 2.0%보다 가파름
    const label = correctionDirectionLabel(c, 10.0, 2.0, false);
    expect(label).toBe('북쪽 끝을 10.0mm 높임');
  });

  it('slope_pct === design_pct(경계)는 높임으로 취급한다(부호 없는 0 처리)', () => {
    const c = cell({ slope_pct: 2.0, downhill_rad: 0 });
    const label = correctionDirectionLabel(c, 0.0, 2.0, false);
    expect(label).toBe('동쪽 끝을 0.0mm 높임');
  });

  it('ok=false(측정 불가) 셀은 null', () => {
    const c = cell({ ok: false, slope_pct: null, downhill_rad: null });
    expect(correctionDirectionLabel(c, null, 2.0, false)).toBeNull();
  });

  it('correction_mm이 null(판정불가 등)이면 null', () => {
    const c = cell({ ok: true });
    expect(correctionDirectionLabel(c, null, 2.0, false)).toBeNull();
  });

  // ★ 코드리뷰 Important-1: 역구배는 크기 문구가 아니라 방향 결함 문구를 낸다.
  // correction_mm이 0에 가까워도(크기는 거의 맞음) "고칠 것 없음"으로 읽히면
  // 안 된다 - 물이 반대로 흐르는 것 자체가 문제이므로.
  it('reverse=true면 correction_mm 값과 무관하게 방향 재시공 문구를 낸다', () => {
    const c = cell({ slope_pct: 2.0, downhill_rad: 0 }); // 설계와 거의 같은 크기
    const label = correctionDirectionLabel(c, 0.0, 2.0, true);
    expect(label).toBe('역구배 - 방향 전면 재시공 필요(크기 보정으로 해결 안 됨)');
    expect(label).not.toContain('0.0mm');
  });

  it('reverse=true여도 측정 불가 셀(ok=false)은 여전히 null', () => {
    const c = cell({ ok: false, slope_pct: null, downhill_rad: null });
    expect(correctionDirectionLabel(c, null, 2.0, true)).toBeNull();
  });
});
