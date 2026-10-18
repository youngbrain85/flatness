import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { UploadForm } from '../upload-form';
import { DUPLICATE_JOB_MESSAGE } from '@/lib/domain/jobs';
import { buttonClass } from '@/components/ui/button';
import { inputClass, selectClass } from '@/components/ui/form';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from '@/lib/upload/validate';
import type { CriteriaRow, LocationRow } from '@/lib/domain/types';

const location: LocationRow = {
  id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
  memo: null, created_at: '', updated_at: '',
};
const criteria: CriteriaRow = {
  id: 'cr1', site_id: null, surface: 'floor', name: 'floor-kcs', source_text: 'KCS 근거',
  thresholds: [], is_default: true, is_active: true, version: 1, supersedes_id: null, created_at: '',
  kind: 'flatness',
};

type StubResult = { data: unknown; error: { code?: string; message: string } | null };

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
    storageUpload?: (key: string) => void;
    rpc?: (fn: string, params: unknown) => void;
    /** 적용 기준 조회 응답. 함수면 호출마다(표면 같은 인자를 보고) 응답을 만들거나 늦춘다. */
    criteriaResult?: StubResult | ((params: { p_site_id: string; p_surface: string }) => StubResult | Promise<StubResult>);
    // 변이 실험 보강(T6): 저장 값·되돌림 대상·실패 경로·업로드 중 상태를 관찰하고 주입하는 자리
    scansInsert?: (fields: unknown) => void;
    scansInsertResult?: StubResult;
    /** scans insert 응답을 이 약속이 풀릴 때까지 붙잡는다(업로드 중 상태를 보려고). */
    scansInsertGate?: Promise<void>;
    scansUpdateEq?: (col: string, val: unknown) => void;
    /** 3)의 raw_file_path 반영 update 만 실패시킨다(soft delete 는 softDeleteError). */
    rawPathError?: { message: string };
    analysesInsertResult?: StubResult;
    analysesUpdateEq?: (col: string, val: unknown) => void;
    storageError?: Error;
    storageThrows?: unknown;
  } = {},
) {
  return {
    from: (table: string) => {
      if (table === 'scans') {
        return {
          insert: (fields: unknown) => {
            spies.scansInsert?.(fields);
            return {
              select: () => ({
                single: async () => {
                  await spies.scansInsertGate;
                  return spies.scansInsertResult ?? { data: { id: 'scan1' }, error: null };
                },
              }),
            };
          },
          update: (fields: unknown) => {
            spies.scansUpdate?.(fields);
            const isSoftDelete = !!(fields as { deleted_at?: string }).deleted_at;
            return {
              eq: async (col: string, val: unknown) => {
                spies.scansUpdateEq?.(col, val);
                return { error: isSoftDelete ? spies.softDeleteError ?? null : spies.rawPathError ?? null };
              },
            };
          },
        };
      }
      if (table === 'analyses') {
        return {
          insert: (fields: unknown) => {
            spies.analysesInsert?.(fields);
            return {
              select: () => ({
                single: async () => spies.analysesInsertResult ?? { data: { id: 'analysis1' }, error: null },
              }),
            };
          },
          update: (fields: unknown) => {
            spies.analysesUpdate?.(fields);
            return { eq: async (col: string, val: unknown) => { spies.analysesUpdateEq?.(col, val); return { error: null }; } };
          },
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    storage: {
      from: (bucket: string) => {
        if (bucket !== 'raw-scans') throw new Error(`예상치 못한 버킷: ${bucket}`);
        return {
          upload: async (key: string) => {
            spies.storageUpload?.(key);
            if (spies.storageThrows !== undefined) throw spies.storageThrows;
            return { error: spies.storageError ?? null };
          },
        };
      },
    },
    rpc: async (fn: string, params: unknown) => {
      spies.rpc?.(fn, params);
      if (fn === 'fn_resolve_criteria') {
        const r = spies.criteriaResult;
        return (typeof r === 'function' ? await r(params as { p_site_id: string; p_surface: string }) : r)
          ?? { data: [criteria], error: null };
      }
      if (fn === 'fn_enqueue_job') return { error: enqueueError };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

// locations insert 만 받는 스텁(그 자리에서 새 측정위치 만들기). 기준 조회 rpc는 빈 목록으로 답한다 -
// 응답이 없으면 마운트 즉시 도는 기준 조회 이펙트가 unhandled rejection이 된다.
function stubLocationInsert(
  insertSpy: (fields: unknown) => void,
  result: StubResult | ((call: number) => StubResult | Promise<StubResult>) = { data: { id: 'l2' }, error: null },
  scansInsert?: (fields: unknown) => void,
) {
  let calls = 0;
  return {
    from: (table: string) => {
      if (table === 'locations') {
        return {
          insert: (fields: unknown) => {
            insertSpy(fields);
            calls += 1;
            const call = calls;
            return { select: () => ({ single: async () => (typeof result === 'function' ? result(call) : result) }) };
          },
        };
      }
      if (table === 'scans' && scansInsert) {
        return {
          insert: (fields: unknown) => {
            scansInsert(fields);
            return { select: () => ({ single: async () => ({ data: { id: 'scan1' }, error: null }) }) };
          },
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    rpc: async () => ({ data: [], error: null }),
  };
}

function renderForm(props: Partial<React.ComponentProps<typeof UploadForm>> = {}) {
  return render(<UploadForm siteId="s1" locations={[location]} userId="u1" {...props} />);
}

// 다크 C안(T6): 측정위치를 고르면 그 값이 셀렉트에 들고, 적용 기준은 현장으로 이미 떠 있다.
async function selectLocation() {
  fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: 'l1' } });
  await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
}

beforeEach(() => {
  // 기준 조회 이펙트가 마운트마다 돈다(현장이 경로로 정해져 있다) - 기본 스텁을 깔아 둔다.
  vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('UploadForm 엔큐 실패 처리 (리뷰 Important #1)', () => {
  it('스캔 모드: precheck 엔큐 실패 시 오류를 화면에 남기고 이동하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ code: '23505', message: 'dup' }) as never);
    const { container } = renderForm();
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
    const { container } = renderForm();
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
    const { container } = renderForm();
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
    const { container } = renderForm();
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
    const { container } = renderForm();
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
    const { container } = renderForm();
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    await selectLocation();
    const file = new File(['{}'], 'result.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(/결과 파일 \(csv\/json\)/), { target: { files: [file] } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
  });

  it('임포트 모드에서 csv/json이 아닌 파일은 화면에서 바로 거부한다', async () => {
    const { container } = renderForm();
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
    const { container } = renderForm();
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
    renderForm();

    expect(screen.queryByText(/경고가 표시됩니다/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('융합 메시'));

    expect(screen.getByText(/분석 결과와 보고서에 경고가 표시됩니다/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });
});

// T6(스펙 §5 행 05): 현장은 경로가 정한다. 화면 안 현장 고르기·새 현장 만들기는 없고, 측정위치
// 셀렉트·그 자리 새 측정위치·적용 기준 조회·파일 저장 경로가 모두 경로의 현장(siteId)을 쓴다.
describe('UploadForm 현장 고정 (T6)', () => {
  it('현장 고르기·새 현장 입력이 없다', async () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));

    expect(screen.queryByLabelText('현장 선택 또는 새 현장명')).toBeNull();
    expect(screen.queryByLabelText('새 현장명')).toBeNull();
    expect(screen.queryByText('+ 새 현장 만들기')).toBeNull();
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });

  it('측정위치 셀렉트에는 받은 측정위치만 받은 순서대로 있다(현장 묶음 optgroup 없음)', async () => {
    const other = { ...location, id: 'l3', building: '102동', floor: '2층', room: '201호', name: '안방' };
    renderForm({ locations: [location, other] });

    const select = screen.getByLabelText('측정위치') as HTMLSelectElement;
    expect(select.querySelector('optgroup')).toBeNull();
    expect(Array.from(select.options).map((o) => [o.value, o.textContent]))
      .toEqual([['', '선택...'], ['l1', '1층'], ['l3', '102동 / 2층 / 201호 / 안방']]);
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });

  it('프리필 측정위치(?location=)가 선택돼 있고 적용 기준은 측정위치를 고르기 전부터 현장으로 뜬다', async () => {
    const rpc = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { rpc }) as never);
    renderForm({ initialLocationId: 'l1' });

    expect((screen.getByLabelText('측정위치') as HTMLSelectElement).value).toBe('l1');
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith('fn_resolve_criteria', { p_site_id: 's1', p_surface: 'floor' });
  });

  it('측정위치를 고르지 않아도 적용 기준을 현장으로 불러온다(옛 "측정위치를 먼저 선택하세요" 없음)', async () => {
    renderForm();
    expect(await screen.findByText('floor-kcs')).toBeInTheDocument();
    expect(screen.queryByText('측정위치를 먼저 선택하세요.')).toBeNull();
  });

  it.each([
    ['조회가 실패한', { data: null, error: { message: 'permission denied' } }, '적용 기준을 불러오지 못했습니다: permission denied'],
    ['후보가 없는', { data: [], error: null }, '이 현장에 쓸 수 있는 적용 기준이 없습니다.'],
  ] as const)('적용 기준 %s 경우 목록 자리에 그 까닭을 적는다', async (_l, criteriaResult, note) => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { criteriaResult }) as never);
    renderForm();
    expect(await screen.findByText(note)).toBeInTheDocument();
  });

  it('스캔 파일은 경로 현장의 raw-scans 경로로 올리고 성공하면 스캔 작업대로 간다', async () => {
    const storageUpload = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { storageUpload }) as never);
    const { container } = renderForm({ initialLocationId: 'l1' });
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/스캔 파일/), { target: { files: [new File(['x'], 'scan.ply')] } });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
    // rawScanRelPath 규약: raw-scans/{site}/{scan}/raw.{ext} - 버킷 안 키는 접두사를 뗀 값
    expect(storageUpload).toHaveBeenCalledWith('s1/scan1/raw.ply');
  });

  it('새 측정위치는 경로의 현장으로 저장하고 셀렉트에 넣어 고른다', async () => {
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubLocationInsert(locationsInsert) as never);
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));
    fireEvent.change(screen.getByLabelText('동'), { target: { value: ' 101동 ' } });
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '2층' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(locationsInsert).toHaveBeenCalledWith({
      site_id: 's1', building: '101동', floor: '', floor_order: 0, room: '', name: '2층',
    }));
    const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
    await waitFor(() => expect(sel.value).toBe('l2'));
    // 저장하면 패널이 닫힌다
    expect(screen.queryByLabelText('이름')).toBeNull();
  });

  it('새 측정위치 이름이 비면 저장하지 않고 안내한다', () => {
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubLocationInsert(locationsInsert) as never);
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(screen.getByRole('alert')).toHaveTextContent('측정위치명을 입력하세요.');
    expect(locationsInsert).not.toHaveBeenCalled();
  });

  it('같은 동/층/공간에 같은 이름이 있으면(23505) 그 사실을 알린다', async () => {
    vi.mocked(createClient).mockReturnValue(
      stubLocationInsert(vi.fn(), { data: null, error: { code: '23505', message: 'dup' } }) as never);
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '1층' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('같은 동/층/공간에 동일한 측정위치가 이미 있습니다.')).toBeInTheDocument();
  });

  // F2 [Important]: 미니폼이 상위 스캔 업로드 <form> 안에 중첩돼 있어, 파일·위치·
  // 기준을 이미 골라 둔 상태에서 미니폼 입력 중 Enter를 누르면 브라우저 기본 동작이
  // 상위 폼을 암묵 제출해 엉뚱한 기존 측정위치로 스캔이 올라갈 수 있었다. Enter는
  // 패널 안에서 가로채져 측정위치 생성으로만 이어져야 한다.
  it('미니폼 입력에서 Enter를 누르면 스캔 제출이 아니라 측정위치 생성이 실행된다', async () => {
    const scansInsert = vi.fn();
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubLocationInsert(locationsInsert, undefined, scansInsert) as never);
    renderForm();
    // 파일·위치를 이미 골라 둔 상태를 흉내낸다 - 실수로 제출되면 이 기존
    // 측정위치(l1)로 스캔이 올라간다.
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: 'l1' } });
    fireEvent.change(screen.getByLabelText(/스캔 파일/), { target: { files: [new File(['x'], 'scan.ply')] } });

    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '2층' } });
    fireEvent.keyDown(screen.getByLabelText('이름'), { key: 'Enter', code: 'Enter' });

    await waitFor(() => expect(locationsInsert).toHaveBeenCalledWith(
      expect.objectContaining({ site_id: 's1', name: '2층' })));
    expect(scansInsert).not.toHaveBeenCalled();
  });

  it('파일을 고르면 파일 이름 줄이 뜨고 "선택한 파일 빼기"로 비운다', async () => {
    renderForm();
    const input = screen.getByLabelText(/스캔 파일/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'scan_101_301.ply')] } });

    expect(screen.getByText('scan_101_301.ply')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '선택한 파일 빼기' }));

    expect(screen.queryByText('scan_101_301.ply')).toBeNull();
    expect(input.value).toBe('');
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });
});

