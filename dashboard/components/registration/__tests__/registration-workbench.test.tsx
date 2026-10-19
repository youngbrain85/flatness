// 정합 작업대 (단계 F Task 5, 스펙 §7.4) + 다크 리스킨(Task 9, 아트보드 RegistrationDetail)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { RegistrationWorkbench } from '../registration-workbench';
import { FakeImage, recordingCtx } from './canvas-stub';
import { checkLgClass } from '@/components/ui/form';
import { plainPngUrl } from '@/lib/domain/height-view';
import type { HeightViewMeta } from '@/lib/domain/height-view';
import { imageCornersM, overlayAffine, overlayView } from '@/lib/domain/registration';
import type { RegistrationRow, ScanRow } from '@/lib/domain/types';

// ★ 두 스캔의 픽스처를 다르게 잡는다 - 같게 만들면 한쪽 사이드카만 읽는 구현도 통과한다.
//   경로도 워커 생성 규칙(artifacts/scans/{scan_id}/height_view.png)에서 벗어난 값이다.
const PATH_A = 'artifacts/scans/OTHER-A/hv-a.png';
const PATH_B = 'artifacts/scans/OTHER-B/hv-b.png';

const META_A: HeightViewMeta = {
  schema_version: 1, bbox_min: [1234.5, -678.25, 12.75],
  bbox_max: [1234.5 + 5 * 31.25, -678.25 + 3 * 31.25, 40],
  subcell_m_file: 31.25, shape: [3, 5],
  median_z: [[0, 1, 2, 3, 4], [10, 11, 12, 13, 14], [20, 21, 22, 23, 24]],
};
const META_B: HeightViewMeta = {
  schema_version: 1, bbox_min: [-10, 40, 3.5], bbox_max: [-10 + 6 * 8, 40 + 4 * 8, 9],
  subcell_m_file: 8, shape: [4, 6],
  median_z: [
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], [1.1, 1.2, 1.3, 1.4, 1.5, 1.6],
    [2.1, 2.2, 2.3, 2.4, 2.5, 2.6], [3.1, 3.2, 3.3, 3.4, 3.5, 3.6],
  ],
};

function scan(over: Partial<ScanRow> = {}): ScanRow {
  return {
    id: 'sa', location_id: 'l1', surface: 'floor', scanned_at: '2026-08-01', device: null,
    operator_id: null, operator_name_manual: null, selected_criteria_id: null,
    raw_file_path: 'raw-scans/s1/sa/raw.ply', original_filename: 'a.ply', file_format: 'ply',
    point_count: 1000, unit_scale: 1, lineage: 'raw', status: 'ready',
    height_view_path: PATH_A, deleted_at: null, created_at: '', updated_at: '', ...over,
  } as ScanRow;
}
const SCAN_A = scan();
const SCAN_B = scan({ id: 'sb', original_filename: 'b.ply', height_view_path: PATH_B, unit_scale: 0.001 });

function reg(over: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: 'r1', source_scan_ids: ['sa', 'sb'], correspondences: [], transform: null,
    rmse_mm: null, iterations: null, overlap_ratio: null, horizontal_sensitivity: null,
    status: 'awaiting_points',
    error_text: null, result_scan_id: null, created_by: null,
    created_at: '', updated_at: '', ...over,
  };
}

type Opts = {
  updateSpy?: (fields: unknown) => void;
  updateError?: { message: string } | null;
  enqueueError?: { code?: string; message: string } | null;
  scanUpdateSpy?: (fields: unknown) => void;
  // --- Task 9 변이 실험 보강: 호출 인자·진행 중 상태·실패 분기를 관찰하려고 더한 선택 항목(기존 테스트는 안 쓴다) ---
  /** update().eq(column, value) 의 대상 - 어느 행에 쓰는지 */
  eqSpy?: (table: string, column: string, value: unknown) => void;
  /** rpc 호출의 함수 이름과 인자 */
  rpcSpy?: (fn: string, args: unknown) => void;
  scanUpdateError?: { message: string } | null;
  /** 이 프라미스가 풀릴 때까지 update() 가 끝나지 않는다(진행 중 화면을 관찰) */
  updateGate?: Promise<void>;
  /** useRowStatus 가 구독한 postgres_changes 콜백을 넘겨받는다 */
  onStatusSubscribe?: (cb: (payload: { new: Record<string, string> }) => void) => void;
};

function stubSupabase(o: Opts = {}) {
  return {
    from: (table: string) => {
      if (table === 'registrations') {
        return {
          update: (fields: unknown) => {
            o.updateSpy?.(fields);
            return {
              eq: async (column: string, value: unknown) => {
                o.eqSpy?.('registrations', column, value);
                if (o.updateGate) await o.updateGate;
                return { error: o.updateError ?? null };
              },
            };
          },
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        };
      }
      if (table === 'scans') {
        return {
          update: (fields: unknown) => {
            o.scanUpdateSpy?.(fields);
            return {
              eq: async (column: string, value: unknown) => {
                o.eqSpy?.('scans', column, value);
                if (o.updateGate) await o.updateGate;
                return { error: o.scanUpdateError ?? null };
              },
            };
          },
        };
      }
      // 설계 결정 F10: jobs는 RLS 정책이 0개라 대시보드가 읽으면 안 된다.
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    channel: () => ({
      on(_event: string, _filter: unknown, cb: (p: { new: Record<string, string> }) => void) {
        o.onStatusSubscribe?.(cb);
        return this;
      },
      subscribe() { return this; },
    }),
    removeChannel: () => {},
    rpc: async (fn: string, args?: unknown) => {
      o.rpcSpy?.(fn, args);
      if (fn === 'fn_enqueue_job') return { error: o.enqueueError ?? null };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

// fail: true 면 두 사이드카 모두, 'A'·'B' 면 그 쪽 사이드카만 404 로 실패한다.
function stubFetch(fail: boolean | 'A' | 'B' = false) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const isA = url.includes('OTHER-A');
    const failed = fail === true || (fail === 'A' && isA) || (fail === 'B' && !isA);
    return { ok: !failed, status: failed ? 404 : 200, json: async () => (isA ? META_A : META_B) };
  }));
}

// 이미지 5x3(A) / 6x4(B)를 각각 500x300 CSS 픽셀로 띄운 상태를 흉내 낸다.
function stubRect() {
  Object.defineProperty(HTMLImageElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0, top: 0, right: 500, bottom: 300, width: 500, height: 300, x: 0, y: 0, toJSON() {},
    }),
  });
}

function mount(row = reg(), o: Opts = {}, scanB: ScanRow = SCAN_B, fetchFails: boolean | 'A' | 'B' = false) {
  vi.mocked(createClient).mockReturnValue(stubSupabase(o) as never);
  stubFetch(fetchFails);
  const utils = render(<RegistrationWorkbench registration={row} scanA={SCAN_A} scanB={scanB} />);
  stubRect();
  return utils;
}

/** 두 사이드카가 모두 로드돼 클릭을 받을 수 있게 된 시점까지 기다린다. */
function waitReady() {
  return screen.findByRole('button', { name: /정합 실행/ });
}

