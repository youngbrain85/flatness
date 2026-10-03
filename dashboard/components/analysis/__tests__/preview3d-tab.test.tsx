// 3D 프리뷰 탭 본문(Preview3dTab): 스펙 2026-10-02 pointcloud-viewer §7.11 분기표의 화면,
// 탐지 effect·요청 effect, 다시 시도 전이. 상위(AnalysisResult)가 가진 state(load, support, optedIn)는
// props 로 주입한다. Points3dView 와 createRenderer 는 실제 구현을 쓰고 getContext 만 스텁으로 끼운다.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

// probeWebgl2 만 가짜로 바꾼다. createRenderer 는 실제 것을 남겨야 뷰어 마운트를 getContext 호출 수로 셀 수 있다
vi.mock('@/lib/viz/points3d/gl-renderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/viz/points3d/gl-renderer')>()),
  probeWebgl2: vi.fn(),
}));

import { Preview3dTab } from '../preview3d-tab';
import { probeWebgl2 } from '@/lib/viz/points3d/gl-renderer';
import { recordingGl } from '@/lib/viz/points3d/__tests__/gl-stub';
import type { Points3dData, Points3dLoad, Webgl2Support } from '@/lib/domain/points3d';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';

// ---- 화면 문구: 스펙 §7.12 에서 손으로 옮긴 전문(구현의 상수를 가져다 쓰지 않는다) ----
const M1 = '벽면 분석은 3D 프리뷰 이미지와 3D 점군 뷰를 제공하지 않습니다.';
const M2 = '외부 결과(임포트)에는 3D 점군 데이터를 생성하지 않습니다.';
const M3 = '이 분석에는 3D 점군 데이터가 없습니다. 재분석하면 생성됩니다.';
const M4 = '이 기기는 그래픽 가속을 사용할 수 없어 3D 점군 뷰가 느릴 수 있습니다. 기본으로 정적 이미지를 표시합니다.';
const M5 = '3D 점군 데이터를 저장소에서 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.';
const M6 = '3D 점군 데이터 형식을 읽을 수 없습니다. 지원하지 않는 버전이거나 손상된 파일입니다.';
const M7 = '이 브라우저 또는 기기에서는 WebGL2를 사용할 수 없어 3D 점군 뷰를 표시할 수 없습니다.';
const M8 = '그래픽 컨텍스트가 끊겨 3D 점군 뷰를 표시할 수 없습니다. 다시 시도하세요.';
const M9 = '3D 점군 데이터를 불러오는 중입니다.';
const M10 = '엔진이 생성한 정적 3D 프리뷰 이미지입니다. 높이 축은 편차(mm)이며 실제 축 비율이 아닙니다.';
// 없애기로 한 옛 문구(analysis-result.tsx 의 옛 3D 탭 본문)
const OLD_CAPTION = '워커가 생성한 정적 3D 프리뷰입니다';
const OLD_EMPTY = '3D 프리뷰가 없습니다';

const DIR_A = 'artifacts/an1';
const DIR_B = 'artifacts/an2';

// ---- 픽스처 ----
/** 뷰어 대상인 바닥 분석의 stats: 정적 PNG 1장, 점 파일, 표시 임계값 70(7mm)이 다 있다. */
function statsOf(extra: Partial<Stats> = {}): Stats {
  return {
    n_cells: 1, n_valid: 1,
    grade_counts: { pass: 1, borderline: 0, repair: 0, rework: 0, na: 0 },
    grade_pct: { pass: 100, borderline: 0, repair: 0, rework: 0, na: 0 },
    value_max_mm: 3.2, value_min_mm: 3.2, value_mean_mm: 3.2, value_p95_mm: 3.2,
    worst: null, coverage_pct: 98.0, reduced_span_cells: 0,
    applied_criteria: { name: 'floor-kcs-exposed', source: 'KCS 14 20 10', span_m: 3,
                        pass_mm: 7, rework_mm: 21, u_mm: 5 },
    warnings: [], zones: [],
    meta: { file: 'raw.ply', n_points: 100, surface: 'floor', engine_version: 'p4-0.5.0' },
    auto_summary: '자동 의견',
    preview3d_paths: ['preview3d.png'],
    points3d_paths: ['points3d.bin'],
    points3d_threshold_q: 70,
    ...extra,
  };
}

