import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const fromMock = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: fromMock }) }));

import { CriteriaList } from '../criteria-list';
import { checkClass } from '@/components/ui/form';
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

  // 아트보드 Settings: h3 + (n) mono → 표 상자(최소 960px, 상자 안에서만 가로 스크롤) 4열 → 안내 상자
  it('전역 기준은 h3 "전역 기본 기준" + (n), 4열 표(scope=col)이고, 표는 최소 960px 상자 안에서만 가로 스크롤한다', () => {
    render(<CriteriaList criteria={rows} siteNames={new Map()} />);
    expect(screen.getByRole('heading', { level: 3, name: '전역 기본 기준' })).toBeInTheDocument();
    expect(screen.getByText('(1)').className).toContain('font-mono');
    const table = screen.getByRole('table');
    expect(table.closest('.overflow-x-auto')).not.toBeNull();
    // TableBox minWidth={960}: 안쪽 <table>에 min-w-[960px](Task 1 TableBox가 그린 표 하나 - 표가 겹치지 않는다)
    expect(table.className).toContain('min-w-[960px]');
    expect(table.querySelector('table')).toBeNull();
    const headers = screen.getAllByRole('columnheader');
    expect(headers.map((th) => th.textContent)).toEqual(['기준 · 출처', '표면 · 버전', '임계값', '활성']);
    for (const h of headers) expect(h).toHaveAttribute('scope', 'col');
  });

  it('이름은 mono, 출처는 13px muted로 말줄임 없이 전문, 표면·버전은 ink-2, 임계값은 tabular', () => {
    render(<CriteriaList criteria={rows} siteNames={new Map()} />);
    expect(screen.getByText('floor-kcs-exposed').className).toContain('font-mono');
    const source = screen.getByText(/KCS 14 20 10/);
    expect(source.className).toContain('text-muted');
    expect(source.className).not.toMatch(/truncate|line-clamp/);
    expect(screen.getByText('바닥 · v1').className).toContain('text-ink-2');
    expect(screen.getByText('3m당 허용 7mm / 재시공 21mm').className).toContain('tabular-nums');
  });

  it('활성 체크박스는 checkClass이고 44x44 라벨이 감싼다(터치 대상)', () => {
    render(<CriteriaList criteria={rows} siteNames={new Map()} />);
    const box = screen.getByRole('checkbox', { name: 'floor-kcs-exposed 활성' });
    expect(box.className).toBe(checkClass);
    expect(box.parentElement?.tagName).toBe('LABEL');
    expect(box.parentElement?.className).toContain('min-h-11');
    expect(box.parentElement?.className).toContain('min-w-11');
  });

  it('현장별 기준은 "현장 기준: <현장명>" 그룹으로 전역 표 아래에 따로 그린다', () => {
    render(<CriteriaList criteria={[...rows, siteRow]} siteNames={new Map([['s1', '현장A']])} />);
    expect(screen.getByRole('heading', { level: 3, name: '현장 기준: 현장A' })).toBeInTheDocument();
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

  it('맨 아래 안내는 info 상자이고 criteria 테이블 이름은 mono다', () => {
    render(<CriteriaList criteria={rows} siteNames={new Map()} />);
    expect(screen.getByText(/데모 범위 밖입니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
    expect(screen.getByText('criteria').className).toContain('font-mono');
  });
});
