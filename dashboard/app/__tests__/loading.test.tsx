// loading.tsx 4종: 페이지와 같은 PAGE_MAIN을 써야 로딩→화면 전환에서 레이아웃 점프가 없다(스펙 §5).
// Loading은 매개변수 없는 동기 서버 컴포넌트(node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/loading.md)라 render()로 그린다. 4개 파일이 같은 규약을 지키는지 한 표로 본다.
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PAGE_MAIN } from '@/components/ui/page';
import RootLoading from '../loading';
import ReportsLoading from '../reports/loading';
import ScanLoading from '../scans/[id]/loading';
import SiteLoading from '../sites/[id]/loading';

const CASES: [string, () => ReactElement][] = [
  ['app/loading.tsx', RootLoading],
  ['app/reports/loading.tsx', ReportsLoading],
  ['app/scans/[id]/loading.tsx', ScanLoading],
  ['app/sites/[id]/loading.tsx', SiteLoading],
];

describe.each(CASES)('%s', (_file, Loading) => {
  it('main은 PAGE_MAIN 그대로 + aria-busy, 중앙 스피너 + "불러오는 중…"(보조색)', () => {
    render(<Loading />);
    const main = screen.getByRole('main');
    expect(main.className).toBe(PAGE_MAIN);
    expect(main).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toBeInTheDocument();
    // Spinner의 sr-only '불러오는 중'(말줄임 없음)과 구분되는 표시 문구
    const hint = screen.getByText('불러오는 중…');
    expect(hint.className).toContain('text-cs-text-secondary');
    expect(hint.className).not.toMatch(/zinc-/);
    expect(hint.parentElement?.className).toContain('items-center');
    expect(hint.parentElement?.className).toContain('justify-center');
  });
});

// 스펙 §4 "Spinner 유지(색만 토큰으로)": 트랙 cs-divider + 회전 호 cs-link(진행 색 = ProgressBar 채움과
// 동일, T12 ui.test.tsx의 Spinner 색 단언과 같은 토큰). 루트 로딩 하나로 대표한다.
describe('Spinner 색 토큰', () => {
  it('링 색은 cs-divider 트랙 + cs-link 회전 호이고 zinc가 없다', () => {
    render(<RootLoading />);
    const spinner = screen.getByRole('status');
    expect(spinner.className).toContain('border-cs-divider');
    expect(spinner.className).toContain('border-t-cs-text');
    expect(spinner.className).not.toMatch(/zinc-/);
  });
});
