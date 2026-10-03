import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// WebGL2 탐지(probeWebgl2)만 가짜로 바꾼다. 같은 모듈의 createRenderer 는 실제 구현이고,
// 그것이 부르는 canvas.getContext 는 아래 3D 탭 describe 가 gl 호출 기록 스텁으로 끼운다.
vi.mock('@/lib/viz/points3d/gl-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/viz/points3d/gl-renderer')>();
  return { ...actual, probeWebgl2: vi.fn() };
});
// Preview3dTab 을 얇게 감싼다. 평소에는 실제 구현을 그대로 그리고(통합 테스트),
// tabProbe.render 가 있으면 그것을 대신 그려 AnalysisResult 가 넘긴 props 와 콜백을 직접 부른다(계약 테스트).
type TabProps = Parameters<typeof import('../preview3d-tab').Preview3dTab>[0];
const tabProbe = vi.hoisted(() => ({ render: null as null | ((props: TabProps) => ReactNode) }));
vi.mock('../preview3d-tab', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../preview3d-tab')>();
  return {
    ...actual,
    Preview3dTab: (props: TabProps) => (tabProbe.render ? tabProbe.render(props) : <actual.Preview3dTab {...props} />),
  };
});

import { AnalysisResult } from '../analysis-result';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';
import { probeWebgl2 } from '@/lib/viz/points3d/gl-renderer';
import { recordingGl } from '@/lib/viz/points3d/__tests__/gl-stub';

const stats: Stats = {
  n_cells: 1, n_valid: 1,
  grade_counts: { pass: 1, borderline: 0, repair: 0, rework: 0, na: 0 },
  grade_pct: { pass: 100, borderline: 0, repair: 0, rework: 0, na: 0 },
  value_max_mm: 3.2, value_min_mm: 3.2, value_mean_mm: 3.2, value_p95_mm: 3.2,
  worst: { value_mm: 3.2, cell_ix: 0, cell_iy: 0, point_x: 0.5, point_y: 0.5, zone_id: 1 },
  coverage_pct: 98.0, reduced_span_cells: 0,
  applied_criteria: { name: 'floor-kcs-exposed', source: 'KCS 14 20 10', span_m: 3,
                      pass_mm: 7, rework_mm: 21, u_mm: 5 },
  warnings: [], zones: [],
  meta: { file: 'raw.ply', n_points: 100, surface: 'floor', engine_version: 'p1d-0.4.0' },
  auto_summary: '자동 의견',
  deviation_paths: ['deviation.png'],
};

const analysis: AnalysisRow = {
  id: 'an1', scan_id: 'scan1', surface: 'floor', criteria_id: 'c1', applied_criteria: null,
  params: {}, engine_version: 'p1d-0.4.0', status: 'done', stats, coverage_pct: 98.0,
  overall_verdict: 'pass', warnings: [], artifacts_dir: 'artifacts/an1',
  auto_summary: '자동 의견', user_summary: null, is_current: true, deleted_at: null,
  created_at: '2026-07-29', created_by: null, kind: 'flatness',
};

const scan: ScanRow = {
  id: 'scan1', location_id: 'loc1', surface: 'floor', scanned_at: '2026-07-20', device: null,
  operator_id: null, operator_name_manual: null, selected_criteria_id: null,
  raw_file_path: null, original_filename: null, file_format: null, point_count: null,
  unit_scale: null, lineage: 'raw', status: 'ready', height_view_path: null, deleted_at: null,
  created_at: '2026-07-20', updated_at: '2026-07-20',
};

// cells.json fetch는 히트맵 탭 전용이라 빈 배열로 스텁한다
function stubCellsFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] } as unknown as Response)));
}

