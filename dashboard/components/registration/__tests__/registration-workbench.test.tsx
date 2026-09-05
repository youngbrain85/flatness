// 정합 작업대 (단계 F Task 5, 스펙 §7.4)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { RegistrationWorkbench } from '../registration-workbench';
import { FakeImage, recordingCtx } from './canvas-stub';
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
};

function stubSupabase(o: Opts = {}) {
  return {
    from: (table: string) => {
      if (table === 'registrations') {
        return {
          update: (fields: unknown) => {
            o.updateSpy?.(fields);
            return { eq: async () => ({ error: o.updateError ?? null }) };
          },
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
        };
      }
      if (table === 'scans') {
        return {
          update: (fields: unknown) => {
            o.scanUpdateSpy?.(fields);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      // 설계 결정 F10: jobs는 RLS 정책이 0개라 대시보드가 읽으면 안 된다.
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
    rpc: async (fn: string) => {
      if (fn === 'fn_enqueue_job') return { error: o.enqueueError ?? null };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

function stubFetch(fail = false) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: !fail, status: fail ? 404 : 200,
    json: async () => (url.includes('OTHER-A') ? META_A : META_B),
  })));
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

function mount(row = reg(), o: Opts = {}, scanB: ScanRow = SCAN_B, fetchFails = false) {
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

  it('3쌍이 되면 활성화된다', async () => {
    mount();
    await waitReady();
    pickPair(50, 250);
    pickPair(250, 150);
    pickPair(450, 50);

    const run = screen.getByRole('button', { name: /정합 실행/ });
    expect(run).toBeEnabled();
    // 대응점 지정 뷰의 유일한 primary. 안내문은 info Alert.
    expect(run.className).toContain('bg-cs-link');
    expect(screen.getByText(/번갈아 클릭해 쌍을 만드세요/).closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
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
    expect(indicator).toBeInTheDocument();
    // 진행 상태는 StatusIndicator in-progress - 스타일이 아니라 의미 속성으로 읽는다
    expect(indicator).toHaveAttribute('data-status', 'in-progress');
    expect(screen.queryByRole('button', { name: /정합 실행/ })).toBeNull();
  });

  // jobs 테이블은 RLS 정책이 0개라 대시보드가 못 읽는다 - 사유는 registrations에만 있다.
  it('정합 실패 시 error_text를 그대로 보여준다', async () => {
    mount(reg({
      status: 'failed',
      error_text: '중첩이 부족합니다(약 6%). 두 스캔이 실제로 겹치는지 확인하세요.',
    }));
    expect(await screen.findByText(/중첩이 부족합니다\(약 6%\)/)).toBeInTheDocument();
    // 실패는 error Alert, 다음 행동(대응점 다시 찍기)이 이 뷰의 primary
    expect(screen.getByText(/정합에 실패했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.getByRole('button', { name: /대응점 다시 찍기/ }).className).toContain('bg-cs-link');
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
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.queryByText('80%')).toBeNull();
  });

  it('정합 후 두 뷰를 겹쳐 그린 그림을 함께 제시한다', async () => {
    const { container } = mount(done);
    await screen.findByText(/1\.01/);
    expect(screen.getByRole('heading', { name: /겹쳐보기/ })).toBeInTheDocument();
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  // 아트보드 RegistrationDetail: 컨테이너 '정합 결과'(KeyValuePairs 3열 + warning Alert) →
  // 컨테이너 '겹쳐보기'(체크박스 checkClass, disabled 버튼, 보조색 안내문). 컨테이너는 정확히 둘.
  it('정합 결과·겹쳐보기를 컨테이너와 Cloudscape 프리미티브로 그린다', async () => {
    const { container } = mount(done);
    await screen.findByText(/1\.01/);

    expect(screen.getByRole('heading', { level: 2, name: '정합 결과' })).toBeInTheDocument();
    expect(container.querySelectorAll('.rounded-cs-container')).toHaveLength(2);
    expect(screen.getByText('정합 잔차 RMSE').className).toContain('font-bold');
    expect(screen.getByText(/1\.01/).className).toContain('font-mono');
    expect(screen.getByText(/수직 방향 일치만 보증/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
    expect(screen.getByRole('checkbox', { name: /포개지는/ }).className).toContain('accent-cs-link');
    expect(screen.getByRole('button', { name: /병합 스캔/ }).className).toContain('border-cs-disabled');
    expect(screen.getByRole('button', { name: /대응점 다시 찍기/ }).className).toContain('text-cs-link');
    expect(screen.getByText(/시스템 차원의 승인 절차가 아닙니다/).className).toContain('text-cs-text-secondary');
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

  // ★ RMSE만 보고 승인하게 두면 안 된다(스펙 §9.3.2 남는 위험).
  it('겹쳐보기 확인 전에는 병합 스캔으로 진행할 수 없다', async () => {
    mount(done);
    await screen.findByText(/1\.01/);
    expect(screen.queryByRole('link', { name: /병합 스캔/ })).toBeNull();
    expect(screen.getByRole('button', { name: /병합 스캔/ })).toBeDisabled();
  });

  it('겹쳐보기를 확인하면 병합 스캔으로 가는 링크가 열린다', async () => {
    mount(done);
    await screen.findByText(/1\.01/);

    fireEvent.click(screen.getByRole('checkbox', { name: /포개지는/ }));

    expect(screen.getByRole('link', { name: /병합 스캔/ })).toHaveAttribute('href', '/scans/merged-1');
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
  // metaA·metaB가 null이라 겹쳐보기가 빈 흰 상자로 남는데, 예전 구현은 아무 안내 없이
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
    const box = screen.getByText(/수평 검증 가능성: 낮음/).parentElement!;
    for (const word of ['오류', '이상', '실패']) {
      expect(box.textContent).not.toContain(word);
    }
    // 정보 알림(info)으로 제시한다 - 실패 알림(error)과 같은 무게로 보이면 안 된다.
    // 스타일 문자열 대신 Alert의 의미 속성(data-alert)으로 읽는다.
    expect(box.closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
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
