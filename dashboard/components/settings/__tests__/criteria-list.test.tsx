import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const fromMock = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: fromMock }) }));

import { CriteriaList } from '../criteria-list';
import type { CriteriaRow } from '@/lib/domain/types';

const rows: CriteriaRow[] = [
  {
    id: 'g1', site_id: null, surface: 'floor', name: 'floor-kcs-exposed',
    source_text: 'KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)',
    thresholds: [{ span_m: 3, metric: 'flatness', pass_mm: 7, rework_mm: 21 }],
    is_default: true, is_active: true, version: 1, supersedes_id: null, created_at: '',
    kind: 'flatness',
  },
];

// 현장별 재정의 행(site_id 있음) - 전역 표 아래 "현장 기준: <현장명>" 그룹으로 나온다.
const siteRow: CriteriaRow = {
  id: 's1-1', site_id: 's1', surface: 'wall', name: 'wall-site-override',
  source_text: '현장 계약 특기시방 3.2',
  thresholds: [{ span_m: 3, metric: 'flatness', pass_mm: 4, rework_mm: 12 }],
  is_default: false, is_active: false, version: 2, supersedes_id: null, created_at: '',
  kind: 'flatness',
};

describe('CriteriaList', () => {
  it('기준 이름·출처·요약·기본 배지·활성 토글을 렌더한다', () => {
    render(<CriteriaList criteria={rows} siteNames={new Map()} />);
    expect(screen.getByText('floor-kcs-exposed')).toBeInTheDocument();
    expect(screen.getByText(/KCS 14 20 10/)).toBeInTheDocument();
    expect(screen.getByText('3m당 허용 7mm / 재시공 21mm')).toBeInTheDocument();
    expect(screen.getByText('기본')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /활성/ })).toBeChecked();
  });

  it('전역 기준은 4열 테이블(기준 · 출처 / 표면 · 버전 / 임계값 / 활성)이고 출처는 말줄임 없이 전문이다', () => {
    render(<CriteriaList criteria={rows} siteNames={new Map()} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      '기준 · 출처', '표면 · 버전', '임계값', '활성',
    ]);
    expect(screen.getByText('전역 기본 기준')).toBeInTheDocument();
    expect(screen.getByText('(1)').className).toContain('text-cs-text-secondary');
    const name = screen.getByText('floor-kcs-exposed');
    expect(name.className).toContain('font-mono');
    expect(name.className).toContain('font-bold');
    const source = screen.getByText(/KCS 14 20 10/);
    expect(source.className).toContain('text-cs-text-secondary');
    expect(source.className).not.toMatch(/truncate|line-clamp/);
    expect(screen.getByText('바닥 · v1').className).toContain('text-cs-nav-text');
    expect(screen.getByText('3m당 허용 7mm / 재시공 21mm').className).toContain('tabular-nums');
    expect(screen.getByRole('checkbox', { name: /활성/ }).className).toContain('accent-cs-link');
  });

  it('현장별 기준은 "현장 기준: <현장명>" 그룹으로 전역 표 아래에 따로 그린다', () => {
    render(<CriteriaList criteria={[...rows, siteRow]} siteNames={new Map([['s1', '현장A']])} />);
    expect(screen.getByText('현장 기준: 현장A')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByText('wall-site-override')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'wall-site-override 활성' })).not.toBeChecked();
  });

  it('RLS 무음 거부(0행 갱신)면 토글을 되돌리지 않고 error Alert로 안내한다', async () => {
    // update().eq().select()가 data: []를 돌려주는 경로 = USING 절이 거른 경우
    fromMock.mockReturnValue({
      update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
    });
    render(<CriteriaList criteria={rows} siteNames={new Map()} />);
    const box = screen.getByRole('checkbox', { name: /활성/ });
    fireEvent.click(box);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-alert', 'error');
    expect(alert.textContent).toContain('전역 기준은 관리자만 수정할 수 있습니다');
    expect(box).toBeChecked(); // 실패했으므로 상태는 그대로
  });
});
