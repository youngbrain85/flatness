import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({})) }));

import { createClient } from '@/lib/supabase/client';
import { UnitConfirmForm } from '../unit-confirm-form';
import type { ScanRow } from '@/lib/domain/types';

const scan = {
  id: 'c1', location_id: 'l1', surface: 'floor', scanned_at: '2026-07-28',
  device: null, operator_id: null, operator_name_manual: null,
  selected_criteria_id: 'cr1', raw_file_path: 'raw-scans/s1/c1/raw.ply',
  original_filename: 'room.ply', file_format: 'ply', point_count: null,
  unit_scale: null, lineage: 'raw', status: 'awaiting_unit_confirm',
  deleted_at: null, created_at: '', updated_at: '',
} as ScanRow;

// scans 갱신 -> analyses insert -> fn_enqueue_job 순서를 흉내 내는 최소 스텁.
// analyses.update는 고아 행 롤백(soft delete) 여부를 관찰하려고 스파이를 건다.
function stubSupabase(
  enqueueError: { code?: string; message: string } | null,
  analysesUpdateSpy: (fields: unknown) => void = () => {},
) {
  return {
    from: (table: string) => {
      if (table === 'scans') {
        return { update: () => ({ eq: async () => ({ error: null }) }) };
      }
      if (table === 'analyses') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'a1' }, error: null }) }) }),
          update: (fields: unknown) => {
            analysesUpdateSpy(fields);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    rpc: async (fn: string) => {
      if (fn === 'fn_enqueue_job') return { error: enqueueError };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('UnitConfirmForm', () => {
  it('단위 3종 라디오와 확정 버튼, 원본 파일명을 렌더한다', () => {
    render(<UnitConfirmForm scan={scan} userId="u1" />);
    expect(screen.getByText(/room\.ply/)).toBeInTheDocument();
    expect(screen.getByLabelText(/m\(미터\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/cm/)).toBeInTheDocument();
    expect(screen.getByLabelText(/mm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '단위 확정 후 분석 시작' })).toBeInTheDocument();
  });

  // reanalyze-button의 I1과 같은 결함. 단위 확정은 모든 스캔이 반드시 지나는 주 경로라
  // 영향이 더 크다. 엔큐가 실패했는데 analyses 행을 그대로 두면 status='queued'인 고아
  // 행이 남고, scans/[id]/page.tsx의 latest가 이 행이 되어 inProgress가 영구 true로
  // 고정된다. 워커의 reap_stuck_jobs는 jobs 테이블만 보는데 이 경우 잡 자체가 없으므로
  // 자동 복구도 안 된다 - 그 스캔은 영영 "분석 중"에 갇힌다.
  it('엔큐 실패 시 방금 만든 analyses 행을 soft delete로 되돌린다(고아 행 방지)', async () => {
    const updateSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ message: '전송 오류로 등록 실패' }, updateSpy) as never,
    );
    render(<UnitConfirmForm scan={scan} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '단위 확정 후 분석 시작' }));

    await screen.findByText(/전송 오류로 등록 실패/);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(pushMock).not.toHaveBeenCalled();
    // 재시도할 수 있어야 하므로 버튼이 다시 활성화된다
    expect(screen.getByRole('button', { name: '단위 확정 후 분석 시작' })).toBeEnabled();
  });

  // 회귀 방지: push 직후 refresh를 부르면 refresh가 "현재 라우트"를 다시 렌더하면서
  // 진행 중이던 이동을 취소한다(로그인 화면에서 실제로 재현된 결함). 이동 대상인
  // scans/[id]는 force-dynamic이고 동적 페이지의 클라이언트 캐시 staleTime 기본값은
  // 0초(캐시 안 함)라, push만으로도 항상 서버에서 새로 받아온다. refresh는 불필요하다.
  it('성공하면 스캔 상세로 push만 하고 refresh는 부르지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    render(<UnitConfirmForm scan={scan} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '단위 확정 후 분석 시작' }));

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/c1'));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
