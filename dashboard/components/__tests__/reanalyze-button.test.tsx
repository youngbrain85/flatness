import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const { pushMock, refreshMock } = vi.hoisted(() => ({ pushMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { ReanalyzeButton } from '../reanalyze-button';
// T6 리뷰 수정 1차: 구배 기준 라디오는 아트보드대로 컨테이너 '본문'으로 옮겼다
// (ScanDone.dc.html 172-205 - 헤더에는 버튼만). 라디오와 버튼이 같은 상태를 공유하므로
// 그 배치는 SlopeAnalysisContainer가 맡는다(로직은 useReanalyze 그대로 - 중복 없음).
// 아래 구배 describe들은 렌더 대상만 그 컴포넌트로 바꿨고 단언은 한 줄도 바꾸지 않았다.
import { SlopeAnalysisContainer } from '../slope-analysis-container';
import { DUPLICATE_JOB_MESSAGE } from '@/lib/domain/jobs';
import type { CriteriaRow } from '@/lib/domain/types';

// unit-confirm-form과 동일한 형태의 로컬 스텁(insert().select().single() 체인 +
// fn_enqueue_job rpc). rpcSpy/updateSpy로 실제 호출 인자를 검증한다
// (C1: 잡 타입 분기, I1: 엔큐 실패 시 고아 행 롤백).
function stubSupabase(
  enqueueError: { code?: string; message: string } | null,
  rpcSpy: (fn: string, params: unknown) => void = () => {},
  updateSpy: (fields: unknown) => void = () => {},
) {
  return {
    from: (table: string) => {
      if (table === 'analyses') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'a2' }, error: null }) }) }),
          update: (fields: unknown) => {
            updateSpy(fields);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    rpc: async (fn: string, params: unknown) => {
      rpcSpy(fn, params);
      if (fn === 'fn_enqueue_job') return { error: enqueueError };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

// 단계 C: kind='flatness'를 명시해야 하는 구간이라 버튼 문구가 '다시 분석'에서
// '평활도 분석'으로 바뀌었다(ANALYSIS_KIND_LABEL[kind] + ' 분석' - reanalyze-button.tsx).
describe('ReanalyzeButton (C5: 스캔 상세 다시 분석, 단계 C: kind 인지형으로 일반화)', () => {
  it('직전 분석이 done이면 버튼이 활성 상태다', () => {
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness" criteriaId="cr1"
      latestStatus="done" isImport={false} />);
    expect(screen.getByRole('button', { name: '평활도 분석' })).toBeEnabled();
  });

  it('직전 분석이 진행 중(queued/processing)이면 버튼이 비활성화되고 안내가 보인다', () => {
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness" criteriaId="cr1"
      latestStatus="processing" isImport={false} />);
    expect(screen.getByRole('button', { name: '평활도 분석' })).toBeDisabled();
    expect(screen.getByText(/진행 중인 분석이 끝난 뒤/)).toBeInTheDocument();
  });

  it('직전 분석이 없으면(latestStatus 미지정) 첫 분석으로 취급해 버튼이 활성 상태다', () => {
    // 단계 C: 구배처럼 이 종류의 분석이 한 번도 없었던 경우를 흉내낸다.
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness" criteriaId="cr1"
      isImport={false} />);
    expect(screen.getByRole('button', { name: '평활도 분석' })).toBeEnabled();
  });

  it('클릭 시 kind를 실은 새 분석 행 생성 + analyze 잡 등록 후 새로고침한다', async () => {
    const rpcSpy = vi.fn();
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      from: (table: string) => {
        if (table === 'analyses') {
          return {
            insert: (fields: unknown) => {
              insertSpy(fields);
              return { select: () => ({ single: async () => ({ data: { id: 'a2' }, error: null }) }) };
            },
          };
        }
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
      rpc: async (fn: string, params: unknown) => {
        rpcSpy(fn, params);
        return { error: null };
      },
    } as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness" criteriaId="cr1"
      latestStatus="done" isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: '평활도 분석' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // 회귀 차단: insert에 kind가 빠지면 DB 기본값('flatness')에 조용히 기대게 된다
    // (스텁이 insert 인자를 무시하던 옛 방식으로는 이 회귀를 못 잡는다).
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'flatness', criteria_id: 'cr1', scan_id: 's1' }));
    expect(rpcSpy).toHaveBeenCalledWith('fn_enqueue_job', { p_type: 'analyze', p_payload: { analysis_id: 'a2' } });
  });

  it('중복 엔큐(409)면 안내 메시지를 남기고 새로고침하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ code: '23505', message: 'dup' }) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness" criteriaId="cr1"
      latestStatus="done" isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: '평활도 분석' }));
    expect(await screen.findByText(DUPLICATE_JOB_MESSAGE)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('C1(회귀): 임포트 결과 스캔(isImport=true)은 analyze가 아니라 import 잡을 건다', async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, rpcSpy) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness" criteriaId="cr1"
      latestStatus="done" isImport={true} />);
    fireEvent.click(screen.getByRole('button', { name: '평활도 분석' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(rpcSpy).toHaveBeenCalledWith('fn_enqueue_job', { p_type: 'import', p_payload: { analysis_id: 'a2' } });
  });

  it('C1(회귀): 일반(LiDAR) 스캔(isImport=false)은 analyze 잡을 건다', async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, rpcSpy) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness" criteriaId="cr1"
      latestStatus="done" isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: '평활도 분석' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(rpcSpy).toHaveBeenCalledWith('fn_enqueue_job', { p_type: 'analyze', p_payload: { analysis_id: 'a2' } });
  });

  it('I1: 엔큐 실패 시 방금 만든 analyses 행을 soft delete로 되돌린다(고아 행 방지)', async () => {
    const updateSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(
      stubSupabase({ message: '전송 오류로 등록 실패' }, undefined, updateSpy) as never,
    );
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness" criteriaId="cr1"
      latestStatus="done" isImport={false} />);
    fireEvent.click(screen.getByRole('button', { name: '평활도 분석' }));
    await screen.findByText(/전송 오류로 등록 실패/);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

// 007_slope_analysis.sql:118-133의 5개 구배 기준을 그대로 옮긴 픽스처.
// slope-indoor-level만 is_default=true이고 방향 비대상(design_pct=0, dir_pass_deg=180)이다.
const slopeCriteriaRows: CriteriaRow[] = [
  {
    id: 'c-roof-exposed', site_id: null, surface: 'floor', name: 'slope-roof-exposed',
    source_text: 'KCS 41 40 01 방수공사일반 §3.1.3(1) 노출방수', is_default: false, is_active: true,
    version: 1, supersedes_id: null, created_at: '', kind: 'slope',
    thresholds: [{ use: '옥상 슬래브(노출방수)', design_pct: 3.5, pass_pct: 1.5, re_pct: 4.5, dir_pass_deg: 30 }] as never,
  },
  {
    id: 'c-bathroom', site_id: null, surface: 'floor', name: 'slope-bathroom',
    source_text: 'KCS 41 48 01 타일공사', is_default: false, is_active: true,
    version: 1, supersedes_id: null, created_at: '', kind: 'slope',
    thresholds: [{ use: '욕실·화장실 바닥', design_pct: 0.5, pass_pct: 0.5, re_pct: 1.5, dir_pass_deg: 30 }] as never,
  },
  {
    id: 'c-indoor-level', site_id: null, surface: 'floor', name: 'slope-indoor-level',
    source_text: '설계 구배 0%(의도적 구배 없음)', is_default: true, is_active: true,
    version: 1, supersedes_id: null, created_at: '', kind: 'slope',
    thresholds: [{ use: '실내 평바닥', design_pct: 0.0, pass_pct: 1.0, re_pct: 3.0, dir_pass_deg: 180 }] as never,
  },
];

function stubSupabaseSlope(
  criteriaRows: CriteriaRow[] | null,
  enqueueError: { code?: string; message: string } | null = null,
  rpcSpy: (fn: string, params: unknown) => void = () => {},
  insertSpy: (fields: unknown) => void = () => {},
) {
  return {
    from: (table: string) => {
      if (table === 'analyses') {
        return {
          insert: (fields: unknown) => {
            insertSpy(fields);
            return { select: () => ({ single: async () => ({ data: { id: 'a2' }, error: null }) }) };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    rpc: async (fn: string, params: unknown) => {
      rpcSpy(fn, params);
      if (fn === 'fn_resolve_criteria') {
        return criteriaRows === null ? { data: null, error: { message: 'RPC 오류' } } : { data: criteriaRows, error: null };
      }
      if (fn === 'fn_enqueue_job') return { error: enqueueError };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

// ★ 코드리뷰(4차) N1(Blocker): 예전에는 rows[0](=is_default)을 무조건 썼는데,
// 007의 유일한 is_default 구배 기준(slope-indoor-level)이 방향 비대상이라
// 대시보드로는 다른 기준을 절대 못 골랐다 - 배수구 클릭 -> slope_judge 잡으로
// 이어지는 단계 D 전체 경로가 UI로 도달 불가능했다. 이 describe가 그 수정을 고정한다.
describe('ReanalyzeButton kind=slope 기준 선택 (코드리뷰(4차) N1)', () => {
  it('마운트 시 후보 기준을 불러와 라디오 목록으로 보여주고, is_default를 기본 선택으로 둔다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabaseSlope(slopeCriteriaRows) as never);
    render(<SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton />);

    await waitFor(() => expect(screen.getByText('옥상 슬래브(노출방수)')).toBeInTheDocument());
    expect(screen.getByText('욕실·화장실 바닥')).toBeInTheDocument();
    expect(screen.getByText('실내 평바닥')).toBeInTheDocument();

    // is_default(slope-indoor-level = "실내 평바닥")가 기본 선택이어야 한다.
    const indoorRadio = screen.getByText('실내 평바닥').closest('label')!.querySelector('input')!;
    expect(indoorRadio).toBeChecked();
  });

  it('방향 비대상 기준에는 "방향 판정 안 함" 힌트를 보여준다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabaseSlope(slopeCriteriaRows) as never);
    render(<SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton />);
    await waitFor(() => expect(screen.getByText('실내 평바닥')).toBeInTheDocument());
    expect(screen.getByText(/방향 판정 안 함/)).toBeInTheDocument();
  });

  it('사용자가 다른 기준을 선택하면 그 기준으로 분석을 시작한다(rows[0] 고정 아님)', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabaseSlope(slopeCriteriaRows, null, () => {}, insertSpy) as never);
    render(<SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton />);
    await waitFor(() => expect(screen.getByText('옥상 슬래브(노출방수)')).toBeInTheDocument());

    // 기본 선택(실내 평바닥, 방향 비대상)이 아니라 방향 판정이 되는 기준으로 바꾼다.
    const roofRadio = screen.getByText('옥상 슬래브(노출방수)').closest('label')!.querySelector('input')!;
    fireEvent.click(roofRadio);

    fireEvent.click(screen.getByRole('button', { name: '구배 분석' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // rows[0]이 아니라 사용자가 고른 c-roof-exposed가 실려야 한다.
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ criteria_id: 'c-roof-exposed' }));
  });

  it('기본 선택 그대로 시작하면 is_default 기준(c-indoor-level)이 실린다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabaseSlope(slopeCriteriaRows, null, () => {}, insertSpy) as never);
    render(<SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton />);
    await waitFor(() => expect(screen.getByText('실내 평바닥')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '구배 분석' }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ criteria_id: 'c-indoor-level' }));
  });

  it('후보 기준을 못 찾으면(마이그레이션 007 미적용 등) 오류를 보여주고 버튼을 비활성화한다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabaseSlope([]) as never);
    render(<SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton />);
    await waitFor(() => {
      expect(screen.getByText(/구배 판정 기준을 찾을 수 없습니다/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '구배 분석' })).toBeDisabled();
  });

  it('후보가 로딩되기 전에는 버튼이 비활성 상태다(빈 criteria_id로 분석을 시작하지 않음)', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabaseSlope(slopeCriteriaRows) as never);
    render(<SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton />);
    // 비동기 useEffect가 아직 안 끝난 첫 렌더 시점.
    expect(screen.getByRole('button', { name: '구배 분석' })).toBeDisabled();
  });
});

