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

// 셋째 칸은 로딩이 여는 본문 태그다. 현장 안 로딩은 app/sites/[id]/layout.tsx 의 <main> 안에 그려지므로
// main 을 또 두지 않고 div 로 연다(Task 2) - 문서에 main 이 둘이면 랜드마크가 깨진다.
const CASES: [string, () => ReactElement, 'main' | 'div'][] = [
  ['app/loading.tsx', RootLoading, 'main'],
  ['app/reports/loading.tsx', ReportsLoading, 'main'],
  ['app/scans/[id]/loading.tsx', ScanLoading, 'main'],
  ['app/sites/[id]/loading.tsx', SiteLoading, 'div'],
];

describe.each(CASES)('%s', (_file, Loading, tag) => {
  it('본문은 PAGE_MAIN 그대로 + aria-busy, 중앙 스피너 + "불러오는 중…"(보조색)', () => {
    const { container } = render(<Loading />);
    const main = container.firstElementChild as HTMLElement;
    expect(main.tagName.toLowerCase()).toBe(tag);
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

// 다크 C안 스펙 §6 "Spinner: 토큰만 바꾼다": 트랙 line + 회전 호 ink(진행 막대 채움과 같은 ink,
// ui.test.tsx의 Spinner 색 단언과 같은 토큰). 루트 로딩 하나로 대표한다.
describe('Spinner 색 토큰', () => {
  it('링 색은 line 트랙 + ink 회전 호이고 zinc·cs 토큰이 없다', () => {
    render(<RootLoading />);
    const spinner = screen.getByRole('status');
    expect(spinner.className).toContain('border-line');
    expect(spinner.className).toContain('border-t-ink');
    expect(spinner.className).not.toMatch(/zinc-|cs-/);
  });
});