// T6 다크 C안 해부(아트보드 Upload): 상태는 checked·aria 속성으로, 모양은 새 토큰 클래스로 읽는다.
describe('UploadForm 다크 C안 해부 (T6)', () => {
  it('카드 제목 "업로드 정보", 업로드 방식은 칩 라디오 묶음이고 고른 칩만 ink 테두리 + surface-2', async () => {
    renderForm();
    expect(screen.getByRole('heading', { level: 2, name: '업로드 정보' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: '업로드 방식' });
    const scanChip = within(group).getByLabelText('스캔 분석');
    const importChip = within(group).getByLabelText('기존 결과 가져오기(CSV/JSON)');
    expect(scanChip).toBeChecked();
    expect(scanChip.closest('label')?.className).toContain('bg-surface-2');
    expect(scanChip.closest('label')?.className).toContain('border-ink');
    expect(importChip.closest('label')?.className).toContain('border-line-3');
    expect(importChip.closest('label')?.className).not.toContain('bg-surface-2');
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });

  it('표면 유형·데이터 계보는 fieldset/legend 칩 묶음이고 임포트로 바꾸면 사라진다', async () => {
    renderForm();
    expect(screen.getByRole('group', { name: '표면 유형' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '데이터 계보' })).toBeInTheDocument();
    expect(screen.getByLabelText('바닥')).toBeChecked();
    expect(screen.getByLabelText('모름')).toBeChecked();

    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    expect(screen.queryByRole('group', { name: '표면 유형' })).toBeNull();
    expect(screen.queryByRole('group', { name: '데이터 계보' })).toBeNull();
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });

  it('입력칸·셀렉트는 공통 클래스, 측정위치 셀렉트는 꺾쇠 아이콘을 얹고 측정일자는 mono다', async () => {
    renderForm();
    const sel = screen.getByLabelText('측정위치');
    expect(sel.className).toContain(selectClass);
    expect(sel.parentElement?.querySelector('[data-icon="chevron-down"]')).not.toBeNull();
    expect(screen.getByLabelText('장비').className).toContain(inputClass);
    expect(screen.getByLabelText('측정일자').className).toContain('font-mono');
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });

  it('적용 기준은 목록 상자이고 고른 줄만 surface-2 바탕 + 왼쪽 ink 막대다', async () => {
    renderForm();
    const code = await screen.findByText('floor-kcs');
    expect(code.className).toContain('font-mono');
    const row = code.closest('label')!;
    expect(within(row).getByRole('radio')).toBeChecked();
    expect(row.className).toContain('bg-surface-2');
    expect(row.className).toContain('border-l-ink');
    expect(within(row).getByText('(기본)')).toBeInTheDocument();
  });

  it('"새 측정위치" 토글은 aria-expanded로 패널 열림을 알리고 aria-controls로 패널을 가리킨다', async () => {
    renderForm();
    const toggle = screen.getByRole('button', { name: '새 측정위치' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const panelId = toggle.getAttribute('aria-controls')!;
    expect(document.getElementById(panelId)).toContainElement(screen.getByLabelText('이름'));
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });

  // 최종 리뷰: 닫힌 패널은 DOM 에 없으므로 aria-controls 가 없는 id 를 가리키면 안 된다(계정 메뉴·현장 바꾸기와 같은 규칙).
  it('"새 측정위치" 토글은 패널이 닫혀 있으면 aria-controls 를 달지 않고, 열면 DOM 에 있는 패널 id 를 가리킨다', async () => {
    renderForm();
    const toggle = screen.getByRole('button', { name: '새 측정위치' });
    expect(toggle).not.toHaveAttribute('aria-controls');
    fireEvent.click(toggle);
    const panelId = toggle.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).not.toBeNull();
    fireEvent.click(toggle);
    expect(toggle).not.toHaveAttribute('aria-controls');
    expect(document.getElementById(panelId!)).toBeNull();
    await settle();
  });

  it('제출 버튼만 주 버튼이고, 미니폼을 열어도 주 버튼은 하나다(저장은 보조, 취소는 글자 버튼)', async () => {
    const { container } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));

    const submit = screen.getByRole('button', { name: '업로드 후 사전 검사' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.className).toContain(buttonClass('primary'));
    expect(submit.querySelector('[data-icon="upload"]')).not.toBeNull();
    const primaries = Array.from(container.querySelectorAll('button'))
      .filter((b) => b.className.includes(buttonClass('primary')));
    expect(primaries).toHaveLength(1);
    const save = screen.getByRole('button', { name: '저장' });
    expect(save).toHaveAttribute('type', 'button');
    expect(save.className).toContain(buttonClass('normal'));
    expect(screen.getByRole('button', { name: '취소' })).toHaveAttribute('type', 'button');
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });

  it('파일 상자: 점선 상자를 진짜 파일 입력이 투명하게 덮고, "파일 선택"·끌어다 놓기 문구는 모양뿐이다', async () => {
    renderForm();
    const input = screen.getByLabelText(/스캔 파일/);
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toBeRequired();
    expect(input.className).toContain('opacity-0');
    expect(input.className).toContain('inset-0');
    const box = input.parentElement!;
    expect(box.className).toContain('border-dashed');
    expect(within(box).getByText('파일 선택').closest('[aria-hidden]')).not.toBeNull();
    expect(within(box).getByText('또는 파일을 여기에 끌어다 놓기').closest('[aria-hidden]')).not.toBeNull();
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });

  it('제출 오류는 error Alert로 보인다', async () => {
    const { container } = renderForm();
    // 파일 없이 제출 -> onSubmit의 첫 가드('파일을 선택하세요.')가 동기적으로 error를 세운다
    fireEvent.submit(container.querySelector('form')!);

    const alert = container.querySelector('[data-alert="error"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('파일을 선택하세요.');
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });

  it('임포트 안내는 info Alert, 융합 메시 경고는 warning Alert다', async () => {
    const { container } = renderForm();

    fireEvent.click(screen.getByLabelText('융합 메시'));
    expect(container.querySelector('[data-alert="warning"]')?.textContent)
      .toContain('분석 결과와 보고서에 경고가 표시됩니다');

    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    expect(container.querySelector('[data-alert="info"]')?.textContent).toContain('외부 결과');
    // 임포트 모드에서는 데이터 계보 묶음 자체가 사라진다(기존 mode==='scan' 가드)
    expect(container.querySelector('[data-alert="warning"]')).toBeNull();
    await waitFor(() => expect(screen.getByText('floor-kcs')).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------------------------
// T6 변이 실험 보강. 브리프 테스트만으로는 살아남던 변이(scans·analyses 저장 값, 잡 종류·payload, 되돌림 대상 id,
// 실패 경로, 업로드 중 잠금, 기준 선택, 새 측정위치의 잠금·초기화, Enter 기본 동작, 파일 입력 비우기 …)를 막는다.
// 위쪽 브리프의 테스트는 고치지 않고 이 아래에 덧붙였다(스텁에는 관찰점·주입점만 더했다).
// ---------------------------------------------------------------------------------------------

// 마운트 때 도는 기준 조회가 끝날 때까지 기다린다(끝나기 전에 테스트가 끝나면 act 경고가 난다).
const settle = () => waitFor(() => expect(screen.queryByText('적용 기준을 불러오는 중...')).toBeNull());

// 기본은 이 현장의 측정위치 l1 이 미리 골라진 폼 - 기준 조회까지 끝낸 뒤 돌려준다.
async function readyForm(props: Partial<React.ComponentProps<typeof UploadForm>> = { initialLocationId: 'l1' }) {
  const view = renderForm(props);
  await settle();
  return view;
}

function pickFile(name: string, label: RegExp = /스캔 파일/) {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [new File(['x'], name)] } });
}

// fireEvent 는 기본 동작이 막혔으면 false 를 돌려준다.
function submitForm(container: HTMLElement) {
  return fireEvent.submit(container.querySelector('form')!);
}

describe('UploadForm 저장 값·잡 등록 (T6 변이 보강)', () => {
  it('스캔 모드: scans 행에 위치·표면·기준·일자·장비·담당자·파일·계보를 담고, raw 경로를 반영한 뒤 precheck 잡을 건다', async () => {
    const scansInsert = vi.fn();
    const scansUpdate = vi.fn();
    const scansUpdateEq = vi.fn();
    const rpc = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase(null, { scansInsert, scansUpdate, scansUpdateEq, rpc }) as never);
    const { container } = await readyForm();
    fireEvent.click(screen.getByLabelText('벽면'));
    // 표면을 바꾸면 기준을 다시 불러오고, 그동안은 목록·선택이 비어 제출이 막힌다(최종 리뷰 픽스) - 벽면 기준이 온 뒤에 낸다
    await settle();
    fireEvent.click(screen.getByLabelText('원시 점군'));
    fireEvent.change(screen.getByLabelText('측정일자'), { target: { value: '2026-09-03' } });
    fireEvent.change(screen.getByLabelText('장비'), { target: { value: ' iPhone 15 ' } });
    fireEvent.change(screen.getByLabelText(/담당자 이름/), { target: { value: ' 홍길동 ' } });
    pickFile('Scan A.PLY');
    submitForm(container);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
    expect(scansInsert).toHaveBeenCalledWith({
      location_id: 'l1', surface: 'wall', scanned_at: '2026-09-03', device: 'iPhone 15', operator_id: 'u1',
      operator_name_manual: '홍길동', selected_criteria_id: 'cr1', original_filename: 'Scan A.PLY',
      file_format: 'ply', lineage: 'raw', status: 'uploaded',
    });
    expect(scansUpdate).toHaveBeenCalledWith({ raw_file_path: 'raw-scans/s1/scan1/raw.ply' });
    expect(scansUpdateEq).toHaveBeenCalledWith('id', 'scan1');
    expect(rpc).toHaveBeenCalledWith('fn_enqueue_job', { p_type: 'precheck', p_payload: { scan_id: 'scan1' } });
  });

  it('스캔 모드: 장비·담당자가 비거나 공백뿐이면 null 로 저장하고 측정일자 기본값은 날짜 형식이다', async () => {
    const scansInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { scansInsert }) as never);
    const { container } = await readyForm();
    fireEvent.change(screen.getByLabelText('장비'), { target: { value: '   ' } });
    pickFile('scan.ply');
    submitForm(container);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
    expect(scansInsert).toHaveBeenCalledWith(expect.objectContaining({
      device: null, operator_name_manual: null, surface: 'floor', lineage: 'unknown',
      scanned_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    }));
  });

  it('임포트 모드: 스캔 모드에서 고른 벽면·계보와 상관없이 floor·unknown 으로 저장하고 분석 행과 import 잡을 만든다', async () => {
    const scansInsert = vi.fn();
    const scansUpdate = vi.fn();
    const analysesInsert = vi.fn();
    const rpc = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase(null, { scansInsert, scansUpdate, analysesInsert, rpc }) as never);
    const { container } = await readyForm();
    // 스캔 모드에서 고른 값이 임포트로 새면 안 된다
    fireEvent.click(screen.getByLabelText('벽면'));
    fireEvent.click(screen.getByLabelText('원시 점군'));
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    // 임포트로 바꾸면 바닥 기준을 다시 불러오고, 그동안은 목록·선택이 비어 제출이 막힌다(최종 리뷰 픽스) - 온 뒤에 낸다
    await settle();
    pickFile('result.json', /결과 파일 \(csv\/json\)/);
    submitForm(container);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
    // 기준은 표면(바닥 -> 벽면 -> 임포트라 다시 바닥)이 바뀔 때마다 현장 기준으로 다시 불러온다
    const surfaces = rpc.mock.calls
      .filter(([fn]) => fn === 'fn_resolve_criteria')
      .map(([, params]) => (params as { p_surface: string }).p_surface);
    expect(surfaces).toEqual(['floor', 'wall', 'floor']);
    expect(scansInsert).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'l1', surface: 'floor', lineage: 'unknown', unit_scale: 1, status: 'uploaded',
      original_filename: 'result.json', file_format: 'json',
    }));
    expect(scansUpdate).toHaveBeenCalledWith({ raw_file_path: 'raw-scans/s1/scan1/raw.json', status: 'ready' });
    expect(analysesInsert).toHaveBeenCalledWith({
      scan_id: 'scan1', surface: 'floor', criteria_id: 'cr1', kind: 'flatness', status: 'queued', created_by: 'u1',
    });
    expect(rpc).toHaveBeenCalledWith('fn_enqueue_job', { p_type: 'import', p_payload: { analysis_id: 'analysis1' } });
  });
});