// T6 Cloudscape 재스킨: 버튼은 normal 알약(진행 중이면 cs-disabled 보더), 구배 기준 라디오는
// FormField 안 네이티브 라디오(checkClass)이고 순서는 RPC 반환 순서 그대로다(재정렬 금지).
describe('ReanalyzeButton Cloudscape 재스킨 (T6)', () => {
  it('활성 버튼은 normal(cs-link 보더), 진행 중이면 disabled(cs-disabled 보더)다', () => {
    const { rerender } = render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness"
      criteriaId="cr1" latestStatus="done" isImport={false} />);
    expect(screen.getByRole('button', { name: '평활도 분석' }).className).toContain('border-cs-link');

    rerender(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness"
      criteriaId="cr1" latestStatus="processing" isImport={false} />);
    const btn = screen.getByRole('button', { name: '평활도 분석' });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('border-cs-disabled');
    expect(screen.getByText(/진행 중인 분석이 끝난 뒤/).className).toContain('text-cs-text-secondary');
  });

  it('구배 기준 라디오는 checkClass를 쓰고 RPC 반환 순서를 그대로 유지한다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabaseSlope(slopeCriteriaRows) as never);
    render(<SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton />);
    await waitFor(() => expect(screen.getByText('실내 평바닥')).toBeInTheDocument());

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0].className).toContain('accent-cs-link');
    // 픽스처 순서(옥상 → 욕실 → 실내) 그대로 - is_default(실내)를 앞으로 끌어올리지 않는다.
    const names = radios.map((r) => r.closest('label')?.querySelector('span > span')?.textContent);
    expect(names).toEqual(['옥상 슬래브(노출방수)', '욕실·화장실 바닥', '실내 평바닥']);
    expect(screen.getByText('적용 기준').className).toContain('font-bold');
  });
});