function analysisOf(stats: Stats, over: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    id: 'an1', scan_id: 'scan1', surface: 'floor', criteria_id: 'c1', applied_criteria: null,
    params: {}, engine_version: 'p4-0.5.0', status: 'done', stats, coverage_pct: 98.0,
    overall_verdict: 'pass', warnings: [], artifacts_dir: DIR_A,
    auto_summary: '자동 의견', user_summary: null, is_current: true, deleted_at: null,
    created_at: '2026-10-02', created_by: null, kind: 'flatness',
    ...over,
  };
}

const SCAN: ScanRow = {
  id: 'scan1', location_id: 'loc1', surface: 'floor', scanned_at: '2026-10-01', device: null,
  operator_id: null, operator_name_manual: null, selected_criteria_id: null,
  raw_file_path: null, original_filename: null, file_format: null, point_count: null,
  unit_scale: null, lineage: 'raw', status: 'ready', height_view_path: null, deleted_at: null,
  created_at: '2026-10-01', updated_at: '2026-10-01',
};

/** 손으로 만든 점 3개짜리 데이터. 범위 4.0 x 2.5 x 0.3125 m, 편차 0 / +3.2mm / -10.5mm. */
const DATA: Points3dData = {
  meta: {
    schema_version: 1, n_points: 3, units: 'm',
    origin_m: [254012.8371, 4180045.1626, 31.6052], extent_m: [4.0, 2.5, 0.3125],
    deviation: { unit_mm: 0.1, not_floor: -32768, no_deviation: -32767 },
    sample_cell_m: 0.0125,
    fit_bounds: { min: [0, 0, 0], max: [4.0, 2.5, 0.1] },
    sampling: { method: 'cell min-hash stratified', source_points: 12345, cap: 500000 },
    order: 'hash',
  },
  xyz: new Uint16Array([0, 0, 0, 65535, 65535, 4096, 32768, 16384, 8192]),
  dev: new Int16Array([0, 32, -105]),
};

const IDLE: Points3dLoad = { status: 'idle' };
const LOADING_A: Points3dLoad = { status: 'loading', dir: DIR_A };
const READY_A: Points3dLoad = { status: 'ready', dir: DIR_A, data: DATA };
const FETCH_ERROR_A: Points3dLoad = { status: 'error', dir: DIR_A, reason: 'fetch' };
const FORMAT_ERROR_A: Points3dLoad = { status: 'error', dir: DIR_A, reason: 'format' };

type TabProps = Parameters<typeof Preview3dTab>[0];

function spies() {
  return { onSupport: vi.fn(), onOptIn: vi.fn(), onRequestLoad: vi.fn(), onRetryLoad: vi.fn() };
}

/** 기준 props: 뷰어 대상인 바닥 분석, 하드웨어 가속, 적재 전(idle), 소프트웨어 렌더 선택 안 함.
 *  stats 를 덮어쓰면 analysis.stats 도 같은 객체가 된다(analysis 를 따로 주면 그 값이 이긴다). */
function tabProps(over: Partial<TabProps> = {}): TabProps {
  const stats = over.stats ?? statsOf();
  return {
    analysis: analysisOf(stats), stats, scan: SCAN, isImport: false,
    load: IDLE, support: 'hardware', optedIn: false,
    ...spies(),
    ...over,
  };
}

/** 상위(AnalysisResult)처럼 support 를 state 로 들고 onSupport 로 갱신하는 최소 부모.
 *  "다시 탐지" 흐름을 끝까지 돌려야 하는 테스트에서만 쓴다. */
function SupportOwner({ initial, log, tab }: {
  initial: Webgl2Support | null;
  log: (s: Webgl2Support | null) => void;
  tab: TabProps;
}) {
  const [support, setSupport] = useState<Webgl2Support | null>(initial);
  return <Preview3dTab {...tab} support={support} onSupport={(s) => { log(s); setSupport(s); }} />;
}

