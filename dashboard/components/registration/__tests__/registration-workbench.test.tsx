// 정합 작업대 (단계 F Task 5, 스펙 §7.4)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { RegistrationWorkbench } from '../registration-workbench';
import type { HeightViewMeta } from '@/lib/domain/height-view';
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
    rmse_mm: null, iterations: null, overlap_ratio: null, status: 'awaiting_points',
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

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
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

function mount(row = reg(), o: Opts = {}, scanB: ScanRow = SCAN_B) {
  vi.mocked(createClient).mockReturnValue(stubSupabase(o) as never);
  stubFetch();
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

    expect(screen.getByRole('button', { name: /정합 실행/ })).toBeEnabled();
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
    expect(await screen.findByText(/정합 중|정합 대기 중/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /정합 실행/ })).toBeNull();
  });

  // jobs 테이블은 RLS 정책이 0개라 대시보드가 못 읽는다 - 사유는 registrations에만 있다.
  it('정합 실패 시 error_text를 그대로 보여준다', async () => {
    mount(reg({
      status: 'failed',
      error_text: '중첩이 부족합니다(약 6%). 두 스캔이 실제로 겹치는지 확인하세요.',
    }));
    expect(await screen.findByText(/중첩이 부족합니다\(약 6%\)/)).toBeInTheDocument();
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
});
