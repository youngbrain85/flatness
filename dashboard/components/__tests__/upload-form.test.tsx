import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { UploadForm } from '../upload-form';
import { DUPLICATE_JOB_MESSAGE } from '@/lib/domain/jobs';
import type { CriteriaRow, LocationRow, SiteRow } from '@/lib/domain/types';

const site: SiteRow = { id: 's1', name: '현장1', address: null, memo: null, created_at: '', updated_at: '' };
const location: LocationRow = {
  id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
  memo: null, created_at: '', updated_at: '',
};
const criteria: CriteriaRow = {
  id: 'cr1', site_id: null, surface: 'floor', name: 'floor-kcs', source_text: 'KCS 근거',
  thresholds: [], is_default: true, is_active: true, version: 1, supersedes_id: null, created_at: '',
};

// scans/analyses insert·update와 fn_resolve_criteria/fn_enqueue_job rpc 체인을 흉내내는
// 로컬 스텁 - 이 파일 하나만 이 모양을 쓰므로(리뷰 대상 파일 기준) 공유 헬퍼로 뽑지 않았다.
function stubSupabase(enqueueError: { code?: string; message: string } | null) {
  return {
    from: (table: string) => {
      if (table === 'scans') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'scan1' }, error: null }) }) }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === 'analyses') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'analysis1' }, error: null }) }) }),
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    rpc: async (fn: string) => {
      if (fn === 'fn_resolve_criteria') return { data: [criteria], error: null };
      if (fn === 'fn_enqueue_job') return { error: enqueueError };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

async function selectSiteAndLocation() {
  fireEvent.change(screen.getByLabelText('현장'), { target: { value: 's1' } });
  await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: 'l1' } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ rel_path: 'raw-scans/s1/scan1/raw.ply', size: 3 }),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('UploadForm 엔큐 실패 처리 (리뷰 Important #1)', () => {
  it('스캔 모드: precheck 엔큐 실패 시 오류를 화면에 남기고 이동하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ code: '23505', message: 'dup' }) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    await selectSiteAndLocation();
    const file = new File(['x'], 'scan.ply');
    fireEvent.change(screen.getByLabelText(/스캔 파일/), { target: { files: [file] } });
    // jsdom의 네이티브 제약 검증(required 필드)이 클릭발 암묵 제출을 막을 수 있어
    // submit 이벤트를 폼에 직접 발생시켜 onSubmit 핸들러를 확실히 호출한다
    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText(DUPLICATE_JOB_MESSAGE)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('임포트 모드: import 엔큐 실패 시 오류를 화면에 남기고 이동하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ code: '23505', message: 'dup' }) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(Colab CSV)'));
    await selectSiteAndLocation();
    const file = new File(['x'], 'result.csv');
    fireEvent.change(screen.getByLabelText(/결과 CSV 파일/), { target: { files: [file] } });
    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText(DUPLICATE_JOB_MESSAGE)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
