// 단계 C: ReanalyzeButton을 kind 인지형으로 일반화하면서 새로 생긴 구배(kind='slope')
// 경로를 전담해서 검증한다. 평활도 경로의 회귀 테스트는 reanalyze-button.test.tsx에 있다.
//
// 이 파일 전체가 존재하는 이유: 기존 reanalyze-button.test.tsx:24의 스텁은
// insert()를 인자 무시하고 고정 응답만 돌려주는 형태라, insert에 kind를 빠뜨려도
// 스위트가 초록으로 통과했다(단계 C 작업 지시서가 명시적으로 지적한 함정). 여기서는
// insertSpy/rpcSpy로 실제 호출 인자를 관찰한다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { ReanalyzeButton } from '../reanalyze-button';

function stubSupabase(opts: {
  criteriaRows?: { id: string; is_default?: boolean }[];
  criteriaError?: { message: string } | null;
  enqueueError?: { code?: string; message: string } | null;
  rpcSpy?: (fn: string, params: unknown) => void;
  insertSpy?: (fields: unknown) => void;
} = {}) {
  const {
    criteriaRows = [{ id: 'slope-crit-1', is_default: true }],
    criteriaError = null,
    enqueueError = null,
    rpcSpy = () => {},
    insertSpy = () => {},
  } = opts;
  return {
    from: (table: string) => {
      if (table === 'analyses') {
        return {
          insert: (fields: unknown) => {
            insertSpy(fields);
            return { select: () => ({ single: async () => ({ data: { id: 'a1' }, error: null }) }) };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    rpc: async (fn: string, params: unknown) => {
      rpcSpy(fn, params);
      if (fn === 'fn_resolve_criteria') {
        return { data: criteriaError ? null : criteriaRows, error: criteriaError };
      }
      if (fn === 'fn_enqueue_job') return { error: enqueueError };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReanalyzeButton kind=slope (단계 C: 구배 분석 시작)', () => {
  it('버튼 문구가 "구배 분석"이다(kind별 문구 노출)', () => {
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="slope" siteId="site1"
      isImport={false} />);
    expect(screen.getByRole('button', { name: /구배 분석/ })).toBeInTheDocument();
  });

  it('이 종류의 분석이 한 번도 없었어도(latestStatus 미지정) 버튼이 활성 상태다(첫 시작)', () => {
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="slope" siteId="site1"
      isImport={false} />);
    expect(screen.getByRole('button', { name: /구배 분석/ })).toBeEnabled();
  });

  it('구배 버튼은 클릭 시점에 fn_resolve_criteria(site, floor, slope)로 구배 기준을 해석해 쓴다', async () => {
    const rpcSpy = vi.fn();
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ rpcSpy, insertSpy }) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="slope" siteId="site1"
      isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: /구배 분석/ }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());

    // scans.selected_criteria_id(평활도 기준)를 그대로 쓰면 워커가 KeyError로 죽으므로
    // 반드시 p_kind: 'slope'로 새로 해석해야 한다.
    expect(rpcSpy).toHaveBeenCalledWith('fn_resolve_criteria',
      { p_site_id: 'site1', p_surface: 'floor', p_kind: 'slope' });
    // fn_resolve_criteria는 order by is_default desc, name이므로 첫 행이 기본 기준이다.
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'slope', criteria_id: 'slope-crit-1', scan_id: 's1', surface: 'floor' }));
  });

  it('평활도 버튼(kind=flatness)은 기준을 그대로 쓰고 fn_resolve_criteria를 부르지 않는다', async () => {
    const rpcSpy = vi.fn();
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ rpcSpy, insertSpy }) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness" criteriaId="flat-crit-9"
      isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: '평활도 분석' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());

    expect(rpcSpy).not.toHaveBeenCalledWith('fn_resolve_criteria', expect.anything());
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'flatness', criteria_id: 'flat-crit-9' }));
  });

  it('구배 판정 기준이 비어 있으면(마이그레이션 007 미적용 등) 안내를 띄우고 분석 행을 만들지 않는다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ criteriaRows: [], insertSpy }) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="slope" siteId="site1"
      isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: /구배 분석/ }));

    await screen.findByText(/구배 판정 기준을 찾을 수 없습니다/);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
