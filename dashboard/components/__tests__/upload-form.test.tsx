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
  kind: 'flatness',
};

// scans/analyses insert·update와 fn_resolve_criteria/fn_enqueue_job rpc 체인을 흉내내는
// 로컬 스텁 - 이 파일 하나만 이 모양을 쓰므로(리뷰 대상 파일 기준) 공유 헬퍼로 뽑지 않았다.
// storage.from().upload()는 uploadRawScan(lib/scans/upload.ts)이 브라우저에서 직접 호출한다.
function stubSupabase(
  enqueueError: { code?: string; message: string } | null,
  spies: {
    scansUpdate?: (fields: unknown) => void;
    analysesUpdate?: (fields: unknown) => void;
    analysesInsert?: (fields: unknown) => void;
    /** discardScan의 soft delete(update에 deleted_at이 실린 호출)만 실패시킨다.
     *  3)의 raw_file_path 반영 update는 그대로 성공해야 그 뒤 경로에 닿는다. */
    softDeleteError?: { message: string };
  } = {},
) {
  return {
    from: (table: string) => {
      if (table === 'scans') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'scan1' }, error: null }) }) }),
          update: (fields: unknown) => {
            spies.scansUpdate?.(fields);
            const isSoftDelete = !!(fields as { deleted_at?: string }).deleted_at;
            return {
              eq: async () => ({
                error: isSoftDelete ? spies.softDeleteError ?? null : null,
              }),
            };
          },
        };
      }
      if (table === 'analyses') {
        return {
          insert: (fields: unknown) => {
            spies.analysesInsert?.(fields);
            return { select: () => ({ single: async () => ({ data: { id: 'analysis1' }, error: null }) }) };
          },
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

// 단계 D4: 현장/측정위치 이중 셀렉트가 optgroup 단일 셀렉트로 바뀌었다 - 측정위치를
// 고르면 현장은 site_id 역산으로 자동 결정되고 그 결과로 적용 기준이 뜬다.
async function selectLocation() {
  fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: 'l1' } });
  await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('UploadForm 엔큐 실패 처리 (리뷰 Important #1)', () => {
  it('스캔 모드: precheck 엔큐 실패 시 오류를 화면에 남기고 이동하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ code: '23505', message: 'dup' }) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    await selectLocation();
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
    await selectLocation();
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
    await selectLocation();
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
    await selectLocation();
    fireEvent.change(screen.getByLabelText(/결과 파일 \(csv\/json\)/), {
      target: { files: [new File(['x'], 'result.csv')] } });
    fireEvent.submit(container.querySelector('form')!);

    await screen.findByText(new RegExp(DUPLICATE_JOB_MESSAGE));
    expect(analysesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(scansUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ deleted_at: expect.any(String) }));
  });

  // ★ 재리뷰: 정리(soft delete)까지 실패하면 스캔이 status='ready' + analyses 0행으로
  // 남는다(임포트 모드는 3)에서 이미 ready로 승격했다). 예전에는 이 update의 오류를
  // 검사하지 않고 "등록되지 않았습니다"라고 단언해, 사용자가 남은 스캔을 모른 채
  // 떠났다. 그 남은 스캔이 바로 스캔 상세의 분석 진입점이 임포트인지 판별해야 하는
  // 대상이다 - 실패를 삼키면 안 된다.
  it('임포트 모드: 스캔 정리까지 실패하면 "등록되지 않았다"고 말하지 않고 사실대로 알린다', async () => {
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ code: '23505', message: 'dup' },
        { softDeleteError: { message: '연결이 끊겼습니다' } }) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    await selectLocation();
    fireEvent.change(screen.getByLabelText(/결과 파일 \(csv\/json\)/), {
      target: { files: [new File(['x'], 'result.csv')] } });
    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText(/정리하지도 못했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/연결이 끊겼습니다/)).toBeInTheDocument();
    expect(screen.getByText(/관리자에게 알리세요/)).toBeInTheDocument();
    // 거짓 안심을 주면 안 된다 - 스캔은 실제로 남아 있다.
    expect(screen.queryByText(/업로드한 스캔은 등록되지 않았습니다/)).toBeNull();
  });
});

