// 구배 분석 컨테이너(T6 리뷰 수정 1차): 아트보드 ScanDone.dc.html 172-205행은 컨테이너
// 헤더에 '구배 분석' 버튼만 두고, 본문(20px 패딩)에 '적용 기준' + 라디오를 그린다.
// 수정 전에는 ReanalyzeButton 하나가 라디오와 버튼을 함께 들고 Container의 actions
// 슬롯에 들어가, 기준 5개짜리 라디오 목록이 헤더 오른쪽에 통째로 쌓였다 - actions는
// shrink-0이라 그 폭이 그대로 헤더를 차지해 min-w-0인 제목을 밀어낸다. 게다가
// latestSlope가 없으면 본문이 비어 padding까지 꺼지므로 구배 UI 전체가 헤더에만 있었다.
//
// 구배 기준 선택·잡 등록의 동작 단언은 여기로 옮기지 않았다 - reanalyze-button.test.tsx의
// 'kind=slope 기준 선택' describe와 analyze-buttons.test.tsx가 렌더 대상만 이 컴포넌트로
// 바꿔 그대로 지킨다. 이 파일은 배치(헤더/본문)와 게이트(showButton)만 본다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { SlopeAnalysisContainer } from '../slope-analysis-container';
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

function stubSupabase(rpcSpy: (fn: string, params: unknown) => void = () => {}) {
  return {
    rpc: async (fn: string, params: unknown) => {
      rpcSpy(fn, params);
      if (fn === 'fn_resolve_criteria') return { data: slopeCriteriaRows, error: null };
      throw new Error(`예상치 못한 rpc: ${fn}`);
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

// components/ui/container.tsx 구조: section > header(제목·액션) + section > div(본문).
function parts(container: HTMLElement) {
  const section = container.querySelector('section');
  if (!section) throw new Error('Container section 없음');
  return {
    header: section.querySelector('header') as HTMLElement,
    body: section.lastElementChild as HTMLElement,
  };
}

describe('SlopeAnalysisContainer 아트보드 배치 (ScanDone.dc.html 172-205)', () => {
  it('적용 기준 라디오는 본문에 있고 헤더에는 버튼만 있다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    const { container } = render(
      <SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton />);
    await waitFor(() => expect(screen.getByText('실내 평바닥')).toBeInTheDocument());
    const { header, body } = parts(container);

    // 헤더: 제목 + 버튼(과 진행/오류 안내)뿐이다.
    expect(within(header).getByRole('heading', { name: '구배 분석' })).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: '구배 분석' })).toBeInTheDocument();
    expect(header.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    // 본문: '적용 기준' 라벨 + 라디오 전부.
    expect(within(body).getByText('적용 기준')).toBeInTheDocument();
    expect(body.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(body.className).toContain('p-5'); // 아트보드 본문 패딩 20px
  });

  it('본문 children(진행 상태·이전 이력)은 적용 기준 아래에 온다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    const { container } = render(
      <SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton>
        <p>분석 완료 - 결과 보기</p>
      </SlopeAnalysisContainer>);
    await waitFor(() => expect(screen.getByText('실내 평바닥')).toBeInTheDocument());
    const { body } = parts(container);

    const criteria = within(body).getByText('적용 기준');
    const child = within(body).getByText('분석 완료 - 결과 보기');
    // DOCUMENT_POSITION_FOLLOWING: 기준 블록이 먼저, children이 뒤.
    expect(criteria.compareDocumentPosition(child) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('showButton=false면 버튼도 기준 라디오도 없고 기준 후보를 부르지도 않는다(옛 게이트 그대로)', async () => {
    const rpcSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(rpcSpy) as never);
    render(
      <SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton={false}>
        <p>이전 분석</p>
      </SlopeAnalysisContainer>);

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('적용 기준')).toBeNull();
    // 버튼이 없으면 fn_resolve_criteria도 부르지 않는다 - 옛 코드에서 ReanalyzeButton
    // 자체가 렌더되지 않아 마운트 시 RPC가 없던 것과 같아야 한다.
    expect(rpcSpy).not.toHaveBeenCalled();
    // 이미 완료된 구배 결과·이력은 버튼 없이도 계속 보인다(컨트롤러 보강 확정 5).
    expect(screen.getByText('이전 분석')).toBeInTheDocument();
  });

  it('userId가 없으면(비로그인) 버튼을 그리지 않는다(옛 `user &&` 게이트)', () => {
    const rpcSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(rpcSpy) as never);
    render(<SlopeAnalysisContainer scanId="s1" siteId="site1" showButton />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('본문이 비면 패딩을 끈다(빈 20px 방지 - 옛 padded={!!latestSlope})', () => {
    const { container } = render(
      <SlopeAnalysisContainer scanId="s1" userId="u1" siteId="site1" showButton={false} />);
    const { body } = parts(container);

    expect(body.className).not.toContain('p-5');
  });
});