/** A -> B 순서로 한 쌍을 찍는다. */
function pickPair(clientX: number, clientY: number) {
  fireEvent.click(screen.getByRole('img', { name: /A 스캔/ }), { clientX, clientY });
  fireEvent.click(screen.getByRole('img', { name: /B 스캔/ }), { clientX, clientY });
}

/** 정합 결과 수치 칸: 라벨(dt) 바로 다음의 값(dd). 숫자와 단위가 서로 다른 글꼴의 두 span이다. */
function metric(label: string): HTMLElement {
  return screen.getByText(label).nextElementSibling as HTMLElement;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('RegistrationWorkbench 대응점 수집 (스펙 §7.4)', () => {
  it('한쪽 스캔에 높이 뷰가 없으면 정합을 시작할 수 없다고 안내한다', () => {
    mount(reg(), {}, scan({ id: 'sb', height_view_path: null }));

    expect(screen.getByText(/정합을 시작할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/정합을 시작할 수 없습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
    expect(screen.queryByRole('button', { name: /정합 실행/ })).toBeNull();
  });

  it('대응점이 3쌍 미만이면 정합 실행 버튼이 비활성이다', async () => {
    mount();
    expect(await waitReady()).toBeDisabled();

    pickPair(50, 250);
    expect(screen.getByRole('button', { name: /정합 실행/ })).toBeDisabled();
    pickPair(250, 150);
    expect(screen.getByRole('button', { name: /정합 실행/ })).toBeDisabled();
  });

  it('3쌍이 되면 활성화된다(대응점 지정 화면의 유일한 주 버튼)', async () => {
    mount();
    await waitReady();
    pickPair(50, 250);
    pickPair(250, 150);
    pickPair(450, 50);

    const run = screen.getByRole('button', { name: /정합 실행/ });
    expect(run).toBeEnabled();
    expect(run.className).toContain('bg-ink');
    expect(screen.getByText(/번갈아 클릭해 쌍을 만드세요/).closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
  });

  // 아트보드 RegistrationDetail 대응점 화면: 두 그림은 검정 스테이지 안, 제목 뒤 mono 파일명·시각
  it('두 그림은 검정 스테이지 안에 있고 제목 뒤에 파일명·시각을 붙인다', async () => {
    mount();
    await waitReady();
    expect(screen.getByRole('heading', { level: 3, name: 'A 스캔 (기준) · a.ply · 2026-08-01' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'B 스캔 (맞출 대상) · b.ply · 2026-08-01' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /A 스캔/ }).closest('[data-stage]')).not.toBeNull();
  });

  it('대응점 목록 줄의 지우기 버튼은 번호로 이름이 붙고, 지우면 쌍이 줄어든다', async () => {
    mount();
    await waitReady();
    pickPair(50, 250);
    pickPair(250, 150);
    expect(screen.getByRole('heading', { level: 2, name: '대응점 2쌍' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '1번 쌍 지우기' }));
    expect(screen.getByRole('heading', { level: 2, name: '대응점 1쌍' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2번 쌍 지우기' })).toBeNull();
  });

  // Task 4 계약: a = source_scan_ids[0], b = [1], 값은 각 파일 단위 월드 좌표.
  // 두 스캔의 사이드카가 서로 다르므로 한쪽만 읽는 구현은 여기서 어긋난다.
  it('정합 실행이 대응점을 저장하고 register 잡을 건다', async () => {
    const updateSpy = vi.fn();
    mount(reg(), { updateSpy });
    await waitReady();
    pickPair(50, 250);
    pickPair(250, 150);
    pickPair(450, 50);

    fireEvent.click(screen.getByRole('button', { name: /정합 실행/ }));

    await vi.waitFor(() => expect(updateSpy).toHaveBeenCalled());
    const fields = updateSpy.mock.calls[0][0] as {
      correspondences: { a: { x: number; z: number }; b: { x: number; z: number } }[];
      status: string;
    };
    expect(fields.status).toBe('queued');
    expect(fields.correspondences).toHaveLength(3);
    // A: px=0,py=2 -> ix=0, iy=0 -> x = 1234.5 + 0.5*31.25, z = 12.75 + median_A[0][0]
    expect(fields.correspondences[0].a.x).toBeCloseTo(1234.5 + 15.625, 6);
    expect(fields.correspondences[0].a.z).toBeCloseTo(12.75, 6);
    // B: px=0,py=3 -> ix=0, iy=0 -> x = -10 + 0.5*8, z = 3.5 + median_B[0][0]
    expect(fields.correspondences[0].b.x).toBeCloseTo(-6, 6);
    expect(fields.correspondences[0].b.z).toBeCloseTo(3.6, 6);
  });

  // ★ 리뷰 I2: 저장된 대응점을 마커로 되돌릴 때 양쪽 모두 a를 써도 개수는 맞는다.
  //   두 스캔의 사이드카가 다르므로 픽셀 위치로만 잡힌다. 이 회귀가 나면 사용자는
  //   B 그림에서 엉뚱한 칸(대개 그림 밖)에 찍힌 마커를 보고 대응점을 다시 찍는다.
  it('저장된 대응점 마커가 각자의 좌표계로 찍힌다(A는 A 메타, B는 B 메타)', async () => {
    // A: 격자 (ix=2, iy=1) 중심 -> 픽셀 (2, 1) -> left 50% / top 50%
    // B: 격자 (ix=4, iy=2) 중심 -> 픽셀 (4, 1) -> left 75% / top 37.5%
    mount(reg({
      correspondences: [{
        a: { x: 1234.5 + 2.5 * 31.25, y: -678.25 + 1.5 * 31.25, z: 12.75 + 11 },
        b: { x: -10 + 4.5 * 8, y: 40 + 2.5 * 8, z: 3.5 + 1.5 },
      }],
    }));
    await waitReady();

    const aMarker = screen.getByRole('img', { name: /A 스캔/ })
      .parentElement!.querySelector('span') as HTMLElement;
    const bMarker = screen.getByRole('img', { name: /B 스캔/ })
      .parentElement!.querySelector('span') as HTMLElement;

    expect([aMarker.style.left, aMarker.style.top]).toEqual(['50%', '50%']);
    expect([bMarker.style.left, bMarker.style.top]).toEqual(['75%', '37.5%']);
  });

  it('잡 등록에 실패하면 상태를 대응점 대기로 되돌리고 사유를 보여준다', async () => {
    const updateSpy = vi.fn();
    mount(reg(), { updateSpy, enqueueError: { message: '전송 오류로 등록 실패' } });
    await waitReady();
    pickPair(50, 250);
    pickPair(250, 150);
    pickPair(450, 50);

    fireEvent.click(screen.getByRole('button', { name: /정합 실행/ }));

    await screen.findByText(/전송 오류로 등록 실패/);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'awaiting_points' }));
  });
});

describe('RegistrationWorkbench 진행·실패 표시 (설계 결정 F10)', () => {
  it.each(['queued', 'processing'] as const)('%s면 진행 중임을 알린다', async (status) => {
    mount(reg({ status }));
    const indicator = await screen.findByText(/정합 중|정합 대기 중/);
    // 진행 상태는 StatusIndicator in-progress - 스타일이 아니라 의미 속성으로 읽는다
    expect(indicator.closest('[data-status]')).toHaveAttribute('data-status', 'in-progress');
    expect(screen.queryByRole('button', { name: /정합 실행/ })).toBeNull();
  });

  // jobs 테이블은 RLS 정책이 0개라 대시보드가 못 읽는다 - 사유는 registrations에만 있다.
  it('정합 실패 시 error_text를 그대로 보여준다', async () => {
    mount(reg({
      status: 'failed',
      error_text: '중첩이 부족합니다(약 6%). 두 스캔이 실제로 겹치는지 확인하세요.',
    }));
    expect(await screen.findByText(/중첩이 부족합니다\(약 6%\)/)).toBeInTheDocument();
    // 실패는 error Alert, 다음 행동(대응점 다시 찍기)이 이 화면의 주 버튼
    expect(screen.getByText(/정합에 실패했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.getByRole('button', { name: /대응점 다시 찍기/ }).className).toContain('bg-ink');
  });
});

describe('RegistrationWorkbench 결과 표시 (스펙 §9.3.2·§9.3.4)', () => {
  const done = reg({
    status: 'done', rmse_mm: 1.006, iterations: 12, overlap_ratio: 0.8,
    result_scan_id: 'merged-1',
    transform: [[1, 0, 0, 0.5], [0, 1, 0, -0.25], [0, 0, 1, 0.001], [0, 0, 0, 1]],
  });

  it('RMSE를 보여주되 수직 방향만 보증한다는 한계를 함께 밝힌다', async () => {
    mount(done);
    expect(await screen.findByText(/1\.01/)).toBeInTheDocument();
    // point-to-plane 잔차는 수평 오정합에 무감각하다(스펙 §9.3.2 실측: 3m 어긋나도 1.006mm)
    expect(screen.getByText(/수직 방향 일치만 보증/)).toBeInTheDocument();
    expect(screen.getByText(/수평으로 수 미터 어긋나/)).toBeInTheDocument();
  });

  // overlap_ratio는 trim_ratio(0.8)가 상한이라 100% 겹쳐도 0.8이 최대다.
  // 그대로 "중첩률 80%"로 쓰면 사용자가 "80%밖에 안 겹쳤네"로 오해한다.
  it('overlap_ratio 원값을 중첩률로 그대로 보여주지 않는다', async () => {
    mount(done);
    await screen.findByText(/1\.01/);
    expect(metric('겹친 영역(추정)')).toHaveTextContent('100%');
    expect(metric('겹친 영역(추정)')).not.toHaveTextContent('80');
  });

  it('정합 후 두 뷰를 겹쳐 그린 그림을 함께 제시한다', async () => {
    const { container } = mount(done);
    await screen.findByText(/1\.01/);
    expect(screen.getByRole('heading', { name: /겹쳐보기/ })).toBeInTheDocument();
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  // 아트보드 RegistrationDetail 완료 화면: 카드 둘('정합 결과' · '겹쳐보기'), 수치는 눈썹 라벨 + Anton 숫자.
  it('정합 결과·겹쳐보기 카드 둘과 다크 프리미티브로 그린다', async () => {
    const { container } = mount(done);
    await screen.findByText(/1\.01/);

    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent))
      .toEqual(['정합 결과', '겹쳐보기 (정합 결과 육안 확인)']);
    expect(screen.getByText('정합 잔차 RMSE').className).toContain('text-dim');
    expect(screen.getByText('정합 잔차 RMSE').className).toContain('font-mono');
    expect(screen.getByText('1.01').className).toContain('font-display');
    expect(metric('정합 잔차 RMSE')).toHaveTextContent('1.01mm');
    expect(metric('ICP 반복')).toHaveTextContent('12');
    expect(screen.getByText(/수직 방향 일치만 보증/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
    // 아트보드 RegistrationDetail 확인 체크박스는 18px(checkLgClass)
    expect(screen.getByRole('checkbox', { name: /포개지는/ }).className).toBe(checkLgClass);
    const openMerged = screen.getByRole('button', { name: /병합 스캔/ });
    expect(openMerged).toBeDisabled();
    expect(openMerged.className).not.toContain('bg-ink');
    expect(screen.getByRole('button', { name: /대응점 다시 찍기/ }).className).not.toContain('bg-ink');
    expect(screen.getByText(/시스템 차원의 승인 절차가 아닙니다/).className).toContain('text-muted');
    expect(container.querySelector('canvas')?.closest('[data-stage]')).not.toBeNull();
  });

  // ★ 리뷰 C2: overlay-view.test.tsx는 컴포넌트를 직접 마운트해 그 안쪽 배선만 잠근다.
  //   **작업대가 그 컴포넌트에 무엇을 넘기는지**(어느 스캔의 unit_scale·어느 변환)는
  //   여기서만 잡힌다 - 두 스캔의 배율이 1과 0.001로 다르므로 뒤바꾸면 1000배 어긋난다.
  it('겹쳐보기에 각 스캔의 unit_scale과 정합 변환을 그대로 넘긴다', async () => {
    const { ctx, calls } = recordingCtx();
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as RenderingContext);
    vi.stubGlobal('Image', FakeImage);
    try {
      mount(done);
      await vi.waitFor(() => expect(calls).toHaveLength(2));

      const view = overlayView([
        imageCornersM(META_A, 1, null),
        imageCornersM(META_B, 0.001, done.transform),
      ], 560, 420);
      expect(calls[0].src).toBe(plainPngUrl(PATH_A));
      expect(calls[1].src).toBe(plainPngUrl(PATH_B));
      expect(calls[0].transform).toEqual(overlayAffine(META_A, 1, null, view));
      expect(calls[1].transform).toEqual(overlayAffine(META_B, 0.001, done.transform, view));
      expect(calls[0].alpha).toBe(1);
      expect(calls[1].alpha).toBeLessThan(1);
    } finally {
      spy.mockRestore();
    }
  });

  // 후속(2026-10-18): 사이드카·변환은 있는데 그림(PNG) 자체를 못 불러오면 겹쳐보기 상자는
  // 비어 있다. 이때도 "확인했습니다"를 체크할 수 없어야 한다(리뷰 C1 과 같은 방어).
  it('겹쳐보기 그림을 불러오지 못하면 확인 체크박스를 잠근다', async () => {
    const { ctx } = recordingCtx();
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(ctx as unknown as RenderingContext);
    vi.stubGlobal('Image', FakeImage);
    FakeImage.fail = true;
    try {
      mount(done);
      await screen.findByText(/겹쳐보기 그림을 불러오지 못했습니다/);
      expect(screen.getByRole('checkbox')).toBeDisabled();
      expect(screen.getByText(/체크할 수 없습니다/)).toBeInTheDocument();
    } finally {
      FakeImage.fail = false;
      spy.mockRestore();
    }
  });

  // ★ RMSE만 보고 승인하게 두면 안 된다(스펙 §9.3.2 남는 위험).
  it('겹쳐보기 확인 전에는 병합 스캔으로 진행할 수 없다', async () => {
    mount(done);
    await screen.findByText(/1\.01/);
    expect(screen.queryByRole('link', { name: /병합 스캔/ })).toBeNull();
    expect(screen.getByRole('button', { name: /병합 스캔/ })).toBeDisabled();
  });

  it('겹쳐보기를 확인하면 병합 스캔으로 가는 링크(주 버튼)가 열린다', async () => {
    mount(done);
    await screen.findByText(/1\.01/);

    fireEvent.click(screen.getByRole('checkbox', { name: /포개지는/ }));

    const link = screen.getByRole('link', { name: /병합 스캔/ });
    expect(link).toHaveAttribute('href', '/scans/merged-1');
    expect(link.className).toContain('bg-ink');
  });

  // 다시 찍으면 방금 만들어진 병합 스캔은 쓰레기가 된다 - 목록에 남으면 안 된다.
  it('대응점을 다시 찍으면 확인 후 기존 병합 스캔을 soft delete 한다', async () => {
    const scanUpdateSpy = vi.fn();
    const updateSpy = vi.fn();
    mount(done, { scanUpdateSpy, updateSpy });
    await screen.findByText(/1\.01/);

    fireEvent.click(screen.getByRole('button', { name: /대응점 다시 찍기/ }));
    fireEvent.click(await screen.findByRole('button', { name: /삭제하고 다시 찍기/ }));

    await vi.waitFor(() => expect(scanUpdateSpy).toHaveBeenCalled());
    expect(scanUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      status: 'awaiting_points', result_scan_id: null,
    }));
  });

  // 아트보드: 다시 찍기 확인 = err 14px 문장 + 위험 버튼 '삭제하고 다시 찍기' + 보조 버튼 '취소'
  it('다시 찍기 확인 단계는 위험 버튼과 보조 버튼이다', async () => {
    mount(done);
    await screen.findByText(/1\.01/);
    fireEvent.click(screen.getByRole('button', { name: /대응점 다시 찍기/ }));

    const confirm = await screen.findByRole('button', { name: '삭제하고 다시 찍기' });
    expect(confirm.className).toContain('text-err');
    expect(confirm.className).not.toContain('bg-ink');
    expect(screen.getByText(/병합 스캔이 삭제됩니다/).className).toContain('text-err');
    expect(screen.getByRole('button', { name: '취소' }).className).not.toContain('bg-ink');
  });

  // ★ 리뷰 I3: 다시 찍기 후 육안 확인 체크가 남아 있으면, 다음 정합 결과가 나왔을 때
  // 사용자가 그 그림을 한 번도 안 봤는데도 병합 스캔 링크가 이미 열려 있다.
  it('대응점을 다시 찍으면 육안 확인 체크가 풀린다', async () => {
    mount(done);
    await screen.findByText(/1\.01/);
    fireEvent.click(screen.getByRole('checkbox', { name: /포개지는/ }));
    expect(screen.getByRole('link', { name: /병합 스캔/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /대응점 다시 찍기/ }));
    fireEvent.click(await screen.findByRole('button', { name: /삭제하고 다시 찍기/ }));

    await vi.waitFor(() =>
      expect(screen.getByRole('checkbox', { name: /포개지는/ })).not.toBeChecked());
    expect(screen.queryByRole('link', { name: /병합 스캔/ })).toBeNull();
  });

  // ★ 리뷰 C1 (실증 프로브: canvas=300x150 / 안내 없음 / 링크 열림). 사이드카가 404면
  // metaA·metaB가 null이라 겹쳐보기가 빈 상자로 남는데, 예전 구현은 아무 안내 없이
  // 체크를 허용해 방어가 조용히 0이 됐다.
  it('사이드카를 못 받으면 육안 확인을 체크할 수 없고 사유를 그 자리에 띄운다', async () => {
    mount(done, {}, SCAN_B, true);
    await screen.findByText(/1\.01/);

    const cb = await screen.findByRole('checkbox', { name: /포개지는/ });
    await vi.waitFor(() => expect(cb).toBeDisabled());
    expect(screen.getByText(/겹쳐보기를 볼 수 없는 상태에서는/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /병합 스캔/ })).toBeNull();
  });

  // transform이 null인 채 done이면 B가 자기 좌표로 그려져 정합된 것처럼 보인다.
  it('정합 변환이 저장되지 않았으면 육안 확인을 체크할 수 없다', async () => {
    mount(reg({ ...done, transform: null }));
    await screen.findByText(/1\.01/);

    const cb = await screen.findByRole('checkbox', { name: /포개지는/ });
    await vi.waitFor(() => expect(cb).toBeDisabled());
    // 겹쳐보기 컴포넌트도 자기 자리에 같은 취지를 띄우므로, 체크박스 옆 사유만 고른다
    expect(screen.getByText(/두 스캔을 겹쳐 그릴 수 없습니다/)).toBeInTheDocument();
  });

  // 리뷰 I4·I5: RMSE(수직)와 겹쳐보기(수평)가 서로 다른 축을 본다는 사실을 밝힌다.
  it('RMSE와 겹쳐보기가 서로 다른 축을 본다고 밝힌다', async () => {
    mount(done);
    await screen.findByText(/1\.01/);
    expect(screen.getByText(/서로 다른 축을 보며/)).toBeInTheDocument();
  });

  // 리뷰 I1: 체크는 승인 게이트가 아니다. 병합 스캔은 이미 목록에 떠 있다.
  it('확인 체크가 시스템 차원의 승인 절차가 아님을 밝힌다', async () => {
    mount(done);
    await screen.findByText(/1\.01/);
    expect(screen.getByText(/시스템 차원의 승인 절차가 아닙니다/)).toBeInTheDocument();
  });

  // ★ 단계 F 최종 리뷰 Critical: 옛 문구는 "거기서 바로 분석할 수 있습니다"였는데
  //   그때 병합 스캔에는 분석 진입점이 **하나도 없었다**(막다른 골목). 진입점을 만든
  //   지금도 문구는 정확해야 한다 - 어느 화면의 어느 버튼인지 이름을 대고, 그 경로가
  //   겹쳐보기를 건너뛴다는(=이 체크가 게이트가 아니라는) 사실까지 말해야 한다.
  it('병합 스캔을 어디서 어떻게 분석하는지 이름을 대어 알린다', async () => {
    mount(done);
    await screen.findByText(/1\.01/);

    const note = screen.getByText(/시스템 차원의 승인 절차가 아닙니다/);
    expect(note).toHaveTextContent('스캔 상세');
    expect(note).toHaveTextContent('평활도 분석');
    expect(note).toHaveTextContent('겹쳐보기를 한 번도 보지 않은 채로');
  });

  // ★ 리뷰 Minor(m2): 결과 수치를 지우면서 horizontal_sensitivity만 남기면, 다음 시도가
  //   조기 검사(prepare_correspondences 등)에서 실패했을 때 옛 정합의 감도가 DB에 그대로
  //   살아남는다 - 다른 정합의 값 하나가 섞여 든다.
  it('다시 찍기가 결과 수치를 하나도 남기지 않는다(수평 감도 포함)', async () => {
    const updateSpy = vi.fn();
    mount(reg({ ...done, horizontal_sensitivity: 1.71 }), { updateSpy });
    await screen.findByText(/1\.01/);

    fireEvent.click(screen.getByRole('button', { name: /대응점 다시 찍기/ }));
    fireEvent.click(await screen.findByRole('button', { name: /삭제하고 다시 찍기/ }));

    await vi.waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      transform: null, rmse_mm: null, iterations: null, overlap_ratio: null,
      horizontal_sensitivity: null, result_scan_id: null, status: 'awaiting_points',
    }));
  });
});

