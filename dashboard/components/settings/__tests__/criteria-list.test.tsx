import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

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

describe('CriteriaList', () => {
  it('기준 이름·출처·요약·기본 배지·활성 토글을 렌더한다', () => {
    render(<CriteriaList criteria={rows} siteNames={new Map()} />);
    expect(screen.getByText('floor-kcs-exposed')).toBeInTheDocument();
    expect(screen.getByText(/KCS 14 20 10/)).toBeInTheDocument();
    expect(screen.getByText('3m당 허용 7mm / 재시공 21mm')).toBeInTheDocument();
    expect(screen.getByText('기본')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /활성/ })).toBeChecked();
  });
});
