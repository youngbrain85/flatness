import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SiteCard } from '../site-card';

describe('SiteCard', () => {
  it('현장명·위치 수·최근 측정일·판정 분포를 렌더한다', () => {
    render(
      <SiteCard summary={{
        site: { id: 's1', name: '테스트 현장', address: '서울', memo: null, created_at: '', updated_at: '' },
        locationCount: 3,
        lastScannedAt: '2026-07-20',
        verdictCounts: { pass: 2, borderline: 1, repair: 0, rework: 0 },
      }} />,
    );
    expect(screen.getByText('테스트 현장')).toBeInTheDocument();
    expect(screen.getByText(/측정위치 3/)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-20/)).toBeInTheDocument();
    expect(screen.getByText(/적합 2/)).toBeInTheDocument();
    expect(screen.getByText(/경계 1/)).toBeInTheDocument();
  });
});