describe('UploadForm 실패 경로·업로드 중 잠금 (T6 변이 보강)', () => {
  it.each([
    ['오류 객체가 있으면 그 메시지를', { data: null, error: { message: '삽입 거부' } }, '삽입 거부'],
    ['오류도 행도 없으면 기본 문구를', { data: null, error: null }, '스캔 등록 실패'],
  ] as const)('scans insert 가 실패하면 %s 보이고 저장소·잡·이동 없이 버튼을 다시 연다', async (_l, scansInsertResult, text) => {
    const storageUpload = vi.fn();
    const rpc = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { scansInsertResult, storageUpload, rpc }) as never);
    const { container } = await readyForm();
    pickFile('scan.ply');
    submitForm(container);

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(storageUpload).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('fn_enqueue_job', expect.anything());
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '업로드 후 사전 검사' })).toBeEnabled();
  });

  it.each([
    ['Error 면 그 메시지를', { storageError: new Error('버킷 없음') }, '파일 업로드에 실패했습니다: 버킷 없음'],
    ['Error 가 아닌 값이면 기본 문구를', { storageThrows: 'boom' }, '업로드에 실패했습니다'],
  ] as const)('저장소 업로드가 실패하면 %s 보이고 raw 경로 반영·잡 등록·이동을 하지 않는다', async (_l, spies, text) => {
    const scansUpdate = vi.fn();
    const rpc = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { ...spies, scansUpdate, rpc }) as never);
    const { container } = await readyForm();
    pickFile('scan.ply');
    submitForm(container);

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(scansUpdate).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith('fn_enqueue_job', expect.anything());
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '업로드 후 사전 검사' })).toBeEnabled();
  });

  it('raw_file_path 반영이 실패하면 그 오류를 보이고 잡을 걸지 않는다', async () => {
    const rpc = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase(null, { rawPathError: { message: '경로 반영 실패' }, rpc }) as never);
    const { container } = await readyForm();
    pickFile('scan.ply');
    submitForm(container);

    expect(await screen.findByText('경로 반영 실패')).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith('fn_enqueue_job', expect.anything());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it.each([
    ['오류 메시지가 있으면 그 메시지로', { data: null, error: { message: '분석 거부' } }, /분석 거부/],
    ['오류도 행도 없으면 기본 문구로', { data: null, error: null }, /분석 등록 실패/],
  ] as const)('임포트 모드: 분석 행 insert 가 실패하면 %s 알리고 스캔을 되돌리며 잡을 걸지 않는다', async (_l, analysesInsertResult, text) => {
    const scansUpdate = vi.fn();
    const scansUpdateEq = vi.fn();
    const rpc = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase(null, { analysesInsertResult, scansUpdate, scansUpdateEq, rpc }) as never);
    const { container } = await readyForm();
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    pickFile('result.csv', /결과 파일 \(csv\/json\)/);
    submitForm(container);

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByText(/다시 시도하세요/)).toBeInTheDocument();
    expect(scansUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(scansUpdateEq).toHaveBeenLastCalledWith('id', 'scan1');
    expect(rpc).not.toHaveBeenCalledWith('fn_enqueue_job', expect.anything());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('임포트 엔큐 실패: 되돌림은 방금 만든 분석 행과 스캔 행을 id 로 짚어 지운다', async () => {
    const analysesUpdateEq = vi.fn();
    const scansUpdateEq = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ code: '23505', message: 'dup' }, { analysesUpdateEq, scansUpdateEq }) as never);
    const { container } = await readyForm();
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    pickFile('result.csv', /결과 파일 \(csv\/json\)/);
    submitForm(container);

    await screen.findByText(new RegExp(DUPLICATE_JOB_MESSAGE));
    expect(analysesUpdateEq).toHaveBeenCalledWith('id', 'analysis1');
    expect(scansUpdateEq).toHaveBeenLastCalledWith('id', 'scan1');
  });

  it('스캔 엔큐 실패: 되돌린 스캔 행을 id 로 짚고, 제출 버튼은 다시 열려 재시도할 수 있다', async () => {
    const scansUpdateEq = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ code: '23505', message: 'dup' }, { scansUpdateEq }) as never);
    const { container } = await readyForm();
    pickFile('scan.ply');
    submitForm(container);

    await screen.findByText(new RegExp(DUPLICATE_JOB_MESSAGE));
    expect(scansUpdateEq).toHaveBeenLastCalledWith('id', 'scan1');
    expect(screen.getByRole('button', { name: '업로드 후 사전 검사' })).toBeEnabled();
  });

  it('업로드하는 동안 제출 버튼은 "업로드 중..."으로 잠기고, 끝나면 스캔 작업대로 간다', async () => {
    let release!: () => void;
    const scansInsertGate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { scansInsertGate }) as never);
    const { container } = await readyForm();
    pickFile('scan.ply');
    submitForm(container);

    const busyButton = await screen.findByRole('button', { name: '업로드 중...' });
    expect(busyButton).toBeDisabled();
    expect(pushMock).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
  });
});

