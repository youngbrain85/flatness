// 높이 뷰 좌표 계약 (단계 F Task 5, 설계 결정 F6/F7)
//
// 정본은 engine/flatness/outputs/height_view.py의 render_height_view_plain
// 독스트링이다. 이 테스트는 그 계약을 대시보드 쪽에 못 박는다.
//
// ★ 픽스처 항등식 금지 3종을 전부 깬다:
//   (1) 경로는 워커 생성 규칙(artifacts/scans/{scan_id}/height_view.png)에서 벗어난
//       값을 쓴다 - 같은 값을 쓰면 scan.id로 재조립하는 구현도 통과한다.
//   (2) shape은 비정사각([ny=3, nx=5])이다 - 정사각이면 [nx,ny]로 뒤집어 읽어도 통과한다.
//   (3) median_z는 셀마다 값이 다르다 - 같은 값이면 전치해 읽어도 통과한다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HEIGHT_VIEW_SCHEMA_VERSION, fetchHeightViewMeta, imageSize, isHeightViewMeta,
  pixelToWorld, plainPngPath, plainPngUrl, sidecarPath, sidecarUrl, worldToPixel,
} from '../height-view';
import type { HeightViewMeta } from '../height-view';

const SUB = 31.25;
const X0 = 1234.5;
const Y0 = -678.25;
const Z0 = 12.75; // ★ bbox_min[2]. 사이드카 median_z는 이 값 기준 "상대" 높이다
//   (engine/flatness/core/subcell.py build_subcell_grid: z - lo[2]를 저장한다).
//   워커 registration.load_source_points가 점군에 bbox_min[2]를 더해 절대 높이로
//   되돌리므로, 화면이 보내는 대응점 z도 같은 기준이어야 한다. 이 오프셋을
//   빠뜨리면 두 스캔의 bbox 최저 z 차이만큼 z가 통째로 어긋난다(조용한 실패).

// shape = [ny, nx] = [3, 5] (세로 먼저). median_z[iy][ix] = iy*10 + ix -> 셀마다 유일.
const META: HeightViewMeta = {
  schema_version: 1,
  bbox_min: [X0, Y0, Z0],
  bbox_max: [X0 + 5 * SUB, Y0 + 3 * SUB, Z0 + 24],
  subcell_m_file: SUB,
  shape: [3, 5],
  median_z: [
    [0, 1, 2, 3, 4],
    [10, 11, 12, null, 14], // [iy=1][ix=3]이 NaN 셀(사이드카에서 null)
    [20, 21, 22, 23, 24],
  ],
};

// 워커 생성 규칙에서 일부러 벗어난 경로(unit-confirm-form.test.tsx와 같은 값)
const VIEW_PATH = 'artifacts/scans/OTHER-DIR/hv-2026.png';

afterEach(() => { vi.restoreAllMocks(); });

describe('파일명 유도 (Task 4 워커 구현과 정확히 일치해야 한다)', () => {
  // 워커: render_height_view_plain(grid, out_dir / "height_view_plain.png")
  //       dump_height_view_meta(grid, info, out_dir / "height_view.json")
  it('height_view_path에서 무장식 PNG 경로를 유도한다', () => {
    expect(plainPngPath(VIEW_PATH)).toBe('artifacts/scans/OTHER-DIR/hv-2026_plain.png');
  });

  it('height_view_path에서 사이드카 JSON 경로를 유도한다', () => {
    expect(sidecarPath(VIEW_PATH)).toBe('artifacts/scans/OTHER-DIR/hv-2026.json');
  });

  it('워커가 실제로 쓰는 파일명(height_view.png)에서도 규약이 성립한다', () => {
    const p = 'artifacts/scans/abc/height_view.png';
    expect(plainPngPath(p)).toBe('artifacts/scans/abc/height_view_plain.png');
    expect(sidecarPath(p)).toBe('artifacts/scans/abc/height_view.json');
  });

  // 경로 함정(lib/domain/slope-cells.ts가 문서화): height_view_path는 이미 버킷-상대
  // "전체" 경로라 artifactUrl(dir, name)로 다시 조립하면 접두사가 중복돼 404가 난다.
  // 기대값을 dataUrl()로 계산하지 않고 문자열로 박아 항등식을 피한다.
  it('dataUrl 규약으로 URL을 만든다(artifactUrl은 접두사가 두 번 붙는다)', () => {
    expect(plainPngUrl(VIEW_PATH)).toBe('/api/data/artifacts/scans/OTHER-DIR/hv-2026_plain.png');
    expect(sidecarUrl(VIEW_PATH)).toBe('/api/data/artifacts/scans/OTHER-DIR/hv-2026.json');
  });
});

