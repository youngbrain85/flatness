import { afterEach, describe, expect, it, vi } from 'vitest';
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
// storage.from().upload()는 uploadRawScan(lib/scans/upload.ts)이 브라우저에서 직접 호출한다.
function stubSupabase(
  enqueueError: { code?: string; message: string } | null,
  spies: { scansUpdate?: (fields: unknown) => void; analysesUpdate?: (fields: unknown) => void } = {},
) {
  return {
    from: (table: string) => {
      if (table === 'scans') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'scan1' }, error: null }) }) }),
          update: (fields: unknown) => {
            spies.scansUpdate?.(fields);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      if (table === 'analyses') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'analysis1' }, error: null }) }) }),
          update: (fields: unknown) => {
            spies.analysesUpdate?.(fields);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    storage: {
      from: (bucket: string) => {
        if (bucket !== 'raw-scans') throw new Error(`예상치 못한 버킷: ${bucket}`);
        return { upload: async () => ({ error: null }) };
      },
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

afterEach(() => {
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

    // 되돌림 안내가 뒤에 덧붙으므로 부분 일치로 확인한다
    expect(await screen.findByText(new RegExp(DUPLICATE_JOB_MESSAGE))).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('임포트 모드: import 엔큐 실패 시 오류를 화면에 남기고 이동하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ code: '23505', message: 'dup' }) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    await selectSiteAndLocation();
    const file = new File(['x'], 'result.csv');
    fireEvent.change(screen.getByLabelText(/결과 파일 \(csv\/json\)/), { target: { files: [file] } });
    fireEvent.submit(container.querySelector('form')!);

    // 되돌림 안내가 뒤에 덧붙으므로 부분 일치로 확인한다
    expect(await screen.findByText(new RegExp(DUPLICATE_JOB_MESSAGE))).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // 코드리뷰 Critical(후속): 엔큐가 실패했는데 방금 만든 scans 행을 그대로 두면 잡이
  // 없는데 status가 'uploaded'(사전 검사 대기) 또는 'ready'(분석 준비됨)인 스캔이 남는다.
  // 화면상 정상처럼 보이면서 영원히 진행되지 않고, 재시도 버튼은 분석 행이 있어야 뜨므로
  // 사용자가 UI로 복구할 방법이 없다. 이번 제출로 만든 것을 되돌리고 재업로드를 안내한다.
  it('스캔 모드: precheck 엔큐 실패 시 방금 만든 스캔을 되돌린다', async () => {
    const scansUpdate = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ code: '23505', message: 'dup' }, { scansUpdate }) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    await selectSiteAndLocation();
    fireEvent.change(screen.getByLabelText(/스캔 파일/), {
      target: { files: [new File(['x'], 'scan.ply')] } });
    fireEvent.submit(container.querySelector('form')!);

    await screen.findByText(new RegExp(DUPLICATE_JOB_MESSAGE));
    expect(scansUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(screen.getByText(/다시 시도하세요/)).toBeInTheDocument();
  });

  it('임포트 모드: import 엔큐 실패 시 analyses 행과 스캔을 함께 되돌린다', async () => {
    const scansUpdate = vi.fn();
    const analysesUpdate = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ code: '23505', message: 'dup' }, { scansUpdate, analysesUpdate }) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    await selectSiteAndLocation();
    fireEvent.change(screen.getByLabelText(/결과 파일 \(csv\/json\)/), {
      target: { files: [new File(['x'], 'result.csv')] } });
    fireEvent.submit(container.querySelector('form')!);

    await screen.findByText(new RegExp(DUPLICATE_JOB_MESSAGE));
    expect(analysesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(scansUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }));
  });
});

describe('UploadForm 임포트 모드 파일 형식(B4: CSV/JSON 지원)', () => {
  it('JSON 파일도 정상 제출된다(엔큐 성공 시 결과 화면으로 이동)', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    await selectSiteAndLocation();
    const file = new File(['{}'], 'result.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(/결과 파일 \(csv\/json\)/), { target: { files: [file] } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
  });

  it('임포트 모드에서 csv/json이 아닌 파일은 화면에서 바로 거부한다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    await selectSiteAndLocation();
    const file = new File(['x'], 'scan.ply');
    fireEvent.change(screen.getByLabelText(/결과 파일 \(csv\/json\)/), { target: { files: [file] } });
    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText('지원 포맷: csv, json')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