// ---- DOM 헬퍼 ----
const probe = vi.mocked(probeWebgl2);
let getContext: MockInstance<HTMLCanvasElement['getContext']>;

/** Points3dView 가 마운트된 횟수 = canvas.getContext('webgl2', ...) 호출 수(마운트마다 한 번). */
function viewerMounts(): number {
  return getContext.mock.calls.filter((call) => call[0] === 'webgl2').length;
}
function viewerCanvas(): HTMLElement | null {
  return screen.queryByRole('img', { name: '3D 점군 뷰어' });
}
function pngImage(): HTMLElement | null {
  return screen.queryByAltText('3D 프리뷰 preview3d.png');
}
function retryButton(): HTMLElement | null {
  return screen.queryByRole('button', { name: '다시 시도' });
}
function onlyAlert(container: HTMLElement): HTMLElement {
  const found = container.querySelectorAll<HTMLElement>('[data-alert]');
  expect(found).toHaveLength(1);
  return found[0];
}
/** 문서 순서로 a 다음에 b 가 오는가. */
function isBefore(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}
/** 대체 화면 공통: 옛 문구와 옛 팔레트 부분 문자열이 없다. */
function expectNoLegacy(container: HTMLElement) {
  expect(container.textContent).not.toContain(OLD_CAPTION);
  expect(container.textContent).not.toContain(OLD_EMPTY);
  expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-|green-|purple-/);
}

