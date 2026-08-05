// 높이 뷰 사이드카 로더 + 픽셀<->월드 환산 (단계 F Task 5, 설계 결정 F6/F7)
//
// ★ 이 파일이 파일명 유도와 좌표 환산의 **단일 정본**이다. 화면 어디서도 경로를
//   재조립하거나 좌표식을 다시 쓰지 않는다.
//
// 좌표 계약의 정본은 engine/flatness/outputs/height_view.py의
// render_height_view_plain 독스트링이다(단계 E 최종 리뷰가 오프센터 범프로 전수
// 검증했다). 여기 옮겨 적는다:
//
//     사이드카 shape = [ny, nx]        <- 세로 먼저
//     이미지 크기    = (가로 nx, 세로 ny)
//     픽셀 (px,py) 좌상단 원점 0-index -> 격자:  ix = px,  iy = ny - 1 - py
//     격자 -> 월드(파일 단위):
//         world_x = bbox_min[0] + (ix + 0.5) * subcell_m_file
//         world_y = bbox_min[1] + (iy + 0.5) * subcell_m_file
//
// ★ z는 median_z 원값이 아니다. engine/flatness/core/subcell.py의
//   build_subcell_grid가 median_z를 **bbox_min[2] 기준 상대 높이**로 저장한다
//   (`z - lo[2]`). 워커 registration.load_source_points는 점군에 bbox_min[2]를
//   더해 절대 높이로 되돌린 뒤 정합하고, 대응점에는 unit_scale만 곱한다
//   (align_sources). 그러므로 화면이 보내는 z도 bbox_min[2]를 더한 값이어야
//   한다 - 빠뜨리면 두 스캔의 bbox 최저 z 차이만큼 대응점 z가 통째로 어긋난다.
//
// 클릭 대상은 **무장식 PNG**다(설계 결정 F7). 화면에 크게 보이는 장식 PNG는
// matplotlib 여백·컬러바 때문에 픽셀 -> 월드 역산이 불가능하다.
import { dataUrl } from './paths';

/** engine/flatness/outputs/height_view.py의 SCHEMA_VERSION과 같아야 한다. */
export const HEIGHT_VIEW_SCHEMA_VERSION = 1;

export interface HeightViewMeta {
  schema_version: number;
  /** 원 파일 단위 그대로의 bbox. bbox_min[2]가 median_z의 기준면이다. */
  bbox_min: [number, number, number];
  bbox_max: [number, number, number];
  /** 서브셀 크기(파일 단위). PNG 1픽셀 = 이 크기의 정사각 셀이다. */
  subcell_m_file: number;
  /** [ny, nx] - 세로 먼저. 이미지 크기는 (가로 nx, 세로 ny)다. */
  shape: [number, number];
  /** [ny][nx]. bbox_min[2] 기준 상대 높이. 저밀도·빈 셀은 null(엔진의 NaN). */
  median_z: (number | null)[][];
}

/** 클릭 한 번의 결과. z가 null이면 그 셀에는 높이 값이 없다(설계 결정 F6). */
export interface PickedPoint { x: number; y: number; z: number | null }

function splitExt(path: string): { stem: string; ext: string } {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  if (dot <= slash + 1) return { stem: path, ext: '' }; // 확장자 없음(또는 숨김파일)
  return { stem: path.slice(0, dot), ext: path.slice(dot) };
}

/** height_view_path -> 무장식 PNG 경로.
 *
 * 워커가 같은 디렉터리에 `<basename>_plain.png`로 올린다
 * (worker/flatworker/jobs.py: render_height_view_plain(grid, out_dir / "height_view_plain.png")).
 * 저장된 경로에서 파일명만 바꿔 유도한다 - scan.id로 재조립하지 않는다(경로
 * 규약이 바뀌면 재조립 구현만 조용히 어긋난다).
 */
export function plainPngPath(heightViewPath: string): string {
  const { stem, ext } = splitExt(heightViewPath);
  return `${stem}_plain${ext || '.png'}`;
}

/** height_view_path -> 사이드카 JSON 경로(같은 basename, 확장자만 .json). */
export function sidecarPath(heightViewPath: string): string {
  return `${splitExt(heightViewPath).stem}.json`;
}

// ★ dataUrl()을 쓴다. height_view_path는 이미 버킷-상대 "전체" 경로라
//   artifactUrl(dir, name)로 다시 조립하면 접두사가 두 번 붙어 404가 난다
//   (lib/domain/slope-cells.ts가 문서화한 함정).
export function plainPngUrl(heightViewPath: string): string {
  return dataUrl(plainPngPath(heightViewPath));
}