describe('UploadForm 적용 기준 (T6 변이 보강)', () => {
  const crit = (id: string, name: string, over: Partial<CriteriaRow> = {}): CriteriaRow =>
    ({ ...criteria, id, name, source_text: `${name} 근거`, is_default: false, ...over });
  const rowOf = (name: string) => screen.getByText(name).closest('label')!;

  it('기본 기준 줄이 미리 골라지고 (기본)·(현장 기준) 표시와 선택 강조는 해당 줄에만 붙는다', async () => {
    const rows = [crit('crA', 'floor-a'), crit('crB', 'floor-b', { is_default: true }), crit('crC', 'floor-c', { site_id: 's1' })];
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { criteriaResult: { data: rows, error: null } }) as never);
    renderForm();
    await screen.findByText('floor-b');

    expect(within(rowOf('floor-b')).getByRole('radio')).toBeChecked();
    expect(within(rowOf('floor-a')).getByRole('radio')).not.toBeChecked();
    expect(within(rowOf('floor-b')).getByText('(기본)')).toBeInTheDocument();
    expect(within(rowOf('floor-a')).queryByText('(기본)')).toBeNull();
    expect(within(rowOf('floor-c')).getByText('(현장 기준)')).toBeInTheDocument();
    expect(within(rowOf('floor-a')).queryByText('(현장 기준)')).toBeNull();
    expect(rowOf('floor-b').className).toContain('bg-surface-2');
    expect(rowOf('floor-a').className).not.toContain('bg-surface-2');
    expect(rowOf('floor-c').className).not.toContain('bg-surface-2');
  });

  it('다른 줄을 누르면 선택 강조가 그 줄로 옮겨 가고 저장되는 기준도 바뀐다', async () => {
    const scansInsert = vi.fn();
    const rows = [crit('crA', 'floor-a', { is_default: true }), crit('crB', 'floor-b')];
    vi.mocked(createClient).mockReturnValue(
      stubSupabase(null, { criteriaResult: { data: rows, error: null }, scansInsert }) as never);
    const { container } = renderForm({ initialLocationId: 'l1' });
    await screen.findByText('floor-a');

    fireEvent.click(within(rowOf('floor-b')).getByRole('radio'));
    expect(within(rowOf('floor-b')).getByRole('radio')).toBeChecked();
    expect(within(rowOf('floor-a')).getByRole('radio')).not.toBeChecked();
    expect(rowOf('floor-b').className).toContain('border-l-ink');
    expect(rowOf('floor-a').className).not.toContain('border-l-ink');

    pickFile('scan.ply');
    submitForm(container);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
    expect(scansInsert).toHaveBeenCalledWith(expect.objectContaining({ selected_criteria_id: 'crB' }));
  });

  it('기본 기준이 없으면 첫 줄이 미리 골라진다', async () => {
    const rows = [crit('crA', 'floor-a'), crit('crB', 'floor-b')];
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { criteriaResult: { data: rows, error: null } }) as never);
    renderForm();
    await screen.findByText('floor-a');

    expect(within(rowOf('floor-a')).getByRole('radio')).toBeChecked();
    expect(within(rowOf('floor-b')).getByRole('radio')).not.toBeChecked();
  });

  it('data 도 error 도 없는 응답이면 불러오지 못했다고 적는다', async () => {
    vi.mocked(createClient).mockReturnValue(
      stubSupabase(null, { criteriaResult: { data: null, error: null } }) as never);
    renderForm();
    expect(await screen.findByText('적용 기준을 불러오지 못했습니다.')).toBeInTheDocument();
  });

  it('불러오는 동안 "적용 기준을 불러오는 중..."이 보이고 목록이 오면 사라진다', async () => {
    renderForm();
    expect(screen.getByText('적용 기준을 불러오는 중...')).toBeInTheDocument();
    await screen.findByText('floor-kcs');
    expect(screen.queryByText('적용 기준을 불러오는 중...')).toBeNull();
  });

  it('표면을 바꿔 다시 불러온 결과가 오류면 옛 목록과 선택을 치우고, 선택 없이는 제출하지 못한다', async () => {
    const scansInsert = vi.fn();
    const criteriaResult = (p: { p_surface: string }) => (p.p_surface === 'wall'
      ? { data: null, error: { message: 'wall 거부' } }
      : { data: [criteria], error: null });
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { criteriaResult, scansInsert }) as never);
    const { container } = renderForm({ initialLocationId: 'l1' });
    await screen.findByText('floor-kcs');
    fireEvent.click(screen.getByLabelText('벽면'));

    expect(await screen.findByText('적용 기준을 불러오지 못했습니다: wall 거부')).toBeInTheDocument();
    expect(screen.queryByText('floor-kcs')).toBeNull();
    pickFile('scan.ply');
    submitForm(container);
    expect(screen.getByText('적용 기준을 선택하세요.')).toBeInTheDocument();
    expect(scansInsert).not.toHaveBeenCalled();
  });

  // 최종 리뷰: 다시 불러오는 동안 옛 목록과 선택이 남아 있으면, 그 사이 제출이 surface='wall' 에 바닥 기준(cr1)을 붙여 저장했다.
  it('표면을 바꿔 다시 불러오는 동안에는 옛 목록·선택을 치우고 불러오는 중이라 적어, 그 사이 제출해도 저장하지 않는다', async () => {
    const scansInsert = vi.fn();
    // 바닥 기준은 바로 오고, 벽면 기준 응답은 끝내 오지 않는다(다시 불러오는 사이를 붙잡아 둔다)
    const criteriaResult = (p: { p_surface: string }) => (p.p_surface === 'wall'
      ? new Promise<StubResult>(() => {})
      : { data: [criteria], error: null });
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { criteriaResult, scansInsert }) as never);
    const { container } = renderForm({ initialLocationId: 'l1' });
    await screen.findByText('floor-kcs');
    fireEvent.click(screen.getByLabelText('벽면'));
    pickFile('scan.ply');
    submitForm(container);

    expect(scansInsert).not.toHaveBeenCalled();
    expect(screen.getByText('적용 기준을 선택하세요.')).toBeInTheDocument();
    expect(screen.getByText('적용 기준을 불러오는 중...')).toBeInTheDocument();
    expect(screen.queryByText('floor-kcs')).toBeNull();
  });

  it('늦게 도착한 옛 응답은 새 응답을 덮지 않는다', async () => {
    const pending: Record<string, (r: StubResult) => void> = {};
    const criteriaResult = (p: { p_surface: string }) =>
      new Promise<StubResult>((resolve) => { pending[p.p_surface] = resolve; });
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { criteriaResult }) as never);
    renderForm({ initialLocationId: 'l1' });
    // 바닥 응답이 오기 전에 벽면으로 바꾼다
    fireEvent.click(screen.getByLabelText('벽면'));
    await act(async () => { pending.wall({ data: [{ ...criteria, id: 'crW', name: 'wall-kcs' }], error: null }); });
    expect(await screen.findByText('wall-kcs')).toBeInTheDocument();

    // 바닥 응답이 뒤늦게 도착해도 화면은 벽면 기준 그대로다
    await act(async () => { pending.floor({ data: [criteria], error: null }); });
    expect(screen.queryByText('floor-kcs')).toBeNull();
    expect(screen.getByText('wall-kcs')).toBeInTheDocument();
  });
});