describe('UploadForm 임포트 모드 파일 형식(B4: CSV/JSON 지원)', () => {
  it('JSON 파일도 정상 제출된다(엔큐 성공 시 결과 화면으로 이동)', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    await selectLocation();
    const file = new File(['{}'], 'result.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(/결과 파일 \(csv\/json\)/), { target: { files: [file] } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
  });

  it('임포트 모드에서 csv/json이 아닌 파일은 화면에서 바로 거부한다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    await selectLocation();
    const file = new File(['x'], 'scan.ply');
    fireEvent.change(screen.getByLabelText(/결과 파일 \(csv\/json\)/), { target: { files: [file] } });
    fireEvent.submit(container.querySelector('form')!);

    expect(await screen.findByText('지원 포맷: csv, json')).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  // 단계 C 회귀 차단: kind가 insert에서 빠지면 DB 기본값('flatness')에 조용히
  // 기대게 된다 - 임포트 결과는 점 단위 편차 목록이지 점군이 아니라 애초에 구배
  // 분석 대상이 될 수 없으므로 이 화면은 항상 kind='flatness'만 만들어야 한다.
  it('단계 C: 임포트 모드의 분석 행 insert에 kind=flatness를 명시한다', async () => {
    const analysesInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { analysesInsert }) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    await selectLocation();
    const file = new File(['{}'], 'result.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(/결과 파일 \(csv\/json\)/), { target: { files: [file] } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
    expect(analysesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'flatness', criteria_id: 'cr1' }));
  });
  // 이 저장소가 가장 경계하는 실패 양식(화면이 사실이 아닌 것을 주장) 차단.
  // 이 안내문은 오래도록 거짓이었다 - `scans.lineage`는 보고서 라벨로만 쓰였고
  // 경고를 만드는 코드가 엔진·워커·대시보드 어디에도 없었다. 이제
  // `worker/flatworker/lineage.py`가 실제로 `fused_mesh_smoothed`를 붙이고
  // 결과 패널(verdict-panel)과 보고서 스냅샷이 그것을 한국어로 보여준다.
  // 문구가 약속하는 대상(분석 결과·보고서)이 바뀌면 그 구현도 함께 따라가야 한다.
  it('융합 메시를 고르면 경고가 표시된다고 안내한다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);

    expect(screen.queryByText(/경고가 표시됩니다/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('융합 메시'));

    expect(screen.getByText(/분석 결과와 보고서에 경고가 표시됩니다/)).toBeInTheDocument();
  });
});

// 단계 D4: 현장·측정위치 이중 셀렉트를 optgroup 단일 셀렉트로 개편한다.
// 회귀 테스트(첫 번째 it)가 옛 버그를 잡는다 - 예전에는 location만 프리필해도
// 현장 셀렉트가 비어 있어 measure위치 옵션 목록 자체가 필터링으로 사라졌다.
describe('UploadForm 위치 선택 개편 (단계 D4)', () => {
  it('location 프리필만 있어도 해당 현장이 함께 선택된다', () => {
    render(<UploadForm sites={[site]} locations={[location]} userId="u1" initialLocationId={location.id} />);
    const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
    expect(sel.value).toBe(location.id);
  });

  it('새 측정위치 인라인 폼을 열 수 있다', () => {
    render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '+ 새 측정위치' }));
    expect(screen.getByLabelText('현장 선택 또는 새 현장명')).toBeInTheDocument();
  });
});

describe('UploadForm 인라인 현장·측정위치 생성 (단계 D4)', () => {
  it('기존 현장을 골라 측정위치를 추가하면 목록에 반영되고 선택된다', async () => {
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'locations') {
          return {
            insert: (fields: unknown) => {
              locationsInsert(fields);
              return { select: () => ({ single: async () => ({ data: { id: 'l2' }, error: null }) }) };
            },
          };
        }
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
      // 새 측정위치가 선택되면 현장이 역산되어 적용 기준 조회 이펙트가 돈다 - 이
      // 테스트는 그 결과를 검증하지 않지만, 응답이 없으면 unhandled rejection이 된다.
      rpc: async () => ({ data: [], error: null }),
    } as never);
    render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '+ 새 측정위치' }));
    fireEvent.change(screen.getByLabelText('현장 선택 또는 새 현장명'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '2층' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(locationsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ site_id: 's1', name: '2층' })));
    const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
    await waitFor(() => expect(sel.value).toBe('l2'));
  });

  it('새 현장명을 입력하면 현장부터 만든 뒤 그 현장으로 측정위치를 만든다', async () => {
    const sitesInsert = vi.fn();
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'sites') {
          return {
            insert: (fields: unknown) => {
              sitesInsert(fields);
              return { select: () => ({ single: async () => ({ data: { id: 's2' }, error: null }) }) };
            },
          };
        }
        if (table === 'locations') {
          return {
            insert: (fields: unknown) => {
              locationsInsert(fields);
              return { select: () => ({ single: async () => ({ data: { id: 'l2' }, error: null }) }) };
            },
          };
        }
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
      // 새 측정위치가 선택되면 현장이 역산되어 적용 기준 조회 이펙트가 돈다 - 이
      // 테스트는 그 결과를 검증하지 않지만, 응답이 없으면 unhandled rejection이 된다.
      rpc: async () => ({ data: [], error: null }),
    } as never);
    render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '+ 새 측정위치' }));
    fireEvent.change(screen.getByLabelText('새 현장명'), { target: { value: '신규현장' } });
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '1층' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(sitesInsert).toHaveBeenCalledWith(
      expect.objectContaining({ name: '신규현장' })));
    await waitFor(() => expect(locationsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ site_id: 's2', name: '1층' })));
  });
});