beforeEach(() => {
  probe.mockReset();
  probe.mockReturnValue('hardware');
  // jsdom 의 getContext 는 null 이다. 기본은 "WebGL2 가 되는 기기"로 두고 필요한 테스트만 null 로 바꾼다
  getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => recordingGl().gl);
  // jsdom 에는 ResizeObserver 도 없다. Points3dView 가 쓰더라도 죽지 않게 빈 구현을 둔다
  if (!('ResizeObserver' in globalThis)) {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 모드별 화면 (§7.11 분기표의 화면 열)', () => {
  it('wall: 안내 M1 한 줄뿐이다(Alert·버튼·이미지·캡션 없음)', () => {
    const stats = statsOf();   // 정적 PNG 와 점 파일 키가 있어도 벽면이면 M1 만 낸다
    const { container } = render(
      <Preview3dTab {...tabProps({ stats, analysis: analysisOf(stats, { surface: 'wall' }) })} />,
    );

    expect(screen.getByText(M1).tagName).toBe('P');
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(M10)).toBeNull();
    expect(viewerCanvas()).toBeNull();
    expectNoLegacy(container);
  });

  it('import: 정적 PNG + 캡션 M10 + 안내 M2. 재분석을 권하지 않는다', () => {
    const { container } = render(<Preview3dTab {...tabProps({ isImport: true })} />);

    const img = pngImage() as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/data/artifacts/an1/preview3d.png');
    expect(img.className).toBe('max-w-full rounded-lg border border-cs-divider bg-white');
    expect(screen.getByText(M10)).toBeInTheDocument();
    const note = screen.getByText(M2);
    expect(note.tagName).toBe('P');
    expect(isBefore(img, note)).toBe(true);
    expect(container.textContent).not.toContain('재분석');
    expect(screen.queryByText(M3)).toBeNull();
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expectNoLegacy(container);
  });

  it('import: 정적 PNG 가 없으면 이미지와 캡션 없이 M2 만 낸다', () => {
    const { container } = render(
      <Preview3dTab {...tabProps({ isImport: true, stats: statsOf({ preview3d_paths: undefined }) })} />,
    );

    expect(screen.getByText(M2)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(M10)).toBeNull();
  });

  it('no_data: 정적 PNG(빈 이름은 거른다) + 캡션 M10 + 안내 M3. Alert 와 버튼이 없다', () => {
    const stats = statsOf({
      preview3d_paths: ['', 'preview3d.png', 'preview3d_zone2.png'],
      points3d_paths: undefined, points3d_threshold_q: undefined,   // 옛 분석: 점 파일 키가 없다
    });
    const { container } = render(<Preview3dTab {...tabProps({ stats })} />);

    const imgs = [...container.querySelectorAll('img')];
    expect(imgs.map((el) => el.getAttribute('src'))).toEqual([
      '/api/data/artifacts/an1/preview3d.png',
      '/api/data/artifacts/an1/preview3d_zone2.png',
    ]);
    expect(imgs.map((el) => el.getAttribute('alt'))).toEqual([
      '3D 프리뷰 preview3d.png',
      '3D 프리뷰 preview3d_zone2.png',
    ]);
    expect(screen.getAllByText(M10)).toHaveLength(1);
    const note = screen.getByText(M3);
    expect(note.tagName).toBe('P');
    expect(isBefore(imgs[1], note)).toBe(true);
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expectNoLegacy(container);
  });

  it('no_data: 정적 PNG 목록이 비면 이미지와 캡션 없이 M3 만 낸다', () => {
    const stats = statsOf({ preview3d_paths: [], points3d_paths: [], points3d_threshold_q: undefined });
    const { container } = render(<Preview3dTab {...tabProps({ stats })} />);

    expect(screen.getByText(M3)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(M10)).toBeNull();
  });

  it('no_data: artifacts_dir 가 없으면 정적 PNG 이름이 있어도 이미지를 그리지 않는다', () => {
    const stats = statsOf();
    const { container } = render(
      <Preview3dTab {...tabProps({ stats, analysis: analysisOf(stats, { artifacts_dir: null }) })} />,
    );

    expect(screen.getByText(M3)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(M10)).toBeNull();
  });

  it('error_stats: Alert(error) M6 + 정적 PNG. 다시 시도 버튼이 없다', () => {
    const stats = statsOf({ points3d_threshold_q: undefined });   // 점 파일은 있는데 표시 임계값이 없다
    const { container } = render(<Preview3dTab {...tabProps({ stats })} />);

    const alert = onlyAlert(container);
    expect(alert.getAttribute('data-alert')).toBe('error');
    expect(within(alert).getByText(M6)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    const img = pngImage() as HTMLElement;
    expect(img).toBeInTheDocument();
    expect(isBefore(alert, img)).toBe(true);
    expect(screen.getByText(M10)).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();
    expectNoLegacy(container);
  });

  it.each<[string, Partial<TabProps>]>([
    ['탐지 전(support null). 점 데이터가 이미 ready 여도 로딩 틀이다', { support: null, load: READY_A }],
    ['적재 전(idle)', { support: 'hardware', load: IDLE }],
    ['받는 중(loading)', { support: 'hardware', load: LOADING_A }],
  ])('loading: 검정 로딩 틀과 M9 를 낸다: %s', (_label, over) => {
    const { container } = render(<Preview3dTab {...tabProps(over)} />);

    const frame = screen.getByTestId('points3d-loading');
    expect(frame).toHaveStyle({ backgroundColor: '#000000' });   // dark 테마. 밝은 틀이 번쩍이지 않는다
    expect(within(frame).getByText(M9)).toBeInTheDocument();
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(viewerCanvas()).toBeNull();
    expect(viewerMounts()).toBe(0);
    expectNoLegacy(container);
  });

  it.each<[string, Partial<TabProps>, string, string]>([
    ['error_webgl(WebGL2 불가)', { support: 'unsupported' }, 'warning', M7],
    ['error_fetch', { load: FETCH_ERROR_A }, 'error', M5],
    ['error_format', { load: FORMAT_ERROR_A }, 'error', M6],
  ])('%s: Alert + 다시 시도 + 정적 PNG 순서로 낸다', (_label, over, alertType, message) => {
    const { container } = render(<Preview3dTab {...tabProps(over)} />);

    const alert = onlyAlert(container);
    expect(alert.getAttribute('data-alert')).toBe(alertType);
    expect(within(alert).getByText(message)).toBeInTheDocument();
    const retry = retryButton() as HTMLElement;
    expect(retry.className).toContain('bg-transparent');   // Button 의 normal 변형
    expect(retry.className).not.toContain('text-white');   // primary 가 아니다
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const img = pngImage() as HTMLElement;
    expect(isBefore(alert, retry)).toBe(true);
    expect(isBefore(retry, img)).toBe(true);
    expect(screen.getByText(M10)).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();
    expectNoLegacy(container);
  });

  it('software_prompt: 정적 PNG + Alert(info) M4 + "3D로 보기" 순서로 낸다. 다시 시도는 없다', () => {
    const { container } = render(<Preview3dTab {...tabProps({ support: 'software', optedIn: false })} />);

    const img = pngImage() as HTMLElement;
    const alert = onlyAlert(container);
    expect(alert.getAttribute('data-alert')).toBe('info');
    expect(within(alert).getByText(M4)).toBeInTheDocument();
    const optIn = screen.getByRole('button', { name: '3D로 보기' });
    expect(optIn.className).toContain('bg-transparent');
    expect(optIn.className).not.toContain('text-white');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(retryButton()).toBeNull();
    expect(isBefore(img, alert)).toBe(true);
    expect(isBefore(alert, optIn)).toBe(true);
    expect(screen.getByText(M10)).toBeInTheDocument();
    expectNoLegacy(container);
  });

  it('viewer: Points3dView 를 그리고 정적 PNG 는 그리지 않는다. stats 의 표시 임계값을 넘긴다', () => {
    const cb = spies();
    const stats = statsOf({ points3d_threshold_q: 60 });   // 픽스처 기본값(70)과 다른 값
    const { container } = render(<Preview3dTab {...tabProps({ ...cb, stats, load: READY_A })} />);

    expect(viewerCanvas()).toBeInTheDocument();
    expect(viewerMounts()).toBe(1);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByText(M10)).toBeNull();
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect((screen.getByLabelText('표시 임계값(mm)') as HTMLInputElement).value).toBe('60');
    expect(screen.queryByTestId('points3d-merged-note')).toBeNull();   // lineage 'raw'
    expect(probe).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
  });

  it('viewer: 정합 병합 스캔(lineage registered)이면 병합 안내가 나온다', () => {
    render(<Preview3dTab {...tabProps({ load: READY_A, scan: { ...SCAN, lineage: 'registered' } })} />);

    expect(viewerCanvas()).toBeInTheDocument();
    expect(screen.getByTestId('points3d-merged-note')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 뷰어 대상이 아닌 분석 (§7.11 의 1~4행)', () => {
  it('대조군: 뷰어 대상이면 탐지 전에는 탐지하고, 하드웨어 + idle 이면 적재를 요청한다', () => {
    const a = spies();
    render(<Preview3dTab {...tabProps({ ...a, support: null })} />);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(a.onSupport).toHaveBeenCalledTimes(1);

    const b = spies();
    render(<Preview3dTab {...tabProps({ ...b, support: 'hardware', load: IDLE })} />);
    expect(b.onRequestLoad).toHaveBeenCalledTimes(1);
  });

  const NON_VIEWER: [string, () => Partial<TabProps>][] = [
    ['벽면', () => { const s = statsOf(); return { stats: s, analysis: analysisOf(s, { surface: 'wall' }) }; }],
    ['임포트', () => ({ isImport: true })],
    ['artifacts_dir 없음', () => { const s = statsOf(); return { stats: s, analysis: analysisOf(s, { artifacts_dir: null }) }; }],
    ['점 파일 없음', () => ({ stats: statsOf({ points3d_paths: undefined, points3d_threshold_q: undefined }) })],
    ['표시 임계값 없음(error_stats)', () => ({ stats: statsOf({ points3d_threshold_q: undefined }) })],
  ];

  it.each(NON_VIEWER)('%s: 탐지 전이어도 probeWebgl2 를 부르지 않는다', (_label, over) => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, ...over(), support: null, load: IDLE })} />);

    expect(probe).not.toHaveBeenCalled();
    expect(cb.onSupport).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
    expect(screen.queryByTestId('points3d-loading')).toBeNull();   // 5행(로딩 틀)으로 가지 않는다
  });

  it.each(NON_VIEWER)('%s: 하드웨어 + idle 이어도 적재를 요청하지 않는다', (_label, over) => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, ...over(), support: 'hardware', load: IDLE })} />);

    expect(cb.onRequestLoad).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(viewerMounts()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 탐지 effect (§7.3 의 2번)', () => {
  it('support 가 null 이면 마운트 때 한 번 탐지해 결과를 onSupport 로 올린다. 탐지 전에는 적재를 요청하지 않는다', () => {
    probe.mockReturnValue('software');   // 기본값(hardware)과 다른 값: 결과를 그대로 올리는지 본다
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, support: null })} />);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(cb.onSupport.mock.calls).toEqual([['software']]);
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
  });

  it.each<[Webgl2Support]>([['hardware'], ['software'], ['unsupported']])(
    'support 가 이미 있으면(%s) 다시 탐지하지 않는다',
    (support) => {
      const cb = spies();
      render(<Preview3dTab {...tabProps({ ...cb, support })} />);

      expect(probe).not.toHaveBeenCalled();
      expect(cb.onSupport).not.toHaveBeenCalled();
    },
  );

  it('상위가 아직 support 를 올려 주지 않은 채 다시 렌더해도 탐지를 반복하지 않는다', () => {
    const first = spies();
    const { rerender } = render(<Preview3dTab {...tabProps({ ...first, support: null })} />);
    const second = spies();   // 상위가 다시 렌더하면 콜백의 정체가 바뀐다
    rerender(<Preview3dTab {...tabProps({ ...second, support: null })} />);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(first.onSupport).toHaveBeenCalledTimes(1);
    expect(second.onSupport).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 요청 effect (§7.3 의 3번)', () => {
  it('하드웨어 + idle 이면 마운트 때 onRequestLoad 를 한 번 부른다', () => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, support: 'hardware', load: IDLE })} />);

    expect(cb.onRequestLoad).toHaveBeenCalledTimes(1);
    expect(cb.onRetryLoad).not.toHaveBeenCalled();
  });

  it.each<[string, Partial<TabProps>]>([
    ['받는 중', { load: LOADING_A }],
    ['ready', { load: READY_A }],
    ['fetch 오류', { load: FETCH_ERROR_A }],
    ['형식 오류', { load: FORMAT_ERROR_A }],
    ['WebGL2 불가 + idle', { support: 'unsupported', load: IDLE }],
  ])('요청하지 않는다: %s', (_label, over) => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, ...over })} />);

    expect(cb.onRequestLoad).not.toHaveBeenCalled();
    expect(cb.onRetryLoad).not.toHaveBeenCalled();
  });

  it('상위가 아직 load 를 바꾸지 않은 채 다시 렌더해도 요청을 반복하지 않는다', () => {
    const first = spies();
    const { rerender } = render(<Preview3dTab {...tabProps({ ...first, load: IDLE })} />);
    const second = spies();
    rerender(<Preview3dTab {...tabProps({ ...second, load: IDLE })} />);

    expect(first.onRequestLoad).toHaveBeenCalledTimes(1);
    expect(second.onRequestLoad).not.toHaveBeenCalled();
  });

  it('같은 인스턴스에서 artifacts_dir 가 바뀌면 요청 여부가 그대로 참이어도 다시 요청한다', () => {
    const cb = spies();
    const stats = statsOf();
    const { rerender } = render(<Preview3dTab {...tabProps({ ...cb, stats, load: IDLE })} />);
    expect(cb.onRequestLoad).toHaveBeenCalledTimes(1);

    rerender(
      <Preview3dTab {...tabProps({ ...cb, stats, load: IDLE,
        analysis: analysisOf(stats, { id: 'an2', artifacts_dir: DIR_B }) })} />,
    );
    expect(cb.onRequestLoad).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 소프트웨어 렌더 (§7.11 의 7행)', () => {
  it('"3D로 보기"를 누르기 전에는 요청하지 않고, 누르면 onOptIn, optedIn 이 참이 되면 요청한다', () => {
    const cb = spies();
    const { rerender } = render(
      <Preview3dTab {...tabProps({ ...cb, support: 'software', optedIn: false, load: IDLE })} />,
    );
    expect(cb.onRequestLoad).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '3D로 보기' }));
    expect(cb.onOptIn).toHaveBeenCalledTimes(1);
    expect(cb.onRequestLoad).not.toHaveBeenCalled();   // 선택은 상위 state 다. 상위가 optedIn 을 줄 때까지 기다린다

    rerender(<Preview3dTab {...tabProps({ ...cb, support: 'software', optedIn: true, load: IDLE })} />);
    expect(cb.onRequestLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('points3d-loading')).toBeInTheDocument();
    expect(probe).not.toHaveBeenCalled();
  });

  it('재진입: 선택을 마친 소프트웨어 렌더 기기는 점 데이터가 ready 면 곧바로 뷰어다', () => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, support: 'software', optedIn: true, load: READY_A })} />);

    expect(viewerCanvas()).toBeInTheDocument();
    expect(viewerMounts()).toBe(1);
    expect(screen.queryByRole('button', { name: '3D로 보기' })).toBeNull();
    expect(probe).not.toHaveBeenCalled();
    expect(cb.onSupport).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
  });

  it('재진입: 선택하지 않았으면 점 데이터가 ready 여도 software_prompt 이고 뷰어를 마운트하지 않는다', () => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, support: 'software', optedIn: false, load: READY_A })} />);

    expect(screen.getByRole('button', { name: '3D로 보기' })).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();
    expect(viewerMounts()).toBe(0);
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 다시 시도 (§7.11 의 상태 전이 표)', () => {
  it.each<[string, Points3dLoad]>([
    ['error_fetch', FETCH_ERROR_A],
    ['error_format', FORMAT_ERROR_A],
  ])('%s: onRetryLoad 를 한 번 부른다(다시 탐지하지 않는다)', (_label, load) => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, load })} />);

    fireEvent.click(retryButton() as HTMLElement);

    expect(cb.onRetryLoad).toHaveBeenCalledTimes(1);
    expect(cb.onSupport).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  });

  it('error_webgl(WebGL2 불가): onSupport(null) 로 다시 탐지하겠다고 알린다', () => {
    const cb = spies();
    render(<Preview3dTab {...tabProps({ ...cb, support: 'unsupported', load: IDLE })} />);

    fireEvent.click(retryButton() as HTMLElement);

    expect(cb.onSupport.mock.calls).toEqual([[null]]);
    expect(cb.onRetryLoad).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
  });

  it('error_webgl(렌더러 생성 실패): 다시 시도가 실패 플래그를 되돌리고 다시 탐지해 뷰어로 돌아온다', () => {
    getContext.mockImplementation(() => null);   // createRenderer 가 null 을 돌려준다 -> onError('webgl')
    const log = vi.fn();
    const cb = spies();
    const { container } = render(
      <SupportOwner initial="hardware" log={log} tab={tabProps({ ...cb, load: READY_A })} />,
    );

    // 뷰어가 한 번 마운트됐다가 실패를 알려 error_webgl 이 됐다
    expect(viewerMounts()).toBe(1);
    const alert = onlyAlert(container);
    expect(alert.getAttribute('data-alert')).toBe('warning');
    expect(within(alert).getByText(M7)).toBeInTheDocument();
    expect(pngImage()).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();
    expect(log).not.toHaveBeenCalled();

    // 그래픽 장치가 돌아온 뒤 다시 시도한다
    getContext.mockImplementation(() => recordingGl().gl);
    fireEvent.click(retryButton() as HTMLElement);

    expect(log.mock.calls).toEqual([[null], ['hardware']]);   // 다시 탐지하겠다 -> 탐지 결과
    expect(probe).toHaveBeenCalledTimes(1);
    expect(viewerCanvas()).toBeInTheDocument();                // error_webgl 을 벗어났다
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(viewerMounts()).toBe(2);
    expect(cb.onRetryLoad).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();           // 점 데이터가 ready 로 남아 있어 다시 받지 않는다
  });

  it('error_context: 손실 후 3,000ms 가 지나면 Alert(error) M8, 다시 시도는 뷰어를 새로 마운트하고 다시 받지 않는다', () => {
    vi.useFakeTimers();
    const cb = spies();
    const { container } = render(<Preview3dTab {...tabProps({ ...cb, load: READY_A })} />);
    const canvas = viewerCanvas() as HTMLElement;
    expect(viewerMounts()).toBe(1);

    fireEvent(canvas, new Event('webglcontextlost', { cancelable: true }));
    act(() => { vi.advanceTimersByTime(2999); });
    expect(container.querySelector('[data-alert]')).toBeNull();   // 복구를 기다리는 동안은 viewer 모드 그대로
    expect(viewerCanvas()).toBe(canvas);
    act(() => { vi.advanceTimersByTime(1); });

    const alert = onlyAlert(container);
    expect(alert.getAttribute('data-alert')).toBe('error');
    expect(within(alert).getByText(M8)).toBeInTheDocument();
    const retry = retryButton() as HTMLElement;
    const img = pngImage() as HTMLElement;
    expect(isBefore(alert, retry)).toBe(true);
    expect(isBefore(retry, img)).toBe(true);
    expect(screen.getByText(M10)).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();

    fireEvent.click(retry);

    const again = viewerCanvas();
    expect(again).not.toBeNull();
    expect(again).not.toBe(canvas);            // 끊긴 canvas 를 재사용하지 않는다
    expect(viewerMounts()).toBe(2);
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(cb.onRetryLoad).not.toHaveBeenCalled();
    expect(cb.onRequestLoad).not.toHaveBeenCalled();
    expect(cb.onSupport).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('Preview3dTab 분석 전환 (§7.3: 상위가 key={analysis.id} 로 그린다)', () => {
  it('key 와 analysis 가 바뀌면 오류 플래그가 남지 않고, 이전 분석의 ready 는 로딩 틀이며 새로 요청한다', () => {
    getContext.mockImplementation(() => null);   // 분석 A 에서 렌더러 생성 실패 -> rendererFailed
    const a = spies();
    const statsA = statsOf();
    const { container, rerender } = render(
      <Preview3dTab key="an1" {...tabProps({ ...a, stats: statsA, load: READY_A })} />,
    );
    expect(onlyAlert(container).getAttribute('data-alert')).toBe('warning');
    expect(viewerMounts()).toBe(1);

    // 분석 B 로 전환. 상위의 load 에는 아직 분석 A 의 ready 가 남아 있다
    getContext.mockImplementation(() => recordingGl().gl);
    const b = spies();
    const statsB = statsOf({ points3d_threshold_q: 60 });
    const analysisB = analysisOf(statsB, { id: 'an2', artifacts_dir: DIR_B });
    rerender(
      <Preview3dTab key="an2" {...tabProps({ ...b, stats: statsB, analysis: analysisB, load: READY_A })} />,
    );

    expect(container.querySelector('[data-alert]')).toBeNull();     // rendererFailed 가 남았다면 error_webgl 이다
    expect(screen.getByTestId('points3d-loading')).toBeInTheDocument();
    expect(viewerCanvas()).toBeNull();                              // 분석 A 의 점으로 뷰어를 그리지 않는다
    expect(viewerMounts()).toBe(1);
    expect(b.onRequestLoad).toHaveBeenCalledTimes(1);
    expect(a.onRequestLoad).not.toHaveBeenCalled();

    // 분석 B 의 점이 도착하면 B 의 표시 임계값으로 뷰어가 뜬다
    rerender(
      <Preview3dTab key="an2" {...tabProps({ ...b, stats: statsB, analysis: analysisB,
        load: { status: 'ready', dir: DIR_B, data: DATA } })} />,
    );
    expect(viewerCanvas()).toBeInTheDocument();
    expect((screen.getByLabelText('표시 임계값(mm)') as HTMLInputElement).value).toBe('60');
    expect(b.onRequestLoad).toHaveBeenCalledTimes(1);
  });
});