// 엔진 감도 프로브가 유일한 자동 신호인 사각(평탄 바닥 + 수평 오클릭)을 화면이 알린다.
//
// ★ 이것은 "이상 경고"가 아니라 **정보**다(재리뷰 정정). 바닥이 평탄할수록 값이 낮아지고
// (±12mm 1.710 / ±6mm 1.218 / ±3.5mm 1.084 / ±2.5mm 1.038, 교차점 약 ±4.5mm), 스펙이
// 정의한 이 용역의 대상이 ±5mm 평탄 바닥이라 **스펙을 만족하는 좋은 바닥일수록 낮게
// 나온다.** 거의 항상 뜨는 안내를 경고로 만들면 늑대소년이 되어 곧 무시당한다.
describe('RegistrationWorkbench 수평 검증 가능성 안내', () => {
  const base = {
    status: 'done' as const, rmse_mm: 1.008, iterations: 9, overlap_ratio: 0.8,
    result_scan_id: 'merged-1',
    transform: [[1, 0, 0, 0.5], [0, 1, 0, -0.25], [0, 0, 1, 0.001], [0, 0, 0, 1]],
  };

  it('감도가 기준 미만이면 "낮음"으로 알리고 왜인지·무엇을 해야 하는지 말한다', async () => {
    mount(reg({ ...base, horizontal_sensitivity: 1.084 }));

    expect(await screen.findByText(/수평 검증 가능성: 낮음/)).toBeInTheDocument();
    expect(screen.getByText(/수평 검증 가능성: 낮음/)).toHaveTextContent('1.084');
    // 왜: 평탄한 면에는 수평 위치를 구속할 정보가 원래 없다
    expect(screen.getByText(/바닥이 평탄할수록 이 값은 낮게 나옵니다/)).toBeInTheDocument();
    // 무엇을: 대응점을 넓게 분산한 것이 유일한 보장이다
    expect(screen.getByText(/넓게 분산해 찍은 것이 이 방향의 유일한 보장/)).toBeInTheDocument();
  });

  // ★ 늑대소년 방지: 이 상태가 정상이고 흔하다는 것을 문구가 스스로 말해야 한다.
  //   "오류·이상·실패"로 읽히면 사용자가 곧 무시한다.
  it('낮은 것이 정상이고 흔하다고 밝히며 오류·이상·실패로 부르지 않는다', async () => {
    const { container } = mount(reg({ ...base, horizontal_sensitivity: 1.038 }));
    await screen.findByText(/수평 검증 가능성: 낮음/);

    expect(screen.getByText(/정상이고 흔합니다/)).toBeInTheDocument();
    const box = screen.getByText(/수평 검증 가능성: 낮음/).closest('[data-alert]') as HTMLElement;
    for (const word of ['오류', '이상', '실패']) {
      expect(box.textContent).not.toContain(word);
    }
    // 정보 알림(info)으로 제시한다 - 실패 알림(error)과 같은 무게로 보이면 안 된다.
    expect(box).toHaveAttribute('data-alert', 'info');
    expect(container.querySelector('[data-alert="error"]')).toBeNull();
  });

  // I4·I5와 하나의 이야기여야 한다: 감도가 낮은 바닥이 정확히 겹쳐보기도 안 통하는 바닥이다.
  it('겹쳐보기도 같은 이유로 신호가 약하다고 이어서 말한다', async () => {
    mount(reg({ ...base, horizontal_sensitivity: 1.084 }));
    await screen.findByText(/수평 검증 가능성: 낮음/);

    expect(screen.getByText(/같은 이유로 아래 겹쳐보기도/)).toBeInTheDocument();
  });

  it('감도가 기준 이상이면 수평도 데이터로 검증됐다고 알린다', async () => {
    mount(reg({ ...base, horizontal_sensitivity: 1.71 }));

    expect(await screen.findByText(/수평 검증 가능성: 있음/)).toBeInTheDocument();
    expect(screen.queryByText(/수평 검증 가능성: 낮음/)).toBeNull();
  });

  // 구 데이터·012 미적용 DB. "알 수 없음"을 "낮음"으로 접으면 옛 정합 전부에 안내가 붙는다.
  it('감도 값이 없으면 아무것도 띄우지 않는다', async () => {
    mount(reg({ ...base, horizontal_sensitivity: null }));
    await screen.findByText(/1\.01/);

    expect(screen.queryByText(/수평 검증 가능성/)).toBeNull();
  });
});