describe('AnalysisResult 정밀 편차맵 탭', () => {
  it('탭을 누르면 stats.deviation_paths의 이미지를 보여준다', async () => {
    stubCellsFetch();

    render(<AnalysisResult analysis={analysis} scan={scan} photos={[]} />);
    // Cloudscape 리스킨(T7): 탭은 TabBar(role=tab)다 - 동작(클릭 -> 이미지)은 그대로
    fireEvent.click(screen.getByRole('tab', { name: '정밀 편차맵' }));

    await waitFor(() => {
      const img = screen.getByAltText('정밀 편차맵(10cm)') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/api/data/artifacts/an1/deviation.png');
    });
  });

  it('편차맵이 없는 분석에서는 안내 문구를 보여준다', async () => {
    stubCellsFetch();
    const without = { ...analysis, stats: { ...stats, deviation_paths: undefined } };

    render(<AnalysisResult analysis={without} scan={scan} photos={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: '정밀 편차맵' }));

    await waitFor(() => {
      expect(screen.getByText(/정밀 편차맵이 없습니다/)).toBeInTheDocument();
    });
  });

  it('임포트(Colab) 결과에서는 편차맵 재분석을 권하지 않는다 (스펙 §8/계약 §2: 임포트 경로는 편차맵 미생성)', async () => {
    stubCellsFetch();
    const imported: AnalysisRow = {
      ...analysis, engine_version: 'external-colab-v1',
      stats: { ...stats, deviation_paths: undefined,
                meta: { ...stats.meta, engine_version: 'external-colab-v1', source: 'colab-import' } },
    };

    render(<AnalysisResult analysis={imported} scan={scan} photos={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: '정밀 편차맵' }));

    await waitFor(() => {
      expect(screen.getByText(/외부\(Colab\) 임포트 결과에는 정밀 편차맵을 생성하지 않습니다/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/재분석하면 생성됩니다/)).not.toBeInTheDocument();
  });
});

// Cloudscape 리스킨(T7): 컨테이너는 페이지(T6)가 그리고 이 컴포넌트는 본문만 그린다 -
// TabBar → 3:2 그리드(좌 히트맵 / 우 판정 패널) → 구간별 결과표.
describe('AnalysisResult Cloudscape 본문 (T7)', () => {
  it('TabBar 4탭(히트맵 활성) + 3:2 그리드 + 구간별 결과표 제목, 구 팔레트 클래스 없음', async () => {
    stubCellsFetch();
    const { container } = render(<AnalysisResult analysis={analysis} scan={scan} photos={[]} />);

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['히트맵', '정밀 편차맵', '3D 프리뷰', '현장 사진']);
    expect(screen.getByRole('tab', { name: '히트맵' })).toHaveAttribute('aria-selected', 'true');

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('flex flex-col gap-5');
    const grid = root.firstElementChild as HTMLElement;
    expect(grid.className).toContain('md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]');
    expect(grid.className).toContain('gap-5');
    expect(screen.getByRole('heading', { level: 3, name: '구간별 결과표' })).toBeInTheDocument();

    // 빈 cells가 도착하면 히트맵 자리에는 "표시할 셀 데이터가 없습니다." (fetch 이펙트를 기다려 act 경고를 막는다)
    await waitFor(() => expect(screen.getByText('표시할 셀 데이터가 없습니다.')).toBeInTheDocument());
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-|green-|purple-/);
  });
});

// ---------------------------------------------------------------------------
// 3D 프리뷰 탭 통합 (스펙 2026-10-02-pointcloud-viewer-design.md §7.3, §10.4)
// 점 파일은 탭 첫 진입에 한 번만 받아 AnalysisResult state 에 둔다. 탐지 결과와 소프트웨어 렌더 선택도 같다.
// ---------------------------------------------------------------------------

// __tests__ -> analysis -> components -> dashboard -> 저장소 루트. 엔진 pytest 와 같은 골든 파일을 읽는다(n = 12)
const GOLDEN_PATH = join(__dirname, '../../../../engine/tests/fixtures/points3d_golden.bin');
const GOLDEN_N = 12;