describe('픽셀 -> 월드 좌표 (단계 E 좌표 계약)', () => {
  // ix = px, iy = ny - 1 - py; world = bbox_min + (i + 0.5) * subcell_m_file
  it('좌하단 픽셀(px=0, py=ny-1)이 격자 원점 셀의 중심이 된다', () => {
    const p = pixelToWorld(META, 0, 2);
    expect(p.x).toBeCloseTo(X0 + 0.5 * SUB, 9);   // 1250.125
    expect(p.y).toBeCloseTo(Y0 + 0.5 * SUB, 9);   // -662.625
    expect(p.z).toBeCloseTo(Z0 + 0, 9);           // 12.75 (median_z[0][0] = 0)
  });

  // ★ 이 단언이 shape=[nx,ny] 오독을 잡는다. px=4는 nx=5일 때만 격자 안이고,
  //   py=0은 ny=3일 때 iy=2가 된다. shape을 뒤집어 읽으면 nx=3이라 px=4가 범위 밖,
  //   ny=5라 iy=4가 되어 x·y·z가 전부 어긋난다.
  it('우상단 픽셀(px=nx-1, py=0)이 격자 최대 인덱스 셀의 중심이 된다', () => {
    const p = pixelToWorld(META, 4, 0);
    expect(p.x).toBeCloseTo(X0 + 4.5 * SUB, 9);   // 1375.125
    expect(p.y).toBeCloseTo(Y0 + 2.5 * SUB, 9);   // -600.125
    expect(p.z).toBeCloseTo(Z0 + 24, 9);          // median_z[2][4] = 24
  });

  it('shape을 [nx, ny]로 뒤집어 읽으면 어긋난다(비정사각 메타로 고정)', () => {
    // 이미지 크기는 (가로 nx, 세로 ny)다. shape[0]이 ny다.
    expect(imageSize(META)).toEqual({ width: 5, height: 3 });
    // 뒤집힌 해석이었다면 세로가 5라 py=3이 유효했을 것이다 - 실제로는 범위 밖이다.
    expect(pixelToWorld(META, 0, 3).z).toBeNull();
    // 뒤집힌 해석이었다면 가로가 3이라 px=4가 범위 밖이었을 것이다 - 실제로는 유효하다.
    expect(pixelToWorld(META, 4, 0).z).not.toBeNull();
  });

  it('z는 bbox_min[2] 기준 상대 높이를 절대 높이로 되돌린 값이다', () => {
    // median_z 원값(10)을 그대로 내면 이 단언이 깨진다. 워커는 대응점 z에
    // unit_scale만 곱할 뿐 오프셋을 더하지 않으므로, 여기서 더해야 한다.
    expect(pixelToWorld(META, 0, 1).z).toBeCloseTo(Z0 + 10, 9);
    expect(pixelToWorld(META, 0, 1).z).not.toBeCloseTo(10, 9);
  });

  it('셀 중심 보정(+0.5)이 없으면 셀 경계 좌표가 된다', () => {
    // +0.5가 빠지면 x가 정확히 bbox_min[0]이 된다.
    expect(pixelToWorld(META, 0, 2).x).not.toBeCloseTo(X0, 9);
  });

  it('소수 픽셀(클릭 좌표)은 셀 안으로 내림한다', () => {
    const a = pixelToWorld(META, 0.9, 2.4);
    const b = pixelToWorld(META, 0, 2);
    expect(a).toEqual(b);
  });

  // 설계 결정 F6: 0으로 대체하거나 이웃에서 끌어오면 대응점이 조용히 틀린다.
  it('NaN(null) 서브셀을 찍으면 z가 null이다', () => {
    const p = pixelToWorld(META, 3, 1); // median_z[1][3] === null
    expect(p.z).toBeNull();
    // 0으로 대체하는 구현을 잡는다. 0으로 대체했다면 z === Z0 + 0 = 12.75가 된다.
    expect(p.z).not.toBe(Z0);
    // 이웃(median_z[1][2] = 12, [1][4] = 14)에서 끌어오는 구현도 잡는다.
    expect(p.z).not.toBe(Z0 + 12);
    expect(p.z).not.toBe(Z0 + 14);
    // XY는 여전히 계산된다(어느 셀을 찍었는지 화면이 표시할 수 있어야 한다).
    expect(p.x).toBeCloseTo(X0 + 3.5 * SUB, 9);
  });

  it('격자 밖 픽셀은 z가 null이다', () => {
    expect(pixelToWorld(META, 5, 0).z).toBeNull();
    expect(pixelToWorld(META, -1, 0).z).toBeNull();
    expect(pixelToWorld(META, 0, -1).z).toBeNull();
  });
});