describe('UploadForm 제출 가드·형식·칩 (T6 변이 보강)', () => {
  it('스캔 모드에서 지원하지 않는 확장자는 스캔용 안내로 바로 거부한다', async () => {
    const scansInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { scansInsert }) as never);
    const { container } = await readyForm();
    pickFile('scan.exe');
    submitForm(container);

    expect(screen.getByText('지원 포맷: ply, las, laz, xyz, txt, csv, pts')).toBeInTheDocument();
    expect(scansInsert).not.toHaveBeenCalled();
  });

  it('용량 상한을 넘는 파일은 저장소에 닿기 전에 거부하고, 상한과 같은 파일은 올린다', async () => {
    const scansInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { scansInsert }) as never);
    const { container } = await readyForm();
    const sized = (bytes: number) => {
      const f = new File(['x'], 'scan.ply');
      Object.defineProperty(f, 'size', { value: bytes });
      return f;
    };

    fireEvent.change(screen.getByLabelText(/스캔 파일/), { target: { files: [sized(MAX_UPLOAD_BYTES + 1)] } });
    submitForm(container);
    expect(screen.getByText(`파일이 너무 큽니다(최대 ${MAX_UPLOAD_MB}MB). 스캔 범위를 나눠 다시 시도하세요.`))
      .toBeInTheDocument();
    expect(scansInsert).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/스캔 파일/), { target: { files: [sized(MAX_UPLOAD_BYTES)] } });
    submitForm(container);
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/scans/scan1'));
    expect(scansInsert).toHaveBeenCalledTimes(1);
  });

  it('측정위치를 고르지 않으면 제출하지 않고 안내한다', async () => {
    const scansInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, { scansInsert }) as never);
    const { container } = await readyForm({});
    pickFile('scan.ply');
    submitForm(container);

    expect(screen.getByText('측정위치를 선택하세요.')).toBeInTheDocument();
    expect(scansInsert).not.toHaveBeenCalled();
  });

  it('쓸 수 있는 적용 기준이 없으면 제출하지 않고 안내한다', async () => {
    const scansInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase(null, { scansInsert, criteriaResult: { data: [], error: null } }) as never);
    const { container } = await readyForm();
    expect(screen.getByText('이 현장에 쓸 수 있는 적용 기준이 없습니다.')).toBeInTheDocument();
    pickFile('scan.ply');
    submitForm(container);

    expect(screen.getByText('적용 기준을 선택하세요.')).toBeInTheDocument();
    expect(scansInsert).not.toHaveBeenCalled();
  });

  it('제출 이벤트의 기본 동작(페이지 이동)을 막는다', async () => {
    const { container } = await readyForm();
    expect(submitForm(container)).toBe(false);
  });

  it('임포트 모드의 제출 버튼은 "가져오기 시작"이다', async () => {
    renderForm();
    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    expect(screen.getByRole('button', { name: '가져오기 시작' })).toHaveAttribute('type', 'submit');
    await settle();
  });

  it('표면 유형·데이터 계보 칩은 고른 칩만 강조되고, 눌러서 선택이 옮겨 간다', async () => {
    renderForm();
    const lit = (label: string) => screen.getByLabelText(label).closest('label')!.className.includes('bg-surface-2');
    expect(lit('바닥')).toBe(true);
    expect(lit('벽면')).toBe(false);
    expect(lit('모름')).toBe(true);
    expect(lit('원시 점군')).toBe(false);

    fireEvent.click(screen.getByLabelText('벽면'));
    expect(screen.getByLabelText('벽면')).toBeChecked();
    expect(screen.getByLabelText('바닥')).not.toBeChecked();
    expect(lit('벽면')).toBe(true);
    expect(lit('바닥')).toBe(false);

    fireEvent.click(screen.getByLabelText('원시 점군'));
    expect(screen.getByLabelText('원시 점군')).toBeChecked();
    expect(lit('원시 점군')).toBe(true);
    expect(lit('모름')).toBe(false);
    await settle();
  });

  it('라디오는 모두 네이티브 + accent(accent-ink)다: 업로드 방식·표면 유형·데이터 계보·적용 기준', async () => {
    renderForm();
    for (const label of ['스캔 분석', '기존 결과 가져오기(CSV/JSON)', '바닥', '벽면', '원시 점군', '융합 메시', '모름']) {
      expect(screen.getByLabelText(label).className).toContain('accent-ink');
    }
    const criteriaRadio = within((await screen.findByText('floor-kcs')).closest('label')!).getByRole('radio');
    expect(criteriaRadio.className).toContain('accent-ink');
  });

  it('아트보드의 작은 구성: 적용 기준 묶음 이름, 새 측정위치의 plus·파일 선택 모양의 upload 아이콘, 어두운 달력 색', async () => {
    renderForm();
    const code = await screen.findByText('floor-kcs');
    expect(screen.getByRole('group', { name: '적용 기준' })).toContainElement(code);
    expect(screen.getByRole('button', { name: '새 측정위치' }).querySelector('[data-icon="plus"]')).not.toBeNull();
    expect(screen.getByText('파일 선택').querySelector('[data-icon="upload"]')).not.toBeNull();
    // 날짜 선택창이 밝은 색으로 뜨지 않게 하는 color-scheme(아트보드 입력칸)
    expect(screen.getByLabelText('측정일자').className).toContain('[color-scheme:dark]');
  });

  it('현장 고르기는 어떤 이름으로도 없다: select 는 필수 입력인 측정위치 하나뿐이다', async () => {
    const { container } = renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));

    const selects = container.querySelectorAll('select');
    expect(selects).toHaveLength(1);
    expect(selects[0].id).toBe('location');
    expect(selects[0]).toBeRequired();
    await settle();
  });

  it('입력칸: 측정일자는 필수이고 장비 칸에 예시 placeholder 가 있으며, 용량 안내는 저장 위치와 최대 용량을 말한다', async () => {
    renderForm();
    expect(screen.getByLabelText('측정일자')).toBeRequired();
    expect(screen.getByLabelText('장비')).toHaveAttribute('placeholder', '예: iPhone 15 Pro + 3d Scanner App');
    expect(screen.getByText(/파일은 Supabase Storage에 저장됩니다/))
      .toHaveTextContent(`파일은 Supabase Storage에 저장됩니다. 파일당 최대 ${MAX_UPLOAD_MB}MB입니다.`);
    await settle();
  });
});

