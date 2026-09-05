// ConsoleShell: /login에서만 사이드 내비 슬롯을 생략한다(스펙 §5).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const usePathnameMock = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => usePathnameMock() }));

import { ConsoleShell } from '../console-shell';

function renderShell(pathname: string) {
  usePathnameMock.mockReturnValue(pathname);
  return render(
    <ConsoleShell topNav={<div data-testid="top" />} sideNav={<div data-testid="side" />}>
      <p>본문</p>
    </ConsoleShell>,
  );
}

describe('ConsoleShell', () => {
  it('일반 경로에서는 상단 바 + 사이드 내비 + 본문을 그린다', () => {
    renderShell('/reports');
    expect(screen.getByTestId('top')).toBeInTheDocument();
    expect(screen.getByTestId('side')).toBeInTheDocument();
    expect(screen.getByText('본문')).toBeInTheDocument();
  });
  it('/login에서는 사이드 내비를 그리지 않는다', () => {
    renderShell('/login');
    expect(screen.getByTestId('top')).toBeInTheDocument();
    expect(screen.queryByTestId('side')).toBeNull();
    expect(screen.getByText('본문')).toBeInTheDocument();
  });
});