/** 골든 파일을 새 ArrayBuffer 로 읽는다. 작은 Buffer 는 풀링된 ArrayBuffer 의 임의 오프셋을 가리키므로 잘라 낸다. */
function golden(): ArrayBuffer {
  const buf = readFileSync(GOLDEN_PATH);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * 골든의 앞 n 점만 남긴 올바른 파일(n 은 10 또는 11). 분석 B 의 점 데이터로 쓴다.
 * 화면의 점 수(HUD)가 A(12점)와 달라야 "지금 그린 점이 어느 분석의 것인가"를 단언할 수 있다.
 * 형식: magic 4 + json_len 4 + JSON(json_len) + uint16 xyz[3n] + int16 dev[n].
 * n_points 의 자릿수가 12 와 같아 json_len 과 공백 패딩은 그대로다.
 */
function goldenFirst(n: number): ArrayBuffer {
  const src = new Uint8Array(golden());
  const jsonLen = new DataView(src.buffer).getUint32(4, true);
  const body = 8 + jsonLen;
  const json = new TextDecoder().decode(src.subarray(8, body));
  const edited = new TextEncoder().encode(json.replace(`"n_points":${GOLDEN_N}`, `"n_points":${n}`));
  if (edited.length !== jsonLen || n < 10 || n >= GOLDEN_N) throw new Error('goldenFirst: n 은 10 또는 11 이어야 한다');
  const out = new Uint8Array(body + 8 * n);
  out.set(src.subarray(0, 8), 0);
  out.set(edited, 8);
  out.set(src.subarray(body, body + 6 * n), body);                                       // xyz 앞 3n 개
  out.set(src.subarray(body + 6 * GOLDEN_N, body + 6 * GOLDEN_N + 2 * n), body + 6 * n); // dev 앞 n 개
  return out.buffer;
}

/** magic 첫 바이트를 깨뜨린 버퍼. parsePoints3d 가 bad_magic 으로 거부한다. */
function brokenGolden(): ArrayBuffer {
  const bytes = new Uint8Array(golden());
  bytes[0] = 0x58;
  return bytes.buffer;
}

// 분석 A: 파일 이름을 엔진의 실제 이름과 다르게 준다. 대시보드가 이름을 리터럴로 고정하면 URL 단언이 죽는다.
const stats3d: Stats = {
  ...stats, preview3d_paths: ['preview3d.png'],
  points3d_paths: ['custom3d.bin'], points3d_threshold_q: 70,
};
const analysisA: AnalysisRow = { ...analysis, stats: stats3d };
// 분석 B: id, artifacts_dir, 파일 이름, 기본 임계값이 전부 A 와 다르다
const analysisB: AnalysisRow = {
  ...analysis, id: 'an2', artifacts_dir: 'artifacts/an2',
  stats: { ...stats3d, points3d_paths: ['points3d.bin'], points3d_threshold_q: 60 },
};
const URL_A = '/api/data/artifacts/an1/custom3d.bin';
const URL_B = '/api/data/artifacts/an2/points3d.bin';

// 화면 문구(스펙 §7.12 전문 그대로)
const M1 = '벽면 분석은 3D 프리뷰 이미지와 3D 점군 뷰를 제공하지 않습니다.';
const M2 = '외부 결과(임포트)에는 3D 점군 데이터를 생성하지 않습니다.';
const M4 = '이 기기는 그래픽 가속을 사용할 수 없어 3D 점군 뷰가 느릴 수 있습니다. 기본으로 정적 이미지를 표시합니다.';
const M5 = '3D 점군 데이터를 저장소에서 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.';
const M6 = '3D 점군 데이터 형식을 읽을 수 없습니다. 지원하지 않는 버전이거나 손상된 파일입니다.';
const M7 = '이 브라우저 또는 기기에서는 WebGL2를 사용할 수 없어 3D 점군 뷰를 표시할 수 없습니다.';

function okBin(buf: ArrayBuffer): Response {
  return { ok: true, status: 200, arrayBuffer: async () => buf } as unknown as Response;
}
// 404 응답에도 본문이 있다(오류 페이지). ok 를 보지 않고 본문을 읽으면 받기 실패가 형식 오류로 둔갑한다
const NOT_FOUND = {
  ok: false, status: 404,
  arrayBuffer: async () => new TextEncoder().encode('<html>Not Found</html>').buffer,
} as unknown as Response;

/** 테스트가 직접 resolve 하는 응답(늦은 응답 순서를 만들 때 쓴다). */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

/**
 * URL 로 갈라 응답하는 fetch 스텁. cells.json 은 빈 배열(json), *.bin 은 binReply 가 정한다(arrayBuffer).
 * binUrls() 는 지금까지 나간 *.bin 요청의 URL 목록(호출 순)이다. cells.json 요청은 세지 않는다.
 * binReply 의 둘째 인자는 그 요청이 몇 번째 *.bin 요청인가(1부터)다.
 */
function stubFetch(binReply: (url: string, nth: number) => Promise<Response>) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.endsWith('.bin')) return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response);
    urls.push(url);
    return binReply(url, urls.length);
  }));
  return { binUrls: () => [...urls] };
}