// ---- Task 9 변이 실험 보강 --------------------------------------------------------------------
// 변이 실험(보고서 참고)으로 드러난 빈틈. 위 테스트는 A 를 먼저 찍는 순서만, 어느 쌍을 지웠는지 구분 못 하는 개수만,
// Supabase 호출 인자·진행 중 잠금·실패 분기·사이드카 한쪽 실패·로딩 표시·실시간 상태 반영을 보지 않았다.

/** 풀기 전까지 끝나지 않는 프라미스(진행 중 화면을 관찰하려고 쓴다). */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

/** 사이드카 응답을 직접 정하는 마운트(로딩 중 표시를 보려고 응답을 붙들어 둔다). */
function mountWithFetch(respond: (url: string) => Promise<unknown>, row = reg(), o: Opts = {}) {
  vi.mocked(createClient).mockReturnValue(stubSupabase(o) as never);
  vi.stubGlobal('fetch', vi.fn(respond));
  const utils = render(<RegistrationWorkbench registration={row} scanA={SCAN_A} scanB={SCAN_B} />);
  stubRect();
  return utils;
}

const okMeta = (url: string) => ({
  ok: true, status: 200, json: async () => (url.includes('OTHER-A') ? META_A : META_B),
});

// 저장된 대응점 3쌍(서로 다른 칸): 픽셀을 찍지 않고도 정합 실행을 열 수 있다.
const SAVED = [
  { a: { x: 1234.5 + 0.5 * 31.25, y: -678.25 + 0.5 * 31.25, z: 12.75 }, b: { x: -10 + 0.5 * 8, y: 40 + 0.5 * 8, z: 3.5 + 0.1 } },
  { a: { x: 1234.5 + 2.5 * 31.25, y: -678.25 + 1.5 * 31.25, z: 12.75 + 11 }, b: { x: -10 + 4.5 * 8, y: 40 + 2.5 * 8, z: 3.5 + 1.5 } },
  { a: { x: 1234.5 + 4.5 * 31.25, y: -678.25 + 2.5 * 31.25, z: 12.75 + 2 }, b: { x: -10 + 2.5 * 8, y: 40 + 1.5 * 8, z: 3.5 + 2.2 } },
];

