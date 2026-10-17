import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { UploadForm } from '../upload-form';
import { DUPLICATE_JOB_MESSAGE } from '@/lib/domain/jobs';
import { buttonClass } from '@/components/ui/button';
import { inputClass, selectClass } from '@/components/ui/form';
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
    criteriaResult?: { data: unknown; error: { message: string } | null };
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
        return { upload: async (key: string) => { spies.storageUpload?.(key); return { error: null }; } };
      },
    },
    rpc: async (fn: string, params: unknown) => {
      spies.rpc?.(fn, params);
      if (fn === 'fn_resolve_criteria') return spies.criteriaResult ?? { data: [criteria], error: null };
      if (fn === 'fn_enqueue_job') return { error: enqueueError };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

// locations insert 만 받는 스텁(그 자리에서 새 측정위치 만들기). 기준 조회 rpc는 빈 목록으로 답한다 -
// 응답이 없으면 마운트 즉시 도는 기준 조회 이펙트가 unhandled rejection이 된다.
function stubLocationInsert(
  insertSpy: (fields: unknown) => void,
  result: { data: unknown; error: { code?: string; message: string } | null } = { data: { id: 'l2' }, error: null },
  scansInsert?: (fields: unknown) => void,
) {
  return {
    from: (table: string) => {
      if (table === 'locations') {
        return {
          insert: (fields: unknown) => {
            insertSpy(fields);
            return { select: () => ({ single: async () => result }) };
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