describe('UploadForm 인라인 생성 리뷰 픽스', () => {
  // F1 [Important]: sites insert는 성공했는데 뒤이은 locations insert가 실패하면,
  // newLocSiteId가 NEW_SITE_VALUE로 남아 있던 예전 구현에서는 사용자가 "저장"을
  // 다시 눌렀을 때 sites insert가 또 실행돼 같은 이름의 고아 현장이 재시도마다
  // 쌓였다. 이제는 site 생성 성공 즉시 newLocSiteId를 그 site로 전환하므로
  // 재시도가 기존 site를 재사용하고 sites insert가 두 번째로 불리지 않아야 한다.
  it('현장 생성 후 측정위치 저장이 실패해도 재시도 시 sites insert가 다시 불리지 않는다', async () => {
    const sitesInsert = vi.fn();
    const locationsInsert = vi.fn();
    let locationAttempts = 0;
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'sites') {
          return {
            insert: (fields: unknown) => {
              sitesInsert(fields);
              return { select: () => ({ single: async () => ({ data: { id: 's2' }, error: null }) }) };
            },
          };
        }
        if (table === 'locations') {
          return {
            insert: (fields: unknown) => {
              locationsInsert(fields);
              locationAttempts += 1;
              const failThisAttempt = locationAttempts === 1;
              return {
                select: () => ({
                  single: async () => (failThisAttempt
                    ? { data: null, error: { code: '23505', message: 'dup' } }
                    : { data: { id: 'l2' }, error: null }),
                }),
              };
            },
          };
        }
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
      rpc: async () => ({ data: [], error: null }),
    } as never);
    render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '+ 새 측정위치' }));
    fireEvent.change(screen.getByLabelText('새 현장명'), { target: { value: '신규현장' } });
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '1층' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    // 1차 시도: site는 만들어지고 location은 실패 - 상황을 알리는 메시지가 떠야 한다.
    await waitFor(() => expect(sitesInsert).toHaveBeenCalledTimes(1));
    await screen.findByText(/현장은 생성됐습니다\. 같은 현장으로 다시 시도하세요/);

    // 2차 시도(재시도): 같은 입력으로 다시 저장 - sites insert는 다시 불리면 안 된다.
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(locationsInsert).toHaveBeenCalledTimes(2));
    expect(sitesInsert).toHaveBeenCalledTimes(1);
    expect(locationsInsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ site_id: 's2', name: '1층' }));
  });

  // F2 [Important]: 미니폼이 상위 스캔 업로드 <form> 안에 중첩돼 있어, 파일·위치·
  // 기준을 이미 골라 둔 상태에서 미니폼 입력 중 Enter를 누르면 브라우저 기본 동작이
  // 상위 폼을 암묵 제출해 엉뚱한 기존 측정위치로 스캔이 올라갈 수 있었다. Enter는
  // 패널 안에서 가로채져 측정위치 생성으로만 이어져야 한다.
  it('미니폼 입력에서 Enter를 누르면 스캔 제출이 아니라 측정위치 생성이 실행된다', async () => {
    const scansInsert = vi.fn();
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'scans') {
          return {
            insert: (fields: unknown) => {
              scansInsert(fields);
              return { select: () => ({ single: async () => ({ data: { id: 'scan1' }, error: null }) }) };
            },
          };
        }
        if (table === 'locations') {
          return {
            insert: (fields: unknown) => {
              locationsInsert(fields);
              return { select: () => ({ single: async () => ({ data: { id: 'l2' }, error: null }) }) };
            },
          };
        }
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
      rpc: async () => ({ data: [], error: null }),
    } as never);
    render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    // 파일·위치를 이미 골라 둔 상태를 흉내낸다 - 실수로 제출되면 이 기존
    // 측정위치(l1)로 스캔이 올라간다.
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: 'l1' } });
    fireEvent.change(screen.getByLabelText(/스캔 파일/), { target: { files: [new File(['x'], 'scan.ply')] } });

    fireEvent.click(screen.getByRole('button', { name: '+ 새 측정위치' }));
    fireEvent.change(screen.getByLabelText('현장 선택 또는 새 현장명'), { target: { value: 's1' } });
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '2층' } });
    fireEvent.keyDown(screen.getByLabelText('이름'), { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(locationsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ site_id: 's1', name: '2층' })));
    expect(scansInsert).not.toHaveBeenCalled();
  });
});