const DONE = reg({
  status: 'done', rmse_mm: 1.006, iterations: 12, overlap_ratio: 0.8, result_scan_id: 'merged-1',
  transform: [[1, 0, 0, 0.5], [0, 1, 0, -0.25], [0, 0, 1, 0.001], [0, 0, 0, 1]],
});

/** 대응점 목록 n번 줄의 좌표 글자 "A(x, y, z) / B(x, y, z)" */
function pairText(n: number): string {
  const li = screen.getByRole('button', { name: `${n}번 쌍 지우기` }).closest('li') as HTMLElement;
  return (li.textContent ?? '').match(/A\([^)]*\) \/ B\([^)]*\)/)![0];
}

describe('RegistrationWorkbench 변이 실험 보강 (Task 9) - 쌍 만들기·지우기·마커·두 그림', () => {
  // A: 클릭 (250,150) -> 칸 (2,1) / B: 클릭 (50,250) -> 픽셀 (0,3) -> 격자 (0,0)
  const A_CLICK = { clientX: 250, clientY: 150 };
  const B_CLICK = { clientX: 50, clientY: 250 };
  const PAIR_TEXT = `A(${(1234.5 + 2.5 * 31.25).toFixed(2)}, ${(-678.25 + 1.5 * 31.25).toFixed(2)}, ${(12.75 + 12).toFixed(2)})`
    + ` / B(${(-10 + 0.5 * 8).toFixed(2)}, ${(40 + 0.5 * 8).toFixed(2)}, ${(3.5 + 0.1).toFixed(2)})`;

  it.each([
    ['A', 'B'],
    ['B', 'A'],
  ] as const)('%s 를 먼저 찍으면 짝을 기다리다가 %s 를 찍으면 한 쌍이 되고 대기가 모두 풀린다', async (first, second) => {
    mount();
    await waitReady();
    const click = (side: 'A' | 'B') => fireEvent.click(
      screen.getByRole('img', { name: new RegExp(`${side} 스캔`) }), side === 'A' ? A_CLICK : B_CLICK);
    const region = (side: 'A' | 'B') => within(screen.getByRole('region', { name: new RegExp(`${side} 스캔`) }));

    click(first);
    // 어느 쪽을 찍었는지 말하고, 대기 마커(1번)는 찍은 그림에만 있다
    expect(screen.getByText(new RegExp(`^${first} 쪽 점을 찍었습니다`))).toBeInTheDocument();
    expect(region(first).getByText('1')).toHaveAttribute('data-pending', 'true');
    expect(region(second).queryByText('1')).toBeNull();

    click(second);
    // 한 쌍이 되면 대기 안내·대기 마커가 모두 사라지고, A·B 는 각자 자리에 들어간다
    expect(screen.getByRole('heading', { level: 2, name: '대응점 1쌍' })).toBeInTheDocument();
    expect(screen.queryByText(/쪽 점을 찍었습니다/)).toBeNull();
    expect(document.querySelector('[data-pending]')).toBeNull();
    expect(pairText(1)).toBe(PAIR_TEXT);
  });

  it('가운데 쌍을 지우면 나머지 두 쌍이 순서대로 남고 번호가 다시 매겨진다', async () => {
    mount();
    await waitReady();
    pickPair(50, 250);
    pickPair(250, 150);
    pickPair(450, 50);
    const [one, two, three] = [pairText(1), pairText(2), pairText(3)];
    expect(new Set([one, two, three]).size).toBe(3); // 세 줄이 서로 구분되는 픽스처인지

    fireEvent.click(screen.getByRole('button', { name: '2번 쌍 지우기' }));

    expect(screen.getByRole('heading', { level: 2, name: '대응점 2쌍' })).toBeInTheDocument();
    expect(pairText(1)).toBe(one);
    expect(pairText(2)).toBe(three);
    expect(two).not.toBe(three);
    expect(screen.queryByRole('button', { name: '3번 쌍 지우기' })).toBeNull();
  });

  it('저장된 대응점 마커는 1번부터 순서대로 번호가 붙는다', async () => {
    mount(reg({ correspondences: SAVED.slice(0, 2) }));
    await waitReady();
    const labels = (name: RegExp) => Array.from(
      screen.getByRole('img', { name }).parentElement!.querySelectorAll('span'), (s) => s.textContent);

    expect(labels(/A 스캔/)).toEqual(['1', '2']);
    expect(labels(/B 스캔/)).toEqual(['1', '2']);
  });

  it('쌍이 없을 때의 안내와 단위 안내 문구를 그대로 보인다', async () => {
    mount();
    await waitReady();
    expect(screen.getByText('아직 찍은 쌍이 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('좌표는 각 스캔 파일의 단위 그대로입니다(미터로 환산하지 않습니다).')).toBeInTheDocument();

    pickPair(50, 250);
    expect(screen.queryByText('아직 찍은 쌍이 없습니다.')).toBeNull();
  });

  it('두 그림은 각자의 스캔 그림을 쓴다', async () => {
    mount();
    await waitReady();
    expect(screen.getByRole('img', { name: /A 스캔/ })).toHaveAttribute('src', plainPngUrl(PATH_A));
    expect(screen.getByRole('img', { name: /B 스캔/ })).toHaveAttribute('src', plainPngUrl(PATH_B));
  });

  it.each([
    ['A', /A 스캔/, /B 스캔/],
    ['B', /B 스캔/, /A 스캔/],
  ] as const)('%s 사이드카만 못 받으면 그 그림 자리에만 사유를 띄우고 정합 실행은 쌍이 3개여도 잠긴다', async (bad, badName, goodName) => {
    mount(reg({ correspondences: SAVED }), {}, SCAN_B, bad);
    const run = await screen.findByRole('button', { name: /정합 실행/ }); // 실패도 '불러오기 끝'이다

    const badRegion = within(screen.getByRole('region', { name: badName }));
    expect(await badRegion.findByText(/높이 뷰 좌표 정보를 불러오지 못했습니다\(HTTP 404\)/)).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: goodName })).queryByText(/불러오지 못했습니다/)).toBeNull();
    expect(run).toBeDisabled();
  });

  it.each([['A'], ['B']] as const)('%s 사이드카가 아직 오는 중이면 정합 실행 대신 불러오는 중 표시를 둔다', async (slow) => {
    const gate = deferred();
    mountWithFetch((url) => (url.includes('OTHER-A') === (slow === 'A')
      ? gate.promise.then(() => okMeta(url))
      : Promise.resolve(okMeta(url))));

    expect(await screen.findByText('높이 뷰 좌표 정보를 불러오는 중입니다...')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0)); // 빠른 쪽 응답이 반영될 시간을 준다
    expect(screen.getByText('높이 뷰 좌표 정보를 불러오는 중입니다...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /정합 실행/ })).toBeNull();

    gate.resolve();
    expect(await screen.findByRole('button', { name: /정합 실행/ })).toBeInTheDocument();
  });

  it.each<[string, ScanRow, ScanRow, string]>([
    ['A', scan({ original_filename: 'a-missing.ply', height_view_path: null }), SCAN_B, 'a-missing.ply · 2026-08-01'],
    ['B', SCAN_A, scan({ id: 'sb', original_filename: 'b-missing.ply', height_view_path: null }), 'b-missing.ply · 2026-08-01'],
  ])('%s 스캔에 높이 뷰가 없으면 그 스캔의 파일명을 짚어 알린다', (_side, scanA, scanB, label) => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    stubFetch();
    render(<RegistrationWorkbench registration={reg()} scanA={scanA} scanB={scanB} />);

    expect(screen.getByText(/정합을 시작할 수 없습니다/).closest('[data-alert]')).toHaveTextContent(label);
  });
});

