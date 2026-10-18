// loading.tsx: 페이지와 같은 PAGE_MAIN을 써야 로딩 -> 화면 전환에서 레이아웃 점프가 없다(스펙 §5).
// 헤더를 페이지가 직접 그리는 경로(루트·보고서·스캔)는 LoadingScreen(헤더 자리 + MAIN_BG <main> + 몸통),
// 현장 레이아웃 안(app/sites/[id])은 몸통(LoadingBody)만 - 레이아웃이 이미 헤더와 <main>을 그렸다.
// Loading은 매개변수 없는 동기 서버 컴포넌트(node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/loading.md)라 render()로 그린다.
import type { ReactElement } from 'react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { HEADER_CLASS } from '@/components/shell/brand';
import RootLoading from '../loading';
import ReportsLoading from '../reports/loading';
import ScanLoading from '../scans/[id]/loading';
import SiteLoading from '../sites/[id]/loading';

const SCREENS: [string, () => ReactElement][] = [
  ['app/loading.tsx', RootLoading],
  ['app/reports/loading.tsx', ReportsLoading],
  ['app/scans/[id]/loading.tsx', ScanLoading],
];

function expectBody(body: HTMLElement) {
  expect(body.className).toBe(PAGE_MAIN);
  expect(body).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('status')).toBeInTheDocument();
  // Spinner의 화면 읽기용 '불러오는 중'(말줄임 없음)과 구분되는 표시 문구
  const hint = screen.getByText('불러오는 중…');
  expect(hint.className).toContain('text-muted');
  expect(hint.parentElement?.className).toContain('items-center');
  expect(hint.parentElement?.className).toContain('justify-center');
}

describe.each(SCREENS)('%s (헤더를 페이지가 그리는 경로)', (_file, Loading) => {
  it('헤더 자리(셸 헤더 틀 HEADER_CLASS: 64px, 아래 1px line) + MAIN_BG <main> + PAGE_MAIN 몸통(aria-busy, 가운데 스피너 + 안내)', () => {
    const { container } = render(<Loading />);
    const placeholder = container.firstElementChild as HTMLElement;
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(placeholder.className).toBe(HEADER_CLASS);
    expect(placeholder.children).toHaveLength(0); // 초점 대상 없음
    const main = screen.getByRole('main');
    expect(main.className).toBe(MAIN_BG);
    expectBody(main.firstElementChild as HTMLElement);
  });
});

describe('app/sites/[id]/loading.tsx (현장 레이아웃 안)', () => {
  it('<main> 없이 PAGE_MAIN 몸통만 그린다 - 헤더와 <main>은 현장 레이아웃 몫', () => {
    const { container } = render(<SiteLoading />);
    expect(screen.queryByRole('main')).toBeNull();
    expectBody(container.firstElementChild as HTMLElement);
  });
});

// 앞으로 loading.tsx가 늘어도 같은 규약을 지키게 한다: app 아래 모든 loading.tsx는 LoadingScreen이나
// LoadingBody 하나로 그린다(본문 클래스가 페이지와 어긋나지 않게).
const APP = join(__dirname, '..'); // dashboard/app

function loadingFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') loadingFiles(p, out);
    } else if (name === 'loading.tsx') {
      out.push(p);
    }
  }
  return out;
}

describe('모든 loading.tsx', () => {
  it('LoadingScreen 또는 LoadingBody로 그린다', () => {
    const files = loadingFiles(APP);
    expect(files.length).toBeGreaterThanOrEqual(4);
    const offenders = files
      .filter((f) => !/<Loading(Screen|Body) \/>/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(APP, f).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });
});
