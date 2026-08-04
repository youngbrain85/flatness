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
  height_view_path: null,
  deleted_at: null, created_at: '', updated_at: '',
} as ScanRow;

// precheck가 남기는 값은 버킷-상대 "전체" 경로다(worker/flatworker/jobs.py의
// handle_precheck: artifacts/scans/{scan_id}/height_view.png). 스캔 id가 'c1'이므로
// 경로 안에도 c1이 들어간다 - artifactUrl로 다시 접두사를 붙이면 곧바로 중복이 보인다.
const scanWithView = {
  ...scan, height_view_path: 'artifacts/scans/c1/height_view.png',
} as ScanRow;

// scans 갱신 -> analyses insert -> fn_enqueue_job 순서를 흉내 내는 최소 스텁.
// analyses.update는 고아 행 롤백(soft delete) 여부를 관찰하려고 스파이를 건다.
type Opts = {
  enqueueError?: { code?: string; message: string } | null;
  insertError?: { message: string } | null;
  scansRevertError?: { message: string } | null;
  scansUpdateSpy?: (fields: unknown) => void;
  analysesUpdateSpy?: (fields: unknown) => void;
  analysesInsertSpy?: (fields: unknown) => void;
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
          insert: (fields: unknown) => {
            o.analysesInsertSpy?.(fields);
            return {
              select: () => ({
                single: async () => (o.insertError
                  ? { data: null, error: o.insertError }
                  : { data: { id: 'a1' }, error: null }),
              }),
            };
          },
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

  // 단계 C 회귀 차단: kind가 insert에서 빠지면 DB 기본값('flatness')에 조용히
  // 기대게 된다 - 단위 확인 화면은 항상 평활도 첫 분석만 만들어야 한다.
  it('단계 C: 분석 행 insert에 kind=flatness를 명시한다', async () => {
    const analysesInsertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ analysesInsertSpy }) as never);
    render(<UnitConfirmForm scan={scan} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '단위 확정 후 분석 시작' }));

    await vi.waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/c1'));
    expect(analysesInsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'flatness', criteria_id: 'cr1' }));
  });
});

// 단계 E: 높이 뷰(precheck가 만든 평면도 PNG)를 단위 확정 화면에 띄운다.
// 이 그림이 "이 방이 8m인가 80cm인가"를 사용자가 눈으로 가늠하는 유일한 단서다.
describe('UnitConfirmForm 높이 뷰 (단계 E)', () => {
  it('height_view_path가 없으면 기존 파일명 전용 화면을 그대로 보여준다', () => {
    // 임포트 등 precheck를 돈 적이 없는 기존 스캔은 이 값이 영원히 null이다
    // (설계 결정 E6). 오류가 아니라 정상 경로이므로 화면이 죽으면 안 된다.
    render(<UnitConfirmForm scan={scan} userId="u1" />);

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/room\.ply/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '단위 확정 후 분석 시작' })).toBeEnabled();
    expect(screen.getByLabelText(/mm/)).toBeInTheDocument();
  });

  it('height_view_path가 있으면 높이 뷰를 표시한다(dataUrl 그대로 - artifactUrl 이중 접두사 금지)', () => {
    // 경로 함정(lib/domain/slope-cells.ts가 문서화): 저장값이 이미 버킷-상대
    // 전체 경로라 artifactUrl(dir, name)로 다시 조립하면
    // artifacts/scans/c1/artifacts/scans/c1/... 로 중복돼 404가 난다.
    render(<UnitConfirmForm scan={scanWithView} userId="u1" />);

    const img = screen.getByRole('img', { name: /높이 뷰/ });
    expect(img).toHaveAttribute('src', '/api/data/artifacts/scans/c1/height_view.png');
    // 폼도 함께 살아 있어야 한다(그림이 폼을 대체하는 것이 아니다)
    expect(screen.getByRole('button', { name: '단위 확정 후 분석 시작' })).toBeEnabled();
  });

  it('높이 뷰 로딩이 실패하면(객체 삭제 등 404) 폴백 안내로 바꾸고 폼은 계속 쓸 수 있다', () => {
    // null 검사만으로는 부족하다: /api/data는 서명 URL 302를 거치므로 경로가
    // 남아 있어도 객체가 지워졌으면 404다. 그때 깨진 이미지 아이콘만 남으면
    // 사용자는 "그림이 원래 없는 것"인지 "지금 못 불러온 것"인지 구별하지 못한다.
    render(<UnitConfirmForm scan={scanWithView} userId="u1" />);
    const img = screen.getByRole('img', { name: /높이 뷰/ });

    fireEvent.error(img);

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText(/높이 뷰를 불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '단위 확정 후 분석 시작' })).toBeEnabled();
    expect(screen.getByLabelText(/mm/)).toBeInTheDocument();
  });

  // ★ 실제 브라우저(headless Chrome, /api/data가 401)에서 재현한 결함이다.
  // 이 화면은 서버 렌더된 HTML에 <img>가 이미 들어 있어, 브라우저가 그 요청을
  // 하이드레이션(React가 onError를 붙이는 시점)보다 먼저 끝낸다. 그 사이에 지나간
  // error 이벤트는 영영 사라져, 하이드레이션이 끝난 뒤에도 폴백이 뜨지 않고 깨진
  // 이미지 아이콘만 남았다(화면 캡처로 확인). onError만 다는 구현은 위의 fireEvent
  // 테스트는 통과하지만 실제 화면에서는 실패한다 - render()가 항상 핸들러를 먼저
  // 붙여 주기 때문이다. 마운트 시점의 이미지 상태를 직접 확인해야 잡힌다.
  it('하이드레이션 전에 이미 실패한 이미지도 폴백으로 바꾼다(onError만으로는 못 잡는다)', () => {
    // 깨진 이미지의 최종 상태: complete=true인데 naturalWidth=0
    // (실제 브라우저에서 관측한 값 그대로다).
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const nw = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
    try {
      render(<UnitConfirmForm scan={scanWithView} userId="u1" />);

      expect(screen.queryByRole('img')).toBeNull();
      expect(screen.getByText(/높이 뷰를 불러오지 못했습니다/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '단위 확정 후 분석 시작' })).toBeEnabled();
    } finally {
      complete.mockRestore();
      nw.mockRestore();
    }
  });

  it('축 눈금이 미터가 아니라 파일 단위임을 밝힌다(라벨 오인 방지)', () => {
    render(<UnitConfirmForm scan={scanWithView} userId="u1" />);

    expect(screen.getByText(/파일 단위/)).toBeInTheDocument();
  });
});