describe('월드 -> 픽셀 (저장된 대응점을 다시 마커로 그리기)', () => {
  it('pixelToWorld의 역함수다(격자 전수 왕복)', () => {
    const [ny, nx] = META.shape;
    for (let py = 0; py < ny; py += 1) {
      for (let px = 0; px < nx; px += 1) {
        const w = pixelToWorld(META, px, py);
        expect(worldToPixel(META, w.x, w.y)).toEqual({ px, py });
      }
    }
  });

  it('셀 안 어디를 넣어도 같은 픽셀로 돌아온다(경계 반올림 안정)', () => {
    const w = pixelToWorld(META, 2, 1);
    expect(worldToPixel(META, w.x - 0.4 * SUB, w.y + 0.4 * SUB)).toEqual({ px: 2, py: 1 });
  });
});

describe('사이드카 형식 검증', () => {
  it('정상 메타를 받아들인다', () => {
    expect(isHeightViewMeta(META)).toBe(true);
    expect(HEIGHT_VIEW_SCHEMA_VERSION).toBe(1);
  });

  it.each([
    ['미지원 schema_version', { ...META, schema_version: 2 }],
    ['shape 결측', { ...META, shape: undefined }],
    ['median_z 행 수가 ny와 다름', { ...META, median_z: META.median_z.slice(0, 2) }],
    ['median_z 열 수가 nx와 다름', { ...META, median_z: [[0, 1], [2, 3], [4, 5]] }],
    ['subcell_m_file이 0', { ...META, subcell_m_file: 0 }],
    ['bbox_min이 2개', { ...META, bbox_min: [1, 2] }],
    ['배열이 아님', 'height_view'],
    ['null', null],
  ])('%s는 거부한다', (_label, raw) => {
    expect(isHeightViewMeta(raw)).toBe(false);
  });
});

describe('사이드카 로딩', () => {
  it('사이드카 URL로 받아 파싱한다', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => META }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(fetchHeightViewMeta(VIEW_PATH)).resolves.toEqual(META);
    expect(fetchSpy).toHaveBeenCalledWith('/api/data/artifacts/scans/OTHER-DIR/hv-2026.json');
  });

  it('HTTP 실패는 한국어 사유로 거부한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    await expect(fetchHeightViewMeta(VIEW_PATH)).rejects.toThrow(/불러오지 못했습니다/);
  });

  it('형식이 깨진 사이드카는 한국어 사유로 거부한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ a: 1 }) })));
    await expect(fetchHeightViewMeta(VIEW_PATH)).rejects.toThrow(/형식/);
  });
});