describe('RegistrationWorkbench 변이 실험 보강 (Task 9) - 정합 실행', () => {
  it('정합 실행은 이 정합 행에 저장하고 register 잡을 이 정합 id 로 건 뒤 화면을 새로 고친다', async () => {
    const updateSpy = vi.fn();
    const eqSpy = vi.fn();
    const rpcSpy = vi.fn();
    mount(reg({ correspondences: SAVED, error_text: '지난 실패 사유' }), { updateSpy, eqSpy, rpcSpy });
    await waitReady();
    fireEvent.click(screen.getByRole('button', { name: /정합 실행/ }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued', error_text: null }));
    expect(eqSpy).toHaveBeenCalledWith('registrations', 'id', 'r1');
    expect(rpcSpy).toHaveBeenCalledWith('fn_enqueue_job', { p_type: 'register', p_payload: { registration_id: 'r1' } });
  });

  it('정합을 실행하는 동안에는 버튼과 두 그림이 잠기고, 끝나면 다시 열린다', async () => {
    const gate = deferred();
    const updateSpy = vi.fn();
    mount(reg({ correspondences: SAVED }), { updateSpy, updateGate: gate.promise });
    await waitReady();
    const run = screen.getByRole('button', { name: /정합 실행/ });
    expect(run).toBeEnabled();

    fireEvent.click(run);
    await vi.waitFor(() => expect(run).toBeDisabled());
    fireEvent.click(run); // 잠긴 버튼은 눌러도 아무 일이 없다
    expect(updateSpy).toHaveBeenCalledTimes(1);
    for (const name of [/A 스캔/, /B 스캔/]) {
      expect(screen.getByRole('img', { name }).className).toContain('cursor-not-allowed');
    }

    gate.resolve();
    await vi.waitFor(() => expect(run).toBeEnabled());
    expect(screen.getByRole('img', { name: /A 스캔/ }).className).toContain('cursor-crosshair');
  });

  it('대응점 저장에 실패하면 사유를 보이고 잡을 걸지 않으며, 다시 시도해 성공하면 지난 오류가 지워진다', async () => {
    const rpcSpy = vi.fn();
    const opts: Opts = { updateError: { message: '권한이 없습니다' }, rpcSpy };
    mount(reg({ correspondences: SAVED }), opts);
    await waitReady();
    fireEvent.click(screen.getByRole('button', { name: /정합 실행/ }));

    expect(await screen.findByText('대응점을 저장하지 못했습니다: 권한이 없습니다')).toBeInTheDocument();
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /정합 실행/ })).toBeEnabled();

    opts.updateError = null;
    fireEvent.click(screen.getByRole('button', { name: /정합 실행/ }));
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/대응점을 저장하지 못했습니다/)).toBeNull();
  });

  it('높이 값이 없는 점이 섞인 쌍은 저장 전에 막고 사유를 보인다', async () => {
    const updateSpy = vi.fn();
    const bad = [{ ...SAVED[0], a: { ...SAVED[0].a, z: null as unknown as number } }, SAVED[1], SAVED[2]];
    mount(reg({ correspondences: bad }), { updateSpy });
    await waitReady();
    fireEvent.click(screen.getByRole('button', { name: /정합 실행/ }));

    expect(await screen.findByText('1번째 대응점에 높이 값이 없는 지점이 섞여 있습니다. 그 쌍을 지우고 다시 찍으세요.')).toBeInTheDocument();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /정합 실행/ })).toBeEnabled();
  });

  it('잡 등록에 실패하면 같은 정합 행을 되돌리고 화면을 새로 고치지 않으며 버튼을 다시 연다', async () => {
    const eqSpy = vi.fn();
    mount(reg({ correspondences: SAVED }), { enqueueError: { message: '전송 오류' }, eqSpy });
    await waitReady();
    fireEvent.click(screen.getByRole('button', { name: /정합 실행/ }));

    expect(await screen.findByText(/전송 오류/)).toBeInTheDocument();
    // 저장과 되돌림 둘 다 이 정합 행(r1)에 쓴다
    expect(eqSpy.mock.calls).toEqual([['registrations', 'id', 'r1'], ['registrations', 'id', 'r1']]);
    expect(refreshMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /정합 실행/ })).toBeEnabled();
  });

  it('실시간 상태가 바뀌면 서버 데이터를 다시 받아 온다', async () => {
    let push!: (p: { new: Record<string, string> }) => void;
    mount(reg({ status: 'queued' }), { onStatusSubscribe: (cb) => { push = cb; } });
    await screen.findByText(/정합 중|정합 대기 중/);
    expect(refreshMock).not.toHaveBeenCalled();

    act(() => push({ new: { status: 'done' } }));
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe('RegistrationWorkbench 변이 실험 보강 (Task 9) - 다시 찍기·육안 확인·실패 화면', () => {
  /** 완료 화면에서 "대응점 다시 찍기"를 눌러 확인 단계의 위험 버튼을 돌려준다. */
  async function openRepick() {
    await screen.findByText(/1\.01/);
    fireEvent.click(screen.getByRole('button', { name: /대응점 다시 찍기/ }));
    return screen.findByRole('button', { name: '삭제하고 다시 찍기' });
  }

  it('다시 찍기는 병합 스캔 행을 지우고 이 정합 행을 대응점 대기로 되돌린 뒤 화면을 새로 고치고 확인 단계를 닫는다', async () => {
    const scanUpdateSpy = vi.fn();
    const updateSpy = vi.fn();
    const eqSpy = vi.fn();
    mount(DONE, { scanUpdateSpy, updateSpy, eqSpy });
    fireEvent.click(await openRepick());

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(eqSpy).toHaveBeenCalledWith('scans', 'id', 'merged-1');
    expect(eqSpy).toHaveBeenCalledWith('registrations', 'id', 'r1');
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'awaiting_points', error_text: null }));
    // 끝나면 확인 단계가 닫히고, 다시 열면 누를 수 있다(잠겨 있지 않다)
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: '삭제하고 다시 찍기' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /대응점 다시 찍기/ }));
    expect(await screen.findByRole('button', { name: '삭제하고 다시 찍기' })).toBeEnabled();
  });

  it('다시 찍기 확인 중 취소하면 아무것도 바꾸지 않고 확인 단계를 닫는다', async () => {
    const scanUpdateSpy = vi.fn();
    const updateSpy = vi.fn();
    mount(DONE, { scanUpdateSpy, updateSpy });
    await openRepick();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    expect(screen.queryByRole('button', { name: '삭제하고 다시 찍기' })).toBeNull();
    expect(screen.getByRole('button', { name: /대응점 다시 찍기/ })).toBeInTheDocument();
    expect(scanUpdateSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('다시 찍는 동안에는 확인 버튼이 잠겨 한 번만 실행된다', async () => {
    const gate = deferred();
    const scanUpdateSpy = vi.fn();
    mount(DONE, { scanUpdateSpy, updateGate: gate.promise });
    const confirm = await openRepick();

    fireEvent.click(confirm);
    await vi.waitFor(() => expect(confirm).toBeDisabled());
    fireEvent.click(confirm);
    expect(scanUpdateSpy).toHaveBeenCalledTimes(1);

    gate.resolve();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('병합 스캔을 정리하지 못하면 사유를 보이고 정합 행은 건드리지 않으며, 재시도가 성공하면 오류가 지워진다', async () => {
    const updateSpy = vi.fn();
    const opts: Opts = { updateSpy, scanUpdateError: { message: '정리 실패' } };
    mount(DONE, opts);
    fireEvent.click(await openRepick());

    expect(await screen.findByText('이전 병합 스캔을 정리하지 못했습니다: 정리 실패')).toBeInTheDocument();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
    // 잠기지 않는다: 확인 단계가 그대로 열려 있고 다시 누를 수 있다
    const confirm = screen.getByRole('button', { name: '삭제하고 다시 찍기' });
    expect(confirm).toBeEnabled();

    opts.scanUpdateError = null;
    fireEvent.click(confirm);
    await vi.waitFor(() => expect(updateSpy).toHaveBeenCalled());
    await vi.waitFor(() => expect(screen.queryByText(/이전 병합 스캔을 정리하지 못했습니다/)).toBeNull());
  });

  it('정합 행을 되돌리지 못하면 사유를 보이되 확인 단계는 닫는다', async () => {
    mount(DONE, { updateError: { message: '되돌림 실패' } });
    fireEvent.click(await openRepick());

    expect(await screen.findByText('상태를 되돌리지 못했습니다: 되돌림 실패')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '삭제하고 다시 찍기' })).toBeNull();
  });

  it('정합이 실패했을 때의 다시 찍기는 병합 스캔 없이 정합 행만 대응점 대기로 되돌린다', async () => {
    const updateSpy = vi.fn();
    const scanUpdateSpy = vi.fn();
    const eqSpy = vi.fn();
    mount(reg({ status: 'failed', error_text: '중첩이 부족합니다' }), { updateSpy, scanUpdateSpy, eqSpy });
    fireEvent.click(await screen.findByRole('button', { name: /대응점 다시 찍기/ }));

    await vi.waitFor(() => expect(updateSpy).toHaveBeenCalled());
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({
      status: 'awaiting_points', error_text: null, result_scan_id: null,
    }));
    expect(eqSpy).toHaveBeenCalledWith('registrations', 'id', 'r1');
    expect(scanUpdateSpy).not.toHaveBeenCalled();
  });

  it('실패 화면에서도 다시 찍는 동안 버튼이 잠긴다', async () => {
    const gate = deferred();
    mount(reg({ status: 'failed', error_text: '중첩이 부족합니다' }), { updateGate: gate.promise });
    const button = await screen.findByRole('button', { name: /대응점 다시 찍기/ });

    fireEvent.click(button);
    await vi.waitFor(() => expect(button).toBeDisabled());
    gate.resolve();
    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('실패 사유가 기록되지 않았으면 그렇다고 알린다', async () => {
    mount(reg({ status: 'failed', error_text: null }));
    expect(await screen.findByText('사유가 기록되지 않았습니다. 잠시 후 다시 시도하세요.')).toBeInTheDocument();
  });

  it.each([['A'], ['B']] as const)('%s 사이드카만 못 받아도 육안 확인을 체크할 수 없다', async (bad) => {
    mount(DONE, {}, SCAN_B, bad);
    await screen.findByText(/HTTP 404/); // 실패한 쪽 사유가 올라온 뒤
    await new Promise((resolve) => setTimeout(resolve, 0)); // 성공한 쪽 응답도 반영될 시간을 준다

    expect(screen.getByRole('checkbox', { name: /포개지는/ })).toBeDisabled();
    expect(screen.getByText(/겹쳐보기를 볼 수 없는 상태에서는/)).toBeInTheDocument();
  });

  it('육안 확인 체크를 풀면 병합 스캔 링크가 다시 닫힌다', async () => {
    mount(DONE);
    const cb = await screen.findByRole('checkbox', { name: /포개지는/ });
    await vi.waitFor(() => expect(cb).toBeEnabled());

    fireEvent.click(cb);
    expect(screen.getByRole('link', { name: /병합 스캔/ })).toBeInTheDocument();
    fireEvent.click(cb);

    expect(cb).not.toBeChecked();
    expect(screen.queryByRole('link', { name: /병합 스캔/ })).toBeNull();
    expect(screen.getByRole('button', { name: /병합 스캔/ })).toBeDisabled();
  });

  it('병합 스캔 행이 없으면 확인해도 링크를 열지 않는다', async () => {
    mount(reg({ ...DONE, result_scan_id: null }));
    const cb = await screen.findByRole('checkbox', { name: /포개지는/ });
    await vi.waitFor(() => expect(cb).toBeEnabled());

    fireEvent.click(cb);
    expect(screen.queryByRole('link', { name: /병합 스캔/ })).toBeNull();
    expect(screen.getByRole('button', { name: /병합 스캔/ })).toBeDisabled();
  });
});

// 화면마다 주(ink 채움) 버튼은 하나다(워크북 머리 주석·스펙 §6). 요소별 단언은 "이 버튼이 주가 아니다"만 잠가서,
// 다른 자리에 두 번째 주 버튼이 생겨도 통과한다 - 상태마다 채운 버튼·링크를 센다.
describe('RegistrationWorkbench 변이 실험 보강 (Task 9) - 주 버튼은 한 화면에 하나', () => {
  /** ink 채움(주) 버튼·링크의 글자. 비활성 주 버튼은 채움이 빠지므로 세지 않는다. */
  const primaries = () => Array.from(document.querySelectorAll('button, a'))
    .filter((el) => el.className.includes('bg-ink')).map((el) => el.textContent);

  it('대응점 지정: 3쌍이 모자라면 채운 버튼이 없고, 3쌍이 되면 정합 실행 하나뿐이다', async () => {
    mount();
    await waitReady();
    expect(primaries()).toEqual([]);

    pickPair(50, 250);
    pickPair(250, 150);
    pickPair(450, 50);
    expect(primaries()).toEqual(['정합 실행']);
  });

  it('완료: 확인 전에는 채운 버튼이 없고(다시 찍기 확인 단계도 마찬가지), 확인하면 병합 스캔 열기 하나뿐이다', async () => {
    mount(DONE);
    const cb = await screen.findByRole('checkbox', { name: /포개지는/ });
    await vi.waitFor(() => expect(cb).toBeEnabled());
    expect(primaries()).toEqual([]);

    // 다시 찍기 확인 단계는 위험 버튼 + 보조 버튼이다
    fireEvent.click(screen.getByRole('button', { name: /대응점 다시 찍기/ }));
    expect(await screen.findByRole('button', { name: '삭제하고 다시 찍기' })).toBeInTheDocument();
    expect(primaries()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    fireEvent.click(cb);
    expect(primaries()).toEqual(['병합 스캔 열기']);
  });

  it('실패: 대응점 다시 찍기 하나뿐이다', async () => {
    mount(reg({ status: 'failed', error_text: '중첩이 부족합니다' }));
    await screen.findByText(/중첩이 부족합니다/);
    expect(primaries()).toEqual(['대응점 다시 찍기']);
  });

  it('진행 중: 눌러야 할 버튼이 없다', async () => {
    mount(reg({ status: 'processing' }));
    await screen.findByText(/정합 중|정합 대기 중/);
    expect(primaries()).toEqual([]);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