export function sidecarUrl(heightViewPath: string): string {
  return dataUrl(sidecarPath(heightViewPath));
}

/** 이미지 픽셀 크기. shape가 [ny, nx]이므로 가로가 shape[1]이다. */
export function imageSize(meta: HeightViewMeta): { width: number; height: number } {
  return { width: meta.shape[1], height: meta.shape[0] };
}

function isFinite3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
}

/** 파싱된 원시 객체가 height_view.json인지 내용으로 판별한다.
 *
 * slope-cells.ts의 isSlopeCellsFile과 같은 관례 - 별도 스키마 라이브러리 없이
 * 판별 키를 직접 확인한다. median_z는 행·열 개수까지 shape과 대조한다: 개수가
 * 어긋난 파일을 통과시키면 클릭한 셀과 실제 조회되는 셀이 조용히 달라진다.
 */
export function isHeightViewMeta(raw: unknown): raw is HeightViewMeta {
  if (!raw || typeof raw !== 'object') return false;
  const r = raw as Record<string, unknown>;
  if (r.schema_version !== HEIGHT_VIEW_SCHEMA_VERSION) return false;
  if (!isFinite3(r.bbox_min) || !isFinite3(r.bbox_max)) return false;
  if (typeof r.subcell_m_file !== 'number' || !Number.isFinite(r.subcell_m_file)
      || r.subcell_m_file <= 0) return false;
  if (!Array.isArray(r.shape) || r.shape.length !== 2) return false;
  const [ny, nx] = r.shape as number[];
  if (!Number.isInteger(ny) || !Number.isInteger(nx) || ny <= 0 || nx <= 0) return false;
  if (!Array.isArray(r.median_z) || r.median_z.length !== ny) return false;
  return (r.median_z as unknown[]).every((row) => Array.isArray(row) && row.length === nx
    && row.every((v) => v === null || (typeof v === 'number' && Number.isFinite(v))));
}

/** 사이드카를 받아 검증한다. 실패는 전부 한국어 사유로 던진다. */
export async function fetchHeightViewMeta(heightViewPath: string): Promise<HeightViewMeta> {
  const res = await fetch(sidecarUrl(heightViewPath));
  if (!res.ok) {
    throw new Error(
      `높이 뷰 좌표 정보를 불러오지 못했습니다(HTTP ${res.status}). 스캔 산출물이 지워졌거나 `
      + '아직 사전 검사가 끝나지 않았을 수 있습니다.');
  }
  const raw = await res.json();
  if (!isHeightViewMeta(raw)) {
    throw new Error(
      '높이 뷰 좌표 정보 형식이 올바르지 않습니다. 이 스캔의 사전 검사를 다시 실행해야 합니다.');
  }
  return raw;
}

/** 무장식 PNG의 픽셀 좌표 -> 월드 좌표(파일 단위) + 그 셀의 절대 z.
 *
 * px/py는 클릭에서 오므로 소수일 수 있다 - 셀 안으로 내림한다.
 * 격자 밖이거나 median_z가 null(엔진의 NaN)이면 z는 null이다. **0으로 대체하거나
 * 이웃에서 끌어오지 않는다**(설계 결정 F6) - 그러면 대응점이 조용히 틀린다.
 * x·y는 격자 밖에서도 수식대로 계산한다(어느 셀을 찍었는지 화면이 알려줄 수 있게).
 */
export function pixelToWorld(meta: HeightViewMeta, px: number, py: number): PickedPoint {
  const [ny, nx] = meta.shape;
  const sub = meta.subcell_m_file;
  const ix = Math.floor(px);
  const iy = ny - 1 - Math.floor(py);
  const x = meta.bbox_min[0] + (ix + 0.5) * sub;
  const y = meta.bbox_min[1] + (iy + 0.5) * sub;
  const inside = ix >= 0 && ix < nx && iy >= 0 && iy < ny;
  const cell = inside ? meta.median_z[iy][ix] : null;
  // bbox_min[2]를 더해 절대 높이(파일 단위)로 되돌린다 - 파일 상단 주석 참고.
  return { x, y, z: cell === null ? null : meta.bbox_min[2] + cell };
}

/** pixelToWorld의 역함수. 저장된 대응점을 다시 마커로 그릴 때 쓴다. */
export function worldToPixel(meta: HeightViewMeta, x: number, y: number): { px: number; py: number } {
  const [ny] = meta.shape;
  const sub = meta.subcell_m_file;
  const ix = Math.floor((x - meta.bbox_min[0]) / sub);
  const iy = Math.floor((y - meta.bbox_min[1]) / sub);
  return { px: ix, py: ny - 1 - iy };
}