const probeMock = vi.mocked(probeWebgl2);
let webgl2Available = true;
let getContextSpy: ReturnType<typeof stubGetContext>;

// jsdom 의 getContext 는 null 이다. 'webgl2' 요청에만 gl 호출 기록 스텁을 주고 나머지(히트맵의 '2d')는 null 로 둔다.
function stubGetContext() {
  const rec = recordingGl();
  return vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    ((id: string) => (id === 'webgl2' && webgl2Available ? rec.gl : null)) as unknown as HTMLCanvasElement['getContext'],
  );
}
/** Points3dView 마운트 횟수(마운트마다 getContext('webgl2', ...) 를 한 번 부른다). */
const webgl2Calls = () => getContextSpy.mock.calls.filter((c) => c[0] === 'webgl2').length;

const open3d = () => fireEvent.click(screen.getByRole('tab', { name: '3D 프리뷰' }));
const openHeatmap = () => fireEvent.click(screen.getByRole('tab', { name: '히트맵' }));
const viewerCanvas = () => screen.queryByRole('img', { name: '3D 점군 뷰어' });
const findViewer = () => screen.findByRole('img', { name: '3D 점군 뷰어' });
const thresholdSlider = () => screen.getByLabelText('표시 임계값(mm)') as HTMLInputElement;
const hudText = () => screen.getByTestId('points3d-hud').textContent ?? '';
/** 보류 중인 promise 연쇄(fetch -> arrayBuffer -> setState)와 그 뒤의 effect 를 끝까지 흘려보낸다. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('AnalysisResult 3D 프리뷰 탭 (점 파일 지연 적재)', () => {
  beforeEach(() => {
    webgl2Available = true;
    getContextSpy = stubGetContext();
    probeMock.mockReset();
    probeMock.mockReturnValue('hardware');
  });
  afterEach(() => {
    tabProbe.render = null;
    getContextSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('마운트만으로는 점 파일을 받지 않고 WebGL2 탐지도 하지 않는다(다른 탭을 열어도 같다)', async () => {
    const { binUrls } = stubFetch(async () => okBin(golden()));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    await waitFor(() => expect(screen.getByText('표시할 셀 데이터가 없습니다.')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: '정밀 편차맵' }));
    await flush();

    expect(binUrls()).toEqual([]);
    expect(probeMock).not.toHaveBeenCalled();
    expect(webgl2Calls()).toBe(0);
  });

  it('3D 탭 첫 진입에 stats 가 준 이름으로 한 번 받아 뷰어를 그린다(PNG·옛 문구 없음, 탭 줄 그대로)', async () => {
    const { binUrls } = stubFetch(async () => okBin(golden()));
    const { container } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    await findViewer();

    // 파일명은 리터럴이 아니라 stats.points3d_paths[0] 이다
    expect(binUrls()).toEqual([URL_A]);
    expect(probeMock).toHaveBeenCalledTimes(1);
    // 기본 임계값은 stats.points3d_threshold_q (70 = 7mm). 골든은 12점
    expect(thresholdSlider().value).toBe('70');
    expect(hudText()).toContain('12점');
    // 뷰어가 보일 때는 기존 PNG 를 함께 그리지 않는다. 옛 캡션과 옛 빈 상태 문구는 없앴다
    expect(screen.queryByAltText(/^3D 프리뷰 /)).toBeNull();
    expect(container.textContent).not.toContain('정식 단계 백로그');
    expect(container.textContent).not.toContain('3D 프리뷰가 없습니다');
    // 탭 이름·순서와 활성 탭, 느슨한 팔레트 단언을 3D 탭을 연 상태에도 똑같이 건다
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['히트맵', '정밀 편차맵', '3D 프리뷰', '현장 사진']);
    expect(screen.getByRole('tab', { name: '3D 프리뷰' })).toHaveAttribute('aria-selected', 'true');
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-|green-|purple-/);
  });

  it('다른 탭에 갔다 돌아와도 다시 받지 않고 다시 탐지하지 않는다(로딩 틀 없이 곧바로 뷰어)', async () => {
    const { binUrls } = stubFetch(async () => okBin(golden()));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    await findViewer();

    for (let i = 0; i < 2; i++) {
      openHeatmap();
      expect(viewerCanvas()).toBeNull();   // 탭 본문은 조건부 렌더라 언마운트된다
      open3d();
      // 데이터와 탐지 결과가 상위 state 에 남아 있으므로 첫 렌더가 뷰어다
      expect(viewerCanvas()).not.toBeNull();
      expect(screen.queryByTestId('points3d-loading')).toBeNull();
    }
    await flush();
    expect(binUrls()).toEqual([URL_A]);
    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(webgl2Calls()).toBe(3);   // 뷰어는 탭에 들어올 때마다 새로 마운트된다(첫 진입 1 + 왕복 2)
  });

  it('소프트웨어 렌더: 선택 전에는 받지 않고, "3D로 보기" 뒤에는 탭을 왕복해도 다시 누르지 않는다', async () => {
    probeMock.mockReturnValue('software');
    const { binUrls } = stubFetch(async () => okBin(golden()));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();

    const optIn = await screen.findByRole('button', { name: '3D로 보기' });
    expect(screen.getByText(M4)).toBeInTheDocument();
    expect((screen.getByAltText('3D 프리뷰 preview3d.png') as HTMLImageElement).getAttribute('src'))
      .toBe('/api/data/artifacts/an1/preview3d.png');
    await flush();
    expect(binUrls()).toEqual([]);          // 선택 전에는 점 파일을 받지 않는다
    expect(webgl2Calls()).toBe(0);

    fireEvent.click(optIn);
    await findViewer();
    expect(binUrls()).toEqual([URL_A]);

    openHeatmap();
    open3d();
    expect(viewerCanvas()).not.toBeNull();  // 곧바로 뷰어
    expect(screen.queryByRole('button', { name: '3D로 보기' })).toBeNull();
    await flush();
    expect(binUrls()).toEqual([URL_A]);
    expect(probeMock).toHaveBeenCalledTimes(1);
  });

  it('3D 탭을 연 채 다른 분석으로 바꾸면 새로 받고, 받는 동안 이전 분석의 점을 그리지 않는다', async () => {
    const b = deferred<Response>();
    const { binUrls } = stubFetch((url) => (url === URL_B ? b.promise : Promise.resolve(okBin(golden()))));
    const { rerender } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    await findViewer();
    expect(hudText()).toContain('12점');

    // page.tsx 는 AnalysisResult 에 key 를 주지 않는다. 같은 인스턴스가 재사용되고 tab·load state 가 남는다
    rerender(<AnalysisResult analysis={analysisB} scan={scan} photos={[]} />);
    // 바꾼 직후의 첫 렌더부터 A 의 점으로 뷰어를 그리지 않는다
    expect(viewerCanvas()).toBeNull();
    expect(screen.getByTestId('points3d-loading')).toBeInTheDocument();
    await waitFor(() => expect(binUrls()).toEqual([URL_A, URL_B]));
    expect(viewerCanvas()).toBeNull();

    b.resolve(okBin(goldenFirst(11)));
    await findViewer();
    expect(hudText()).toContain('11점');             // B 의 점
    expect(thresholdSlider().value).toBe('60');      // B 의 points3d_threshold_q
    expect(probeMock).toHaveBeenCalledTimes(1);      // 탐지 결과는 분석을 바꿔도 유지한다
    expect(binUrls()).toEqual([URL_A, URL_B]);
  });

  it('늦은 응답: B 를 받는 중에 A 의 응답이 먼저 도착해도 A 를 그리지 않고, B 가 도착하면 B 를 그린다', async () => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    const { binUrls } = stubFetch((url) => (url === URL_A ? a.promise : b.promise));
    const { rerender } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    await waitFor(() => expect(binUrls()).toEqual([URL_A]));
    rerender(<AnalysisResult analysis={analysisB} scan={scan} photos={[]} />);
    await waitFor(() => expect(binUrls()).toEqual([URL_A, URL_B]));

    a.resolve(okBin(golden()));
    await flush();
    expect(viewerCanvas()).toBeNull();
    expect(screen.getByTestId('points3d-loading')).toBeInTheDocument();

    b.resolve(okBin(goldenFirst(11)));
    await findViewer();
    expect(hudText()).toContain('11점');
    expect(thresholdSlider().value).toBe('60');
    expect(binUrls()).toEqual([URL_A, URL_B]);
  });

  it('늦은 응답: B 를 그린 뒤에 A 의 응답이 도착해도 B 의 상태가 유지되고 다시 받지 않는다', async () => {
    const a = deferred<Response>();
    const b = deferred<Response>();
    const { binUrls } = stubFetch((url) => (url === URL_A ? a.promise : b.promise));
    const { rerender } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    await waitFor(() => expect(binUrls()).toEqual([URL_A]));
    rerender(<AnalysisResult analysis={analysisB} scan={scan} photos={[]} />);
    await waitFor(() => expect(binUrls()).toEqual([URL_A, URL_B]));

    b.resolve(okBin(goldenFirst(11)));
    await findViewer();
    const mounts = webgl2Calls();

    a.resolve(okBin(golden()));
    await flush();
    expect(viewerCanvas()).not.toBeNull();
    expect(screen.queryByTestId('points3d-loading')).toBeNull();
    expect(hudText()).toContain('11점');
    expect(thresholdSlider().value).toBe('60');
    expect(binUrls()).toEqual([URL_A, URL_B]);   // A 의 응답 때문에 B 를 다시 받지 않는다
    expect(webgl2Calls()).toBe(mounts);          // 뷰어가 다시 마운트되지도 않는다
  });

  it.each<[string, () => Promise<Response>]>([
    ['404 응답', () => Promise.resolve(NOT_FOUND)],
    ['fetch 예외', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['arrayBuffer() 예외', () => Promise.resolve({
      ok: true, status: 200, arrayBuffer: () => Promise.reject(new TypeError('network error')),
    } as unknown as Response)],
  ])('받기 실패(%s): 사유를 드러내고, 다시 시도를 누르면 한 번 더 받아 뷰어를 그린다', async (_name, fail) => {
    const { binUrls } = stubFetch((_url, nth) => (nth === 1 ? fail() : Promise.resolve(okBin(golden()))));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();

    expect(await screen.findByText(M5)).toBeInTheDocument();
    expect(screen.getByText(M5).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(viewerCanvas()).toBeNull();
    await flush();
    expect(binUrls()).toEqual([URL_A]);   // 실패 뒤에 스스로 다시 받지 않는다

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await findViewer();
    expect(binUrls()).toEqual([URL_A, URL_A]);
    expect(screen.queryByText(M5)).toBeNull();
  });

  it('형식 불일치: 읽을 수 없는 버퍼면 형식 오류를 드러내고, 다시 시도로 다시 받는다', async () => {
    const { binUrls } = stubFetch((_url, nth) => Promise.resolve(okBin(nth === 1 ? brokenGolden() : golden())));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();

    expect(await screen.findByText(M6)).toBeInTheDocument();
    expect(screen.getByText(M6).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.queryByText(M5)).toBeNull();   // 받기 실패와 구분된다
    expect(viewerCanvas()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    await findViewer();
    expect(binUrls()).toEqual([URL_A, URL_A]);
  });

  it('분석을 바꾸면 이전 분석의 뷰어 오류가 남지 않는다(탭 본문이 새로 마운트된다)', async () => {
    const { binUrls } = stubFetch((url) => Promise.resolve(okBin(url === URL_B ? goldenFirst(11) : golden())));
    webgl2Available = false;   // A 에서는 렌더러를 만들지 못한다
    const { rerender } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    expect(await screen.findByText(M7)).toBeInTheDocument();

    webgl2Available = true;
    rerender(<AnalysisResult analysis={analysisB} scan={scan} photos={[]} />);
    await findViewer();
    expect(screen.queryByText(M7)).toBeNull();
    expect(binUrls()).toEqual([URL_A, URL_B]);
    expect(thresholdSlider().value).toBe('60');
  });

  it('개발 모드의 effect 이중 실행(StrictMode)에서도 점 파일 요청은 한 번만 나간다', async () => {
    const { binUrls } = stubFetch((url) => Promise.resolve(okBin(url === URL_B ? goldenFirst(11) : golden())));
    const { rerender } = render(
      <StrictMode><AnalysisResult analysis={analysisA} scan={scan} photos={[]} /></StrictMode>,
    );
    open3d();
    await findViewer();
    expect(binUrls()).toEqual([URL_A]);

    // 탐지 결과가 이미 있는 상태에서 3D 탭에 들어오면 요청 effect 가 마운트 시점에 참이다.
    // StrictMode 는 마운트 effect 를 두 번 돌리고, 두 번 모두 같은 렌더의 load(idle)를 본다.
    openHeatmap();
    rerender(<StrictMode><AnalysisResult analysis={analysisB} scan={scan} photos={[]} /></StrictMode>);
    open3d();
    await findViewer();
    await flush();
    expect(binUrls()).toEqual([URL_A, URL_B]);
    expect(hudText()).toContain('11점');
  });

  it('벽면 분석: 안내 문구만 보이고 탐지도 받기도 하지 않는다', async () => {
    const { binUrls } = stubFetch(async () => okBin(golden()));
    const wall: AnalysisRow = { ...analysis, surface: 'wall' };
    const { container } = render(<AnalysisResult analysis={wall} scan={scan} photos={[]} />);
    open3d();
    await flush();

    expect(screen.getByText(M1)).toBeInTheDocument();
    expect(container.textContent).not.toContain('3D 프리뷰가 없습니다');
    expect(binUrls()).toEqual([]);
    expect(probeMock).not.toHaveBeenCalled();
  });

  it('임포트 결과: 재분석을 권하지 않는 안내가 보이고 탐지도 받기도 하지 않는다', async () => {
    const { binUrls } = stubFetch(async () => okBin(golden()));
    const imported: AnalysisRow = {
      ...analysis, engine_version: 'external-colab-v1',
      stats: { ...stats, meta: { ...stats.meta, engine_version: 'external-colab-v1', source: 'colab-import' } },
    };
    const { container } = render(<AnalysisResult analysis={imported} scan={scan} photos={[]} />);
    open3d();
    await flush();

    expect(screen.getByText(M2)).toBeInTheDocument();
    expect(container.textContent).not.toContain('재분석하면 생성됩니다');
    expect(binUrls()).toEqual([]);
    expect(probeMock).not.toHaveBeenCalled();
  });
});

// AnalysisResult 가 Preview3dTab 에 넘기는 콜백의 계약(스펙 §7.3 의 4·8·10번)을 직접 부른다.
// 실제 Preview3dTab 은 요청 effect 가 스스로 걸러 부르므로, 통합 테스트만으로는 멱등 가드가 하중을 받지 않는다.
describe('AnalysisResult 가 3D 탭에 넘기는 적재 콜백 (탐침으로 직접 호출)', () => {
  /** 탐침: 적재 상태를 글자로 보이고, 콜백을 부르는 버튼을 둔다. */
  function useProbe() {
    tabProbe.render = (p) => (
      <div>
        <output data-testid="probe-load">{'dir' in p.load ? `${p.load.status}:${p.load.dir}` : p.load.status}</output>
        <output data-testid="probe-support">{String(p.support)}</output>
        <output data-testid="probe-opted">{String(p.optedIn)}</output>
        <button onClick={() => { p.onRequestLoad(); p.onRequestLoad(); }}>요청 두 번</button>
        <button onClick={() => p.onRequestLoad()}>요청</button>
        <button onClick={() => p.onRetryLoad()}>다시 받기</button>
        <button onClick={() => p.onSupport('software')}>탐지 결과</button>
        <button onClick={() => p.onOptIn()}>선택</button>
      </div>
    );
  }
  const loadText = () => screen.getByTestId('probe-load').textContent;
  const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

  afterEach(() => {
    tabProbe.render = null;
    vi.unstubAllGlobals();
  });

  it('onRequestLoad 는 멱등이다: 같은 렌더에서 두 번, 받는 중, 받은 뒤 어느 때 불러도 요청은 한 번이다', async () => {
    useProbe();
    const first = deferred<Response>();
    const { binUrls } = stubFetch(() => first.promise);
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    expect(loadText()).toBe('idle');
    await flush();
    expect(binUrls()).toEqual([]);          // 탭 본문이 요청하지 않으면 받지 않는다

    press('요청 두 번');                     // 두 호출 모두 같은 렌더의 load(idle)를 본다
    expect(binUrls()).toEqual([URL_A]);
    expect(loadText()).toBe('loading:artifacts/an1');

    press('요청');                           // 받는 중
    expect(binUrls()).toEqual([URL_A]);

    first.resolve(okBin(golden()));
    await waitFor(() => expect(loadText()).toBe('ready:artifacts/an1'));
    press('요청');                           // 받은 뒤
    await flush();
    expect(binUrls()).toEqual([URL_A]);
    expect(loadText()).toBe('ready:artifacts/an1');
  });

  it('받기에 실패한 뒤의 onRequestLoad 는 다시 받지 않고, onRetryLoad 는 검사 없이 다시 받는다', async () => {
    useProbe();
    const { binUrls } = stubFetch((_url, nth) => Promise.resolve(nth === 1 ? NOT_FOUND : okBin(golden())));
    render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    press('요청');
    await waitFor(() => expect(loadText()).toBe('error:artifacts/an1'));

    press('요청');                           // 오류 상태는 idle 이 아니다. 스스로 다시 받지 않는다
    await flush();
    expect(binUrls()).toEqual([URL_A]);
    expect(loadText()).toBe('error:artifacts/an1');

    press('다시 받기');
    expect(loadText()).toBe('loading:artifacts/an1');   // 곧바로 loading 으로 둔다
    await waitFor(() => expect(loadText()).toBe('ready:artifacts/an1'));
    expect(binUrls()).toEqual([URL_A, URL_A]);
  });

  it.each<[string, AnalysisRow]>([
    ['점 파일 이름이 없는 분석', analysis],
    ['산출물 경로가 없는 분석', { ...analysisA, artifacts_dir: null }],
  ])('%s 에서는 onRequestLoad 와 onRetryLoad 가 아무것도 하지 않는다', async (_name, row) => {
    useProbe();
    const { binUrls } = stubFetch(async () => okBin(golden()));
    render(<AnalysisResult analysis={row} scan={scan} photos={[]} />);
    open3d();
    press('요청');
    press('다시 받기');
    await flush();

    expect(binUrls()).toEqual([]);
    expect(loadText()).toBe('idle');
  });

  it('탐지 결과와 소프트웨어 렌더 선택은 탭을 벗어나도, 분석을 바꿔도 남는다', async () => {
    useProbe();
    stubFetch(async () => okBin(golden()));
    const { rerender } = render(<AnalysisResult analysis={analysisA} scan={scan} photos={[]} />);
    open3d();
    expect(screen.getByTestId('probe-support').textContent).toBe('null');
    expect(screen.getByTestId('probe-opted').textContent).toBe('false');

    press('탐지 결과');
    press('선택');
    openHeatmap();
    rerender(<AnalysisResult analysis={analysisB} scan={scan} photos={[]} />);
    open3d();
    expect(screen.getByTestId('probe-support').textContent).toBe('software');
    expect(screen.getByTestId('probe-opted').textContent).toBe('true');
    await flush();
  });
});
