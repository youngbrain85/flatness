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
type Opts = {
  enqueueError?: { code?: string; message: string } | null;
  insertError?: { message: string } | null;
  scansRevertError?: { message: string } | null;
  scansUpdateSpy?: (fields: unknown) => void;
  analysesUpdateSpy?: (fields: unknown) => void;
};

function stubSupabase(o: Opts = {}) {
  let scansUpdateCount = 0;
  return {
    from: (table: string) => {
      if (table === 'scans') {
        return {
          update: (fields: unknown) => {
            scansUpdateCount += 1;
            o.scansUpdateSpy?.(fields);
            // 1회차는 ready 승격, 2회차부터가 롤백이다
            const err = scansUpdateCount > 1 ? (o.scansRevertError ?? null) : null;
            return { eq: async () => ({ error: err }) };
          },
        };
      }
      if (table === 'analyses') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => (o.insertError
                ? { data: null, error: o.insertError }
                : { data: { id: 'a1' }, error: null }),
            }),
          }),
          update: (fields: unknown) => {
            o.analysesUpdateSpy?.(fields);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    rpc: async (fn: string) => {
      if (fn === 'fn_enqueue_job') return { error: o.enqueueError ?? null };
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
    const analysesUpdateSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ enqueueError: { message: '전송 오류로 등록 실패' }, analysesUpdateSpy }) as never,
    );
    render(<UnitConfirmForm scan={scan} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '단위 확정 후 분석 시작' }));

    await screen.findByText(/전송 오류로 등록 실패/);
    expect(analysesUpdateSpy).toHaveBeenCalledTimes(1);
    expect(analysesUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(pushMock).not.toHaveBeenCalled();
    // 재시도할 수 있어야 하므로 버튼이 다시 활성화된다
    expect(screen.getByRole('button', { name: '단위 확정 후 분석 시작' })).toBeEnabled();
  });

  // 코드리뷰 Critical: analyses 행만 지우고 scans.status='ready'를 그대로 두면 그 스캔은
  // scans/[id] 화면의 어느 분기에도 걸리지 않는다(awaiting_unit_confirm/uploaded/failed
  // 모두 아니고, latest도 없어 분석 섹션이 통째로 사라진다). 목록에도 "분석 준비됨"이라는
  // 정상 뱃지로만 보여서, 재시도 링크도 오류 표시도 없이 조용히 죽는다. 롤백 전보다 오히려
  // 발견하기 어려워지므로 status도 함께 되돌려 단위 확인 링크가 다시 나타나게 해야 한다.
  it.each([
    ['엔큐', { enqueueError: { message: '전송 오류로 등록 실패' } }, /전송 오류로 등록 실패/],
    ['분석 행 생성', { insertError: { message: '권한이 없습니다' } }, /권한이 없습니다/],
  ] as const)('%s 실패 시 스캔 상태를 awaiting_unit_confirm으로 되돌린다', async (_l, opts, msg) => {
    const scansUpdateSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ ...opts, scansUpdateSpy }) as never);
    render(<UnitConfirmForm scan={scan} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '단위 확정 후 분석 시작' }));

    await screen.findByText(msg);
    expect(scansUpdateSpy).toHaveBeenCalledTimes(2);
    expect(scansUpdateSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'awaiting_unit_confirm' }));
  });

  it('롤백까지 실패하면 스캔이 남았다는 사실을 사용자에게 알린다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({
      enqueueError: { message: '전송 오류로 등록 실패' },
      scansRevertError: { message: 'revert failed' },
    }) as never);
    render(<UnitConfirmForm scan={scan} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '단위 확정 후 분석 시작' }));

    // 원인과 후속 조치가 모두 화면에 남아야 한다
    await screen.findByText(/전송 오류로 등록 실패/);
    expect(screen.getByText(/되돌리지 못했습니다/)).toBeInTheDocument();
  });

  // 회귀 방지: push 직후 refresh를 부르면 refresh가 "현재 라우트"를 다시 렌더하면서
  // 진행 중이던 이동을 취소한다(로그인 화면에서 실제로 재현된 결함). 이동 대상인
  // scans/[id]는 force-dynamic이고 동적 페이지의 클라이언트 캐시 staleTime 기본값은
  // 0초(캐시 안 함)라, push만으로도 항상 서버에서 새로 받아온다. refresh는 불필요하다.
  it('성공하면 스캔 상세로 push만 하고 refresh는 부르지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    render(<UnitConfirmForm scan={scan} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '단위 확정 후 분석 시작' }));

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/c1'));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