describe('UploadForm 새 측정위치 (T6 변이 보강)', () => {
  it('미니폼의 Enter 는 기본 동작(상위 폼 암묵 제출)을 막고, 다른 키는 아무 일도 하지 않는다', async () => {
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubLocationInsert(locationsInsert) as never);
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));
    const name = screen.getByLabelText('이름');
    fireEvent.change(name, { target: { value: '2층' } });

    expect(fireEvent.keyDown(name, { key: 'a', code: 'KeyA' })).toBe(true);
    expect(locationsInsert).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(name, { key: 'Enter', code: 'Enter' })).toBe(false);
    await waitFor(() => expect(locationsInsert).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByLabelText('측정위치') as HTMLSelectElement).value).toBe('l2'));
  });

  it('저장하는 동안 저장 버튼은 "저장 중..."으로 잠기고 Enter 를 또 눌러도 한 번만 저장한다', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubLocationInsert(locationsInsert, () => gate.then(() => ({ data: { id: 'l2' }, error: null }))) as never);
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));
    const name = screen.getByLabelText('이름');
    fireEvent.change(name, { target: { value: '2층' } });
    fireEvent.keyDown(name, { key: 'Enter' });

    const saving = await screen.findByRole('button', { name: '저장 중...' });
    expect(saving).toBeDisabled();
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.click(saving);
    expect(locationsInsert).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect((screen.getByLabelText('측정위치') as HTMLSelectElement).value).toBe('l2'));
  });

  it('저장이 실패해도 잠금이 풀리고, 다음에 성공하면 패널이 닫히며 다시 열면 앞의 오류와 입력이 남아 있지 않다', async () => {
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubLocationInsert(locationsInsert, (call) => (call === 1
      ? { data: null, error: { code: '23505', message: 'dup' } }
      : { data: { id: 'l2' }, error: null })) as never);
    renderForm();
    const toggle = screen.getByRole('button', { name: '새 측정위치' });
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '1층' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByText('같은 동/층/공간에 동일한 측정위치가 이미 있습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled();

    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '2층' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect((screen.getByLabelText('측정위치') as HTMLSelectElement).value).toBe('l2'));
    expect(locationsInsert).toHaveBeenCalledTimes(2);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('이름')).toHaveValue('');
  });

  it.each([
    ['오류 메시지가 있으면 그 메시지를', { data: null, error: { message: '권한 없음' } }, '권한 없음'],
    ['오류 정보도 없으면 기본 문구를', { data: null, error: null }, '측정위치 저장 실패'],
  ] as const)('저장이 실패하면 %s 알린다', async (_l, result, text) => {
    vi.mocked(createClient).mockReturnValue(stubLocationInsert(vi.fn(), result) as never);
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '1층' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(text);
    await settle();
  });

  it('동·층·공간·이름 네 칸 모두 앞뒤 공백을 지워 저장하고, 새 위치는 "동 / 층 / 공간 / 이름" 글자로 목록에 들어간다', async () => {
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubLocationInsert(locationsInsert) as never);
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));
    fireEvent.change(screen.getByLabelText('동'), { target: { value: ' 101동 ' } });
    fireEvent.change(screen.getByLabelText('층'), { target: { value: ' 3층 ' } });
    fireEvent.change(screen.getByLabelText('공간'), { target: { value: ' 301호 ' } });
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: ' 거실 ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(locationsInsert).toHaveBeenCalledWith({
      site_id: 's1', building: '101동', floor: '3층', floor_order: 0, room: '301호', name: '거실',
    }));
    const select = screen.getByLabelText('측정위치') as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe('l2'));
    expect(Array.from(select.options).map((o) => o.textContent)).toContain('101동 / 3층 / 301호 / 거실');
  });

  it('이름이 공백뿐이면 저장하지 않고 안내한다', async () => {
    const locationsInsert = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubLocationInsert(locationsInsert) as never);
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));
    fireEvent.change(screen.getByLabelText('이름'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    expect(screen.getByRole('alert')).toHaveTextContent('측정위치명을 입력하세요.');
    expect(locationsInsert).not.toHaveBeenCalled();
    await settle();
  });

  it('취소는 패널을 닫고, 토글을 다시 누르면 패널이 닫힌다', async () => {
    renderForm();
    const toggle = screen.getByRole('button', { name: '새 측정위치' });
    fireEvent.click(toggle);
    expect(screen.getByLabelText('이름')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByLabelText('이름')).toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByLabelText('이름')).toBeNull();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await settle();
  });

  it('폼 안의 보조 버튼(새 측정위치·저장·취소·선택한 파일 빼기)은 모두 type=button 이라 업로드 제출을 일으키지 않는다', async () => {
    const { container } = renderForm();
    pickFile('scan.ply');
    fireEvent.click(screen.getByRole('button', { name: '새 측정위치' }));

    for (const name of ['새 측정위치', '저장', '취소', '선택한 파일 빼기']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('type', 'button');
    }
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(1);
    await settle();
  });
});

