// 구배 분석 3조각(다크 C안, 아트보드 ScanDone): '구배 분석' 버튼은 페이지 제목 줄(SlopeAnalysisAction),
// '적용 기준' 라디오는 '구배 분석' 카드(SlopeAnalysisCard) 안이고, 둘이 고른 기준을 함께 쓰도록
// SlopeAnalysisScope가 상태를 한 번 만들어 나눠 준다. 이 파일은 배치(제목 줄/카드)와 게이트
// (showButton)·상태 공유만 본다. 구배 기준 선택·잡 등록의 동작 단언은 reanalyze-button.test.tsx의
// 'kind=slope 기준 선택' describe와 analyze-buttons.test.tsx가 같은 조합을 렌더해 지킨다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { SlopeAnalysisAction, SlopeAnalysisCard, SlopeAnalysisScope } from '../slope-analysis-container';
import type { CriteriaRow } from '@/lib/domain/types';

// 007_slope_analysis.sql 시드의 두 행(반환 순서 그대로).
const slopeCriteriaRows: CriteriaRow[] = [
  {
    id: 'c-roof-exposed', site_id: null, surface: 'floor', name: 'slope-roof-exposed',
    source_text: 'KCS 41 40 01', is_default: false, is_active: true,
    version: 1, supersedes_id: null, created_at: '', kind: 'slope',
    thresholds: [{ use: '옥상 슬래브(노출방수)', design_pct: 3.5, pass_pct: 1.5, re_pct: 4.5, dir_pass_deg: 30 }] as never,
  },
  {
    id: 'c-indoor-level', site_id: null, surface: 'floor', name: 'slope-indoor-level',
    source_text: '설계 구배 0%', is_default: true, is_active: true,
    version: 1, supersedes_id: null, created_at: '', kind: 'slope',
    thresholds: [{ use: '실내 평바닥', design_pct: 0.0, pass_pct: 1.0, re_pct: 3.0, dir_pass_deg: 180 }] as never,
  },
];

function stubSupabase(
  rpcSpy: (fn: string, params: unknown) => void = () => {},
  insertSpy: (fields: unknown) => void = () => {},
) {
  return {
    from: (table: string) => {
      if (table === 'analyses') {
        return {
          insert: (fields: unknown) => {
            insertSpy(fields);
            return { select: () => ({ single: async () => ({ data: { id: 'a9' }, error: null }) }) };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
    rpc: async (fn: string, params: unknown) => {
      rpcSpy(fn, params);
      if (fn === 'fn_resolve_criteria') return { data: slopeCriteriaRows, error: null };
      if (fn === 'fn_enqueue_job') return { error: null };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

// 페이지 배치를 흉내낸다: 제목 줄(버튼)과 카드 사이에 다른 내용(결과 구획)이 끼어 있다.
function renderPage(props: { userId?: string; showButton: boolean }, cardChildren?: React.ReactNode) {
  return render(
    <SlopeAnalysisScope scanId="s1" siteId="site1" {...props}>
      <div data-testid="title-row"><SlopeAnalysisAction /></div>
      <p>평활도 결과</p>
      <div data-testid="cards"><SlopeAnalysisCard>{cardChildren}</SlopeAnalysisCard></div>
    </SlopeAnalysisScope>);
}

describe('구배 분석 3조각 배치 (아트보드 ScanDone)', () => {
  it('버튼은 제목 줄에, 적용 기준 라디오는 카드에 있다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    renderPage({ userId: 'u1', showButton: true });
    await waitFor(() => expect(screen.getByText('실내 평바닥')).toBeInTheDocument());

    const titleRow = within(screen.getByTestId('title-row'));
    const cards = within(screen.getByTestId('cards'));
    expect(titleRow.getByRole('button', { name: '구배 분석' })).toBeInTheDocument();
    expect(screen.getByTestId('title-row').querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(cards.getByRole('heading', { name: '구배 분석' })).toBeInTheDocument();
    expect(cards.queryByRole('button', { name: '구배 분석' })).toBeNull();
    expect(cards.getByRole('group', { name: '적용 기준' })).toBeInTheDocument();
    expect(screen.getByTestId('cards').querySelectorAll('input[type="radio"]')).toHaveLength(2);
  });

  it('카드에서 고른 기준으로 제목 줄 버튼이 분석을 시작한다(상태 공유)', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(() => {}, insertSpy) as never);
    renderPage({ userId: 'u1', showButton: true });
    await waitFor(() => expect(screen.getByText('옥상 슬래브(노출방수)')).toBeInTheDocument());

    fireEvent.click(within(screen.getByTestId('cards')).getByLabelText(/옥상 슬래브\(노출방수\)/));
    fireEvent.click(within(screen.getByTestId('title-row')).getByRole('button', { name: '구배 분석' }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ kind: 'slope', criteria_id: 'c-roof-exposed' }));
  });

  it('카드 children(진행 상태·이전 이력)은 적용 기준 아래에 온다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    renderPage({ userId: 'u1', showButton: true }, <p>분석 완료 - 결과 보기</p>);
    await waitFor(() => expect(screen.getByText('실내 평바닥')).toBeInTheDocument());

    const cards = within(screen.getByTestId('cards'));
    const criteria = cards.getByRole('group', { name: '적용 기준' });
    const child = cards.getByText('분석 완료 - 결과 보기');
    // DOCUMENT_POSITION_FOLLOWING: 기준 묶음이 먼저, children이 뒤.
    expect(criteria.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('showButton=false면 버튼도 기준 라디오도 없고 기준 후보를 부르지도 않는다(옛 게이트 그대로)', () => {
    const rpcSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(rpcSpy) as never);
    renderPage({ userId: 'u1', showButton: false }, <p>이전 분석</p>);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('적용 기준')).toBeNull();
    // 버튼이 없으면 fn_resolve_criteria도 부르지 않는다 - 옛 코드에서 ReanalyzeButton
    // 자체가 렌더되지 않아 마운트 시 RPC가 없던 것과 같아야 한다.
    expect(rpcSpy).not.toHaveBeenCalled();
    // 이미 완료된 구배 결과·이력은 버튼 없이도 계속 보인다(컨트롤러 보강 확정 5).
    expect(within(screen.getByTestId('cards')).getByText('이전 분석')).toBeInTheDocument();
  });

  it('userId가 없으면(비로그인) 버튼을 그리지 않는다(옛 `user &&` 게이트)', () => {
    const rpcSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(rpcSpy) as never);
    renderPage({ showButton: true });

    expect(screen.queryByRole('button')).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('범위 밖에서 쓴 SlopeAnalysisAction은 아무것도 그리지 않는다', () => {
    const { container } = render(<SlopeAnalysisAction />);
    expect(container).toBeEmptyDOMElement();
  });
});