describe('UploadForm 파일 상자 (T6 변이 보강)', () => {
  it('고른 파일 줄은 문서 아이콘 + 이름이고, 빼기 버튼은 X 아이콘이며 눌러 파일 입력값까지 비운다', async () => {
    renderForm();
    const input = screen.getByLabelText(/스캔 파일/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'scan_101_301.ply')] } });
    // 브라우저의 파일 입력은 파일을 고르면 value 가 가짜 경로가 된다. jsdom 은 그걸 흉내내지 않으니 직접 심어 둔다.
    Object.defineProperty(input, 'value', { configurable: true, writable: true, value: 'C:\\fakepath\\scan_101_301.ply' });

    const row = screen.getByText('scan_101_301.ply').closest('div')!;
    expect(row.querySelector('[data-icon="file"]')).not.toBeNull();
    const remove = screen.getByRole('button', { name: '선택한 파일 빼기' });
    expect(remove.querySelector('[data-icon="x"]')).not.toBeNull();

    fireEvent.click(remove);
    expect(screen.queryByText('scan_101_301.ply')).toBeNull();
    expect(input.value).toBe('');
    await settle();
  });

  it('투명 파일 입력이 키보드 포커스를 받으면 점선 상자에 외곽선이 보인다(has-[:focus-visible])', async () => {
    renderForm();
    // 보이지 않는 입력이 포커스를 받으므로 전역 :focus-visible 이 아니라 감싼 상자가 외곽선을 그린다
    const box = screen.getByLabelText(/스캔 파일/).parentElement!;
    expect(box.className).toContain('has-[:focus-visible]:outline-2');
    expect(box.className).toContain('has-[:focus-visible]:outline-offset-2');
    expect(box.className).toContain('has-[:focus-visible]:outline-ink');
    await settle();
  });
});
