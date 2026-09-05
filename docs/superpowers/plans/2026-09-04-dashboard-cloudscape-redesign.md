# 대시보드 Cloudscape 리디자인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flatness 대시보드의 시각 시스템을 승인된 Cloudscape 캔버스(14화면)대로 교체한다 — 토큰·셸·공통 컴포넌트를 먼저 깔고, 라우트 단위로 화면을 갈아끼운다. 기능·흐름·데이터는 바꾸지 않는다.

**Architecture:** `app/globals.css`의 `@theme` 토큰(`cs-*`) + `components/shell/`(상단 바·사이드 내비·로그인 분기) + `components/ui/` 프리미티브 위에서 각 라우트의 마크업을 `docs/design/cloudscape/*.dc.html`(시각적 정본)대로 다시 쓴다. 서버 컴포넌트 우선, 클라이언트 섬은 셸·도구 줄 필터·TabBar·기존 폼뿐. `@cloudscape-design/components`는 도입하지 않는다(Tailwind 유틸리티로 직접 구현).

**Tech Stack:** Next.js App Router(이 저장소 전용 관례 — `dashboard/AGENTS.md`), Tailwind CSS v4(`@theme inline`), next/font/google(Open Sans · Noto Sans KR · Geist Mono), Supabase JS, Vitest + Testing Library(jsdom).

## Global Constraints

- **스펙**: `docs/superpowers/specs/2026-09-04-dashboard-cloudscape-redesign-design.md`. **시각적 정본**: `docs/design/cloudscape/<아트보드>.dc.html` — 마크업·수치·문구는 아트보드가 기준, 충돌 시 스펙 §7 결정이 이긴다. 각 태스크는 자기 아트보드를 **먼저 브라우저나 Read로 열어** 구조를 옮긴다.
- **이 Next.js는 관례가 다르다.** 코드 작성 전 `dashboard/node_modules/next/dist/docs/`에서 해당 가이드를 읽는다(최소: fonts, layouts-and-pages, loading, link의 `useLinkStatus`).
- **색은 스펙 §3 토큰(`cs-*`)만.** `zinc-*`·`amber-*`·`red-*`·`green-*`·`emerald-*`·`purple-*`·`blue-*` 클래스는 전부 제거 대상(T12 grep 0건). 예외: `lib/domain/labels.ts`의 `GRADE_COLOR` hex(히트맵·PDF 공용)는 그대로 둔다.
- **판정 색 매핑**: 적합=success, 경계=warning, 보수·재시공=error, 판정 불가=`cs-na`(= `lib/domain/grade-tone.ts`의 3버킷). '외부 결과' 배지는 `<Badge tone="external">`(purple).
- **뷰당 primary 버튼 1개.** 나머지는 `normal`. 아이콘은 `components/ui/icons.tsx`의 `<Icon>`만 — 이모지·딩뱃 글자 금지.
- **폰트**: 본문 `font-sans`(Open Sans + Noto Sans KR), 수치·일시·ID·파일명·단위 배율은 `font-mono tabular-nums`(Geist Mono 유지).
- **다크 모드 금지.** 차트 라이브러리·컴포넌트 라이브러리 추가 금지. 서버 스키마·워커·Supabase 쿼리 로직 무변경(표시용 조회 추가만 허용).
- **가드 보존**: `app/scans/[id]/page.tsx`의 `provenNotImport`·`isImportUnknownOrTrue`·`showFirstFlatness`·`showSlopeButton/Section` 분기와 그 주석은 **문장 그대로 보존**한다(C1 사고 가드). UI만 갈아끼운다.
- **본문 컨테이너 클래스는 `PAGE_MAIN`(`components/ui/page.tsx`) 하나**를 모든 `page.tsx`·`loading.tsx`가 쓴다(전환 점프 방지).
- **테스트**: 기존 동작 단언은 그대로 통과. 클래스 문자열 단언은 새 토큰 클래스로 갱신하고, 상태를 스타일로 읽던 단언은 `aria-current`·`data-status` 같은 의미 속성으로 바꾼다. 각 태스크 완료 시 `cd dashboard && npx vitest run` 전체 통과 후 커밋.
- 코드 주석 한국어, 알고리즘·라이브러리 이름 영어. 커밋 메시지 `feat(dashboard): …`/`refactor(dashboard): …` 관례, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File Structure

```
dashboard/
  app/globals.css                          [T1 수정] @theme cs-* 토큰 + 폰트 변수
  app/layout.tsx                           [T1 수정] Open Sans·Noto Sans KR·Geist Mono + ConsoleShell
  components/shell/console-shell.tsx       [T1 신규] 클라이언트 셸: /login이면 사이드 내비 생략
  components/shell/top-nav.tsx             [T1 신규] 44px 다크 상단 바(로고 + 사용자 이메일)
  components/shell/side-nav.tsx            [T1 신규] 280px 사이드 내비 + 모바일 가로 스트립, 활성 판정, useLinkStatus 스피너
  components/shell/__tests__/side-nav.test.tsx, console-shell.test.tsx [T1 신규]
  components/sidebar.tsx, sidebar-nav.tsx, components/__tests__/sidebar-nav.test.tsx [T1 삭제]
  components/logout-button.tsx             [T1 수정] className prop
  components/ui/icons.tsx                  [T1 신규] Icon(name) 16px 스트로크 아이콘 세트
  components/ui/page.tsx                   [T2 신규] PAGE_MAIN 상수
  components/ui/button.tsx                 [T2 신규] Button · LinkButton · buttonClass
  components/ui/container.tsx              [T2 신규] Container(헤더·카운터·액션·padded)
  components/ui/form.tsx                   [T2 신규] FormField · inputClass · selectClass · SelectWrap · textareaClass · checkClass
  components/ui/status-indicator.tsx       [T2 신규] StatusIndicator · TONE_STATUS
  components/ui/breadcrumbs.tsx            [T2 신규] Breadcrumbs
  components/ui/key-value.tsx              [T2 신규] KeyValuePairs · StatValue
  components/ui/alert.tsx                  [T2 신규] Alert
  components/ui/progress-bar.tsx           [T2 신규] ProgressBar
  components/ui/tab-bar.tsx                [T2 신규] TabBar(client)
  components/ui/verdict-bar.tsx            [T2 신규] VerdictBar · VerdictLegend (metric-card.tsx에서 이동)
  components/ui/badge.tsx                  [T2 재작성] TONE을 cs-* 로, external 톤 추가
  components/ui/page-header.tsx            [T2 재작성] Breadcrumbs + h1 24px + description + actions
  components/ui/data-table.tsx             [T2 재작성] tableClass 프리셋 + TableToolbar
  components/ui/empty-state.tsx            [T2 재작성] 컨테이너형 + primary LinkButton
  components/ui/__tests__/ui.test.tsx      [T2 재작성]
  components/ui/metric-card.tsx, status-dot.tsx [T12 삭제 — 소비자가 전부 옮겨간 뒤]
  app/page.tsx, components/site-table.tsx(신규 client) [T3]
  app/sites/[id]/page.tsx, app/sites/new/page.tsx, components/location-tree.tsx,
    new-location-form.tsx, new-site-form.tsx, photo-gallery.tsx, photo-uploader.tsx [T4]
  app/upload/page.tsx, components/upload-form.tsx [T5]
  app/scans/[id]/page.tsx, components/scan-step-strip.tsx, unit-confirm-form.tsx,
    analysis-progress.tsx, scan-status-watcher.tsx, reanalyze-button.tsx [T6]
  components/analysis/* (9 파일) [T7]
  app/reports/page.tsx, reports/new/page.tsx, reports/[id]/page.tsx, components/report/* (5) [T8]
  app/settings/page.tsx, components/settings/* (3) [T9]
  app/registrations/new/page.tsx, registrations/[id]/page.tsx, components/registration/* (4) [T10]
  app/login/page.tsx, app/login/login-form.tsx, app/loading.tsx, app/reports/loading.tsx,
    app/scans/[id]/loading.tsx, app/sites/[id]/loading.tsx, components/supabase-error.tsx [T11]
  (스윕·삭제·시각 대조) [T12]
```

---

### Task 1: 디자인 토큰 + 폰트 + 셸(상단 바·사이드 내비·로그인 분기)

**Files:**
- Modify: `dashboard/app/globals.css`, `dashboard/app/layout.tsx`, `dashboard/components/logout-button.tsx`
- Create: `dashboard/components/ui/icons.tsx`, `dashboard/components/shell/console-shell.tsx`, `dashboard/components/shell/top-nav.tsx`, `dashboard/components/shell/side-nav.tsx`
- Delete: `dashboard/components/sidebar.tsx`, `dashboard/components/sidebar-nav.tsx`, `dashboard/components/__tests__/sidebar-nav.test.tsx`
- Test: `dashboard/components/shell/__tests__/side-nav.test.tsx`, `dashboard/components/shell/__tests__/console-shell.test.tsx`

**Interfaces:**
- Consumes: `getRequestUser()`(`lib/auth/request-user.ts`, proxy가 실어 준 헤더에서 `{id, email}|null`), `Spinner`(`components/ui/spinner.tsx`), `LogoutButton`.
- Produces:
  - `<Icon name={IconName} size?={16} className? />` — `IconName` = `'check-circle'|'alert-triangle'|'x-circle'|'info-circle'|'clock'|'minus-circle'|'chevron-right'|'chevron-down'|'chevron-left'|'search'|'plus'|'upload'|'user'|'menu'|'logout'|'trend'|'download'|'external'|'photo'`. `data-icon={name}` 속성으로 테스트가 식별한다.
  - Tailwind 클래스: `text-cs-*`/`bg-cs-*`/`border-cs-*`(스펙 §3 표의 모든 토큰), `shadow-cs-container`, `rounded-cs-container`, `font-sans`, `font-mono`.
  - `<ConsoleShell topNav sideNav>{children}</ConsoleShell>`, `<TopNav />`(async 서버), `<SideNav />`(client; 활성 항목에 `aria-current="page"`).
  - `MENU`(`side-nav.tsx` export): `{href, label, match(pathname)}[]` — 현장/보고서/업로드 + `SETTINGS` 항목.

- [ ] **Step 1: Next.js 가이드 확인** — `dashboard/node_modules/next/dist/docs/`에서 fonts·layouts 가이드를 읽고 아래 코드가 관례와 맞는지 확인. 다르면 문서를 따르고 커밋 메시지에 적는다.

- [ ] **Step 2: 실패하는 테스트 작성** — `components/shell/__tests__/side-nav.test.tsx`

```tsx
// SideNav 활성 판정: pathname prefix 매칭이 aria-current="page"로 드러나는지 본다.
// 데스크톱 aside와 모바일 스트립이 같은 링크를 두 번 그리므로 라벨 집합으로 비교한다.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const usePathnameMock = vi.fn();
vi.mock('next/navigation', () => ({ usePathname: () => usePathnameMock() }));
vi.mock('@/components/logout-button', () => ({ LogoutButton: () => <button>로그아웃</button> }));

import { SideNav } from '../side-nav';

function activeLabels() {
  return new Set(
    screen.getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page').map((l) => l.textContent?.trim()),
  );
}

describe('SideNav 활성 판정 (pathname prefix)', () => {
  it.each<[string, string]>([
    ['/', '현장'],
    ['/sites/abc-123', '현장'],
    ['/scans/1', '현장'],
    ['/registrations/new', '현장'],
    ['/reports', '보고서'],
    ['/reports/xyz', '보고서'],
    ['/upload', '업로드'],
    ['/settings', '설정'],
  ])('pathname=%s 이면 "%s"만 활성이다', (pathname, expected) => {
    usePathnameMock.mockReturnValue(pathname);
    render(<SideNav />);
    expect(activeLabels()).toEqual(new Set([expected]));
  });

  it('무관한 경로(/login)는 어떤 메뉴도 활성화하지 않는다', () => {
    usePathnameMock.mockReturnValue('/login');
    render(<SideNav />);
    expect(activeLabels().size).toBe(0);
  });

  it('활성 항목은 cs-link 700, 비활성은 cs-nav-text로 그린다', () => {
    usePathnameMock.mockReturnValue('/reports');
    render(<SideNav />);
    const [active] = screen.getAllByRole('link', { name: '보고서' });
    const [inactive] = screen.getAllByRole('link', { name: '현장' });
    expect(active.className).toContain('text-cs-link');
    expect(active.className).toContain('font-bold');
    expect(inactive.className).toContain('text-cs-nav-text');
  });

  it('두 그룹(현장·보고서·업로드 / 설정·로그아웃)과 헤더 문구를 그린다', () => {
    usePathnameMock.mockReturnValue('/');
    render(<SideNav />);
    expect(screen.getByText('평활도 분석 콘솔')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '설정' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument();
  });
});
```

`components/shell/__tests__/console-shell.test.tsx`

```tsx
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
```

- [ ] **Step 3: 실패 확인** — `cd dashboard && npx vitest run components/shell` → FAIL (모듈 없음).

- [ ] **Step 4: globals.css 교체**

```css
@import "tailwindcss";

/* Cloudscape 어휘 토큰(스펙 §3). 이 표 밖의 색을 쓰지 않는다. */
@theme inline {
  --color-cs-text: #000716;
  --color-cs-text-secondary: #5f6b7a;
  --color-cs-nav-text: #414d5c;
  --color-cs-link: #0972d3;
  --color-cs-link-hover: #033160;
  --color-cs-divider: #e9ebed;
  --color-cs-input-border: #8c8c94;
  --color-cs-disabled: #9ba7b6;
  --color-cs-topnav: #0f1b2a;
  --color-cs-topnav-text: #d1d5db;
  --color-cs-success: #037f0c;
  --color-cs-success-bg: #f2fcf3;
  --color-cs-warning: #8d6605;
  --color-cs-warning-bg: #fffce9;
  --color-cs-error: #d91515;
  --color-cs-error-bg: #fff7f7;
  --color-cs-info-bg: #f2f8fd;
  --color-cs-na: #7d8998;
  --color-cs-external: #7d2f9e;
  --color-cs-external-bg: #f5f0fa;
  --shadow-cs-container: 0 1px 1px 1px #e9ebed, 0 1px 8px 2px rgba(0, 7, 22, 0.12);
  --radius-cs-container: 16px;
  --font-sans: var(--font-open-sans), var(--font-noto-sans-kr), "Helvetica Neue", Arial, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, Menlo, Consolas, monospace;
}

/* 리뷰 Important 4(이력 보존): unlayered 다크모드 규칙은 Tailwind v4 @layer보다
   항상 우선해 판독 불가를 만들었던 사고가 있다 - 다크모드 규칙을 다시 넣지 않는다. */
```

- [ ] **Step 5: icons.tsx 작성**

```tsx
// 16px 스트로크 아이콘 세트(Cloudscape 어휘). 이모지·딩뱃 금지 규칙의 구현체 -
// 화면의 모든 아이콘은 이 컴포넌트를 거친다. data-icon으로 테스트가 식별한다.
import type { ReactNode, SVGProps } from 'react';

const PATHS: Record<string, ReactNode> = {
  'check-circle': <><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></>,
  'alert-triangle': <><path d="M12 3l10 18H2L12 3z" /><path d="M12 10v4M12 17.5v.5" /></>,
  'x-circle': <><circle cx="12" cy="12" r="9" /><path d="M15 9l-6 6M9 9l6 6" /></>,
  'info-circle': <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  'minus-circle': <><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  logout: <path d="M10 17l5-5-5-5M15 12H3M20 4v16" />,
  trend: <><path d="M3 17l6-6 4 4 8-8" /><path d="M14 7h7v7" /></>,
  download: <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" /></>,
  photo: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></>,
};

export type IconName =
  | 'check-circle' | 'alert-triangle' | 'x-circle' | 'info-circle' | 'clock' | 'minus-circle'
  | 'chevron-right' | 'chevron-down' | 'chevron-left' | 'search' | 'plus' | 'upload' | 'user'
  | 'menu' | 'logout' | 'trend' | 'download' | 'external' | 'photo';

export function Icon({ name, size = 16, className, ...rest }:
  { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-icon={name}
      className={`shrink-0${className ? ` ${className}` : ''}`} {...rest}>
      {PATHS[name]}
    </svg>
  );
}
```

- [ ] **Step 6: logout-button.tsx에 className prop**

```tsx
'use client';
import { createClient } from '@/lib/supabase/client';

// 사이드 내비 항목으로도, 단독 버튼으로도 쓰이므로 스타일은 호출자가 준다.
export function LogoutButton({ className = 'text-sm text-cs-nav-text hover:text-cs-text' }: { className?: string }) {
  async function onClick() {
    await createClient().auth.signOut();
    // 로그인과 같은 인증 경계이므로 전체 페이지 이동을 쓴다. router.push('/login')
    // 다음에 router.refresh()를 부르면 refresh가 "현재 라우트"를 다시 렌더하면서
    // 진행 중이던 이동을 취소한다(로그인 화면에서 실제로 재현된 결함). 게다가 소프트
    // 이동은 클라이언트 컴포넌트의 React 상태에 남은 인증 후 데이터를 그대로 두므로,
    // 로그아웃에는 전체 이동이 맞다.
    window.location.assign('/login');
  }
  return <button type="button" onClick={onClick} className={className}>로그아웃</button>;
}
```

- [ ] **Step 7: side-nav.tsx 작성**

```tsx
'use client';
// 사이드 내비(데스크톱 280px aside) + 모바일 가로 스트립. 활성 판정은 pathname prefix,
// 활성 항목은 aria-current="page"(테스트·접근성 모두 이 속성을 본다).
// 클릭 즉시 피드백: useLinkStatus는 Link의 자식에서만 쓸 수 있다(next/link 규약) -
// 별도 state로 pending을 흉내내지 않는다(라우터 상태 오추적 방지).
import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { Spinner } from '@/components/ui/spinner';
import { LogoutButton } from '@/components/logout-button';

type MenuItem = { href: string; label: string; match: (p: string) => boolean };

export const MENU: MenuItem[] = [
  { href: '/', label: '현장', match: (p) => p === '/' || p.startsWith('/sites') || p.startsWith('/scans') || p.startsWith('/registrations') },
  { href: '/reports', label: '보고서', match: (p) => p.startsWith('/reports') },
  { href: '/upload', label: '업로드', match: (p) => p.startsWith('/upload') },
];
export const SETTINGS: MenuItem = { href: '/settings', label: '설정', match: (p) => p.startsWith('/settings') };

function NavPendingHint() {
  const { pending } = useLinkStatus();
  return pending ? <Spinner size="sm" /> : null;
}

const ITEM = 'flex items-center gap-2 py-2 text-sm';
const ACTIVE = 'text-cs-link font-bold';
const INACTIVE = 'text-cs-nav-text hover:text-cs-text';

function NavLink({ item, active, className }: { item: MenuItem; active: boolean; className: string }) {
  return (
    <Link href={item.href} aria-current={active ? 'page' : undefined}
      className={`${ITEM} ${className} ${active ? ACTIVE : INACTIVE}`}>
      {item.label}
      <NavPendingHint />
    </Link>
  );
}

export function SideNav() {
  const pathname = usePathname();
  const all = [...MENU, SETTINGS];
  return (
    <>
      {/* 모바일(<md): 캔버스에 설계가 없다 - 최소 동작(가로 스트립)만 보장. 세로 스택 안에서
          풀폭으로 놓이므로 2026-08-11 T1의 "세로 기둥" 사고가 재발하지 않는다. */}
      <nav aria-label="주 메뉴(모바일)"
        className="flex w-full items-center gap-4 overflow-x-auto border-b border-cs-divider bg-white px-4 md:hidden">
        {all.map((m) => <NavLink key={m.href} item={m} active={m.match(pathname)} className="shrink-0" />)}
      </nav>
      <aside className="hidden w-[280px] shrink-0 flex-col border-r border-cs-divider bg-white md:flex">
        <div className="border-b border-cs-divider px-7 pb-3 pt-5 text-base font-bold leading-5">평활도 분석 콘솔</div>
        <nav aria-label="주 메뉴" className="flex flex-col py-3">
          {MENU.map((m) => <NavLink key={m.href} item={m} active={m.match(pathname)} className="px-7" />)}
        </nav>
        <div className="mx-7 h-px bg-cs-divider" />
        <nav aria-label="관리 메뉴" className="flex flex-col py-3">
          <NavLink item={SETTINGS} active={SETTINGS.match(pathname)} className="px-7" />
          <LogoutButton className={`${ITEM} px-7 ${INACTIVE}`} />
        </nav>
      </aside>
    </>
  );
}
```

- [ ] **Step 8: top-nav.tsx 작성**

```tsx
// 상단 바(서버 컴포넌트): 로고 + 사용자 이메일. 검색·알림은 앱에 없어 넣지 않는다(스펙 §7-1).
// proxy가 검증해 실어 준 헤더만 읽는다(Auth 서버 왕복 0회 - perf-auth-roundtrips 유지).
import Link from 'next/link';
import { getRequestUser } from '@/lib/auth/request-user';
import { Icon } from '@/components/ui/icons';

export async function TopNav() {
  const user = await getRequestUser();
  return (
    <header className="flex h-11 shrink-0 items-center gap-6 bg-cs-topnav px-5 text-white">
      <Link href="/" className="flex items-center gap-2.5 text-base font-bold tracking-wide">
        <Icon name="trend" size={20} />
        FLATNESS
      </Link>
      {user?.email && (
        <span className="ml-auto inline-flex items-center gap-2 text-sm text-cs-topnav-text">
          <Icon name="user" size={18} />
          <span className="font-mono">{user.email}</span>
        </span>
      )}
    </header>
  );
}
```

- [ ] **Step 9: console-shell.tsx 작성**

```tsx
'use client';
// 셸 분기: /login만 사이드 내비 없이 상단 바 + 본문(스펙 §5). 라우트 그룹 이동 대신
// pathname으로 가르므로 서버 컴포넌트(TopNav)는 슬롯으로 받는다.
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function ConsoleShell({ topNav, sideNav, children }: {
  topNav: ReactNode; sideNav: ReactNode; children: ReactNode;
}) {
  const bare = usePathname() === '/login';
  return (
    <div className="flex min-h-screen flex-col">
      {topNav}
      {bare ? (
        <div className="min-w-0 flex-1">{children}</div>
      ) : (
        // 모바일은 세로 스택(스트립 위 / 본문 아래), md 이상만 가로(aside + 본문).
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {sideNav}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10: layout.tsx 교체**

```tsx
import type { Metadata } from 'next';
import { Open_Sans, Noto_Sans_KR, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ConsoleShell } from '@/components/shell/console-shell';
import { TopNav } from '@/components/shell/top-nav';
import { SideNav } from '@/components/shell/side-nav';

// Cloudscape 어휘의 본문 폰트(Open Sans) + 한글(Noto Sans KR). 모노는 Geist Mono 유지(스펙 §3).
const openSans = Open_Sans({ subsets: ['latin'], variable: '--font-open-sans' });
const notoSansKr = Noto_Sans_KR({ subsets: ['latin'], variable: '--font-noto-sans-kr' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Flatness — 평활도 분석 콘솔',
  description: '현장 바닥·벽면 평활도 스크리닝 결과 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${openSans.variable} ${notoSansKr.variable} ${geistMono.variable} min-h-screen bg-white font-sans text-sm leading-5 text-cs-text antialiased`}>
        <ConsoleShell topNav={<TopNav />} sideNav={<SideNav />}>{children}</ConsoleShell>
      </body>
    </html>
  );
}
```

- [ ] **Step 11: 옛 사이드바 삭제** — `git rm dashboard/components/sidebar.tsx dashboard/components/sidebar-nav.tsx dashboard/components/__tests__/sidebar-nav.test.tsx`. `grep -rn "components/sidebar" dashboard/app dashboard/components` 로 남은 import가 0건인지 확인.

- [ ] **Step 12: 테스트 통과 확인** — `cd dashboard && npx vitest run` → 전체 PASS(shell 테스트 6건 포함). `npx tsc --noEmit -p .` 도 0 에러.

- [ ] **Step 13: 커밋**

```bash
git add dashboard/app/globals.css dashboard/app/layout.tsx dashboard/components/shell dashboard/components/ui/icons.tsx dashboard/components/logout-button.tsx
git commit -m "feat(dashboard): Cloudscape 토큰·폰트·셸(상단 바+사이드 내비, 로그인 분기)"
```

---

### Task 2: UI 프리미티브(Cloudscape 해부)

**Files:**
- Create: `dashboard/components/ui/page.tsx`, `button.tsx`, `container.tsx`, `form.tsx`, `status-indicator.tsx`, `breadcrumbs.tsx`, `key-value.tsx`, `alert.tsx`, `progress-bar.tsx`, `tab-bar.tsx`, `verdict-bar.tsx`
- Modify(재작성): `dashboard/components/ui/badge.tsx`, `page-header.tsx`, `data-table.tsx`, `empty-state.tsx`
- Modify(최소): `dashboard/components/ui/metric-card.tsx` — `VerdictBar` 정의를 `verdict-bar.tsx`로 옮기고 여기서는 re-export(`export { VerdictBar } from './verdict-bar'`)만 남긴다. `status-dot.tsx`는 그대로(둘 다 T12에서 삭제).
- Test: `dashboard/components/ui/__tests__/ui.test.tsx` (재작성)

**Interfaces:**
- Consumes: `Icon`/`IconName`(T1), `Spinner`.
- Produces(이후 태스크 전부가 이 시그니처를 쓴다):
  - `PAGE_MAIN: string` — `'flex flex-col gap-5 px-10 pb-10 pt-5'`. 모든 `page.tsx`/`loading.tsx`의 `<main className={PAGE_MAIN}>`.
  - `buttonClass(variant?: 'primary'|'normal', opts?: {disabled?: boolean; full?: boolean}): string`, `<Button variant?>`(button props), `<LinkButton href variant?>`(next/link props).
  - `<Container title? counter? description? actions? padded?=true className?>children</Container>` — `counter`는 `(n)`으로 제목 옆, `padded={false}`면 본문 padding 없음(테이블용).
  - `<FormField label htmlFor? description? error?>{control}</FormField>`, `inputClass`, `selectClass`, `<SelectWrap>{<select className={selectClass}/>}</SelectWrap>`, `textareaClass`, `checkClass`(라디오·체크박스 공용).
  - `<StatusIndicator type={'success'|'warning'|'error'|'in-progress'|'pending'|'info'}>label</StatusIndicator>`(`data-status={type}`), `TONE_STATUS: Record<'pass'|'warn'|'fail'|'unknown'|'busy', StatusType>`.
  - `<Breadcrumbs items={{href?, label}[]} />` — 마지막 항목은 비링크·보조색.
  - `<PageHeader crumbs? title description? actions? />`(기존 props 호환 + description).
  - `<KeyValuePairs items={{label, value: ReactNode}[]} columns?={4} />`, `<StatValue value unit? />`.
  - `tableClass = {table, thead, th, thNum, td, tdNum, row, link}`, `<TableToolbar>`.
  - `<Alert type={'info'|'success'|'warning'|'error'} title?>children</Alert>`(`data-alert={type}`).
  - `<ProgressBar value label? />`(0~100 clamp, `role="progressbar"`).
  - `<TabBar tabs={{id,label}[]} active onChange />`(client; `role="tab"` + `aria-selected`).
  - `<VerdictBar counts={{pass,warn,fail}} />`(기존 API·`[data-seg]` 유지), `<VerdictLegend counts na? />`.
  - `Badge`: `TONE`에 `external` 추가, 클래스는 cs-* 토큰. `BadgeTone = Exclude<keyof typeof TONE,'busy'>`.
  - `<EmptyState message actionHref actionLabel />`(props 동일, 컨테이너형).

- [ ] **Step 1: 실패하는 테스트 작성** — `components/ui/__tests__/ui.test.tsx` 전체 교체

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, LinkButton, buttonClass } from '../button';
import { Container } from '../container';
import { FormField, SelectWrap, inputClass, selectClass } from '../form';
import { StatusIndicator, TONE_STATUS } from '../status-indicator';
import { Badge, TONE } from '../badge';
import { Breadcrumbs } from '../breadcrumbs';
import { PageHeader } from '../page-header';
import { KeyValuePairs, StatValue } from '../key-value';
import { tableClass } from '../data-table';
import { Alert } from '../alert';
import { ProgressBar } from '../progress-bar';
import { TabBar } from '../tab-bar';
import { VerdictBar, VerdictLegend } from '../verdict-bar';
import { EmptyState } from '../empty-state';
import { Spinner } from '../spinner';
import { PAGE_MAIN } from '../page';

describe('ui primitives (Cloudscape 해부)', () => {
  it('PAGE_MAIN은 본문 padding 20px 40px 40px + gap 20px 이다', () => {
    expect(PAGE_MAIN).toBe('flex flex-col gap-5 px-10 pb-10 pt-5');
  });

  it.each([
    { variant: 'primary' as const, has: ['bg-cs-link', 'text-white'] },
    { variant: 'normal' as const, has: ['border-cs-link', 'text-cs-link'] },
  ])('Button $variant: 알약(32px, radius 20px, 700) + 변형 클래스', ({ variant, has }) => {
    render(<Button variant={variant}>실행</Button>);
    const b = screen.getByRole('button', { name: '실행' });
    for (const c of ['h-8', 'rounded-full', 'border-2', 'font-bold', ...has]) expect(b.className).toContain(c);
  });
  it('disabled 버튼은 cs-disabled 보더·글자, primary 채움을 잃는다', () => {
    render(<Button variant="primary" disabled>실행</Button>);
    const b = screen.getByRole('button', { name: '실행' });
    expect(b).toBeDisabled();
    expect(b.className).toContain('border-cs-disabled');
    expect(b.className).not.toContain('bg-cs-link');
    expect(buttonClass('primary', { full: true })).toContain('w-full');
  });
  it('LinkButton은 href를 가진 링크로 렌더된다', () => {
    render(<LinkButton href="/upload" variant="primary">스캔 업로드</LinkButton>);
    expect(screen.getByRole('link', { name: '스캔 업로드' })).toHaveAttribute('href', '/upload');
  });

  it('Container: 제목·카운터·액션·본문, 그림자·16px 라운드', () => {
    const { container } = render(
      <Container title="현장" counter={6} actions={<button>새 현장</button>}><p>본문</p></Container>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('shadow-cs-container');
    expect(root.className).toContain('rounded-cs-container');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('현장(6)');
    expect(screen.getByRole('button', { name: '새 현장' })).toBeInTheDocument();
    expect(screen.getByText('본문').parentElement?.className).toContain('p-5');
  });
  it('Container padded={false}는 본문 padding이 없고, 헤더 없이도 렌더된다', () => {
    const { container } = render(<Container padded={false}><table /></Container>);
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('table')?.parentElement?.className).not.toContain('p-5');
  });

  it('FormField: 라벨(700)·설명·오류를 그린다', () => {
    render(
      <FormField label="현장명" htmlFor="name" description="필수" error="입력하세요">
        <input id="name" className={inputClass} />
      </FormField>,
    );
    expect(screen.getByLabelText('현장명').className).toContain('border-cs-input-border');
    expect(screen.getByText('현장명').className).toContain('font-bold');
    expect(screen.getByText('필수').className).toContain('text-cs-text-secondary');
    expect(screen.getByText('입력하세요').className).toContain('text-cs-error');
  });
  it('SelectWrap은 셀렉트 뒤에 chevron 아이콘을 얹는다', () => {
    const { container } = render(<SelectWrap><select className={selectClass}><option>a</option></select></SelectWrap>);
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
    expect(selectClass).toContain('appearance-none');
  });

  it.each([
    { type: 'success' as const, icon: 'check-circle', color: 'text-cs-success' },
    { type: 'warning' as const, icon: 'alert-triangle', color: 'text-cs-warning' },
    { type: 'error' as const, icon: 'x-circle', color: 'text-cs-error' },
    { type: 'in-progress' as const, icon: 'clock', color: 'text-cs-text-secondary' },
    { type: 'pending' as const, icon: 'minus-circle', color: 'text-cs-na' },
    { type: 'info' as const, icon: 'info-circle', color: 'text-cs-link' },
  ])('StatusIndicator $type: 아이콘 $icon + 색', ({ type, icon, color }) => {
    const { container } = render(<StatusIndicator type={type}>상태</StatusIndicator>);
    const el = screen.getByText('상태');
    expect(el.getAttribute('data-status')).toBe(type);
    expect(el.className).toContain(color);
    expect(container.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
  });
  it('TONE_STATUS는 Badge 톤 5종을 StatusIndicator 타입으로 잇는다', () => {
    expect(TONE_STATUS).toEqual({ pass: 'success', warn: 'warning', fail: 'error', unknown: 'pending', busy: 'in-progress' });
  });

  it.each([
    { tone: 'pass' as const, bg: 'bg-cs-success-bg', text: 'text-cs-success' },
    { tone: 'warn' as const, bg: 'bg-cs-warning-bg', text: 'text-cs-warning' },
    { tone: 'fail' as const, bg: 'bg-cs-error-bg', text: 'text-cs-error' },
    { tone: 'unknown' as const, bg: 'bg-cs-divider', text: 'text-cs-text-secondary' },
    { tone: 'neutral' as const, bg: 'bg-cs-divider', text: 'text-cs-text-secondary' },
    { tone: 'external' as const, bg: 'bg-cs-external-bg', text: 'text-cs-external' },
  ])('Badge $tone: cs 토큰 배경·글자', ({ tone, bg, text }) => {
    render(<Badge tone={tone}>{tone}</Badge>);
    const el = screen.getByText(tone);
    expect(el.className).toContain(bg);
    expect(el.className).toContain(text);
  });
  it('TONE.busy 점은 보조색이다(StatusDot 호환 필드)', () => {
    expect(TONE.busy.dot).toBe('bg-cs-text-secondary');
  });

  it('Breadcrumbs: 마지막 항목은 링크가 아니고 보조색, 구분은 chevron', () => {
    const { container } = render(<Breadcrumbs items={[{ href: '/', label: '현장' }, { label: '설정' }]} />);
    expect(screen.getByRole('link', { name: '현장' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: '설정' })).toBeNull();
    expect(screen.getByText('설정').className).toContain('text-cs-text-secondary');
    expect(container.querySelectorAll('[data-icon="chevron-right"]').length).toBe(1);
  });
  it('PageHeader: 브레드크럼 + h1 24px + 설명 + 액션', () => {
    render(<PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '설정' }]} title="설정" description="계정과 기준" actions={<button>저장</button>} />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe('설정');
    expect(h1.className).toContain('text-2xl');
    expect(screen.getByText('계정과 기준').className).toContain('text-cs-text-secondary');
    expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument();
  });

  it('KeyValuePairs: 두 번째 열부터 세로 구분선, 라벨 700', () => {
    const { container } = render(<KeyValuePairs columns={2} items={[{ label: '현장', value: '6' }, { label: '스캔', value: '130' }]} />);
    const cells = container.querySelectorAll('dl > div');
    expect(cells[0].className).not.toContain('border-l');
    expect(cells[1].className).toContain('border-l');
    expect(screen.getByText('현장').className).toContain('font-bold');
  });
  it('StatValue: 28px 700 tabular 수치 + 보조색 단위', () => {
    render(<StatValue value={130} unit="건" />);
    expect(screen.getByText('130').className).toContain('tabular-nums');
    expect(screen.getByText('건').className).toContain('text-cs-text-secondary');
  });

  it('tableClass: 헤더 40px 700, 행 44px, 셀 padding 20px, 수치 열 mono 우측', () => {
    expect(tableClass.th).toContain('h-10');
    expect(tableClass.th).toContain('font-bold');
    expect(tableClass.td).toContain('h-11');
    expect(tableClass.td).toContain('px-5');
    expect(tableClass.tdNum).toContain('font-mono');
    expect(tableClass.tdNum).toContain('text-right');
    expect(tableClass.row).toContain('border-cs-divider');
    expect(tableClass.link).toContain('text-cs-link');
  });

  it.each([
    { type: 'info' as const, cls: 'border-cs-link', icon: 'info-circle' },
    { type: 'success' as const, cls: 'border-cs-success', icon: 'check-circle' },
    { type: 'warning' as const, cls: 'border-cs-warning', icon: 'alert-triangle' },
    { type: 'error' as const, cls: 'border-cs-error', icon: 'x-circle' },
  ])('Alert $type: 2px 보더·배경·아이콘', ({ type, cls, icon }) => {
    const { container } = render(<Alert type={type} title="제목">내용</Alert>);
    const root = container.querySelector(`[data-alert="${type}"]`) as HTMLElement;
    expect(root.className).toContain(cls);
    expect(root.className).toContain('rounded-xl');
    expect(container.querySelector(`[data-icon="${icon}"]`)).toBeInTheDocument();
    expect(screen.getByText('제목').className).toContain('font-bold');
  });

  it('ProgressBar: 0~100으로 자르고 %를 표시한다', () => {
    render(<ProgressBar value={162} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('TabBar: 활성 탭은 aria-selected, 클릭하면 onChange', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={[{ id: 'a', label: '히트맵' }, { id: 'b', label: '편차맵' }]} active="a" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: '히트맵' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '히트맵' }).className).toContain('border-cs-link');
    fireEvent.click(screen.getByRole('tab', { name: '편차맵' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('VerdictBar: 합계 0이면 비어 있음 표시, 아니면 세그먼트 3개(cs 색)', () => {
    const { container, rerender } = render(<VerdictBar counts={{ pass: 0, warn: 0, fail: 0 }} />);
    expect(container.textContent).toContain('판정 없음');
    rerender(<VerdictBar counts={{ pass: 2, warn: 1, fail: 1 }} />);
    const segs = container.querySelectorAll('[data-seg]');
    expect(segs.length).toBe(3);
    expect(segs[0].className).toContain('bg-cs-success');
  });
  it('VerdictLegend: 적합·주의·재시공(+불가) 건수를 점과 함께 나열한다', () => {
    render(<VerdictLegend counts={{ pass: 93, warn: 21, fail: 9 }} na={3} />);
    expect(screen.getByText('적합 93')).toBeInTheDocument();
    expect(screen.getByText('주의 21')).toBeInTheDocument();
    expect(screen.getByText('재시공 9')).toBeInTheDocument();
    expect(screen.getByText('불가 3')).toBeInTheDocument();
  });

  it('EmptyState: 행동 버튼(primary)이 항상 있다', () => {
    render(<EmptyState message="보고서가 없습니다" actionHref="/reports/new" actionLabel="새 보고서" />);
    const link = screen.getByRole('link', { name: '새 보고서' });
    expect(link).toHaveAttribute('href', '/reports/new');
    expect(link.className).toContain('bg-cs-link');
  });

  it.each([
    { size: undefined, sizeClass: 'h-8 w-8' },
    { size: 'sm' as const, sizeClass: 'h-4 w-4' },
  ])('Spinner: role="status"와 sr-only 안내 텍스트(size=$size)', ({ size, sizeClass }) => {
    render(size === undefined ? <Spinner /> : <Spinner size={size} />);
    const status = screen.getByRole('status');
    expect(status.className).toContain('animate-spin');
    for (const cls of sizeClass.split(' ')) expect(status.className).toContain(cls);
    expect(screen.getByText('불러오는 중')).toHaveClass('sr-only');
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd dashboard && npx vitest run components/ui` → FAIL(모듈 없음·클래스 불일치).

- [ ] **Step 3: page.tsx / button.tsx / container.tsx 작성**

`components/ui/page.tsx`
```tsx
// 본문 컨테이너 클래스의 유일한 정의처. page.tsx와 loading.tsx가 같은 문자열을 써야
// 로딩→화면 전환에서 레이아웃 점프가 없다(스펙 §5).
export const PAGE_MAIN = 'flex flex-col gap-5 px-10 pb-10 pt-5';
```

`components/ui/button.tsx`
```tsx
// Cloudscape 버튼 해부: 32px 알약, 2px 보더, 700. primary(파랑 채움) / normal(파랑 보더).
// 뷰당 primary는 하나 - 나머지 액션은 normal.
import Link from 'next/link';
import type { ComponentProps } from 'react';

export type ButtonVariant = 'primary' | 'normal';

const BASE = 'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border-2 px-5 text-sm font-bold transition-colors';
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'border-cs-link bg-cs-link text-white hover:border-cs-link-hover hover:bg-cs-link-hover',
  normal: 'border-cs-link bg-transparent text-cs-link hover:bg-cs-info-bg',
};
const DISABLED = 'cursor-not-allowed border-cs-disabled bg-transparent text-cs-disabled';

export function buttonClass(variant: ButtonVariant = 'normal', opts: { disabled?: boolean; full?: boolean } = {}): string {
  return [BASE, opts.disabled ? DISABLED : VARIANT[variant], opts.full ? 'w-full' : ''].filter(Boolean).join(' ');
}

export function Button({ variant = 'normal', className, disabled, type = 'button', ...rest }:
  ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return (
    <button type={type} disabled={disabled} {...rest}
      className={`${buttonClass(variant, { disabled: !!disabled })}${className ? ` ${className}` : ''}`} />
  );
}

export function LinkButton({ variant = 'normal', className, ...rest }:
  ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link {...rest} className={`${buttonClass(variant)}${className ? ` ${className}` : ''}`} />;
}
```

`components/ui/container.tsx`
```tsx
// Cloudscape 컨테이너: 흰 배경 + 그림자 + 16px 라운드, 헤더(제목 18px 700 · 카운터 · 액션).
import type { ReactNode } from 'react';

export function Container({ title, counter, description, actions, padded = true, className, children }: {
  title?: ReactNode; counter?: number | string; description?: ReactNode; actions?: ReactNode;
  padded?: boolean; className?: string; children: ReactNode;
}) {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section className={`rounded-cs-container bg-white shadow-cs-container${className ? ` ${className}` : ''}`}>
      {hasHeader && (
        <header className="flex items-start justify-between gap-4 border-b border-cs-divider px-5 py-3">
          <div className="min-w-0">
            {title !== undefined && (
              <h2 className="text-lg font-bold leading-[22px]">
                {title}
                {counter !== undefined && <span className="ml-1.5 font-normal text-cs-text-secondary">({counter})</span>}
              </h2>
            )}
            {description && <p className="mt-1 text-sm text-cs-text-secondary">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}
```

- [ ] **Step 4: form.tsx / status-indicator.tsx / badge.tsx 작성**

`components/ui/form.tsx`
```tsx
// 폼 해부: 라벨 14px 700 위, 설명 12px 보조색, 필드 32px · 2px 보더 · radius 8px.
// 라디오·체크박스는 네이티브 + accent 색(스펙 §7-6).
import type { ReactNode } from 'react';
import { Icon } from './icons';

export const inputClass = 'h-8 w-full rounded-lg border-2 border-cs-input-border bg-white px-2 text-sm text-cs-text placeholder:text-cs-text-secondary focus:border-cs-link focus:outline-none disabled:border-cs-disabled disabled:text-cs-disabled';
export const selectClass = `${inputClass} appearance-none pr-8`;
export const textareaClass = 'min-h-24 w-full rounded-lg border-2 border-cs-input-border bg-white px-2 py-1.5 text-sm text-cs-text placeholder:text-cs-text-secondary focus:border-cs-link focus:outline-none';
export const checkClass = 'h-4 w-4 shrink-0 accent-cs-link';

export function FormField({ label, htmlFor, description, error, children }: {
  label: ReactNode; htmlFor?: string; description?: ReactNode; error?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-bold">{label}</label>
      {description && <p className="text-xs leading-4 text-cs-text-secondary">{description}</p>}
      {children}
      {error && <p className="text-xs leading-4 text-cs-error">{error}</p>}
    </div>
  );
}

// 네이티브 select의 화살표를 숨기고(selectClass의 appearance-none) chevron 아이콘을 얹는다.
export function SelectWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative${className ? ` ${className}` : ''}`}>
      {children}
      <Icon name="chevron-down" size={14} className="pointer-events-none absolute right-2 top-[9px] text-cs-text-secondary" />
    </div>
  );
}
```

`components/ui/status-indicator.tsx`
```tsx
// Cloudscape StatusIndicator: 16px 아이콘 + 텍스트. 색은 스펙 §3.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export type StatusType = 'success' | 'warning' | 'error' | 'in-progress' | 'pending' | 'info';

const STATUS: Record<StatusType, { icon: IconName; color: string }> = {
  success: { icon: 'check-circle', color: 'text-cs-success' },
  warning: { icon: 'alert-triangle', color: 'text-cs-warning' },
  error: { icon: 'x-circle', color: 'text-cs-error' },
  'in-progress': { icon: 'clock', color: 'text-cs-text-secondary' },
  pending: { icon: 'minus-circle', color: 'text-cs-na' },
  info: { icon: 'info-circle', color: 'text-cs-link' },
};

// Badge 톤(pass/warn/fail/unknown/busy) -> 상태 타입. StatusDot 소비자가 이 표로 옮겨온다.
export const TONE_STATUS: Record<'pass' | 'warn' | 'fail' | 'unknown' | 'busy', StatusType> = {
  pass: 'success', warn: 'warning', fail: 'error', unknown: 'pending', busy: 'in-progress',
};

export function StatusIndicator({ type, children, className }: { type: StatusType; children: ReactNode; className?: string }) {
  const s = STATUS[type];
  return (
    <span data-status={type} className={`inline-flex items-center gap-1.5 text-sm ${s.color}${className ? ` ${className}` : ''}`}>
      <Icon name={s.icon} />
      {children}
    </span>
  );
}
```

`components/ui/badge.tsx`
```tsx
// 판정·상태 배지. TONE은 색의 유일한 정의처(VerdictBar·StatusDot 호환 dot 필드 포함).
export const TONE = {
  pass:     { bg: 'bg-cs-success-bg',  text: 'text-cs-success',        dot: 'bg-cs-success' },
  warn:     { bg: 'bg-cs-warning-bg',  text: 'text-cs-warning',        dot: 'bg-cs-warning' },
  fail:     { bg: 'bg-cs-error-bg',    text: 'text-cs-error',          dot: 'bg-cs-error' },
  unknown:  { bg: 'bg-cs-divider',     text: 'text-cs-text-secondary', dot: 'bg-cs-na' },
  neutral:  { bg: 'bg-cs-divider',     text: 'text-cs-text-secondary', dot: 'bg-cs-na' },
  busy:     { bg: 'bg-cs-divider',     text: 'text-cs-text-secondary', dot: 'bg-cs-text-secondary' },
  // '외부 결과'(임포트 출처 경고): 판정 4색과 오독되지 않게 purple(스펙 §3)
  external: { bg: 'bg-cs-external-bg', text: 'text-cs-external',       dot: 'bg-cs-external' },
} as const;

// Badge는 busy를 제외한 톤만 허용(busy는 StatusDot/StatusIndicator 전용)
export type BadgeTone = Exclude<keyof typeof TONE, 'busy'>;

export function Badge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  const t = TONE[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold ${t.bg} ${t.text}`}>{children}</span>;
}
```

- [ ] **Step 5: breadcrumbs.tsx / page-header.tsx / key-value.tsx 작성**

`components/ui/breadcrumbs.tsx`
```tsx
// 브레드크럼: 링크 cs-link, 구분 chevron, 마지막 항목은 현재 페이지(비링크·보조색). 루트는 '현장'(스펙 §7-2).
import Link from 'next/link';
import { Icon } from './icons';

export type Crumb = { href?: string; label: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex items-center gap-2">
          {i > 0 && <Icon name="chevron-right" size={14} className="text-cs-text-secondary" />}
          {c.href
            ? <Link href={c.href} className="text-cs-link hover:text-cs-link-hover hover:underline">{c.label}</Link>
            : <span className="text-cs-text-secondary">{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}
```

`components/ui/page-header.tsx`
```tsx
// 페이지 헤더: 브레드크럼(선택) + h1 24px/30px 700 + 설명(선택) + 우측 액션.
import { Breadcrumbs, type Crumb } from './breadcrumbs';

export function PageHeader({ crumbs, title, description, actions }: {
  crumbs?: Crumb[]; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold leading-[30px]">{title}</h1>
          {description && <p className="text-sm text-cs-text-secondary">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
```

`components/ui/key-value.tsx`
```tsx
// Cloudscape key-value: 라벨 700 위·값 아래, 열 사이 1px 세로 구분 + padding-left 20px.
import type { ReactNode } from 'react';

const COLS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' } as const;

export function KeyValuePairs({ items, columns = 4 }: {
  items: { label: ReactNode; value: ReactNode }[]; columns?: 2 | 3 | 4;
}) {
  return (
    <dl className={`grid ${COLS[columns]} gap-5`}>
      {items.map((it, i) => (
        <div key={i} className={`flex min-w-0 flex-col gap-1${i % columns ? ' border-l border-cs-divider pl-5' : ''}`}>
          <dt className="text-sm font-bold">{it.label}</dt>
          <dd className="text-sm">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// 개요 지표용 큰 수치(28px/32px 700 tabular) + 보조색 단위
export function StatValue({ value, unit }: { value: string | number; unit?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-[28px] font-bold leading-8 tabular-nums">{value}</span>
      {unit && <span className="text-sm text-cs-text-secondary">{unit}</span>}
    </span>
  );
}
```

- [ ] **Step 6: data-table.tsx / alert.tsx / progress-bar.tsx / tab-bar.tsx 작성**

`components/ui/data-table.tsx`
```tsx
// 테이블 클래스 프리셋(Cloudscape 해부): 헤더 40px 700 상하 구분선, 행 44px, 셀 padding 0 20px,
// 수치 열은 thNum/tdNum(우측 정렬 + mono). 첫 열 링크는 tableClass.link.
import type { ReactNode } from 'react';

export const tableClass = {
  table: 'w-full border-collapse text-sm',
  thead: 'border-y border-cs-divider text-left',
  th: 'h-10 px-5 font-bold',
  thNum: 'h-10 px-5 text-right font-bold',
  td: 'h-11 px-5',
  tdNum: 'h-11 px-5 text-right font-mono tabular-nums',
  row: 'border-b border-cs-divider last:border-b-0',
  link: 'font-bold text-cs-link hover:text-cs-link-hover hover:underline',
} as const;

// 컨테이너 헤더와 테이블 사이의 도구 줄(검색·필터·건수). padded={false} 컨테이너 안에서 쓴다.
export function TableToolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-3 px-5 py-3">{children}</div>;
}
```

`components/ui/alert.tsx`
```tsx
// Cloudscape Alert: radius 12px, 2px 보더, 좌측 아이콘. 색은 스펙 §3.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

export type AlertType = 'info' | 'success' | 'warning' | 'error';

const ALERT: Record<AlertType, { icon: IconName; box: string; icon_: string }> = {
  info: { icon: 'info-circle', box: 'border-cs-link bg-cs-info-bg', icon_: 'text-cs-link' },
  success: { icon: 'check-circle', box: 'border-cs-success bg-cs-success-bg', icon_: 'text-cs-success' },
  warning: { icon: 'alert-triangle', box: 'border-cs-warning bg-cs-warning-bg', icon_: 'text-cs-warning' },
  error: { icon: 'x-circle', box: 'border-cs-error bg-cs-error-bg', icon_: 'text-cs-error' },
};

export function Alert({ type, title, children, className }: {
  type: AlertType; title?: ReactNode; children?: ReactNode; className?: string;
}) {
  const a = ALERT[type];
  return (
    <div data-alert={type} role={type === 'error' ? 'alert' : undefined}
      className={`flex gap-3 rounded-xl border-2 px-4 py-3 text-sm ${a.box}${className ? ` ${className}` : ''}`}>
      <Icon name={a.icon} className={`mt-0.5 ${a.icon_}`} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
    </div>
  );
}
```

`components/ui/progress-bar.tsx`
```tsx
// 진행바: 트랙 4px cs-divider, 채움 cs-link, 우측 % 텍스트.
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const v = Math.round(Math.max(0, Math.min(100, value)));
  return (
    <div className="flex items-center gap-3">
      {label && <span className="text-sm">{label}</span>}
      <div role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}
        className="h-1 flex-1 overflow-hidden rounded-sm bg-cs-divider">
        <div className="h-full bg-cs-link" style={{ width: `${v}%` }} />
      </div>
      <span className="text-sm tabular-nums">{v}%</span>
    </div>
  );
}
```

`components/ui/tab-bar.tsx`
```tsx
'use client';
// 탭 바: 텍스트 14px 700, 활성 = 하단 4px cs-link. 내용 전환은 호출자가 active로 한다.
export function TabBar<T extends string>({ tabs, active, onChange }: {
  tabs: { id: T; label: string }[]; active: T; onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-6 border-b border-cs-divider">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.id)}
            className={`-mb-px border-b-4 px-1 pb-2 text-sm font-bold ${on ? 'border-cs-link text-cs-text' : 'border-transparent text-cs-nav-text hover:text-cs-text'}`}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: verdict-bar.tsx / empty-state.tsx 작성, metric-card.tsx 정리**

`components/ui/verdict-bar.tsx`
```tsx
// 판정 분포 바(적합·주의·재시공 3버킷) + 범례. 색은 TONE(badge.tsx)이 유일한 정의처.
import { TONE } from './badge';

export type VerdictCounts = { pass: number; warn: number; fail: number };

export function VerdictBar({ counts }: { counts: VerdictCounts }) {
  const total = counts.pass + counts.warn + counts.fail;
  if (total === 0) return <p className="text-xs text-cs-text-secondary">판정 없음</p>;
  const seg = [
    { n: counts.pass, cls: TONE.pass.dot },
    { n: counts.warn, cls: TONE.warn.dot },
    { n: counts.fail, cls: TONE.fail.dot },
  ];
  return (
    <div className="flex h-2 overflow-hidden rounded bg-cs-divider">
      {seg.filter((s) => s.n > 0).map((s, i) => (
        <div key={i} data-seg className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  );
}

export function VerdictLegend({ counts, na }: { counts: VerdictCounts; na?: number }) {
  const items = [
    { label: `적합 ${counts.pass}`, cls: TONE.pass.dot },
    { label: `주의 ${counts.warn}`, cls: TONE.warn.dot },
    { label: `재시공 ${counts.fail}`, cls: TONE.fail.dot },
    ...(na !== undefined ? [{ label: `불가 ${na}`, cls: TONE.unknown.dot }] : []),
  ];
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-xs leading-4 text-cs-text-secondary tabular-nums">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span aria-hidden className={`h-2 w-2 rounded-full ${it.cls}`} />{it.label}
        </span>
      ))}
    </div>
  );
}
```

`components/ui/empty-state.tsx`
```tsx
// 막다른 화면 금지 규칙의 구현체 - 안내 문구 + 반드시 다음 행동 버튼(primary).
import { LinkButton } from './button';

export function EmptyState({ message, actionHref, actionLabel }: {
  message: string; actionHref: string; actionLabel: string;
}) {
  return (
    <div className="rounded-cs-container bg-white px-5 py-10 text-center shadow-cs-container">
      <p className="text-sm text-cs-text-secondary">{message}</p>
      <LinkButton href={actionHref} variant="primary" className="mt-4">{actionLabel}</LinkButton>
    </div>
  );
}
```

`components/ui/metric-card.tsx` — 파일 상단의 `VerdictBar` 정의를 지우고 다음 한 줄로 대체(기존 import 경로 호환; `MetricCard`는 T3까지 남긴다):
```tsx
export { VerdictBar } from './verdict-bar';
```
`MetricCard` 본문의 클래스는 손대지 않는다(T3에서 홈이 옮겨간 뒤 T12에서 파일 삭제).

- [ ] **Step 8: 기존 소비자 컴파일 유지** — `PageHeader`·`Badge`·`EmptyState`·`tableClass`는 props 호환이라 수정 불필요. `npx tsc --noEmit -p .`로 0 에러 확인. `StatusDot`을 쓰는 곳(`grep -rn "StatusDot" app components`)이 있으면 그대로 둔다(T4~T10에서 각 화면이 `StatusIndicator`로 옮긴다).

- [ ] **Step 9: 테스트 통과 확인** — `cd dashboard && npx vitest run` → 전체 PASS. 다른 테스트가 옛 Badge 클래스(`bg-green-50` 등)를 단언해 실패하면 그 단언만 새 토큰으로 갱신한다(동작 단언은 손대지 않는다).

- [ ] **Step 10: 커밋**

```bash
git add dashboard/components/ui
git commit -m "feat(dashboard): Cloudscape UI 프리미티브(Container·Button·FormField·StatusIndicator·Alert 등)"
```

---

### Task 3: 홈(현장 목록) + 테이블 도구 줄

**Files:**
- Create: `dashboard/components/site-table.tsx`(client), `dashboard/components/__tests__/site-table.test.tsx`
- Modify: `dashboard/app/page.tsx`(전체 교체 — 쿼리 5개·순서·필터 체인·주석은 보존, 처리 중 조회만 `select('status, scan_id')`로 확장), `dashboard/lib/domain/summary.ts`(`SiteSummary.inProgressCount` + `buildSiteSummaries` 다섯 번째 인자)
- Test: `dashboard/components/__tests__/site-table.test.tsx`(신규), `dashboard/app/__tests__/page.test.tsx`(렌더 describe 교체 + 배선 describe에 select 스파이 1건 추가), `dashboard/lib/domain/__tests__/summary.test.ts`(inProgressCount 케이스 추가)

**Interfaces:**
- Consumes:
  - T1: `<Icon name={IconName} size?={16} className? />`(`data-icon={name}`) — 이 태스크는 `'search' | 'upload' | 'plus'`만 쓴다(셀렉트의 `chevron-down`은 `SelectWrap`이 그린다).
  - T2: `PAGE_MAIN: string`; `<LinkButton href variant?: 'primary'|'normal'>`(next/link props, 기본 `normal`); `<Container title? counter? actions? padded?=true>children</Container>`; `<PageHeader title actions? />`(crumbs 생략 = 브레드크럼 없음); `<KeyValuePairs items={{label, value: ReactNode}[]} columns?={4} />`, `<StatValue value unit? />`; `<VerdictBar counts={VerdictCounts} />`(`[data-seg]`, 합계 0이면 '판정 없음'), `<VerdictLegend counts na? />`(na 생략 시 '불가' 항목 없음), `VerdictCounts = {pass, warn, fail}`(`components/ui/verdict-bar.tsx` export); `<StatusIndicator type={StatusType}>label</StatusIndicator>`(`data-status={type}`), `StatusType`(`components/ui/status-indicator.tsx` export); `inputClass`, `selectClass`, `<SelectWrap className?>{<select className={selectClass}/>}</SelectWrap>`; `tableClass = {table, thead, th, thNum, td, tdNum, row, link}`, `<TableToolbar>children</TableToolbar>`; `<EmptyState message actionHref actionLabel />`.
  - 소스(기존): `buildSiteSummaries`·`countInProgress`(`lib/domain/summary.ts`), `SupabaseErrorNotice`(`components/supabase-error.tsx` — 클래스는 T11 몫), `createClient`(`lib/supabase/server`), `AnalysisStatus`·`SiteRow`·`Verdict`(`lib/domain/types.ts`).
- Produces:
  - `lib/domain/summary.ts`: `SiteSummary.inProgressCount: number`; `buildSiteSummaries(sites, locations, scans, currentAnalyses, inProgress: { scan_id: string }[] = []): SiteSummary[]`(다섯 번째 인자 생략 시 `inProgressCount` 0 — 기존 4인자 호출 호환). `countInProgress`는 무변경.
  - `components/site-table.tsx`(client): `export type SiteTableRow = { id: string; name: string; locationCount: number; scanCount: number; lastScannedAt: string | null; counts: VerdictCounts; na: number; inProgress: number }`; `export type VerdictFilter = 'all' | 'fail' | 'warn' | 'na' | 'busy'`; `export function siteStatus(row: Pick<SiteTableRow, 'counts' | 'na' | 'inProgress'>): { type: StatusType; label: string }`; `export function SiteTable({ rows }: { rows: SiteTableRow[] })`.
  - 이후 태스크: T8(보고서 목록)이 도구 줄 구조(`TableToolbar` 안 검색 input + `SelectWrap` + 우측 건수 텍스트, 빈 결과 한 줄)를 이 파일을 본떠 자기 컴포넌트로 만든다(SiteTable을 재사용하지는 않는다). T12는 이 태스크 뒤 `components/ui/metric-card.tsx`의 소비자가 0이 됐음을 근거로 파일을 지운다.

- [ ] **Step 1: 아트보드 확인** — `docs/design/cloudscape/Main.dc.html`을 브라우저나 Read로 열어 `<main>` 안의 구조를 옮긴다. 옮길 섹션: (1) 페이지 헤더 — h1 '현장'(브레드크럼 없음, 스펙 §7-2) + 우측 normal 버튼 '스캔 업로드'(upload 아이콘), (2) 컨테이너 '개요' — 4열 그리드(현장 6곳 / 스캔 130건 / 처리 중 3건 / 판정 분포 123건 + 8px 분포 바 + 범례 적합·주의·재시공·불가), 2열부터 좌측 1px 구분선 + padding-left 20px(= `KeyValuePairs`), 판정 분포 열만 세로 gap 8px, (3) 컨테이너 '현장 (6)' — 헤더 우측 primary '새 현장'(plus 아이콘), 도구 줄(검색 360px, placeholder '현장 검색', search 아이콘 / 판정 셀렉트 / 우측 건수), 테이블 6열(현장명 링크 700 파랑 · 측정위치 우측 · 스캔 우측 · 최근 측정일 mono 13px `#414d5c` · 판정 분포 120px 바 + '31 · 6 · 2' 12px 보조색 · 상태 StatusIndicator). 옮기지 않는 것: 페이지네이션(‹ 1 ›)·새로고침 톱니(스펙 §7-3 — 건수 텍스트만), '최근 측정일' 헤더의 정렬 chevron(소스에 정렬 기능 없음), '판정: 전체'의 접두어(네이티브 select는 닫힌 상태에 접두어를 못 그린다 — 옵션 라벨 '전체' + `aria-label="판정 필터"`). 아트보드의 '판정 불가 3건'은 warning(삼각형, `#8d6605`)이지만 이 태스크는 `pending`(minus-circle, `cs-na`)으로 그린다 — "판정 불가 = `cs-na`"라는 스펙 §3 규칙이 우선. Next.js 가이드: `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`의 "Props passed to Client Components need to be serializable" — `SiteTable`에 넘기는 `rows`는 평면 객체 배열이어야 한다(`SiteSummary`의 `site: SiteRow` 통째가 아니라 `id`·`name`만 접는다). 그 밖에 새로 필요한 API는 없다(`Link`·`'use client'`).

- [ ] **Step 2: 실패하는 테스트 작성/갱신**

`lib/domain/__tests__/summary.test.ts` — 두 군데.

(a) `it('status=done이 아닌(queued/processing/failed) overall_verdict null 분석은 naCount에 잡히지 않는다', …)` 끝 — old:
```ts
    const [a] = buildSiteSummaries(sites, locations, scans, analyses);
    expect(a.naCount).toBe(0); // "판정 불가"는 done인데 verdict가 null인 경우만 - 미분석·실패는 별개
  });
```
new:
```ts
    const [a] = buildSiteSummaries(sites, locations, scans, analyses);
    expect(a.naCount).toBe(0); // "판정 불가"는 done인데 verdict가 null인 경우만 - 미분석·실패는 별개
    // currentAnalyses의 queued는 inProgressCount와 무관하다 - 처리 중은 다섯 번째 인자만 본다
    expect(a.inProgressCount).toBe(0);
  });
```

(b) `describe('buildSiteSummaries …')`의 마지막 `it('현장별 스캔 건수를 scanCount로 집계한다', …)` 뒤 — old:
```ts
    const [a, b] = buildSiteSummaries(sites, locations, scans, []);
    expect(a.scanCount).toBe(2);
    expect(b.scanCount).toBe(1);
  });
});
```
new:
```ts
    const [a, b] = buildSiteSummaries(sites, locations, scans, []);
    expect(a.scanCount).toBe(2);
    expect(b.scanCount).toBe(1);
  });
  it('처리 중 분석(다섯 번째 인자)을 scan_id -> 현장 맵으로 현장별 inProgressCount에 집계한다', () => {
    const sites = [site('s1', '현장A'), site('s2', '현장B')];
    const locations = [{ id: 'l1', site_id: 's1' }, { id: 'l2', site_id: 's2' }];
    const scans = [
      { id: 'c1', scanned_at: '2026-07-01', location_id: 'l1' },
      { id: 'c2', scanned_at: '2026-07-02', location_id: 'l1' },
      { id: 'c3', scanned_at: '2026-07-03', location_id: 'l2' },
    ];
    // c2는 평활도·구배 두 건이 동시에 처리 중일 수 있다(kind 무필터 - 두 번 센다).
    // 'ghost'는 어느 현장의 스캔도 아니다(삭제된 스캔의 잔여 분석 등) - 어디에도 잡히지 않아야 한다.
    const inProgress = [{ scan_id: 'c1' }, { scan_id: 'c2' }, { scan_id: 'c2' }, { scan_id: 'c3' }, { scan_id: 'ghost' }];
    const [a, b] = buildSiteSummaries(sites, locations, scans, [], inProgress);
    expect(a.inProgressCount).toBe(3);
    expect(b.inProgressCount).toBe(1);
  });
  it('inProgress 인자를 생략하면 inProgressCount는 0이고 나머지 집계는 그대로다(무변이 대조군)', () => {
    const sites = [site('s1', '현장A')];
    const locations = [{ id: 'l1', site_id: 's1' }, { id: 'l2', site_id: 's1' }];
    const scans = [
      { id: 'c1', scanned_at: '2026-07-01', location_id: 'l1' },
      { id: 'c2', scanned_at: '2026-07-20', location_id: 'l2' },
    ];
    const analyses = [
      { scan_id: 'c1', status: 'done' as const, overall_verdict: 'pass' as const },
      { scan_id: 'c2', status: 'done' as const, overall_verdict: null },
    ];
    const omitted = buildSiteSummaries(sites, locations, scans, analyses);
    // 기존 4인자 호출 == 빈 배열을 준 5인자 호출. 결과 전체를 대조해 다른 필드가 흔들리지 않았음을 본다.
    expect(omitted).toEqual(buildSiteSummaries(sites, locations, scans, analyses, []));
    expect(omitted[0]).toEqual({
      site: sites[0], locationCount: 2, scanCount: 2, lastScannedAt: '2026-07-20',
      verdictCounts: { pass: 1, borderline: 0, repair: 0, rework: 0 }, naCount: 1,
      inProgressCount: 0,
    });
  });
});
```

`components/__tests__/site-table.test.tsx` — 신규, 전체:

```tsx
// SiteTable(홈 현장 테이블, 클라이언트 섬 - 스펙 §7-3): 서버가 넘긴 rows를 검색·판정 필터로
// 거르고, 상태 열이 처리 중 > 판정 불가 > 완료 > 분석 없음 순으로 하나만 보이는지 본다.
// 서버 조회·URL은 관여하지 않으므로 next/navigation 모킹이 필요 없다.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SiteTable, siteStatus, type SiteTableRow } from '../site-table';

const row = (over: Partial<SiteTableRow> & Pick<SiteTableRow, 'id' | 'name'>): SiteTableRow => ({
  locationCount: 0, scanCount: 0, lastScannedAt: null,
  counts: { pass: 0, warn: 0, fail: 0 }, na: 0, inProgress: 0, ...over,
});

// 아트보드(Main.dc.html)의 행을 옮긴 픽스처 - 상태 4종(처리 중·완료·판정 불가·분석 없음)이 한 번씩 나온다.
const ROWS: SiteTableRow[] = [
  row({ id: 's1', name: '세종 M2블록 아파트', locationCount: 14, scanCount: 42, lastScannedAt: '2026-09-03',
    counts: { pass: 31, warn: 6, fail: 2 }, inProgress: 3 }),
  row({ id: 's2', name: '대전 도안 A1블록', locationCount: 9, scanCount: 27, lastScannedAt: '2026-09-01',
    counts: { pass: 20, warn: 5, fail: 1 } }),
  row({ id: 's3', name: '공주 월송 1블록', locationCount: 4, scanCount: 10, lastScannedAt: '2026-08-14',
    counts: { pass: 6, warn: 1, fail: 0 }, na: 3 }),
  row({ id: 's4', name: '한밭대 시험동', locationCount: 1 }),
];

// 지금 보이는 행의 현장명(첫 열 링크) 목록 - 테이블 안의 링크는 현장명뿐이다
function siteNames(): string[] {
  return screen.queryAllByRole('link').map((l) => l.textContent ?? '');
}
function search(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '현장 검색' }), { target: { value: text } });
}
// 옵션 라벨(화면 문구)로 고른다 - 값 문자열이 아니라 사용자가 보는 텍스트가 계약이다
function pickFilter(label: string) {
  const value = (screen.getByRole('option', { name: label }) as HTMLOptionElement).value;
  fireEvent.change(screen.getByRole('combobox', { name: '판정 필터' }), { target: { value } });
}

describe('SiteTable 열 (아트보드 Main: 현장명·측정위치·스캔·최근 측정일·판정 분포·상태)', () => {
  it('머리글 6열을 이 순서로 그린다', () => {
    render(<SiteTable rows={ROWS} />);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      '현장명', '측정위치', '스캔', '최근 측정일', '판정 분포 적합 · 주의 · 재시공', '상태',
    ]);
  });

  it('현장명은 /sites/[id] 링크(cs-link 700), 수치는 우측 mono, 최근 측정일은 mono, 분포는 120px 바 + 보조 텍스트', () => {
    render(<SiteTable rows={ROWS} />);
    const link = screen.getByRole('link', { name: '세종 M2블록 아파트' });
    expect(link).toHaveAttribute('href', '/sites/s1');
    expect(link.className).toContain('text-cs-link');
    expect(link.className).toContain('font-bold');

    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell'); // [0]은 머리글 행
    expect(cells[1].textContent).toBe('14');
    expect(cells[1].className).toContain('text-right');
    expect(cells[1].className).toContain('font-mono');
    expect(cells[2].textContent).toBe('42');
    expect(cells[3].textContent).toBe('2026-09-03');
    expect(cells[3].className).toContain('font-mono');
    const sub = within(cells[4]).getByText('31 · 6 · 2');
    expect(sub.className).toContain('text-cs-text-secondary');
    expect(sub.previousElementSibling?.className).toContain('w-[120px]');
    expect(cells[4].querySelectorAll('[data-seg]').length).toBe(3);
  });

  it('스캔이 없는 현장은 최근 측정일 "-", 판정 분포는 "판정 없음"만(보조 텍스트 0 · 0 · 0 없음)', () => {
    render(<SiteTable rows={[ROWS[3]]} />);
    const cells = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    expect(cells[3].textContent).toBe('-');
    expect(cells[4].textContent).toBe('판정 없음');
  });

  it('아이콘은 Icon 컴포넌트로 그린다(검색·셀렉트 chevron - 이모지 금지)', () => {
    const { container } = render(<SiteTable rows={ROWS} />);
    expect(container.querySelector('[data-icon="search"]')).toBeInTheDocument();
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
  });
});

describe('상태 열 (처리 중 > 판정 불가 > 완료 > 분석 없음)', () => {
  it.each([
    { name: '처리 중이 있으면 판정 불가·완료보다 앞선다',
      r: { counts: { pass: 1, warn: 0, fail: 0 }, na: 2, inProgress: 3 }, type: 'in-progress', label: '처리 중 3건' },
    { name: '처리 중이 없고 판정 불가가 있으면 pending(cs-na)',
      r: { counts: { pass: 6, warn: 1, fail: 0 }, na: 3, inProgress: 0 }, type: 'pending', label: '판정 불가 3건' },
    { name: '판정이 하나라도 있으면 완료',
      r: { counts: { pass: 0, warn: 0, fail: 1 }, na: 0, inProgress: 0 }, type: 'success', label: '완료' },
    { name: '아무 분석도 없으면 분석 없음',
      r: { counts: { pass: 0, warn: 0, fail: 0 }, na: 0, inProgress: 0 }, type: 'pending', label: '분석 없음' },
  ])('$name', ({ r, type, label }) => {
    expect(siteStatus(r)).toEqual({ type, label });
    render(<SiteTable rows={[row({ id: 'x', name: 'X', ...r })]} />);
    const el = screen.getByText(label);
    expect(el.getAttribute('data-status')).toBe(type);
    expect(el.closest('td')).not.toBeNull();
  });

  it('픽스처 4행의 상태가 각각 하나씩 나온다', () => {
    render(<SiteTable rows={ROWS} />);
    expect(screen.getByText('처리 중 3건').getAttribute('data-status')).toBe('in-progress');
    expect(screen.getByText('완료').getAttribute('data-status')).toBe('success');
    expect(screen.getByText('판정 불가 3건').getAttribute('data-status')).toBe('pending');
    expect(screen.getByText('분석 없음').getAttribute('data-status')).toBe('pending');
  });
});

describe('도구 줄 (클라이언트 필터 - 스펙 §7-3, 페이지네이션 없음)', () => {
  it('검색 입력(placeholder 현장 검색, 2px cs-input-border)·판정 필터 5종·"총 n곳", 페이지네이션 아이콘 없음', () => {
    const { container } = render(<SiteTable rows={ROWS} />);
    const input = screen.getByRole('textbox', { name: '현장 검색' });
    expect(input).toHaveAttribute('placeholder', '현장 검색');
    expect(input.className).toContain('border-cs-input-border');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '전체', '재시공 있음', '주의 있음', '판정 불가 있음', '처리 중',
    ]);
    expect(screen.getByText('총 4곳')).toBeInTheDocument();
    expect(container.querySelector('[data-icon="chevron-left"]')).toBeNull();
    expect(container.querySelector('[data-icon="chevron-right"]')).toBeNull();
  });

  it('검색은 현장명 includes(앞뒤 공백 제거·대소문자 무시)로 거르고 "총 n곳"이 따라간다', () => {
    render(<SiteTable rows={ROWS} />);
    search('블록');
    expect(siteNames()).toEqual(['세종 M2블록 아파트', '대전 도안 A1블록', '공주 월송 1블록']);
    expect(screen.getByText('총 3곳')).toBeInTheDocument();
    search('  a1 ');
    expect(siteNames()).toEqual(['대전 도안 A1블록']);
    search('');
    expect(siteNames()).toHaveLength(4);
  });

  it.each([
    { label: '재시공 있음', expected: ['세종 M2블록 아파트', '대전 도안 A1블록'] },
    { label: '주의 있음', expected: ['세종 M2블록 아파트', '대전 도안 A1블록', '공주 월송 1블록'] },
    { label: '판정 불가 있음', expected: ['공주 월송 1블록'] },
    { label: '처리 중', expected: ['세종 M2블록 아파트'] },
  ])('판정 필터 "$label"', ({ label, expected }) => {
    render(<SiteTable rows={ROWS} />);
    pickFilter(label);
    expect(siteNames()).toEqual(expected);
  });

  it('검색과 필터는 AND로 겹치고, "전체"로 되돌리면 검색만 남는다', () => {
    render(<SiteTable rows={ROWS} />);
    search('블록');
    pickFilter('재시공 있음');
    expect(siteNames()).toEqual(['세종 M2블록 아파트', '대전 도안 A1블록']);
    pickFilter('전체');
    expect(siteNames()).toEqual(['세종 M2블록 아파트', '대전 도안 A1블록', '공주 월송 1블록']);
  });

  it('조건에 맞는 행이 없으면 안내 한 줄만 그리고 링크는 없다', () => {
    render(<SiteTable rows={ROWS} />);
    search('없는현장');
    expect(screen.getByText('조건에 맞는 현장이 없습니다')).toBeInTheDocument();
    expect(siteNames()).toEqual([]);
    expect(screen.getByText('총 0곳')).toBeInTheDocument();
  });
});
```

`app/__tests__/page.test.tsx` — 다섯 군데를 교체한다. **`describe('HomePage 쿼리 배선 (단계 C 회귀 차단: I1)', …)`의 기존 `it` 두 개와 `collectText`는 한 글자도 바꾸지 않는다**(`.eq('kind','flatness')`·`.in('status', …)` 스파이 단언이 이 리디자인의 회귀 방어선이다).

(a) import 블록 — old:
```ts
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import HomePage from '../page';
import { MetricCard } from '@/components/ui/metric-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
```
new:
```ts
import { createClient } from '@/lib/supabase/server';
import HomePage from '../page';
import { SiteTable, type SiteTableRow } from '@/components/site-table';
import { PageHeader } from '@/components/ui/page-header';
import { Container } from '@/components/ui/container';
import { LinkButton } from '@/components/ui/button';
import { KeyValuePairs, StatValue } from '@/components/ui/key-value';
import { VerdictLegend } from '@/components/ui/verdict-bar';
import { EmptyState } from '@/components/ui/empty-state';
```

(b) `findAll` 헬퍼 — old:
```ts
// 엘리먼트 트리를 재귀 탐색해 특정 컴포넌트/태그 타입이 쓰인 곳을 모두 모은다.
function findAll(node: unknown, type: unknown, acc: { props: Record<string, unknown> }[] = []) {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) acc.push(el as { props: Record<string, unknown> });
  findAll(el.props?.children, type, acc);
  return acc;
}
```
new:
```ts
// 엘리먼트 트리를 재귀 탐색해 특정 컴포넌트/태그 타입이 쓰인 곳을 모두 모은다.
// Cloudscape 프리미티브는 슬롯을 children이 아니라 prop으로 받는다(PageHeader·Container의
// actions, KeyValuePairs의 items[].value) - children만 따라가면 그 안의 엘리먼트를 놓치므로
// 엘리먼트면 props 전부를, 평범한 객체(items 항목)면 그 값 전부를 따라간다.
// 함수(onChange 등)·문자열은 typeof 'object'가 아니라 자연히 건너뛴다.
type Found = { props: Record<string, unknown> };
function findAll(node: unknown, type: unknown, acc: Found[] = []): Found[] {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.type === type) acc.push(el as Found);
  const bag = (el.props ?? el) as Record<string, unknown>;
  for (const v of Object.values(bag)) findAll(v, type, acc);
  return acc;
}

// KeyValuePairs는 값을 items prop으로 받는다 - 라벨로 항목을 찾아 그 value 노드를 돌려준다.
function kvValue(el: unknown, label: string): unknown {
  for (const kv of findAll(el, KeyValuePairs)) {
    const hit = (kv.props.items as { label: unknown; value: unknown }[]).find((i) => i.label === label);
    if (hit) return hit.value;
  }
  return undefined;
}
```

(c) `chain` — old:
```ts
function chain(
  result: { data: unknown; error: null },
  spies?: { eq?: (col: string, val: unknown) => void; in?: (col: string, val: unknown) => void },
) {
  const obj: Record<string, unknown> = {
    select: () => obj, order: () => obj, is: () => obj,
```
new:
```ts
function chain(
  result: { data: unknown; error: null },
  spies?: {
    select?: (cols: string) => void;
    eq?: (col: string, val: unknown) => void; in?: (col: string, val: unknown) => void;
  },
) {
  const obj: Record<string, unknown> = {
    select: (cols: string) => { spies?.select?.(cols); return obj; }, order: () => obj, is: () => obj,
```

(d) `stubSupabase` — old:
```ts
  currentAnalyses?: unknown[]; inProgressAnalyses?: unknown[];
  eqSpy?: (col: string, val: unknown) => void; inSpy?: (col: string, val: unknown) => void;
}) {
```
new:
```ts
  currentAnalyses?: unknown[]; inProgressAnalyses?: unknown[];
  eqSpy?: (col: string, val: unknown) => void; inSpy?: (col: string, val: unknown) => void;
  // 처리 중(analyses 두 번째) 조회의 select 컬럼을 기록한다 - 'status, scan_id' 확장 배선용
  selectSpy?: (cols: string) => void;
}) {
```
같은 함수 안 — old:
```ts
        return chain({ data: opts.inProgressAnalyses ?? [], error: null }, { in: opts.inSpy });
```
new:
```ts
        return chain({ data: opts.inProgressAnalyses ?? [], error: null }, { in: opts.inSpy, select: opts.selectSpy });
```

(e) 배선 describe의 두 번째 `it` 끝에 세 번째 `it` 추가 — old:
```ts
    expect(inSpy).toHaveBeenCalledWith('status', ['queued', 'processing']);
  });
});
```
new:
```ts
    expect(inSpy).toHaveBeenCalledWith('status', ['queued', 'processing']);
  });

  it('처리 중 조회는 status와 scan_id를 함께 읽는다(테이블 상태 열의 현장별 건수 - 표시용 조회 확장)', async () => {
    const selectSpy = vi.fn();
    vi.mocked(createClient).mockResolvedValue(stubSupabase({ selectSpy }) as never);

    await HomePage();

    // 'status'만 남기면(회귀 재현) 행의 inProgress가 전부 0이 돼 상태 열이 조용히 틀린다.
    expect(selectSpy).toHaveBeenCalledWith('status, scan_id');
  });
});
```

(f) `describe('HomePage 렌더 (홈 지표 스트립 + 현장 밀도 테이블)', …)` 블록 전체를 다음으로 교체:
```tsx
describe('HomePage 렌더 (PageHeader + 개요 KeyValuePairs + 현장 테이블)', () => {
  const sites = [{ id: 's1', name: '현장A', address: null, memo: null, created_at: '', updated_at: '' }];
  const locations = [{ id: 'l1', site_id: 's1' }];
  const scans = [{ id: 'c1', scanned_at: '2026-07-20', location_id: 'l1' }];

  it('현장 행이 SiteTable rows로 실리고, 개요 "처리 중"과 행의 inProgress는 queued+processing만 센다', async () => {
    const currentAnalyses = [{ scan_id: 'c1', status: 'done', overall_verdict: 'pass', kind: 'flatness' }];
    // 실제 처리 중 조회는 .in('status', [...])가 done을 돌려주지 않는다 - 스텁의 done 행은
    // countInProgress 자체의 가드를 보는 용도라 scan_id를 붙이지 않는다(현장별 집계는 상태를
    // 다시 거르지 않고 쿼리의 필터를 믿는다 - 배선 describe의 .in 스파이가 그 필터를 지킨다).
    const inProgressAnalyses = [
      { status: 'queued', scan_id: 'c1' }, { status: 'processing', scan_id: 'c1' }, { status: 'done' },
    ];
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ sites, locations, scans, currentAnalyses, inProgressAnalyses }) as never,
    );

    const el = await HomePage();

    // 현장 링크는 클라이언트 컴포넌트(SiteTable) 안에서 그려져 트리 탐색으로 닿지 않는다 -
    // SiteTable에 전달된 rows로 검증한다(링크 렌더 자체는 components/__tests__/site-table.test.tsx가 본다).
    const tables = findAll(el, SiteTable);
    expect(tables).toHaveLength(1);
    expect(tables[0].props.rows as SiteTableRow[]).toEqual([{
      id: 's1', name: '현장A', locationCount: 1, scanCount: 1, lastScannedAt: '2026-07-20',
      counts: { pass: 1, warn: 0, fail: 0 }, na: 0, inProgress: 2,
    }]);

    const [kv] = findAll(el, KeyValuePairs);
    expect(kv.props.columns).toBe(4);
    expect((kv.props.items as { label: string }[]).map((i) => i.label)).toEqual(['현장', '스캔', '처리 중', '판정 분포']);
    expect(findAll(kvValue(el, '현장'), StatValue)[0]?.props.value).toBe(1);
    expect(findAll(kvValue(el, '스캔'), StatValue)[0]?.props.value).toBe(1);
    expect(findAll(kvValue(el, '처리 중'), StatValue)[0]?.props.value).toBe(2); // queued+processing만(done 제외)
    expect(findAll(kvValue(el, '판정 분포'), StatValue)[0]?.props.value).toBe(1);
  });

  it('헤더·컨테이너 배선: normal "스캔 업로드"(/upload), primary "새 현장"(/sites/new) - primary는 하나, 브레드크럼 없음', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ sites, locations, scans, currentAnalyses: [] }) as never,
    );

    const el = await HomePage();

    const [header] = findAll(el, PageHeader);
    expect(header.props.title).toBe('현장');
    expect(header.props.crumbs).toBeUndefined(); // 홈에는 브레드크럼 없음(스펙 §7-2)

    const buttons = findAll(el, LinkButton);
    const variantByHref = Object.fromEntries(buttons.map((b) => [b.props.href, b.props.variant]));
    expect(variantByHref).toEqual({ '/upload': undefined, '/sites/new': 'primary' }); // undefined = normal(기본)
    expect(buttons.filter((b) => b.props.variant === 'primary')).toHaveLength(1);
    expect(collectText(buttons.find((b) => b.props.href === '/upload'))).toContain('스캔 업로드');
    expect(collectText(buttons.find((b) => b.props.href === '/sites/new'))).toContain('새 현장');

    expect(findAll(el, Container).map((c) => c.props.title)).toEqual(['개요', '현장']);
    const table = findAll(el, Container).find((c) => c.props.title === '현장');
    expect(table?.props.counter).toBe(1);
    expect(table?.props.padded).toBe(false);
  });

  it('판정 불가(na) 건수를 개요 범례(불가 n)와 테이블 행(na)으로 넘긴다(리뷰 픽스 유지)', async () => {
    // status=done인데 overall_verdict null -> "엔진은 돌았는데 판정이 안 나온" 케이스(naCount).
    const currentAnalyses = [{ scan_id: 'c1', status: 'done', overall_verdict: null, kind: 'flatness' }];
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ sites, locations, scans, currentAnalyses }) as never,
    );

    const el = await HomePage();

    const legend = findAll(kvValue(el, '판정 분포'), VerdictLegend);
    expect(legend).toHaveLength(1);
    expect(legend[0].props.na).toBe(1);
    expect(legend[0].props.counts).toEqual({ pass: 0, warn: 0, fail: 0 });
    expect(findAll(kvValue(el, '판정 분포'), StatValue)[0]?.props.value).toBe(0); // na는 총계에 들지 않는다(기존 동작)

    const rows = findAll(el, SiteTable)[0].props.rows as SiteTableRow[];
    expect(rows[0].na).toBe(1);
    expect(rows[0].counts).toEqual({ pass: 0, warn: 0, fail: 0 });
  });

  it('naCount가 0이면 범례에 불가 항목을 넘기지 않고 행의 na도 0이다(판정 불가 표시 없음)', async () => {
    const currentAnalyses = [{ scan_id: 'c1', status: 'done', overall_verdict: 'pass', kind: 'flatness' }];
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase({ sites, locations, scans, currentAnalyses }) as never,
    );

    const el = await HomePage();

    const legend = findAll(kvValue(el, '판정 분포'), VerdictLegend);
    expect(legend).toHaveLength(1);
    expect(legend[0].props.na).toBeUndefined();
    expect(legend[0].props.counts).toEqual({ pass: 1, warn: 0, fail: 0 });
    expect((findAll(el, SiteTable)[0].props.rows as SiteTableRow[])[0].na).toBe(0);
  });

  it('현장이 없으면 개요는 그대로 두고 테이블 컨테이너 대신 업로드 안내 빈 상태를 렌더한다', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase({}) as never);

    const el = await HomePage();

    // EmptyState는 컴포넌트 참조로만 트리에 실리고(실행되지 않는다), 내부에서 렌더하는
    // LinkButton은 findAll로 닿지 않는다 - EmptyState 자신에게 전달된 props로 문구·이동 대상을 검증한다.
    const emptyStates = findAll(el, EmptyState);
    expect(emptyStates).toHaveLength(1);
    expect(emptyStates[0].props.actionHref).toBe('/upload');
    expect(emptyStates[0].props.message).toContain('아직 등록된 현장이 없습니다');
    expect(findAll(el, SiteTable)).toHaveLength(0);
    expect(findAll(el, Container).map((c) => c.props.title)).toEqual(['개요']);
    expect(findAll(kvValue(el, '현장'), StatValue)[0]?.props.value).toBe(0);
    // 이 분기의 primary는 EmptyState 안(트리 밖) 하나뿐 - 헤더의 '스캔 업로드'는 normal
    expect(findAll(el, LinkButton).filter((b) => b.props.variant === 'primary')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 실패 확인** — `cd dashboard && npx vitest run lib/domain/__tests__/summary.test.ts components/__tests__/site-table.test.tsx app/__tests__/page.test.tsx` → FAIL 3파일: summary는 `expected undefined to be 0`/`… to be 3`(`inProgressCount` 필드 없음, 3건), site-table은 `Failed to resolve import "../site-table"`(파일 전체), page는 `Failed to resolve import "@/components/site-table"`(파일 전체 — 배선 `it` 두 개도 이 단계에서는 같이 실패하지만 Step 6 뒤 그대로 통과해야 한다).

- [ ] **Step 4: summary.ts 수정** — `SiteSummary`에 필드 추가, 다섯 번째 인자 도입. `countInProgress`는 그대로.

old:
```ts
  // 홈 카드 집계에서 조용히 누락됐다 - 별도 카운트로 분리해 총계에 포함시킨다.
  naCount: number;
}

export function buildSiteSummaries(
  sites: SiteRow[],
  locations: { id: string; site_id: string }[],
  scans: { id: string; scanned_at: string; location_id: string }[],
  currentAnalyses: { scan_id: string; status: AnalysisStatus; overall_verdict: Verdict | null }[],
): SiteSummary[] {
```
new:
```ts
  // 홈 카드 집계에서 조용히 누락됐다 - 별도 카운트로 분리해 총계에 포함시킨다.
  naCount: number;
  // 현장별 처리 중(큐 대기·실행 중) 분석 건수 - 홈 테이블 상태 열("처리 중 n건")용.
  // 판정 집계(currentAnalyses, kind='flatness')와 달리 kind 무필터 행을 받는다(countInProgress와 같은 출처).
  inProgressCount: number;
}

export function buildSiteSummaries(
  sites: SiteRow[],
  locations: { id: string; site_id: string }[],
  scans: { id: string; scanned_at: string; location_id: string }[],
  currentAnalyses: { scan_id: string; status: AnalysisStatus; overall_verdict: Verdict | null }[],
  // 처리 중 분석 행. 상태 필터는 호출자의 쿼리(.in('status', ['queued','processing']))가 담당하므로
  // 여기서는 scan_id만 본다. 생략하면 inProgressCount는 0 - 기존 4인자 호출 호환.
  inProgress: { scan_id: string }[] = [],
): SiteSummary[] {
```

old:
```ts
      } else if (a.status === 'done') {
        naCount += 1;
      }
    }
    return { site, locationCount: locCount, scanCount: siteScans.length, lastScannedAt, verdictCounts, naCount };
  });
}
```
new:
```ts
      } else if (a.status === 'done') {
        naCount += 1;
      }
    }
    // 판정 집계와 같은 siteOfScan 맵을 재사용한다 - 어느 현장의 스캔도 아닌 scan_id(삭제된 스캔 등)는
    // 어디에도 잡히지 않는다.
    const inProgressCount = inProgress.filter((a) => siteOfScan.get(a.scan_id) === site.id).length;
    return {
      site, locationCount: locCount, scanCount: siteScans.length, lastScannedAt, verdictCounts, naCount, inProgressCount,
    };
  });
}
```

- [ ] **Step 5: site-table.tsx 작성** — 신규, 전체:

```tsx
'use client';
// 홈 현장 테이블 + 도구 줄(클라이언트 섬 - 스펙 §7-3): 서버가 이미 조회한 rows를 검색 입력과 판정
// 필터로 걸러 보여준다. 서버 조회·URL은 건드리지 않는다. 아트보드의 페이지네이션(‹ 1 ›)은 현재
// 데이터 규모에서 YAGNI - 우측에 건수 텍스트('총 n곳')만 둔다. 마크업·수치: docs/design/cloudscape/Main.dc.html
import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/ui/icons';
import { inputClass, selectClass, SelectWrap } from '@/components/ui/form';
import { tableClass, TableToolbar } from '@/components/ui/data-table';
import { VerdictBar, type VerdictCounts } from '@/components/ui/verdict-bar';
import { StatusIndicator, type StatusType } from '@/components/ui/status-indicator';

// 서버(app/page.tsx)가 SiteSummary를 접어 넘기는 행. 클라이언트 경계를 넘으므로 직렬화 가능한
// 평면 객체만 둔다(Next 가이드 server-and-client-components "serializable").
export type SiteTableRow = {
  id: string;
  name: string;
  locationCount: number;
  scanCount: number;
  lastScannedAt: string | null;
  // 4단계 판정을 3버킷(적합/주의/재시공)으로 접은 값 - 접는 규칙은 app/page.tsx의 toBarCounts
  counts: VerdictCounts;
  // 판정 불가(done인데 overall_verdict null) 건수
  na: number;
  // 처리 중(queued·processing) 분석 건수
  inProgress: number;
};

// 판정 필터 선택지 - 값은 행의 어느 수치를 보는지, 라벨은 화면 문구.
export type VerdictFilter = 'all' | 'fail' | 'warn' | 'na' | 'busy';
const FILTERS: { value: VerdictFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'fail', label: '재시공 있음' },
  { value: 'warn', label: '주의 있음' },
  { value: 'na', label: '판정 불가 있음' },
  { value: 'busy', label: '처리 중' },
];

function matchesFilter(row: SiteTableRow, f: VerdictFilter): boolean {
  switch (f) {
    case 'fail': return row.counts.fail > 0;
    case 'warn': return row.counts.warn > 0;
    case 'na': return row.na > 0;
    case 'busy': return row.inProgress > 0;
    default: return true;
  }
}

// 상태 열: 처리 중 > 판정 불가 > 완료 > 분석 없음 순으로 하나만 보인다. 처리 중이 있으면 그 사실이
// 먼저다(판정 불가 건수는 개요 범례와 '판정 불가 있음' 필터로 여전히 닿는다).
// "판정 불가"는 스펙 §3의 cs-na 색이므로 pending(minus-circle)이다(아트보드의 warning 삼각형은 채택하지 않는다).
export function siteStatus(row: Pick<SiteTableRow, 'counts' | 'na' | 'inProgress'>): { type: StatusType; label: string } {
  if (row.inProgress > 0) return { type: 'in-progress', label: `처리 중 ${row.inProgress}건` };
  if (row.na > 0) return { type: 'pending', label: `판정 불가 ${row.na}건` };
  if (row.counts.pass + row.counts.warn + row.counts.fail > 0) return { type: 'success', label: '완료' };
  return { type: 'pending', label: '분석 없음' };
}

export function SiteTable({ rows }: { rows: SiteTableRow[] }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<VerdictFilter>('all');
  // 현장명 includes(앞뒤 공백 제거, 대소문자 무시 - 'a1'로 'A1블록'을 찾는다). 검색과 필터는 AND.
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => (q === '' || r.name.toLowerCase().includes(q)) && matchesFilter(r, filter));

  return (
    <>
      <TableToolbar>
        {/* 아트보드: 360px, 2px cs-input-border, 좌측 search 아이콘. inputClass의 px-2는 pl-8이 덮는다
            (Tailwind는 단축 속성 px를 개별 속성 pl보다 앞에 내보내므로 뒤의 pl-8이 이긴다). */}
        <div className="relative w-[360px] max-w-full">
          <Icon name="search" className="pointer-events-none absolute left-2 top-2 text-cs-text-secondary" />
          <input type="text" aria-label="현장 검색" placeholder="현장 검색" value={query}
            onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-8`} />
        </div>
        <SelectWrap className="w-44">
          <select aria-label="판정 필터" value={filter} className={selectClass}
            onChange={(e) => setFilter(e.target.value as VerdictFilter)}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </SelectWrap>
        {/* 필터 결과 건수 - 컨테이너 헤더의 (n)은 전체 현장 수, 여기는 지금 보이는 행 수 */}
        <span className="ml-auto text-sm text-cs-text-secondary tabular-nums">{`총 ${visible.length}곳`}</span>
      </TableToolbar>
      {/* 375px에서 6열이 본문을 넘치므로 테이블만 가로 스크롤(스펙 §9-4: 페이지는 세로 스택 유지) */}
      <div className="overflow-x-auto">
        <table className={tableClass.table}>
          <thead className={tableClass.thead}>
            <tr>
              <th className={tableClass.th}>현장명</th>
              <th className={tableClass.thNum}>측정위치</th>
              <th className={tableClass.thNum}>스캔</th>
              <th className={tableClass.th}>최근 측정일</th>
              <th className={tableClass.th}>판정 분포 <span className="font-normal text-cs-text-secondary">적합 · 주의 · 재시공</span></th>
              <th className={tableClass.th}>상태</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${tableClass.td} text-center text-cs-text-secondary`}>조건에 맞는 현장이 없습니다</td>
              </tr>
            ) : visible.map((r) => {
              const status = siteStatus(r);
              const total = r.counts.pass + r.counts.warn + r.counts.fail;
              return (
                <tr key={r.id} className={tableClass.row}>
                  <td className={tableClass.td}>
                    <Link href={`/sites/${r.id}`} className={tableClass.link}>{r.name}</Link>
                  </td>
                  <td className={tableClass.tdNum}>{r.locationCount}</td>
                  <td className={tableClass.tdNum}>{r.scanCount}</td>
                  {/* 아트보드: 모노 13px, #414d5c(= cs-nav-text) - Reports 아트보드의 생성일 열과 같은 스타일 */}
                  <td className={`${tableClass.td} font-mono text-[13px] text-cs-nav-text tabular-nums`}>{r.lastScannedAt ?? '-'}</td>
                  <td className={tableClass.td}>
                    <div className="flex items-center gap-3">
                      <div className="w-[120px] shrink-0"><VerdictBar counts={r.counts} /></div>
                      {/* 합계 0이면 VerdictBar가 '판정 없음'을 쓰므로 '0 · 0 · 0'을 겹쳐 쓰지 않는다 */}
                      {total > 0 && (
                        <span className="text-xs text-cs-text-secondary tabular-nums">
                          {`${r.counts.pass} · ${r.counts.warn} · ${r.counts.fail}`}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={tableClass.td}>
                    <StatusIndicator type={status.type}>{status.label}</StatusIndicator>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 6: app/page.tsx 전체 교체** — 보존되는 것: `dynamic = 'force-dynamic'`, `toBarCounts`와 그 주석, `Promise.all`의 쿼리 5개와 순서·필터 체인·주석(처리 중 조회만 `select('status, scan_id')`로 확장), `firstError` 가드, `verdictCounts`/`verdictBar`/`verdictTotal`/`totalNaCount` 계산과 리뷰 주석, `totalNaCount > 0` 가드(범례 `na`로 옮긴다), EmptyState의 문구·링크·주석. 사라지는 것: `Link`·`MetricCard`·`Badge`·`tableClass` import(테이블은 `SiteTable`로), `p-6`·`zinc-*` 클래스.

```tsx
// 홈(현장 목록) - PageHeader + 개요 KeyValuePairs + 현장 테이블(클라이언트 도구 줄).
// 아트보드: docs/design/cloudscape/Main.dc.html (브레드크럼 없음 - 스펙 §7-2).
// 조회·집계 로직은 무변경 - 처리 중 조회에 scan_id를 더한 표시용 확장(스펙 §2)만.
import { createClient } from '@/lib/supabase/server';
import { buildSiteSummaries, countInProgress } from '@/lib/domain/summary';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { SiteTable, type SiteTableRow } from '@/components/site-table';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { LinkButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { Container } from '@/components/ui/container';
import { KeyValuePairs, StatValue } from '@/components/ui/key-value';
import { VerdictBar, VerdictLegend } from '@/components/ui/verdict-bar';
import { EmptyState } from '@/components/ui/empty-state';
import type { AnalysisStatus, SiteRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

// 4단계 판정(pass/borderline/repair/rework)을 VerdictBar의 3버킷(pass/warn/fail)으로
// 접는다 - 경계는 아직 적합 범위라 warn, 보수·재시공은 조치가 필요해 fail로 묶는다.
function toBarCounts(v: Record<Verdict, number>): { pass: number; warn: number; fail: number } {
  return { pass: v.pass, warn: v.borderline, fail: v.repair + v.rework };
}

export default async function HomePage() {
  const supabase = await createClient();
  const [sitesRes, locationsRes, scansRes, analysesRes, inProgressRes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    supabase.from('locations').select('id, site_id'),
    supabase.from('scans').select('id, scanned_at, location_id').is('deleted_at', null),
    // 리뷰 Important 3: "판정 불가"(done인데 overall_verdict null) 집계를 위해 status도 함께 조회
    // 단계 C 회귀 차단: kind 필터가 없으면 구배 분석이 섞여 판정 집계가 2배로 계상된다.
    // 홈·현장 트리에 두 종류를 함께 보이는 화면 설계는 아직 없다(단계 D 몫).
    supabase.from('analyses').select('scan_id, status, overall_verdict, kind')
      .eq('is_current', true).eq('kind', 'flatness').is('deleted_at', null),
    // 처리 중 지표는 kind 무필터 - 평활도·구배 분석 모두 "처리 중"에 잡혀야 한다.
    // 위 판정 집계 쿼리(kind='flatness')와는 목적이 다른 별도 쿼리다.
    // scan_id는 테이블 상태 열의 현장별 "처리 중 n건"용(표시용 조회 확장 - 스펙 §2).
    supabase.from('analyses').select('status, scan_id').in('status', ['queued', 'processing']).is('deleted_at', null),
  ]);
  const firstError = sitesRes.error ?? locationsRes.error ?? scansRes.error ?? analysesRes.error ?? inProgressRes.error;
  if (firstError) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={firstError.message} /></main>;
  }
  // 처리 중 행 하나로 개요 지표(countInProgress)와 현장별 건수(buildSiteSummaries)를 모두 만든다.
  const inProgressRows = (inProgressRes.data ?? []) as { status: AnalysisStatus; scan_id: string }[];
  const summaries = buildSiteSummaries(
    (sitesRes.data ?? []) as SiteRow[],
    locationsRes.data ?? [],
    scansRes.data ?? [],
    (analysesRes.data ?? []) as { scan_id: string; status: AnalysisStatus; overall_verdict: Verdict | null }[],
    inProgressRows,
  );
  const totalScans = (scansRes.data ?? []).length;
  const inProgress = countInProgress(inProgressRows);
  const verdictCounts = summaries.reduce(
    (acc, s) => ({
      pass: acc.pass + s.verdictCounts.pass,
      borderline: acc.borderline + s.verdictCounts.borderline,
      repair: acc.repair + s.verdictCounts.repair,
      rework: acc.rework + s.verdictCounts.rework,
    }),
    { pass: 0, borderline: 0, repair: 0, rework: 0 } as Record<Verdict, number>,
  );
  const verdictBar = toBarCounts(verdictCounts);
  const verdictTotal = verdictBar.pass + verdictBar.warn + verdictBar.fail;
  // 리뷰 Important: "엔진은 돌았는데 판정이 안 나온"(done인데 overall_verdict null) 현장이
  // "분석을 안 한 현장"과 구분되지 않으면 안 된다 - VerdictBar는 pass/warn/fail 3버킷만
  // 지원해 na를 표시할 수 없으므로 개요 범례('불가 n' - 0이면 생략)와 테이블 상태 열
  // ('판정 불가 n건')로 별도 노출한다.
  const totalNaCount = summaries.reduce((n, s) => n + s.naCount, 0);
  // SiteSummary를 클라이언트 테이블 행(직렬화 가능한 평면 객체)으로 접는다
  const rows: SiteTableRow[] = summaries.map((s) => ({
    id: s.site.id, name: s.site.name, locationCount: s.locationCount, scanCount: s.scanCount,
    lastScannedAt: s.lastScannedAt, counts: toBarCounts(s.verdictCounts), na: s.naCount, inProgress: s.inProgressCount,
  }));

  return (
    <main className={PAGE_MAIN}>
      {/* 홈에는 브레드크럼 없음(스펙 §7-2). 이 뷰의 primary는 '새 현장' 하나 - 여기는 normal(기본) */}
      <PageHeader title="현장" actions={
        <LinkButton href="/upload"><Icon name="upload" />스캔 업로드</LinkButton>
      } />
      <Container title="개요">
        <KeyValuePairs columns={4} items={[
          { label: '현장', value: <StatValue value={summaries.length} unit="곳" /> },
          { label: '스캔', value: <StatValue value={totalScans} unit="건" /> },
          { label: '처리 중', value: <StatValue value={inProgress} unit="건" /> },
          {
            label: '판정 분포',
            value: (
              // 아트보드: 이 열만 세로 gap 8px(수치 → 8px 바 → 범례)
              <div className="flex flex-col gap-2">
                <StatValue value={verdictTotal} unit="건" />
                <VerdictBar counts={verdictBar} />
                <VerdictLegend counts={verdictBar} na={totalNaCount > 0 ? totalNaCount : undefined} />
              </div>
            ),
          },
        ]} />
      </Container>
      {summaries.length === 0 ? (
        // 이전 3단계 안내(현장 등록 -> 측정위치 -> 업로드)의 취지는 유지하되, 버튼은
        // 업로드 셀프서비스 흐름(단계 D4)에 맞춰 업로드 화면으로 바로 보낸다(브리프 Step 4).
        // 이 분기에서는 EmptyState의 primary가 이 뷰의 유일한 primary다('새 현장' 컨테이너는 없다).
        <EmptyState
          message="아직 등록된 현장이 없습니다. 업로드 화면에서 현장 생성까지 한 번에 할 수 있습니다."
          actionHref="/upload"
          actionLabel="스캔 업로드로 시작"
        />
      ) : (
        <Container title="현장" counter={summaries.length} padded={false}
          actions={<LinkButton href="/sites/new" variant="primary"><Icon name="plus" />새 현장</LinkButton>}>
          <SiteTable rows={rows} />
        </Container>
      )}
    </main>
  );
}
```

- [ ] **Step 7: 잔재·소비자 확인** — `grep -nE "zinc-|amber-|red-|green-|emerald-|purple-|blue-" dashboard/app/page.tsx dashboard/components/site-table.tsx` → 0건. `grep -rn "metric-card\|MetricCard\|ui/badge\|from 'next/link'" dashboard/app/page.tsx dashboard/app/__tests__/page.test.tsx` → 0건. `grep -rln "metric-card" dashboard/app dashboard/components` → `dashboard/components/ui/metric-card.tsx` 자기 자신뿐이어야 한다(파일은 T12가 지운다 — 여기서 삭제하지 않는다). `npx eslint app/page.tsx components/site-table.tsx app/__tests__/page.test.tsx components/__tests__/site-table.test.tsx`(`cd dashboard`) → 미사용 import 0건.

- [ ] **Step 8: 통과 확인** — `cd dashboard && npx vitest run` → 전체 PASS(summary 8건 + site-table 17건 + page 8건 포함). `npx tsc --noEmit -p .` → 0 에러(테스트 파일도 tsconfig `include`에 들어가므로 테스트의 타입 오류도 여기서 잡힌다). dev server가 뜨는 환경이면 `/`를 375px과 1440px에서 열어 `docs/design/cloudscape/Main.dc.html`과 나란히 대조하고 콘솔 오류 0을 확인한다(최종 전 화면 대조는 T12 — `app/loading.tsx`는 T11까지 `p-6`이라 홈 로딩→화면 전환에 한 번 점프가 남는 것은 이 태스크의 결함이 아니다).

- [ ] **Step 9: 커밋**

```bash
git add dashboard/app/page.tsx dashboard/app/__tests__/page.test.tsx dashboard/lib/domain/summary.ts dashboard/lib/domain/__tests__/summary.test.ts dashboard/components/site-table.tsx dashboard/components/__tests__/site-table.test.tsx
git commit -m "feat(dashboard): 홈 현장 목록 Cloudscape 재구성 - 개요 KeyValuePairs + SiteTable 도구 줄(검색·판정 필터)·상태 열

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

---

### Task 4: 현장 상세 · 새 현장

**Files:**
- Modify: `dashboard/app/sites/[id]/page.tsx`, `dashboard/app/sites/new/page.tsx`, `dashboard/components/location-tree.tsx`, `dashboard/components/new-location-form.tsx`, `dashboard/components/new-site-form.tsx`, `dashboard/components/photo-gallery.tsx`, `dashboard/components/photo-uploader.tsx`
- Test(갱신): `dashboard/app/sites/[id]/__tests__/page.test.tsx`, `dashboard/components/__tests__/location-tree.test.tsx`, `dashboard/components/__tests__/new-site-form.test.tsx`
- Test(신규): `dashboard/app/sites/new/__tests__/page.test.tsx`, `dashboard/components/__tests__/new-location-form.test.tsx`, `dashboard/components/__tests__/photo-gallery.test.tsx`, `dashboard/components/__tests__/photo-uploader.test.tsx`
- 손대지 않음: `dashboard/app/sites/[id]/loading.tsx`(T11), `dashboard/components/refresh-on-upload.tsx`(래퍼, 변경 불필요), `dashboard/components/supabase-error.tsx`(T11)

**Interfaces:**
- Consumes(T1·T2):
  - `PAGE_MAIN`(`components/ui/page.tsx`) — 세 `page.tsx`/에러 분기 `<main>` 전부.
  - `<Container title? counter? padded?=true>`(`components/ui/container.tsx`) — `counter`는 `number`, `padded={false}`는 현장 사진 컨테이너.
  - `<PageHeader crumbs title description? />`(`components/ui/page-header.tsx`) — `description`에 주소(`string | null`).
  - `<Button variant type>`, `<LinkButton href variant>`, `buttonClass(variant, { disabled })`(`components/ui/button.tsx`).
  - `<FormField label htmlFor>`, `inputClass`, `textareaClass`(`components/ui/form.tsx`).
  - `<StatusIndicator type>`, `TONE_STATUS`(`components/ui/status-indicator.tsx`) — 판정 배지 → 상태 표시.
  - `<Icon name="upload" />`, `<Icon name="plus" />`(`components/ui/icons.tsx`).
  - 소스에 이미 있는 것: `GRADE_TONE`(`lib/domain/grade-tone.ts`), `GRADE_LABEL`·`SCAN_STATUS_LABEL`·`SURFACE_LABEL`(`lib/domain/labels.ts`), `buildLocationTree`(`lib/domain/tree.ts`), `RefreshOnUpload`, `SupabaseErrorNotice`, `uploadPhoto`·`photoUrl`(`lib/photos/upload.ts`).
- Produces: 없음. 기존 export 시그니처(`LocationTree`·`ScanWithCurrent`·`NewLocationForm`·`NewSiteForm`·`PhotoGallery`·`PhotoUploader`)는 그대로다. `PhotoGallery`·`RefreshOnUpload`는 `components/analysis/analysis-result.tsx`(T7)도 쓰므로 T7 화면에도 이 재스킨이 그대로 반영된다(API 무변경).

- [ ] **Step 1: 아트보드 확인** — `docs/design/cloudscape/SiteDetail.dc.html`·`SiteNew.dc.html`을 브라우저나 Read로 열어 `<main>` 안의 구조를 그대로 옮긴다. 옮길 섹션:
  - SiteDetail: 브레드크럼 `현장 › 현장명` + h1 현장명 + 주소 설명 → 컨테이너 **측정위치 (n)**: 동(16px/20px 700) › 층(700, `#414d5c`=`cs-nav-text`) › 공간(`#5f6b7a`=`cs-text-secondary`) 소제목이 각각 `padding-left 20px` + `border-left 1px #e9ebed`로 들여쓰기, 측정위치 카드(`padding 12px 16px`, `border 1px #e9ebed`, `radius 8px`): 이름 700 + 우측 `gap 16px`로 텍스트 링크 **스캔 정합**·**보고서** + 알약(normal) **스캔 업로드**(upload 아이콘); 스캔 행(`gap 4px`): 일시 mono 13px `cs-link` · `· 바닥` 보조색 · StatusIndicator(적합=check-circle success, 경계=triangle warning, 보수·재시공=x-circle error, 업로드됨·분석 준비됨=clock 보조색) → 컨테이너 **새 측정위치**: 필드 5개(동 120 · 층 120 · 층 순서(정수) 140 · 공간 140 · 측정위치 200px, `align-items: flex-end`, `gap 16px`) + **위치 추가**(plus 아이콘; 아트보드는 normal이지만 스펙 §6이 primary — 뷰당 primary 1개가 이것) → 컨테이너 **현장 사진 (n)**: 업로더 줄(설명 입력 360px + 알약 **사진 추가** upload 아이콘) 아래 구분선 + `grid 4열 gap 12px` figure(`padding 4px`, `border 1px #e9ebed`, `radius 8px`, 이미지 128px, figcaption 12px/16px `#414d5c`).
  - SiteNew: 브레드크럼 `현장 › 새 현장 등록` + h1 → 헤더 없는 컨테이너 안 필드 3개(폭 448px; 현장명 (필수) 32px / 주소 32px / 메모 `min-height 96px`) → **컨테이너 밖** 우측 정렬 primary **현장 등록**(plus 아이콘).
  - 이 태스크는 새 Next API를 쓰지 않는다(`Link`·`useRouter`는 기존 소스 그대로, `LinkButton`은 T2가 `next/link`를 감쌌다). `dashboard/AGENTS.md` 관례 확인은 T1이 했다.

- [ ] **Step 2: 실패하는 테스트 작성/갱신**

`components/__tests__/location-tree.test.tsx` — 기존 describe('LocationTree (리뷰 Important 3: …)')는 **그대로 두고** 파일 끝에 다음 describe를 추가한다:

```tsx
// Cloudscape 재스킨(T4): 판정은 StatusIndicator(data-status)로, 측정위치는 카드로, 액션은
// 텍스트 링크 2개 + normal LinkButton '스캔 업로드'. 위 describe의 문구 단언은 그대로 유지한다.
describe('LocationTree (Cloudscape 재스킨: StatusIndicator + 카드 + 액션)', () => {
  const loc = location('l1', '측정1');

  const cases: [string, ScanWithCurrent['current'], string][] = [
    ['적합', { id: 'a1', status: 'done', overall_verdict: 'pass' }, 'success'],
    ['판정 불가', { id: 'a1', status: 'done', overall_verdict: null }, 'pending'],
    ['분석 실패', { id: 'a1', status: 'failed', overall_verdict: null }, 'error'],
    ['분석 준비됨', undefined, 'in-progress'],
  ];
  it.each(cases)('"%s" 판정은 data-status=%s StatusIndicator로 그린다', (label, current, status) => {
    const scansByLocation = new Map([['l1', [scan('c1', 'l1', current)]]]);
    render(<LocationTree tree={tree(loc)} scansByLocation={scansByLocation} siteId="s1" />);
    expect(screen.getByText(label).getAttribute('data-status')).toBe(status);
  });

  it('동(700) › 층(nav-text 700) › 공간(보조색) 소제목 아래 측정위치 카드(1px cs-divider, 8px 라운드)', () => {
    render(<LocationTree tree={tree(loc)} scansByLocation={new Map()} siteId="s1" />);
    expect(screen.getByText('A동').className).toContain('font-bold');
    expect(screen.getByText('1층').className).toContain('text-cs-nav-text');
    expect(screen.getByText('거실').className).toContain('text-cs-text-secondary');
    const name = screen.getByText('측정1');
    expect(name.className).toContain('font-bold');
    const card = name.closest('li');
    expect(card?.className).toContain('border-cs-divider');
    expect(card?.className).toContain('rounded-lg');
  });

  it('카드 액션: 스캔 정합·보고서는 텍스트 링크, 스캔 업로드는 normal LinkButton(upload 아이콘)', () => {
    const { container } = render(<LocationTree tree={tree(loc)} scansByLocation={new Map()} siteId="s1" />);
    expect(screen.getByRole('link', { name: '스캔 정합' })).toHaveAttribute('href', '/registrations/new?location=l1');
    expect(screen.getByRole('link', { name: '보고서' })).toHaveAttribute('href', '/reports?location=l1');
    const upload = screen.getByRole('link', { name: '스캔 업로드' });
    expect(upload).toHaveAttribute('href', '/upload?site=s1&location=l1');
    expect(upload.className).toContain('border-cs-link');
    expect(upload.className).toContain('rounded-full');
    expect(upload.className).not.toContain('bg-cs-link'); // normal(뷰의 primary는 '위치 추가')
    expect(container.querySelector('[data-icon="upload"]')).toBeInTheDocument();
  });

  it('스캔 행: 일시 mono(cs-link) · 표면(보조색) · 판정, 행 전체가 /scans/[id] 링크', () => {
    const scansByLocation = new Map([['l1', [scan('c1', 'l1', { id: 'a1', status: 'done', overall_verdict: 'borderline' })]]]);
    render(<LocationTree tree={tree(loc)} scansByLocation={scansByLocation} siteId="s1" />);
    expect(screen.getByRole('link', { name: /2026-07-28/ })).toHaveAttribute('href', '/scans/c1');
    const when = screen.getByText('2026-07-28');
    expect(when.className).toContain('font-mono');
    expect(when.className).toContain('text-cs-link');
    expect(screen.getByText('· 바닥').className).toContain('text-cs-text-secondary');
    expect(screen.getByText('경계').getAttribute('data-status')).toBe('warning');
  });

  it('측정위치가 없으면 보조색 안내 문구를 그린다', () => {
    render(<LocationTree tree={[]} scansByLocation={new Map()} siteId="s1" />);
    expect(screen.getByText('측정위치가 없습니다. 아래에서 추가하세요.').className).toContain('text-cs-text-secondary');
  });
});
```

`components/__tests__/new-site-form.test.tsx` — 실패 케이스의 단언 한 줄을 교체하고, describe 끝에 구조 테스트를 추가한다.

교체(old → new):
```tsx
    expect(await screen.findByText(/중복된 현장명입니다/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
```
→
```tsx
    const notice = await screen.findByText(/중복된 현장명입니다/);
    expect(notice).toBeInTheDocument();
    expect(notice.className).toContain('text-cs-error');
    expect(pushMock).not.toHaveBeenCalled();
  });

  // Cloudscape 재스킨(T4), 아트보드 SiteNew: 필드 3개는 컨테이너(<section>) 안 FormField,
  // 제출 버튼은 컨테이너 **밖** 우측 하단의 primary. 동작 단언(위 두 it)은 그대로다.
  it('폼 해부: 컨테이너 안 FormField 3개 + 컨테이너 밖 primary "현장 등록"', () => {
    const { container } = render(<NewSiteForm />);
    const section = container.querySelector('section');
    expect(section?.className).toContain('shadow-cs-container');
    expect(screen.getByText('현장명 (필수)').className).toContain('font-bold');
    expect(screen.getByLabelText('현장명 (필수)').className).toContain('border-cs-input-border');
    expect(screen.getByLabelText('주소').className).toContain('border-cs-input-border');
    expect(screen.getByLabelText('메모').className).toContain('min-h-24');
    const submit = screen.getByRole('button', { name: '현장 등록' });
    expect(submit.className).toContain('bg-cs-link');
    expect(section?.contains(submit)).toBe(false);
  });
```

`app/sites/[id]/__tests__/page.test.tsx` — import 블록을 교체하고(findAll 헬퍼 추가), 파일 끝에 구조 describe를 추가한다. 기존 describe('SitePage 쿼리 배선 …')는 그대로.

교체(old → new):
```tsx
import { createClient } from '@/lib/supabase/server';
import SitePage from '../page';

function chain(result: { data: unknown; error: null }, eqSpy?: (col: string, val: unknown) => void) {
```
→
```tsx
import { createClient } from '@/lib/supabase/server';
import SitePage from '../page';
import { Container } from '@/components/ui/container';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_MAIN } from '@/components/ui/page';

// 엘리먼트 트리를 재귀 탐색해 특정 컴포넌트 타입이 쓰인 곳을 모두 모은다
// (app/__tests__/page.test.tsx와 동일 패턴 - async 서버 컴포넌트는 render()할 수 없다).
function findAll(node: unknown, type: unknown, acc: { props: Record<string, unknown> }[] = []) {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) acc.push(el as { props: Record<string, unknown> });
  findAll(el.props?.children, type, acc);
  return acc;
}

function chain(result: { data: unknown; error: null }, eqSpy?: (col: string, val: unknown) => void) {
```

파일 끝에 추가:
```tsx
// Cloudscape 재스킨(T4): PAGE_MAIN 본문, PageHeader(브레드크럼 현장 › 현장명, 설명=주소),
// Container 3개(측정위치 (n) / 새 측정위치 / 현장 사진 (n)). 쿼리 배선은 위 describe가 지킨다.
describe('SitePage 화면 구조 (Cloudscape)', () => {
  function stub(site: unknown, locations: unknown[], photos: unknown[]) {
    return {
      from: (table: string) => {
        if (table === 'sites') return chain({ data: site, error: null });
        if (table === 'locations') return chain({ data: locations, error: null });
        if (table === 'photos') return chain({ data: photos, error: null });
        if (table === 'scans') return chain({ data: [], error: null });
        if (table === 'analyses') return chain({ data: [], error: null });
        throw new Error(`예상치 못한 테이블: ${table}`);
      },
    };
  }

  it('PAGE_MAIN + PageHeader(현장 › 현장명, 주소 설명) + Container 3개(카운터)', async () => {
    const site = { id: 's1', name: '세종 M2블록 아파트', address: '세종시 다정동', memo: null, created_at: '', updated_at: '' };
    const location = {
      id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
      memo: null, created_at: '', updated_at: '',
    };
    const photo = { id: 'p1', scan_id: null, location_id: null, site_id: 's1', file_path: 'a.jpg', caption: null, taken_at: null, created_at: '' };
    vi.mocked(createClient).mockResolvedValue(stub(site, [location], [photo, { ...photo, id: 'p2' }]) as never);

    const el = await SitePage({ params: Promise.resolve({ id: 's1' }) });

    expect(el.props.className).toBe(PAGE_MAIN);
    const [header] = findAll(el, PageHeader);
    expect(header.props.title).toBe('세종 M2블록 아파트');
    expect(header.props.description).toBe('세종시 다정동');
    expect(header.props.crumbs).toEqual([{ href: '/', label: '현장' }, { label: '세종 M2블록 아파트' }]);
    const containers = findAll(el, Container).map((c) => [c.props.title, c.props.counter]);
    expect(containers).toEqual([['측정위치', 1], ['새 측정위치', undefined], ['현장 사진', 2]]);
  });
});
```

`app/sites/new/__tests__/page.test.tsx` (신규):
```tsx
// 새 현장 페이지: PAGE_MAIN 본문 + 브레드크럼(현장 › 새 현장 등록, 마지막은 비링크) + h1 + 폼.
// 동기 서버 컴포넌트라 render()로 그릴 수 있다(폼은 클라이언트 컴포넌트 - 라우터만 mock).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({})) }));

import NewSitePage from '../page';
import { PAGE_MAIN } from '@/components/ui/page';

describe('NewSitePage (Cloudscape)', () => {
  it('PAGE_MAIN 본문 + 브레드크럼(현장 › 새 현장 등록) + h1 + 폼', () => {
    render(<NewSitePage />);
    expect(screen.getByRole('main').className).toBe(PAGE_MAIN);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('새 현장 등록');
    expect(screen.getByRole('link', { name: '현장' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('link', { name: '새 현장 등록' })).toBeNull();
    expect(screen.getByRole('button', { name: '현장 등록' })).toBeInTheDocument();
  });
});
```

`components/__tests__/new-location-form.test.tsx` (신규):
```tsx
// 새 측정위치 폼: FormField 5개 + primary '위치 추가'. insert 컬럼·trim·23505 안내는 기존 로직.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({})) }));

import { createClient } from '@/lib/supabase/client';
import { NewLocationForm } from '../new-location-form';

function stubSupabase(
  result: { error: { code?: string; message: string } | null },
  insertSpy?: (row: unknown) => void,
) {
  return {
    from: (table: string) => {
      if (table === 'locations') return { insert: async (row: unknown) => { insertSpy?.(row); return result; } };
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('NewLocationForm', () => {
  it('폼 해부: 라벨 5개(700) + inputClass + primary "위치 추가"(plus 아이콘)', () => {
    const { container } = render(<NewLocationForm siteId="s1" />);
    for (const label of ['동', '층', '층 순서(정수)', '공간', '측정위치']) {
      expect(screen.getByText(label).className).toContain('font-bold');
      expect(screen.getByLabelText(label).className).toContain('border-cs-input-border');
    }
    const submit = screen.getByRole('button', { name: '위치 추가' });
    expect(submit.className).toContain('bg-cs-link');
    expect(container.querySelector('[data-icon="plus"]')).toBeInTheDocument();
  });

  it('등록에 성공하면 trim한 값으로 insert하고 router.refresh를 부른다', async () => {
    const insertSpy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: null }, insertSpy) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('동'), { target: { value: ' 101동 ' } });
    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    await vi.waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(insertSpy).toHaveBeenCalledWith({
      site_id: 's1', building: '101동', floor: '', floor_order: 0, room: '', name: '거실',
    });
  });

  it('중복(23505)이면 안내 문구를 cs-error로 띄우고 refresh하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ error: { code: '23505', message: 'dup' } }) as never);
    render(<NewLocationForm siteId="s1" />);

    fireEvent.change(screen.getByLabelText('측정위치'), { target: { value: '거실' } });
    fireEvent.click(screen.getByRole('button', { name: '위치 추가' }));

    const notice = await screen.findByText('같은 동/층/공간에 동일한 측정위치가 이미 있습니다.');
    expect(notice.className).toContain('text-cs-error');
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
```

`components/__tests__/photo-gallery.test.tsx` (신규):
```tsx
// 현장 사진 갤러리: 4열 그리드 figure 카드 + 128px 이미지/자리표시자 + 12px 캡션(아트보드 SiteDetail).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
// 서명 URL 조회는 네트워크라 null로 고정한다 - 자리표시자 분기를 본다.
vi.mock('@/lib/photos/upload', () => ({ photoUrl: vi.fn(async () => null) }));

import { PhotoGallery } from '../photo-gallery';
import type { PhotoRow } from '@/lib/domain/types';

const photo = (id: string, caption: string | null): PhotoRow => ({
  id, scan_id: null, location_id: null, site_id: 's1', file_path: `${id}.jpg`, caption, taken_at: null, created_at: '',
});

describe('PhotoGallery (Cloudscape 재스킨)', () => {
  it('사진이 없으면 보조색 안내 문구를 그린다', () => {
    render(<PhotoGallery photos={[]} />);
    expect(screen.getByText('등록된 사진이 없습니다.').className).toContain('text-cs-text-secondary');
  });

  it('figure 카드(1px cs-divider, 8px 라운드) + 128px 자리표시자 + 12px 캡션, md 이상 4열', () => {
    const { container } = render(<PhotoGallery photos={[photo('p1', '현장 전경'), photo('p2', null)]} />);
    expect(container.querySelector('.grid')?.className).toContain('md:grid-cols-4');
    const figures = container.querySelectorAll('figure');
    expect(figures).toHaveLength(2);
    expect(figures[0].className).toContain('border-cs-divider');
    expect(figures[0].className).toContain('rounded-lg');
    const placeholder = figures[0].firstElementChild as HTMLElement;
    expect(placeholder.className).toContain('h-32');
    expect(placeholder.className).toContain('bg-cs-divider');
    const caption = screen.getByText('현장 전경');
    expect(caption.tagName).toBe('FIGCAPTION');
    expect(caption.className).toContain('text-xs');
  });
});
```

`components/__tests__/photo-uploader.test.tsx` (신규):
```tsx
// 사진 업로더: 설명 입력(inputClass, 360px 상한) + '사진 추가' normal 알약(label이 숨은 file input을 연다).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/photos/upload', () => ({ uploadPhoto: vi.fn() }));

import { PhotoUploader } from '../photo-uploader';

describe('PhotoUploader (Cloudscape 재스킨)', () => {
  it('설명 입력은 inputClass(360px 상한), "사진 추가"는 normal 버튼 + upload 아이콘, 파일 입력은 숨김', () => {
    const { container } = render(<PhotoUploader target={{ site_id: 's1' }} onUploaded={() => {}} />);
    const caption = screen.getByPlaceholderText('사진 설명(선택)');
    expect(caption.className).toContain('border-cs-input-border');
    expect(caption.className).toContain('max-w-[360px]');
    const add = screen.getByText('사진 추가');
    expect(add.tagName).toBe('LABEL');
    expect(add.className).toContain('border-cs-link');
    expect(add.className).toContain('rounded-full');
    expect(container.querySelector('[data-icon="upload"]')).toBeInTheDocument();
    const file = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(file.className).toContain('hidden');
    expect(file.accept).toBe('image/jpeg,image/png,image/webp');
  });
});
```

- [ ] **Step 3: 실패 확인** — `cd dashboard && npx vitest run components/__tests__/location-tree.test.tsx components/__tests__/new-site-form.test.tsx components/__tests__/new-location-form.test.tsx components/__tests__/photo-gallery.test.tsx components/__tests__/photo-uploader.test.tsx app/sites` → 기존 it(문구·쿼리 배선·push/refresh)은 PASS, 새 단언은 FAIL: `data-status`가 `null`(Badge에는 없음), `className`에 `cs-*`·`rounded-lg`·`font-bold` 없음, `section`이 `null`(Container 미사용), `el.props.className`이 `'mx-auto max-w-6xl space-y-6 p-6'`, `findAll(el, Container)`가 빈 배열, `[data-icon="upload"]`·`[data-icon="plus"]` 없음.

- [ ] **Step 4: `app/sites/[id]/page.tsx` 교체** — 쿼리·가드·주석은 문장 그대로, `<main>`·헤더·섹션만 바뀐다. 파일 전체를 다음으로 교체:

```tsx
// 현장 상세 (스펙 §7.3: 트리 + 측정 이력 + 현장 사진)
// Cloudscape 구조(아트보드 SiteDetail): PageHeader(현장 › 현장명, 설명=주소) → Container '측정위치 (n)'
// → Container '새 측정위치' → Container '현장 사진 (n)'. 쿼리·가드는 그대로다.
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { buildLocationTree } from '@/lib/domain/tree';
import { LocationTree, type ScanWithCurrent } from '@/components/location-tree';
import { NewLocationForm } from '@/components/new-location-form';
import { PhotoGallery } from '@/components/photo-gallery';
import { RefreshOnUpload } from '@/components/refresh-on-upload';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { Container } from '@/components/ui/container';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import type { AnalysisStatus, LocationRow, PhotoRow, ScanRow, SiteRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: site, error: siteError } = await supabase.from('sites').select('*').eq('id', id).maybeSingle();
  // 저비용 개선(현장 상세 무음 에러): siteError를 확인하지 않으면 연결 실패도
  // "현장 없음"(notFound)으로 오인된다 - 홈(app/page.tsx)의 SupabaseErrorNotice 패턴을 적용
  if (siteError) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={siteError.message} /></main>;
  }
  if (!site) notFound();
  const [locationsRes, photosRes] = await Promise.all([
    supabase.from('locations').select('*').eq('site_id', id),
    supabase.from('photos').select('*').eq('site_id', id).order('created_at', { ascending: false }),
  ]);
  // 아래 `?? []`가 쿼리 실패를 조용히 흡수해 "측정위치가 없습니다"로 오인시키지
  // 않도록, 데이터를 비우기 전에 에러부터 확인한다.
  const parallelError = locationsRes.error ?? photosRes.error;
  if (parallelError) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={parallelError.message} /></main>;
  }
  const locations = (locationsRes.data ?? []) as LocationRow[];
  const photos = (photosRes.data ?? []) as PhotoRow[];
  const locationIds = locations.map((l) => l.id);
  const scansRes = locationIds.length
    ? await supabase.from('scans').select('*').in('location_id', locationIds)
        .is('deleted_at', null).order('scanned_at', { ascending: false })
    : { data: [] as ScanRow[], error: null };
  if (scansRes.error) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={scansRes.error.message} /></main>;
  }
  const scans = scansRes.data;
  const scanIds = (scans ?? []).map((s) => s.id);
  // 단계 C 회귀 차단: kind 필터가 없으면 같은 scan_id의 구배 현재분석이 Map을 덮어써
  // 조회 순서에 따라 배지가 비결정적으로 바뀐다. 트리는 평활도만 보여 기존 동작을 유지한다.
  const currentsRes = scanIds.length
    ? await supabase.from('analyses').select('id, scan_id, status, overall_verdict, kind')
        .in('scan_id', scanIds).eq('is_current', true).eq('kind', 'flatness').is('deleted_at', null)
    : { data: [], error: null };
  if (currentsRes.error) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={currentsRes.error.message} /></main>;
  }
  const currents = currentsRes.data;
  const currentByScan = new Map(
    (currents ?? []).map((a) => [a.scan_id as string, {
      id: a.id as string, status: a.status as AnalysisStatus,
      overall_verdict: a.overall_verdict as Verdict | null,
    }]),
  );
  const scansByLocation = new Map<string, ScanWithCurrent[]>();
  for (const s of (scans ?? []) as ScanRow[]) {
    const arr = scansByLocation.get(s.location_id) ?? [];
    arr.push({ ...s, current: currentByScan.get(s.id) });
    scansByLocation.set(s.location_id, arr);
  }
  return (
    <main className={PAGE_MAIN}>
      <PageHeader
        crumbs={[{ href: '/', label: '현장' }, { label: (site as SiteRow).name }]}
        title={(site as SiteRow).name}
        description={(site as SiteRow).address}
      />
      <Container title="측정위치" counter={locations.length}>
        <LocationTree tree={buildLocationTree(locations)} scansByLocation={scansByLocation} siteId={id} />
      </Container>
      <Container title="새 측정위치">
        <NewLocationForm siteId={id} />
      </Container>
      {/* 아트보드: 헤더 아래 업로더 줄, 그 아래 구분선 + 갤러리 그리드. padded={false}로 두 줄을
          직접 배치한다(Container 헤더의 하단 구분선은 프리미티브 공통이라 그대로 둔다). */}
      <Container title="현장 사진" counter={photos.length} padded={false}>
        <div className="px-5 py-3">
          <RefreshOnUpload target={{ site_id: id }} />
        </div>
        <div className="border-t border-cs-divider p-5">
          <PhotoGallery photos={photos} />
        </div>
      </Container>
    </main>
  );
}
```

- [ ] **Step 5: `components/location-tree.tsx` 교체** — 분기 4개(verdict → done → failed → 스캔 상태)와 세 주석(C4·단계 F·리뷰 Important 3)은 문장 그대로, `Badge` → `StatusIndicator`, 카드·소제목·액션은 아트보드대로. 파일 전체를 다음으로 교체:

```tsx
import Link from 'next/link';
import type { BuildingNode } from '@/lib/domain/tree';
import type { AnalysisStatus, ScanRow, Verdict } from '@/lib/domain/types';
import { GRADE_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { LinkButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';

export interface ScanWithCurrent extends ScanRow {
  current?: { id: string; status: AnalysisStatus; overall_verdict: Verdict | null };
}

// 카드 안 텍스트 링크(브레드크럼과 같은 cs-link 규칙)
const TEXT_LINK = 'text-cs-link hover:text-cs-link-hover hover:underline';

// 아트보드(SiteDetail): 동 › 층 › 공간 소제목이 1px 세로선 + 20px로 들여쓰기되고,
// 측정위치는 1px cs-divider · 8px 라운드 카드다. 카드 안 버튼은 전부 normal(뷰의 primary는 '위치 추가').
export function LocationTree({ tree, scansByLocation, siteId }: {
  tree: BuildingNode[];
  scansByLocation: Map<string, ScanWithCurrent[]>;
  siteId: string;
}) {
  if (tree.length === 0) return <p className="text-sm text-cs-text-secondary">측정위치가 없습니다. 아래에서 추가하세요.</p>;
  return (
    <div className="flex flex-col gap-4">
      {tree.map((b) => (
        <section key={b.building} className="flex flex-col gap-3">
          <h3 className="text-base font-bold leading-5">{b.building || '(동 미지정)'}</h3>
          <div className="flex flex-col gap-3 border-l border-cs-divider pl-5">
            {b.floors.map((f) => (
              <div key={f.floor} className="flex flex-col gap-2">
                <h4 className="text-sm font-bold text-cs-nav-text">{f.floor || '(층 미지정)'}</h4>
                <div className="flex flex-col gap-2 border-l border-cs-divider pl-5">
                  {f.rooms.map((r) => (
                    <div key={r.room} className="flex flex-col gap-2">
                      <h5 className="text-sm text-cs-text-secondary">{r.room || '(공간 미지정)'}</h5>
                      <ul className="flex flex-col gap-2">
                        {r.locations.map((l) => (
                          <li key={l.id} className="flex flex-col gap-2 rounded-lg border border-cs-divider bg-white px-4 py-3 text-sm">
                            <div className="flex items-center justify-between gap-4">
                              <span className="font-bold">{l.name}</span>
                              <span className="flex items-center gap-4">
                                {/* 단계 F: 같은 위치를 나눠 찍은 두 스캔을 하나로 합치는
                                    진입점. 후보 스캔이 2개 미만이면 그 화면이 이유를
                                    안내하므로 여기서는 조건 없이 보여준다(스캔 개수를
                                    세려면 목록 쿼리에 조건을 더해야 하고, 정합 가능
                                    조건은 개수만이 아니다 - 높이 뷰·단위 확정도 본다). */}
                                <Link href={`/registrations/new?location=${l.id}`} className={TEXT_LINK}>스캔 정합</Link>
                                <Link href={`/reports?location=${l.id}`} className={TEXT_LINK}>보고서</Link>
                                {/* C4: 측정위치별 업로드 진입점 강조 - 텍스트 링크에서
                                    눈에 띄는 버튼으로(이 화면에서 가장 자주 하는 다음
                                    동작이므로 "보고서"보다 시각적 우선순위를 둔다) */}
                                <LinkButton href={`/upload?site=${siteId}&location=${l.id}`} variant="normal">
                                  <Icon name="upload" />
                                  스캔 업로드
                                </LinkButton>
                              </span>
                            </div>
                            <ul className="flex flex-col gap-1">
                              {(scansByLocation.get(l.id) ?? []).map((s) => (
                                <li key={s.id}>
                                  <Link href={`/scans/${s.id}`} className="flex items-center gap-2 text-cs-text hover:underline">
                                    <span className="font-mono text-[13px] tabular-nums text-cs-link">{s.scanned_at}</span>
                                    <span className="text-cs-text-secondary">· {SURFACE_LABEL[s.surface]}</span>
                                    {/* 리뷰 Important 3: verdict가 falsy(null)라고 바로 스캔 상태
                                        라벨로 떨어지면 판정 불가·분석 실패 분석이 "분석 준비됨"
                                        등 미분석 스캔과 구분되지 않는다 - 현재 분석의 status를
                                        먼저 분기한다 */}
                                    {s.current?.overall_verdict ? (
                                      <StatusIndicator type={TONE_STATUS[GRADE_TONE[s.current.overall_verdict]]}>
                                        {GRADE_LABEL[s.current.overall_verdict]}
                                      </StatusIndicator>
                                    ) : s.current?.status === 'done' ? (
                                      <StatusIndicator type={TONE_STATUS[GRADE_TONE.na]}>{GRADE_LABEL.na}</StatusIndicator>
                                    ) : s.current?.status === 'failed' ? (
                                      <StatusIndicator type={TONE_STATUS.fail}>분석 실패</StatusIndicator>
                                    ) : (
                                      // 미분석 스캔의 상태 라벨(옛 neutral 배지): 아트보드대로 clock 아이콘 + 보조색
                                      <StatusIndicator type="in-progress">{SCAN_STATUS_LABEL[s.status]}</StatusIndicator>
                                    )}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: `components/new-location-form.tsx` 교체** — state·insert 컬럼·trim·23505 안내·`router.refresh()`는 그대로, 필드 5개를 `FormField`+`inputClass`(아트보드 폭)로, 버튼은 이 뷰의 유일한 primary. 파일 전체를 다음으로 교체:

```tsx
// 입력 trim 정규화는 앱 레벨 책임(001 주석)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormField, inputClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

export function NewLocationForm({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ building: '', floor: '', floorOrder: '0', room: '', name: '' });
  const [error, setError] = useState<string | null>(null);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const { error: err } = await supabase.from('locations').insert({
      site_id: siteId,
      building: form.building.trim(),
      floor: form.floor.trim(),
      floor_order: parseInt(form.floorOrder, 10) || 0,
      room: form.room.trim(),
      name: form.name.trim(),
    });
    if (err) {
      setError(err.code === '23505' ? '같은 동/층/공간에 동일한 측정위치가 이미 있습니다.' : err.message);
      return;
    }
    setForm({ building: '', floor: '', floorOrder: '0', room: '', name: '' });
    router.refresh();
  }

  // 아트보드(SiteDetail '새 측정위치'): 필드 폭 동 120 · 층 120 · 층 순서 140 · 공간 140 · 측정위치 200,
  // 하단 정렬 + gap 16px. '위치 추가'는 현장 상세 뷰의 유일한 primary(스펙 §6).
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-4 text-sm">
      {([
        ['building', '동', false, 'w-[120px]'], ['floor', '층', false, 'w-[120px]'],
        ['floorOrder', '층 순서(정수)', false, 'w-[140px]'],
        ['room', '공간', false, 'w-[140px]'], ['name', '측정위치', true, 'w-[200px]'],
      ] as const).map(([key, label, required, width]) => (
        <div key={key} className={width}>
          <FormField label={label} htmlFor={`loc-${key}`}>
            <input id={`loc-${key}`} required={required} value={form[key]} onChange={set(key)}
              className={key === 'floorOrder' ? `${inputClass} tabular-nums` : inputClass} />
          </FormField>
        </div>
      ))}
      <Button type="submit" variant="primary">
        <Icon name="plus" />
        위치 추가
      </Button>
      {error && <p className="w-full text-cs-error">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 7: `components/new-site-form.tsx` + `app/sites/new/page.tsx` 교체** — insert·`router.push`(refresh 없음) 주석과 로직은 그대로. 아트보드대로 제출 버튼이 컨테이너 **밖**에 있어야 하므로 폼 컴포넌트가 `Container`를 직접 그리고, `<form>`이 컨테이너와 버튼 줄을 함께 감싼다(페이지는 감싸지 않는다).

`components/new-site-form.tsx` 전체:
```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { FormField, inputClass, textareaClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

export function NewSiteForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createClient();
    const { data, error: err } = await supabase.from('sites')
      .insert({ name: name.trim(), address: address.trim() || null, memo: memo.trim() || null })
      .select('id').single();
    if (err || !data) { setError(err?.message ?? '저장 실패'); return; }
    // push만 한다. 뒤에 router.refresh()를 붙이면 refresh가 "현재 라우트"를 다시
    // 렌더하면서 진행 중이던 이동을 취소한다(로그인 화면에서 실제로 재현된 결함).
    // sites/[id]는 force-dynamic이고 동적 페이지의 클라이언트 캐시 staleTime
    // 기본값은 0초(캐시 안 함)라, push만으로도 항상 서버에서 새로 받아온다.
    router.push(`/sites/${data.id}`);
  }

  // 아트보드(SiteNew): 필드 3개(폭 448px)는 헤더 없는 컨테이너 안, 제출 버튼은 컨테이너 밖 우측 하단.
  // 제출 버튼이 <form> 안에 있어야 하므로 form이 컨테이너와 버튼 줄을 함께 감싼다.
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Container>
        <div className="flex w-full max-w-[448px] flex-col gap-4">
          <FormField label="현장명 (필수)" htmlFor="name">
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="주소" htmlFor="address">
            <input id="address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />
          </FormField>
          <FormField label="메모" htmlFor="memo">
            <textarea id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} className={textareaClass} rows={3} />
          </FormField>
          {error && <p className="text-sm text-cs-error">{error}</p>}
        </div>
      </Container>
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" variant="primary">
          <Icon name="plus" />
          현장 등록
        </Button>
      </div>
    </form>
  );
}
```

`app/sites/new/page.tsx` 전체:
```tsx
// 새 현장 등록(아트보드 SiteNew): 브레드크럼 현장 › 새 현장 등록(비링크) + h1 + 폼(컨테이너·버튼은 폼이 그린다).
import { NewSiteForm } from '@/components/new-site-form';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';

export default function NewSitePage() {
  return (
    <main className={PAGE_MAIN}>
      <PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '새 현장 등록' }]} title="새 현장 등록" />
      <NewSiteForm />
    </main>
  );
}
```

- [ ] **Step 8: `components/photo-uploader.tsx` + `components/photo-gallery.tsx` 교체** — 업로드·서명 URL 로직 그대로, 클래스만 토큰으로.

`components/photo-uploader.tsx` 전체:
```tsx
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto, type PhotoRef } from '@/lib/photos/upload';
import { buttonClass } from '@/components/ui/button';
import { inputClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

export function PhotoUploader({ target, onUploaded }: { target: PhotoRef; onUploaded: () => void }) {
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadPhoto(createClient(), file, target, caption || undefined);
      setCaption('');
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : '사진 업로드에 실패했습니다');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  // 아트보드(SiteDetail '현장 사진'): 설명 입력 360px + '사진 추가' normal 알약(upload 아이콘).
  // 파일 선택은 label이 감싼 숨은 input이 연다 - 겉모습만 버튼이다(뷰의 primary는 '위치 추가').
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <input type="text" placeholder="사진 설명(선택)" value={caption}
        onChange={(e) => setCaption(e.target.value)}
        className={`${inputClass} max-w-[360px]`} />
      <label className={busy ? buttonClass('normal', { disabled: true }) : `${buttonClass('normal')} cursor-pointer`}>
        <Icon name="upload" />
        {busy ? '업로드 중...' : '사진 추가'}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={onChange} disabled={busy} />
      </label>
      {error && <span className="text-cs-error">{error}</span>}
    </div>
  );
}
```

`components/photo-gallery.tsx` 전체:
```tsx
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { photoUrl } from '@/lib/photos/upload';
import type { PhotoRow } from '@/lib/domain/types';

export function PhotoGallery({ photos }: { photos: PhotoRow[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      const entries = await Promise.all(
        photos.map(async (p) => [p.id, await photoUrl(supabase, p.file_path)] as const),
      );
      if (!cancelled) {
        setUrls(Object.fromEntries(entries.filter(([, u]) => u !== null) as [string, string][]));
      }
    })();
    return () => { cancelled = true; };
  }, [photos]);

  if (photos.length === 0) return <p className="text-sm text-cs-text-secondary">등록된 사진이 없습니다.</p>;
  // 아트보드(SiteDetail '현장 사진'): 4열 gap 12px, figure 카드(padding 4px · 1px cs-divider · 8px 라운드),
  // 이미지 128px, 캡션 12px/16px nav-text. 모바일(<md)은 2열 유지(스펙 §5 최소 동작).
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {photos.map((p) => (
        <figure key={p.id} className="flex flex-col gap-1 rounded-lg border border-cs-divider bg-white p-1">
          {urls[p.id] ? (
            // signed URL은 외부 호스트라 next/image 대신 img 사용(데모)
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls[p.id]} alt={p.caption ?? '현장 사진'} className="h-32 w-full rounded object-cover" />
          ) : (
            <div className="h-32 w-full animate-pulse rounded bg-cs-divider" />
          )}
          {p.caption && <figcaption className="px-1 text-xs leading-4 text-cs-nav-text">{p.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
```

- [ ] **Step 9: 통과 확인** — `cd dashboard && npx vitest run` → 전체 PASS(이 태스크의 테스트 7파일 포함). `npx tsc --noEmit -p .` → 0 에러. 잔재 스윕(이 태스크 담당 파일만): `grep -n -E "zinc-|amber-|red-|green-|emerald-|purple-|blue-" app/sites/new/page.tsx "app/sites/[id]/page.tsx" components/location-tree.tsx components/new-location-form.tsx components/new-site-form.tsx components/photo-gallery.tsx components/photo-uploader.tsx` → 0건(`app/sites/[id]/loading.tsx`는 T11이 옮긴다). dev server에서 `/sites/<id>`·`/sites/new`를 열어 `SiteDetail.dc.html`·`SiteNew.dc.html`과 나란히 대조(카드 트리 들여쓰기·StatusIndicator 아이콘·'위치 추가'만 파랑 채움·'현장 등록'이 컨테이너 밖 우측)하고 콘솔 오류 0을 확인한다.

- [ ] **Step 10: 커밋**

```bash
git add "dashboard/app/sites/[id]/page.tsx" "dashboard/app/sites/[id]/__tests__/page.test.tsx" dashboard/app/sites/new/page.tsx dashboard/app/sites/new/__tests__/page.test.tsx dashboard/components/location-tree.tsx dashboard/components/new-location-form.tsx dashboard/components/new-site-form.tsx dashboard/components/photo-gallery.tsx dashboard/components/photo-uploader.tsx dashboard/components/__tests__/location-tree.test.tsx dashboard/components/__tests__/new-site-form.test.tsx dashboard/components/__tests__/new-location-form.test.tsx dashboard/components/__tests__/photo-gallery.test.tsx dashboard/components/__tests__/photo-uploader.test.tsx
git commit -m "feat(dashboard): 현장 상세·새 현장을 Cloudscape 구조로(측정위치 카드 트리·StatusIndicator·FormField)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

---

### Task 5: 스캔 업로드(`/upload`)

**Files:**
- Modify: `dashboard/app/upload/page.tsx`, `dashboard/components/upload-form.tsx`
- Create: `dashboard/app/upload/__tests__/page.test.tsx`
- Test: `dashboard/components/__tests__/upload-form.test.tsx`(describe 1개 추가 — 기존 13개 it는 한 글자도 바꾸지 않는다), `dashboard/app/upload/__tests__/page.test.tsx`(신규)

**Interfaces:**
- Consumes:
  - `PAGE_MAIN: string`(`components/ui/page.tsx`, T2) — `<main className={PAGE_MAIN}>`.
  - `<PageHeader crumbs? title description? actions? />`(`components/ui/page-header.tsx`, T2) — `crumbs`의 마지막 항목은 `href` 없이 넘겨 비링크 현재 페이지로 그린다.
  - `<Container title? counter? description? actions? padded?=true className?>children</Container>`(`components/ui/container.tsx`, T2).
  - `<FormField label htmlFor? description? error?>{control}</FormField>`, `inputClass`, `selectClass`, `<SelectWrap>{select}</SelectWrap>`, `checkClass`(`components/ui/form.tsx`, T2).
  - `<Button variant?='normal' …button props>`(`components/ui/button.tsx`, T2) — `type` 기본값 `'button'`이므로 제출 버튼만 `type="submit"`을 명시한다.
  - `<Alert type={'info'|'success'|'warning'|'error'} title?>children</Alert>`(`components/ui/alert.tsx`, T2) — 루트에 `data-alert={type}`.
  - `<Icon name="upload" />`(`components/ui/icons.tsx`, T1). `SelectWrap`이 내부에서 `data-icon="chevron-down"`을 그린다.
  - 소스에 이미 있는 것(무변경): `SURFACE_LABEL`·`LINEAGE_LABEL`(`lib/domain/labels.ts`), `MAX_UPLOAD_MB`·`validateFile`(`lib/upload/validate.ts`), `enqueueJob`, `uploadRawScan`, `getRequestUser`.
- Produces: 없음. (`upload-form.tsx` 안의 `linkButtonClass`·`fileInputClass`는 모듈 내부 상수이며 export 하지 않는다.)

- [ ] **Step 1: 아트보드 확인** — `docs/design/cloudscape/Upload.dc.html`을 브라우저나 Read로 열어 다음 구조를 그대로 옮긴다(Next.js 신규 API는 쓰지 않으므로 이 태스크에서 `node_modules/next/dist/docs/` 재확인은 불필요):
  - 브레드크럼 `현장 › 스캔 업로드` + h1 `스캔 업로드`(액션 없음) → `PageHeader`.
  - 컨테이너 `업로드 정보`(헤더 12px 20px, 본문 padding 20px, 본문 안 `flex-col gap 16px`) → `Container`(padded).
  - 본문 첫 줄: 업로드 방식 라디오 2개(가로, gap 24px: `스캔 분석` / `기존 결과 가져오기(CSV/JSON)`).
  - 2열 grid(gap 40px). **좌열**(`flex-col gap 16px`): 측정위치 셀렉트(라벨 700 + 2px 보더 32px, chevron) → 링크형 `새 측정위치` → 인라인 미니폼(1px `cs-divider` 보더, radius 8px, padding 16px, gap 16px: 현장 셀렉트 / 새 현장명 / 동·층·공간·이름 4열 grid gap 16px / 버튼 줄 gap 8px) → 표면 유형 라디오(바닥·벽면) → 데이터 계보 라디오(원시 점군·융합 메시·모름). **우열**: 적용 기준 라디오 목록(1px 보더 radius 8px padding 12px gap 8px; 각 항목 = 코드 mono 13px + `(기본)` 12px 보조색 + 출처 12px/16px 보조색) → 측정일자(180px 고정, mono)·장비(flex 1) 한 줄 gap 16px → 담당자 → 스캔 파일(라벨 + 파일 입력 + 12px 보조색 안내문).
  - 컨테이너 아래 우측 정렬 primary 버튼(upload 아이콘 + `업로드 후 사전 검사`).
  - **옮기지 않는 것**: 드롭존 문구(`또는 파일을 여기에 끌어다 놓기`)·선택 파일명 행·X 아이콘·날짜 캘린더 아이콘 — 소스에 그 기능·데이터가 없고 T1 아이콘 세트에도 없다. 파일 입력은 네이티브 `<input type="file">`의 `::file-selector-button`만 normal 버튼 모양으로 입힌다. 미니폼 `저장`은 아트보드에서 채움(primary)이지만 **뷰당 primary 1개** 규칙에 따라 normal로, `취소`는 링크형 텍스트 버튼으로 그린다.

- [ ] **Step 2: 실패하는 테스트 작성/갱신**

`dashboard/app/upload/__tests__/page.test.tsx` (신규)

```tsx
// 업로드 화면 서버 배선(T5): 본문 컨테이너 클래스(PAGE_MAIN)·브레드크럼·폼 props·
// 미로그인 리다이렉트. Vitest는 async 서버 컴포넌트의 render()를 지원하지 않으므로
// (node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md) await로 얻은
// React 엘리먼트 트리를 재귀 탐색한다(app/__tests__/page.test.tsx,
// app/registrations/new/__tests__/page.test.tsx와 같은 패턴).
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

// 헤더 스텁을 테스트마다 바꿀 수 있게 hoisted 저장소로 둔다(미로그인 케이스).
const { headerStore } = vi.hoisted(() => ({ headerStore: { id: 'u1' as string | null } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
// perf-auth-roundtrips: getRequestUser는 proxy가 실은 x-flatness-user-* 요청 헤더를
// 읽는다 - 헤더만 흉내내고 실제 코드가 그대로 돈다.
vi.mock('next/headers', () => ({
  headers: async () => new Headers(headerStore.id ? { 'x-flatness-user-id': headerStore.id } : {}),
}));

import { createClient } from '@/lib/supabase/server';
import UploadPage from '../page';
import { UploadForm } from '@/components/upload-form';
import { PageHeader } from '@/components/ui/page-header';
import { PAGE_MAIN } from '@/components/ui/page';

const SITE = { id: 's1', name: '현장1', address: null, memo: null, created_at: '', updated_at: '' };
const LOCATION = {
  id: 'l1', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '1층',
  memo: null, created_at: '', updated_at: '',
};

// Supabase 쿼리 빌더 흉내: 체이닝은 자기 자신, await 되면(thenable) 정해 둔 결과로 resolve.
function chain(result: { data: unknown; error: null }) {
  const obj: Record<string, unknown> = {
    select: () => obj, order: () => obj,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

function findByType(node: unknown, type: unknown): ReactElement | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const c of node) { const f = findByType(c, type); if (f) return f; }
    return null;
  }
  const el = node as ReactElement & { props?: { children?: unknown } };
  if (el.type === type) return el;
  return findByType(el.props?.children, type);
}

function mount(location?: string) {
  headerStore.id = 'u1';
  vi.mocked(createClient).mockResolvedValue({
    from: (table: string) => {
      if (table === 'sites') return chain({ data: [SITE], error: null });
      if (table === 'locations') return chain({ data: [LOCATION], error: null });
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  } as never);
  return UploadPage({ searchParams: Promise.resolve({ location }) });
}

describe('UploadPage (Cloudscape T5)', () => {
  it('본문은 PAGE_MAIN 컨테이너, 브레드크럼은 현장 › 스캔 업로드(마지막은 비링크)', async () => {
    const el = (await mount()) as ReactElement<{ className: string }>;
    // loading.tsx와 같은 문자열이어야 전환 점프가 없다(스펙 §5).
    expect(el.type).toBe('main');
    expect(el.props.className).toBe(PAGE_MAIN);

    const header = findByType(el, PageHeader);
    expect(header).not.toBeNull();
    const props = header!.props as { crumbs: { href?: string; label: string }[]; title: string };
    expect(props.crumbs).toEqual([{ href: '/', label: '현장' }, { label: '스캔 업로드' }]);
    expect(props.title).toBe('스캔 업로드');
  });

  it('폼에 현장·측정위치·사용자·프리필 위치를 그대로 넘긴다(D4 배선 유지)', async () => {
    const el = await mount('l1');
    const form = findByType(el, UploadForm);
    expect(form).not.toBeNull();
    const props = form!.props as {
      sites: unknown[]; locations: unknown[]; userId: string; initialLocationId?: string;
    };
    expect(props.sites).toEqual([SITE]);
    expect(props.locations).toEqual([LOCATION]);
    expect(props.userId).toBe('u1');
    expect(props.initialLocationId).toBe('l1');
  });

  it('사용자 헤더가 없으면 /login으로 보낸다(방어 심층 가드 유지)', async () => {
    headerStore.id = null;
    vi.mocked(createClient).mockResolvedValue({
      from: () => { throw new Error('리다이렉트 전에 조회하면 안 된다'); },
    } as never);
    await expect(UploadPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT:/login');
  });
});
```

`dashboard/components/__tests__/upload-form.test.tsx` — 파일 **끝**(마지막 `});` 뒤)에 다음 describe를 추가한다. 위쪽의 `stubSupabase`·`site`·`location`·`criteria`·`selectLocation`은 그대로 재사용한다.

```tsx
// T5(Cloudscape 리스킨): 로직·문구는 그대로 두고 JSX·클래스만 바뀌었다는 것을 클래스가
// 아니라 의미 속성(data-alert, data-icon, type=submit)으로 최대한 읽는다. 클래스 단언은
// 토큰 클래스(cs-*)에 한정한다.
describe('UploadForm Cloudscape 해부 (T5)', () => {
  it('입력·셀렉트는 cs 토큰 클래스, 측정위치 셀렉트는 chevron 아이콘을 얹는다', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);

    const sel = screen.getByLabelText('측정위치');
    expect(sel.className).toContain('border-cs-input-border');
    expect(sel.className).toContain('appearance-none');
    expect(sel.parentElement?.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
    expect(screen.getByLabelText('장비').className).toContain('border-cs-input-border');
    expect(screen.getByLabelText('측정일자').className).toContain('font-mono');
    // 라디오는 네이티브 + accent(스펙 §7-6)
    expect(screen.getByLabelText('스캔 분석').className).toContain('accent-cs-link');
    expect(screen.getByLabelText('바닥').className).toContain('accent-cs-link');
    // 컨테이너 제목 '업로드 정보'는 시스템 크롬으로 채택(스펙 §7-8)
    expect(screen.getByRole('heading', { level: 2, name: '업로드 정보' })).toBeInTheDocument();
    // 잔재 스윕: 옛 팔레트 클래스(zinc-*, amber-*, red-* …)가 이 화면에 없다
    expect(container.innerHTML).not.toMatch(/(?:zinc|amber|red|green|emerald|purple|blue)-\d/);
  });

  it('제출 버튼만 primary이고, 인라인 미니폼을 열어도 primary는 하나다', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: '+ 새 측정위치' }));

    const submit = screen.getByRole('button', { name: '업로드 후 사전 검사' });
    expect(submit).toHaveAttribute('type', 'submit');
    expect(submit.className).toContain('bg-cs-link');
    expect(submit.querySelector('[data-icon="upload"]')).toBeInTheDocument();

    const primaries = Array.from(container.querySelectorAll('button'))
      .filter((b) => b.className.includes('bg-cs-link'));
    expect(primaries).toHaveLength(1);
    // 미니폼 '저장'은 normal(파랑 보더), '취소'는 링크형 - 둘 다 제출 버튼이 아니다
    const save = screen.getByRole('button', { name: '저장' });
    expect(save).toHaveAttribute('type', 'button');
    expect(save.className).toContain('border-cs-link');
    expect(save.className).not.toContain('bg-cs-link');
    expect(screen.getByRole('button', { name: '취소' })).toHaveAttribute('type', 'button');
  });

  it('제출 오류는 error Alert로 보인다', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);
    // 파일 없이 제출 -> onSubmit의 첫 가드('파일을 선택하세요.')가 동기적으로 error를 세운다
    fireEvent.submit(container.querySelector('form')!);

    const alert = container.querySelector('[data-alert="error"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('파일을 선택하세요.');
  });

  it('임포트 안내는 info Alert, 융합 메시 경고는 warning Alert다', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    const { container } = render(<UploadForm sites={[site]} locations={[location]} userId="u1" />);

    fireEvent.click(screen.getByLabelText('융합 메시'));
    expect(container.querySelector('[data-alert="warning"]')?.textContent)
      .toContain('분석 결과와 보고서에 경고가 표시됩니다');

    fireEvent.click(screen.getByLabelText('기존 결과 가져오기(CSV/JSON)'));
    expect(container.querySelector('[data-alert="info"]')?.textContent).toContain('외부 결과');
    // 임포트 모드에서는 데이터 계보 묶음 자체가 사라진다(기존 mode==='scan' 가드)
    expect(container.querySelector('[data-alert="warning"]')).toBeNull();
  });
});
```

- [ ] **Step 3: 실패 확인**

```bash
cd dashboard && npx vitest run app/upload components/__tests__/upload-form.test.tsx
```

기대: `app/upload/__tests__/page.test.tsx` 3건 중 1번째 FAIL(`expected 'mx-auto max-w-6xl p-6' to be 'flex flex-col gap-5 px-10 pb-10 pt-5'`), 2·3번째 PASS(배선은 이미 맞다). `upload-form.test.tsx`는 기존 13건 PASS, 새 describe 4건 FAIL(`className`에 `border-cs-input-border` 없음 / `[data-alert="error"]`가 null / primary 클래스 없음).

- [ ] **Step 4: `app/upload/page.tsx` 교체** — 조회·가드·주석은 그대로, `<main>` 클래스와 브레드크럼만 바뀐다.

```tsx
import { redirect } from 'next/navigation';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { UploadForm } from '@/components/upload-form';
import type { LocationRow, SiteRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function UploadPage({ searchParams }: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
  const supabase = await createClient();
  // proxy가 검증한 헤더를 읽는다(Auth 왕복 0회). 가드는 방어 심층으로 유지.
  const user = await getRequestUser();
  if (!user) redirect('/login');
  const [sitesRes, locationsRes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    supabase.from('locations').select('*'),
  ]);
  const sites = (sitesRes.data ?? []) as SiteRow[];
  const locations = (locationsRes.data ?? []) as LocationRow[];
  return (
    <main className={PAGE_MAIN}>
      {/* 최종 리뷰 M2: 타 화면(설정·현장 상세·스캔 작업대 등)과 루트 크럼 라벨을
          '현장'으로 통일한다 - 이 화면만 '홈'을 쓰고 있었다.
          Cloudscape(스펙 §7-2): 마지막 크럼은 현재 페이지(비링크)이므로 href 없이 넘긴다. */}
      <PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '스캔 업로드' }]} title="스캔 업로드" />
      {/* D4: 측정위치가 0개인 현장도 폼 안에서 바로 만들 수 있다(인라인 생성) -
          업로드 전 별도 페이지로 보내던 빈 상태 분기와 sites[0] 하드코딩을 없애고
          폼을 항상 렌더한다. */}
      <UploadForm sites={sites} locations={locations} userId={user.id} initialLocationId={location} />
    </main>
  );
}
```

- [ ] **Step 5: `components/upload-form.tsx` — import·상수 블록 교체** — 상태·이펙트·`onSubmit`·`discardScan`·`handleCreateLocation`(27~248행)은 **한 줄도 건드리지 않는다**.

(a) import 추가. 옛:
```tsx
import { uploadRawScan } from '@/lib/scans/upload';
import { IMPORT_EXTS, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, SCAN_EXTS, validateFile } from '@/lib/upload/validate';

interface Props {
```
새:
```tsx
import { uploadRawScan } from '@/lib/scans/upload';
import { IMPORT_EXTS, MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, SCAN_EXTS, validateFile } from '@/lib/upload/validate';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { FormField, SelectWrap, checkClass, inputClass, selectClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

interface Props {
```

(b) 로컬 클래스 상수 교체(옛 `inputClass`는 이제 `components/ui/form`에서 온다 — 로컬 정의를 반드시 지운다, 아니면 이름 충돌로 tsc가 실패한다). 옛:
```tsx
const NEW_SITE_VALUE = '';

// T2 토큰 (D4 브리프 Step 3): 주 버튼 zinc-900, 입력 border-zinc-300 rounded-md.
const inputClass = 'mt-1 w-full rounded-md border border-zinc-300 px-3 py-2';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50';

export function UploadForm({ sites, locations, userId, initialLocationId }: Props) {
```
새:
```tsx
const NEW_SITE_VALUE = '';

// Cloudscape 리스킨(T5): 입력·버튼·알림은 components/ui 프리미티브를 쓴다. 아래 둘은
// 프리미티브에 없는 이 화면 전용 모양이라 여기서만 정의한다(export 하지 않는다).
// 링크형 버튼: '+ 새 측정위치'·'취소'. 아트보드의 링크 스타일(cs-link 700, hover 밑줄).
const linkButtonClass =
  'inline-flex items-center gap-1.5 self-start text-sm font-bold text-cs-link hover:text-cs-link-hover hover:underline';
// 파일 입력: 드롭존은 소스에 없으므로 네이티브 input의 ::file-selector-button(Tailwind `file:`)만
// normal 버튼(2px cs-link 보더 알약) 모양으로 입힌다.
const fileInputClass =
  'w-full text-sm text-cs-text file:mr-3 file:h-8 file:cursor-pointer file:rounded-full file:border-2 file:border-cs-link file:bg-transparent file:px-5 file:text-sm file:font-bold file:text-cs-link';

export function UploadForm({ sites, locations, userId, initialLocationId }: Props) {
```

- [ ] **Step 6: `components/upload-form.tsx` — `return (` 블록 전체 교체** — 옛 블록은 `  return (` / `    <form onSubmit={onSubmit} className="max-w-xl space-y-4">`로 시작해 파일 끝의 `    </form>` / `  );` / `}`로 끝난다(250~426행). 그 사이 전부를 아래로 바꾼다. **핸들러·조건(`mode === 'scan'`, `mode === 'import'`, `newLocSiteId === NEW_SITE_VALUE`, `lineage === 'fused_mesh'`, `criteria.length === 0`, `busy`, `creatingLoc`)·문구·id·`onKeyDown`(리뷰 F2) 주석은 옛 블록과 글자 단위로 같다** — 바뀌는 것은 감싸는 엘리먼트와 클래스뿐이다.

```tsx
  return (
    // 페이지 섹션 gap(20px)과 같은 간격으로 컨테이너 -> 오류 -> 버튼 줄이 쌓인다.
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      {/* 스펙 §7-8: 컨테이너 제목 '업로드 정보'는 아트보드에만 있던 문구지만 Cloudscape
          해부(컨테이너 헤더)의 일부라 시스템 크롬으로 채택한다. 데이터·기능 추가는 없다. */}
      <Container title="업로드 정보">
        <div className="flex flex-col gap-4">
          {/* 업로드 방식(아트보드 본문 첫 줄) */}
          <div className="flex items-center gap-6">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" className={checkClass} checked={mode === 'scan'} onChange={() => setMode('scan')} />
              스캔 분석
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="radio" className={checkClass} checked={mode === 'import'} onChange={() => setMode('import')} />
              기존 결과 가져오기(CSV/JSON)
            </label>
          </div>
          {mode === 'import' && (
            <Alert type="info">
              기존 Colab 노트북 결과 CSV(X, Y, Signed_Distance_mm 컬럼 필수) 또는 범용
              연계 JSON(format: &quot;flatness-import-v1&quot;, points[].x/y/deviation_mm)을
              등록합니다. 바닥 결과만 지원하며, 결과 화면에 &quot;외부 결과&quot; 배지가
              표시됩니다.
            </Alert>
          )}

          {/* 2열(gap 40px). 모바일(<md)은 세로 스택(스펙 §5). */}
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2">

            {/* 좌열: 측정위치(+인라인 생성) · 표면 유형 · 데이터 계보 */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <FormField label="측정위치" htmlFor="location">
                  <SelectWrap>
                    <select id="location" required value={locationId} onChange={(e) => setLocationId(e.target.value)}
                      className={selectClass}>
                      <option value="">선택...</option>
                      {sitesList.map((s) => {
                        const locs = locationsList.filter((l) => l.site_id === s.id);
                        if (locs.length === 0) return null;
                        return (
                          <optgroup key={s.id} label={s.name}>
                            {locs.map((l) => (
                              <option key={l.id} value={l.id}>
                                {[l.building, l.floor, l.room, l.name].filter(Boolean).join(' / ')}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                  </SelectWrap>
                </FormField>
                {/* 문구 '+ 새 측정위치'는 접근 가능한 이름이자 테스트 셀렉터 - 아이콘으로 바꾸지 않는다 */}
                <button type="button" onClick={() => setShowNewLocation((v) => !v)} className={linkButtonClass}>
                  + 새 측정위치
                </button>
                {showNewLocation && (
                  <div className="flex flex-col gap-4 rounded-lg border border-cs-divider bg-white p-4"
                    onKeyDown={(e) => {
                      // 리뷰 F2: 이 패널은 상위 스캔 업로드 <form> 안에 중첩돼 있다. 파일·
                      // 위치·기준을 이미 골라둔 상태에서 미니폼 입력 중 Enter를 누르면 기본
                      // 동작이 상위 폼을 암묵 제출해 엉뚱한 기존 측정위치로 스캔이 올라간다.
                      // Enter를 여기서 가로채 "저장" 버튼과 같은 동작(측정위치 생성)으로
                      // 재해석한다(입력이 모두 단일 라인 input/select라 textarea 예외는 불필요).
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (!creatingLoc) handleCreateLocation();
                      }
                    }}>
                    <FormField label="현장 선택 또는 새 현장명" htmlFor="new-loc-site">
                      <SelectWrap>
                        <select id="new-loc-site" value={newLocSiteId} onChange={(e) => setNewLocSiteId(e.target.value)}
                          className={selectClass}>
                          <option value={NEW_SITE_VALUE}>+ 새 현장 만들기</option>
                          {sitesList.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </SelectWrap>
                    </FormField>
                    {newLocSiteId === NEW_SITE_VALUE && (
                      <FormField label="새 현장명" htmlFor="new-site-name">
                        <input id="new-site-name" value={newSiteName} onChange={(e) => setNewSiteName(e.target.value)}
                          className={inputClass} />
                      </FormField>
                    )}
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                      {([
                        ['building', '동'], ['floor', '층'], ['room', '공간'], ['name', '이름'],
                      ] as const).map(([key, label]) => (
                        <FormField key={key} label={label} htmlFor={`new-loc-${key}`}>
                          <input id={`new-loc-${key}`} value={newLocFields[key]}
                            onChange={(e) => setNewLocFields({ ...newLocFields, [key]: e.target.value })}
                            className={inputClass} />
                        </FormField>
                      ))}
                    </div>
                    {newLocError && <p className="text-xs leading-4 text-cs-error">{newLocError}</p>}
                    {/* 뷰당 primary 1개(제출 버튼) - '저장'은 normal, '취소'는 링크형 */}
                    <div className="flex items-center gap-2">
                      <Button onClick={handleCreateLocation} disabled={creatingLoc}>
                        {creatingLoc ? '저장 중...' : '저장'}
                      </Button>
                      <button type="button" onClick={() => setShowNewLocation(false)} className={linkButtonClass}>
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {mode === 'scan' && (
                <div className="flex flex-col gap-1">
                  {/* 라디오 묶음 제목: FormField는 단일 컨트롤용 <label htmlFor>라 묶음에는 span 700을 쓴다 */}
                  <span className="text-sm font-bold">표면 유형</span>
                  <div className="flex items-center gap-6">
                    {(['floor', 'wall'] as const).map((s) => (
                      <label key={s} className="inline-flex items-center gap-2 text-sm">
                        <input type="radio" className={checkClass} checked={surface === s} onChange={() => setSurface(s)} />
                        {SURFACE_LABEL[s]}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {mode === 'scan' && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-bold">데이터 계보</span>
                  <div className="flex items-center gap-6">
                    {(['raw', 'fused_mesh', 'unknown'] as const).map((l) => (
                      <label key={l} className="inline-flex items-center gap-2 text-sm">
                        <input type="radio" className={checkClass} checked={lineage === l} onChange={() => setLineage(l)} />
                        {LINEAGE_LABEL[l]}
                      </label>
                    ))}
                  </div>
                  {lineage === 'fused_mesh' && (
                    <Alert type="warning">
                      융합 메시는 앱이 스무딩한 데이터라 실제보다 양호하게 나올 수 있습니다. 분석 결과와 보고서에 경고가 표시됩니다.
                    </Alert>
                  )}
                </div>
              )}
            </div>

            {/* 우열: 적용 기준 · 측정일자/장비 · 담당자 · 파일 */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold">적용 기준</span>
                <div className="flex flex-col gap-2 rounded-lg border border-cs-divider bg-white p-3">
                  {criteria.length === 0 && <p className="text-sm text-cs-text-secondary">측정위치를 먼저 선택하세요.</p>}
                  {criteria.map((c) => (
                    <label key={c.id} className="flex items-start gap-2">
                      <input type="radio" className={`${checkClass} mt-0.5`} checked={criteriaId === c.id} onChange={() => setCriteriaId(c.id)} />
                      <span className="flex min-w-0 flex-col">
                        <span className="inline-flex flex-wrap items-baseline gap-1.5">
                          {/* 기준 코드는 ID 성격이라 mono(아트보드 13px) */}
                          <span className="font-mono text-[13px]">{c.name}</span>
                          {c.is_default && <em className="text-xs not-italic text-cs-text-secondary">(기본)</em>}
                          {c.site_id && <em className="text-xs not-italic text-cs-text-secondary">(현장 기준)</em>}
                        </span>
                        <span className="text-xs leading-4 text-cs-text-secondary">{c.source_text}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-start gap-4">
                {/* 아트보드: 측정일자 180px 고정, 장비 flex 1 */}
                <div className="w-[180px] shrink-0">
                  <FormField label="측정일자" htmlFor="scanned-at">
                    <input id="scanned-at" type="date" required value={scannedAt}
                      onChange={(e) => setScannedAt(e.target.value)}
                      className={`${inputClass} font-mono`} />
                  </FormField>
                </div>
                <div className="min-w-0 flex-1">
                  <FormField label="장비" htmlFor="device">
                    <input id="device" value={device} onChange={(e) => setDevice(e.target.value)}
                      placeholder="예: iPhone 15 Pro + 3d Scanner App" className={inputClass} />
                  </FormField>
                </div>
              </div>
              <FormField label="담당자 이름(직접 입력, 비우면 로그인 사용자)" htmlFor="operator">
                <input id="operator" value={operatorManual} onChange={(e) => setOperatorManual(e.target.value)}
                  className={inputClass} />
              </FormField>
              <FormField
                label={mode === 'import' ? '결과 파일 (csv/json)' : '스캔 파일 (ply/las/laz/xyz/txt/csv/pts)'}
                htmlFor="file">
                <input id="file" type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className={fileInputClass} />
                {/* 용량 안내는 아트보드처럼 컨트롤 아래(FormField description은 컨트롤 위라 쓰지 않는다) */}
                <p className="text-xs leading-4 text-cs-text-secondary">
                  파일은 Supabase Storage에 저장됩니다. 파일당 최대 <span className="font-mono">{MAX_UPLOAD_MB}</span>MB입니다.
                </p>
              </FormField>
            </div>

          </div>
        </div>
      </Container>
      {error && <Alert type="error">{error}</Alert>}
      {/* 컨테이너 아래 우측 정렬 - 이 뷰의 유일한 primary */}
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          <Icon name="upload" />
          {busy ? '업로드 중...' : mode === 'import' ? '가져오기 시작' : '업로드 후 사전 검사'}
        </Button>
      </div>
    </form>
  );
}
```

교체 후 자기 점검(테스트가 기대는 지점):
- `getByLabelText('측정위치'|'현장 선택 또는 새 현장명'|'새 현장명'|'이름'|'측정일자'|'장비'|/스캔 파일/|/결과 파일/)`는 전부 `FormField`의 `<label htmlFor>` + 같은 `id`로 이어진다 — id를 하나라도 바꾸면 기존 13건이 깨진다.
- `getByText('floor-kcs')`는 `c.name`만 담은 mono `<span>`에 정확히 일치한다(옛 구조도 텍스트 노드만 비교했다).
- `getByRole('button', { name: '+ 새 측정위치' | '저장' | '취소' })` — 문구 그대로. `Button`은 기본 `type="button"`이므로 미니폼 버튼이 폼을 제출하지 않는다.
- `Alert`의 children `<div>`에 오류 문자열이 단일 텍스트 노드로 들어가므로 `findByText(/…/)`·`getByText(/다시 시도하세요/)`가 그대로 잡는다.

- [ ] **Step 7: 통과 확인**

```bash
cd dashboard && npx vitest run
```
기대: 전체 PASS(upload-form 17건 + upload page 3건 포함).

```bash
cd dashboard && npx tsc --noEmit -p .
```
기대: 0 에러(로컬 `inputClass`를 지우지 않았으면 "Import declaration conflicts with local declaration" — Step 5(b)로 돌아간다).

```bash
grep -nE "(zinc|amber|red|green|emerald|purple|blue)-[0-9]" dashboard/app/upload/page.tsx dashboard/components/upload-form.tsx
```
기대: 0건.

화면 대조(사용자 상시 지시): `cd dashboard && npm run dev` → 로그인 후 `/upload`를 열어 `docs/design/cloudscape/Upload.dc.html`과 나란히 캡처한다. 확인 항목 — 브레드크럼 `현장 › 스캔 업로드`, 컨테이너 헤더 `업로드 정보`, 2열 grid(좌 측정위치/표면/계보, 우 기준/일자·장비/담당자/파일), `+ 새 측정위치` 클릭 시 미니폼(4열 입력, normal `저장` + 링크형 `취소`), 우하단 파랑 `업로드 후 사전 검사` 하나뿐. 브라우저 콘솔 오류 0. 375px에서 두 열이 세로로 쌓인다.

- [ ] **Step 8: 커밋**

```bash
git add dashboard/app/upload/page.tsx dashboard/app/upload/__tests__/page.test.tsx dashboard/components/upload-form.tsx dashboard/components/__tests__/upload-form.test.tsx
git commit -m "feat(dashboard): 스캔 업로드 화면 Cloudscape 리스킨 - '업로드 정보' 컨테이너 2열 + 인라인 측정위치 미니폼

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

---

### Task 6: 스캔 작업대 골격(3상태)

**Files:**
- Modify: `dashboard/app/scans/[id]/page.tsx`, `dashboard/components/scan-step-strip.tsx`, `dashboard/components/unit-confirm-form.tsx`, `dashboard/components/analysis-progress.tsx`, `dashboard/components/reanalyze-button.tsx`
- 변경 없음(확인만): `dashboard/components/scan-status-watcher.tsx` — 마크업이 없다(`return null`). 결정 사항의 "문구를 StatusIndicator로"는 이 파일에 적용할 문구 자체가 없다. `components/analysis/*`(결과 렌더)는 T7이 맡는다 — 여기서는 `AnalysisResult`/`SlopeResult` 호출부를 Container 안에 두는 것까지만.
- Test: `dashboard/app/scans/[id]/__tests__/page.test.tsx`(탐색 헬퍼·클래스 단언 갱신 + 신규 4건), `dashboard/components/__tests__/scan-step-strip.test.tsx`(전체 교체), `dashboard/components/__tests__/unit-confirm-form.test.tsx`(신규 describe 추가), `dashboard/components/__tests__/analysis-progress.test.tsx`(신규 describe 추가), `dashboard/components/__tests__/reanalyze-button.test.tsx`(신규 describe 추가). `analyze-buttons.test.tsx`·`scan-status-watcher.test.tsx`는 동작 단언만이라 손대지 않는다(그대로 통과해야 한다).

**Interfaces:**
- Consumes(T1·T2가 만든 것, 시그니처 그대로):
  - `PAGE_MAIN`(`components/ui/page.tsx`) — `<main className={PAGE_MAIN}>`.
  - `<PageHeader crumbs? title actions? />`(`components/ui/page-header.tsx`).
  - `<Container title? counter? description? actions? padded?=true className?>children</Container>`(`components/ui/container.tsx`).
  - `<KeyValuePairs items={{label, value: ReactNode}[]} columns?={4} />`(`components/ui/key-value.tsx`).
  - `<Alert type={'info'|'success'|'warning'|'error'} title? className?>children</Alert>`(`components/ui/alert.tsx`, `data-alert={type}`).
  - `<Button variant?>`(button props), `<LinkButton href variant? className?>`(`components/ui/button.tsx`).
  - `<FormField label htmlFor? description? error?>{control}</FormField>`, `checkClass`(`components/ui/form.tsx`).
  - `<StatusIndicator type>label</StatusIndicator>`, `StatusType`(`components/ui/status-indicator.tsx`, `data-status={type}`).
  - `<Badge tone>`(`components/ui/badge.tsx`, T2 재작성본 — `GRADE_TONE` 톤 4종 그대로 사용).
  - `<Icon name size? className? />`, `IconName`(`components/ui/icons.tsx`, `data-icon={name}`) — 이 태스크가 쓰는 이름: `check-circle`·`clock`·`x-circle`·`minus-circle`·`external`.
  - 소스에 이미 있는 것: `UNIT_OPTIONS`(`lib/upload/validate.ts`), `dataUrl`(`lib/domain/paths.ts`), `ANALYSIS_KIND_LABEL`·`ANALYSIS_STATUS_LABEL`·`GRADE_LABEL`·`LINEAGE_LABEL`·`SCAN_STATUS_LABEL`·`SURFACE_LABEL`(`lib/domain/labels.ts`), `GRADE_TONE`(`lib/domain/grade-tone.ts`), `isExternalImport`·`isSlopeStats`(`lib/domain/stats.ts`), `useRowStatus`, `enqueueJob`, `isDirectionAwareCriteria`.
- Produces: 없음(새 export 없음). `page.tsx` 안의 `SCAN_STATUS_TYPE: Record<ScanStatus, StatusType>`은 비export 표시 매핑이다. 재스킨된 `ScanStepStrip`은 현재 단계를 `<li aria-current="step">`으로, 연결선을 `[data-connector]`로 드러낸다 — T12 시각 대조가 이 속성을 쓴다.
- primary 배치(뷰당 1개, Global Constraints·스펙 §4): 이 태스크가 그리는 primary는 헤더 `이 위치의 보고서 생성`(`hasDoneAnalysis`일 때만)과 `UnitConfirmForm`의 `단위 확정 후 분석 시작`(awaiting_unit_confirm 상태의 '단위 확인' Container 안)이다. ScanDone 화면의 유일한 primary는 헤더의 보고서 원클릭이다 — 스펙 §6 ScanDone 행과 아트보드 `ScanDone.dc.html` 360행은 결과 패널 '저장'도 채움으로 그리지만 §4 규칙과 충돌하므로, T7이 `VerdictPanel`의 '저장'을 `variant="normal"`로 내린다(T7 Interfaces "저장은 normal"과 짝이다).

- [ ] **Step 1: 아트보드 확인** — `docs/design/cloudscape/ScanUnitConfirm.dc.html`·`ScanProcessing.dc.html`·`ScanDone.dc.html`을 브라우저(또는 Read)로 열어 세 상태가 **같은 페이지 한 장**임을 확인하고 아래 섹션의 마크업·수치·문구를 옮긴다. 옮길 섹션(위에서 아래로): 브레드크럼 현장 › 현장명 › 측정위치 → h1 `스캔 · 바닥 · <일시 mono 22px>` + (Done만) 우측 primary '이 위치의 보고서 생성'(이 화면의 유일한 primary — 아트보드가 채움으로 그린 결과 패널 '저장'은 §4 '뷰당 1개'에 따라 T7이 normal로 내린다) → 단계 스트립(아이콘+라벨, 사이 40px×1px 연결선, 완료 success / 현재 link 700 / 이후 disabled) → Container '스캔 정보'(KeyValuePairs 4열 7항목: 측정위치·원본 파일(mono 13px)·장비·데이터 계보·점 개수(mono tabular)·상태(StatusIndicator)·단위 배율(mono)) → [UnitConfirm] Container '단위 확인'(보조색 안내문 → 3fr:2fr 그리드 — 좌 높이 뷰 이미지 + '원본 크기로 열기 (새 탭)' 링크(cs-link 700 + external 아이콘) + 12px 설명 / 우 form: info Alert(파일명 mono 700 + 12px 설명) → '파일 좌표 단위' 라디오 3종 → primary '단위 확정 후 분석 시작'(check-circle)) → [Processing] Container '평활도 분석'(헤더 액션: disabled 버튼 + 12px 힌트, 본문: in-progress StatusIndicator) → [Done] Container '평활도 분석'(헤더 normal '평활도 분석', 본문: normal 링크 버튼 '분석 완료 - 결과 보기' + 이전 분석 행) → Container '구배 분석'(적용 기준 라디오 + normal '구배 분석') → Container '평활도 결과'(헤더 제목 옆 `2026-09-03 11:32 · 엔진 p4-0.5.0` mono 12px 보조색; 본문은 T7). 아트보드에만 있는 '산출물 PNG 자리' 캡션, 결과 본문의 탭·히트맵·판정 패널은 이 태스크 범위 밖이다.

- [ ] **Step 2: 가드 영역 스냅샷(수정 전)** — `page.tsx`의 JSX 이전 계산부 전체(`WATCHED_SCAN_STATUSES`부터 `return (`까지: `provenNotImport`·`isImportUnknownOrTrue`·`showFirstFlatness`·`showSlopeButton/Section`·`staleSelectedAnalysis`와 그 주석 전부)를 파일로 뽑아 둔다. 이 영역은 **한 글자도** 바꾸지 않는다(C1 사고 가드).

```bash
cd dashboard
sed -n '/^const WATCHED_SCAN_STATUSES/,/^  return ($/p' 'app/scans/[id]/page.tsx' > /tmp/guards-before.txt
wc -l /tmp/guards-before.txt   # 205 (26행 ~ 230행)
grep -c -E 'provenNotImport|isImportUnknownOrTrue|showFirstFlatness|showSlopeButton|showSlopeSection|staleSelectedAnalysis' /tmp/guards-before.txt   # 0이 아니어야 한다
```

- [ ] **Step 3: 실패하는 테스트 작성/갱신**

`app/scans/[id]/__tests__/page.test.tsx` — 서버 컴포넌트라 render()가 아니라 엘리먼트 트리 탐색이다. Cloudscape 프리미티브는 자식을 `children`뿐 아니라 `title`·`actions`·`items` 슬롯 prop으로 받으므로 탐색 헬퍼가 모든 prop 값을 따라가야 한다. 가드·분기 단언은 전부 그대로 두고 **탐색 대상 타입과 클래스 단언만** 바꾼다.

(1) import 블록 — 아래 5줄을 기존 `import { PageHeader } from '@/components/ui/page-header';`(앵커 — 이미 있는 줄이다, 다시 쓰지 않는다) 바로 아래에 추가. 앵커의 다음 줄 `import type { AnalysisKind, AnalysisRow, LocationRow, ScanRow, SiteRow, Stats } from '@/lib/domain/types';`도 이미 파일에 있으므로 건드리지 않는다(같은 식별자를 두 번 import하면 TS2300으로 Step 11의 `tsc` 0 에러가 깨진다). 아래 블록의 첫 줄이 앵커(기존 줄), 나머지 5줄이 새로 넣는 줄이다:

```tsx
import { PageHeader } from '@/components/ui/page-header';
import { Alert } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { KeyValuePairs } from '@/components/ui/key-value';
import { PAGE_MAIN } from '@/components/ui/page';
```

(2) 탐색 헬퍼 교체 — `// 엘리먼트 트리를 재귀 탐색해 …` 주석부터 `collectText` 함수 끝(`function chain(` 바로 앞)까지를 다음으로 교체:

```tsx
// 엘리먼트 트리 전역 순회. Cloudscape 프리미티브(Container·PageHeader·Alert·KeyValuePairs)는
// 자식을 children뿐 아니라 title·actions·items 같은 슬롯 prop으로도 받으므로, 옛 탐색처럼
// children만 따라가면 Container의 actions 슬롯에 놓인 ReanalyzeButton·헤더 액션의
// LinkButton·KeyValuePairs의 items 문구를 통째로 놓친다. 함수 컴포넌트는 실행되지 않고
// 타입으로만 남으니(async 서버 컴포넌트 테스트 제약) 모든 prop 값을 따라간다. 문자열·
// 숫자는 onNode에 그대로 넘기고, 순환 참조는 seen으로 막는다.
type El = { type?: unknown; props: Record<string, unknown> };

function walk(node: unknown, onNode: (n: unknown) => void, seen = new WeakSet<object>()) {
  if (typeof node === 'string' || typeof node === 'number') { onNode(node); return; }
  if (node == null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  onNode(node);
  if (Array.isArray(node)) { node.forEach((n) => walk(n, onNode, seen)); return; }
  Object.values(node as Record<string, unknown>).forEach((v) => walk(v, onNode, seen));
}

// 특정 컴포넌트 타입(또는 태그 문자열)이 쓰인 엘리먼트를 모두 모은다.
function findAll(node: unknown, type: unknown): El[] {
  const acc: El[] = [];
  walk(node, (n) => {
    const el = n as El;
    if (n && typeof n === 'object' && !Array.isArray(n) && el.type === type && el.props) acc.push(el);
  });
  return acc;
}

// 안내 문구 회귀를 잡으려면 트리의 문자열을 모아야 한다. findAll은 타입만 본다.
// (className·href 같은 prop 문자열도 섞여 들어오지만 한국어 안내 문구와는 겹치지 않는다.)
function collectText(node: unknown): string[] {
  const acc: string[] = [];
  walk(node, (n) => { if (typeof n === 'string' || typeof n === 'number') acc.push(String(n)); });
  return acc;
}

// 링크 href 수집: 본문 링크(next/link Link)와 버튼 모양 링크(LinkButton - 안에서 Link를
// 그리지만 트리에는 LinkButton 타입으로만 남는다) 둘 다 센다.
function linkHrefs(node: unknown): string[] {
  return [...findAll(node, Link), ...findAll(node, LinkButton)].map((l) => String(l.props.href));
}

// 분석 섹션(평활도·구배)만 고른다 - 제목이 '<종류> 분석'인 Container. '스캔 정보'·
// '단위 확인'·'<종류> 결과'(제목이 프래그먼트)는 걸리지 않는다. 코드가 항상 평활도를
// 먼저, 구배를 나중에 그리므로 [0] 평활도, [1] 구배다.
function analysisSections(node: unknown): El[] {
  return findAll(node, Container).filter(
    (c) => typeof c.props.title === 'string' && c.props.title.endsWith(' 분석'));
}
```

(3) `<section>` 탐색을 분석 Container 탐색으로 — `it('H(재리뷰): …')` 안:

```tsx
    const el = await ScanPage(pageProps());
    const sections = findAll(el, 'section');
    const progresses = findAll(el, AnalysisProgress);
```
→
```tsx
    const el = await ScanPage(pageProps());
    const sections = analysisSections(el);
    const progresses = findAll(el, AnalysisProgress);
```

`it('이전 분석 목록이 종류별로 나뉜다…')` 안:

```tsx
    const el = await ScanPage(pageProps());
    const sections = findAll(el, 'section');
    expect(sections).toHaveLength(2); // [0] 평활도, [1] 구배 (렌더 순서 고정)
    const flatnessLinks = findAll(sections[0], Link).map((l) => l.props.href);
    const slopeLinks = findAll(sections[1], Link).map((l) => l.props.href);
```
→
```tsx
    const el = await ScanPage(pageProps());
    const sections = analysisSections(el);
    expect(sections).toHaveLength(2); // [0] 평활도, [1] 구배 (렌더 순서 고정)
    const flatnessLinks = linkHrefs(sections[0]);
    const slopeLinks = linkHrefs(sections[1]);
```

(4) href 수집을 `linkHrefs`로 — 아래 6곳을 각각 교체(옛 줄 → 새 줄, 다른 줄은 그대로):

```tsx
    const hrefs = findAll(el, Link).map((l) => l.props.href);
```
→ (`'정합 병합 스캔이면 …'`·`'정합 이력을 못 찾으면 …'` 두 테스트)
```tsx
    const hrefs = linkHrefs(el);
```

```tsx
    const hrefs = findAll(el, Link).map((l) => String(l.props.href));
```
→ (`'병합 스캔을 단위 확인 화면으로 되돌리지 않고 …'`·`'단위 미확정 스캔은 단위 확정 폼을 …'`·`'failed 스캔에는 업로드 화면으로 …'` 세 테스트)
```tsx
    const hrefs = linkHrefs(el);
```

`it('완료된 분석이 있으면 헤더 액션에 …')` 안:
```tsx
    const header = findAll(el, PageHeader)[0];
    const actionHrefs = findAll(header.props.actions, Link).map((l) => String(l.props.href));

    expect(actionHrefs).toContain('/reports/new?location=l1');
```
→
```tsx
    const header = findAll(el, PageHeader)[0];
    const actionHrefs = linkHrefs(header.props.actions);

    expect(actionHrefs).toContain('/reports/new?location=l1');
    // 뷰당 primary 1개(Global Constraints·스펙 §4) - 보고서 원클릭이 그 하나다. 결과 패널의
    // '저장'은 T7이 normal로 그린다(아트보드·스펙 §6은 채움으로 그리지만 §4 규칙을 따른다).
    const primaries = findAll(header.props.actions, LinkButton).filter((b) => b.props.variant === 'primary');
    expect(primaries).toHaveLength(1);
    expect(String(primaries[0].props.href)).toBe('/reports/new?location=l1');
```

`it('완료된 분석이 하나도 없으면 보고서 생성 액션이 없다…')` 안:
```tsx
    const header = findAll(el, PageHeader)[0];

    expect(findAll(header.props.actions, Link)).toHaveLength(0);
```
→
```tsx
    const header = findAll(el, PageHeader)[0];

    expect(linkHrefs(header.props.actions)).toHaveLength(0);
```

(5) 페이지 폭 단언을 PAGE_MAIN으로 — `describe('ScanPage 단위 확인 인라인 …')`의 첫 테스트 전체를 교체:

```tsx
  it('단계 E 리뷰 7: 페이지 폭을 max-w-6xl로 유지한다(높이 뷰 2열 배치가 쓰는 폭이다)', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        status: 'awaiting_unit_confirm', unit_scale: null,
        height_view_path: 'artifacts/scans/sc1/height_view.png',
      }), []) as never);

    const el = await ScanPage(pageProps());
    const main = el as { type: string; props: { className: string } };

    expect(main.type).toBe('main');
    expect(main.props.className).toContain('max-w-6xl');
    expect(main.props.className).not.toContain('max-w-md');
  });
```
→
```tsx
  // Cloudscape(스펙 §5): 본문은 최대폭 없이 PAGE_MAIN 하나다(모든 page/loading이 같은 문자열 -
  // 전환 점프 방지). 높이 뷰 2열 배치가 쓰는 폭이 max-w-md 같은 값으로 쪼그라들면 축 눈금을
  // 못 읽으므로, 폭 제한이 끼어들지 않는지 여기서 계속 지킨다.
  it('단계 E 리뷰 7: 본문 클래스는 PAGE_MAIN이고 최대폭 제한이 없다(높이 뷰 2열 배치가 쓰는 폭이다)', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({
        status: 'awaiting_unit_confirm', unit_scale: null,
        height_view_path: 'artifacts/scans/sc1/height_view.png',
      }), []) as never);

    const el = await ScanPage(pageProps());
    const main = el as { type: string; props: { className: string } };

    expect(main.type).toBe('main');
    expect(main.props.className).toBe(PAGE_MAIN);
    expect(main.props.className).not.toContain('max-w-');
  });
```

(6) 신규 describe — 파일 맨 끝에 추가:

```tsx
// ---- T6 Cloudscape 골격 ----
// 세 아트보드(UnitConfirm·Processing·Done)는 같은 페이지의 세 상태다. 여기서는 새 골격
// (Container·KeyValuePairs·Alert·LinkButton)에 옛 데이터·분기가 그대로 배선됐는지 본다.
describe('ScanPage Cloudscape 골격 (T6)', () => {
  it('스캔 정보는 Container 안 KeyValuePairs 4열 7항목이다(옛 dl과 같은 항목·순서)', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ point_count: 1234567 }), []) as never);

    const el = await ScanPage(pageProps());
    const info = findAll(el, Container).find((c) => c.props.title === '스캔 정보');
    const kv = findAll(info, KeyValuePairs);

    expect(info).toBeDefined();
    expect(kv).toHaveLength(1);
    expect(kv[0].props.columns).toBe(4);
    expect((kv[0].props.items as { label: unknown }[]).map((i) => i.label))
      .toEqual(['측정위치', '원본 파일', '장비', '데이터 계보', '점 개수', '상태', '단위 배율']);
    expect(collectText(kv[0].props.items).join('')).toContain('1,234,567');
  });

  it.each([
    ['uploaded', 'info'],
    ['failed', 'error'],
  ] as const)('%s 스캔의 안내는 %s Alert다', async (status, type) => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan({ status }), []) as never);

    const el = await ScanPage(pageProps());

    expect(findAll(el, Alert).map((a) => a.props.type)).toContain(type);
  });

  it('병합 스캔 안내는 warning Alert이고 정합 링크는 normal LinkButton이다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ lineage: 'registered' }), [], location, { id: 'reg-9' }) as never);

    const el = await ScanPage(pageProps());
    const warning = findAll(el, Alert).find((a) => a.props.type === 'warning');
    const btn = findAll(warning, LinkButton)[0];

    expect(warning).toBeDefined();
    expect(String(btn.props.href)).toBe('/registrations/reg-9');
    expect(btn.props.variant).toBe('normal');
  });

  it('단위 확인은 Container 안에 안내문 + UnitConfirmForm, 결과는 "<종류> 결과" Container 안이다', async () => {
    vi.mocked(createClient).mockResolvedValue(
      stubSupabase(mkScan({ status: 'awaiting_unit_confirm', unit_scale: null }), []) as never);
    const el = await ScanPage(pageProps());
    const unit = findAll(el, Container).find((c) => c.props.title === '단위 확인');
    expect(unit).toBeDefined();
    expect(findAll(unit, UnitConfirmForm)).toHaveLength(1);

    const done = mkAnalysis({ id: 'f1', kind: 'flatness', stats: FLAT_STATS, engine_version: 'p4-0.5.0' });
    vi.mocked(createClient).mockResolvedValue(stubSupabase(mkScan(), [done]) as never);
    const el2 = await ScanPage(pageProps());
    const result = findAll(el2, Container).find((c) => findAll(c, AnalysisResult).length === 1);
    expect(result).toBeDefined();
    const head = collectText(result?.props.title).join('');
    expect(head).toContain('평활도 결과');
    expect(head).toContain('2026-07-01 00:00');
    expect(head).toContain('p4-0.5.0');
  });
});
```

`components/__tests__/scan-step-strip.test.tsx` — 전체 교체(현재 단계를 클래스로 읽던 단언을 `aria-current="step"`으로, 톤·아이콘은 토큰·`data-icon`으로):

```tsx
// D5 스캔 작업대: 단계 스트립(업로드 → 사전 검사 → 단위 확정 → 분석 → 완료).
// 상태별 "현재 단계" 매핑이 이 컴포넌트의 전부다 - 매핑이 한 칸 밀리면 사용자는
// 이미 끝난 단계를 기다리거나, 아직 못 하는 단계를 하려고 든다.
// Cloudscape 재스킨: 현재 단계는 스타일이 아니라 aria-current="step"으로 읽는다(스펙 §8).
// 톤(완료 success / 현재 link 700 / 이후 disabled / 실패 error)과 아이콘은 그 다음이다.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScanStepStrip } from '../scan-step-strip';

// 라벨의 단계 항목(li) - aria-current·톤 클래스·아이콘이 모두 여기 달린다.
function step(label: string): HTMLElement {
  const li = screen.getByText(label).closest('li');
  if (!li) throw new Error(`단계 li 없음: ${label}`);
  return li;
}
function iconOf(label: string) {
  return step(label).querySelector('[data-icon]')?.getAttribute('data-icon');
}

describe('ScanStepStrip', () => {
  it.each([
    ['uploaded', '사전 검사'],
    ['awaiting_unit_confirm', '단위 확정'],
    ['ready', '분석'],
  ] as const)('상태 %s에서 현재 단계 %s가 aria-current="step"이다(현재는 하나뿐)', (status, label) => {
    const { container } = render(<ScanStepStrip status={status} hasDoneAnalysis={false} />);
    expect(step(label)).toHaveAttribute('aria-current', 'step');
    expect(container.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
  });

  it('현재 단계는 cs-link 700 + clock 아이콘이다', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis={false} />);
    expect(step('분석').className).toContain('text-cs-link');
    expect(step('분석').className).toContain('font-bold');
    expect(iconOf('분석')).toBe('clock');
  });

  it('완료 분석이 있으면 마지막 단계가 완료 표시된다', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis />);
    expect(screen.getByText('완료')).toBeInTheDocument();
  });

  it('failed는 실패 톤(cs-error + x-circle)으로, 현재 단계로 표시된다', () => {
    render(<ScanStepStrip status="failed" hasDoneAnalysis={false} />);
    expect(step('사전 검사')).toHaveAttribute('aria-current', 'step');
    expect(step('사전 검사').className).toContain('text-cs-error');
    expect(iconOf('사전 검사')).toBe('x-circle');
  });

  // '완료'는 스트립에 항상 있는 라벨이라 존재 확인만으로는 아무 회귀도 못 잡는다
  // (위 브리프 테스트는 그대로 두되, 여기서 강조까지 못 박는다). hasDoneAnalysis면
  // 현재 단계가 '분석'이 아니라 '완료'로 넘어가야 한다.
  it('완료 분석이 있으면 완료 단계가 현재로 강조되고 분석 단계는 지난 톤이 된다', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis />);
    expect(step('완료')).toHaveAttribute('aria-current', 'step');
    expect(step('분석')).not.toHaveAttribute('aria-current');
    expect(step('분석').className).toContain('text-cs-success');
    expect(iconOf('분석')).toBe('check-circle');
  });

  // 아트보드(ScanDone): 종결 단계 '완료'가 현재이면 시계가 아니라 check-circle이다 -
  // 시계는 "완료를 기다리는 중"으로 읽힌다.
  it('완료 단계가 현재이면 아이콘은 clock이 아니라 check-circle이다(종결 상태)', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis />);
    expect(iconOf('완료')).toBe('check-circle');
    expect(step('완료').className).toContain('text-cs-link');
  });

  it('지난 단계는 cs-success + check-circle, 미래 단계는 cs-disabled + minus-circle로 구분된다', () => {
    render(<ScanStepStrip status="awaiting_unit_confirm" hasDoneAnalysis={false} />);
    for (const l of ['업로드', '사전 검사']) {
      expect(step(l).className).toContain('text-cs-success');
      expect(iconOf(l)).toBe('check-circle');
    }
    for (const l of ['분석', '완료']) {
      expect(step(l).className).toContain('text-cs-disabled');
      expect(iconOf(l)).toBe('minus-circle');
    }
  });

  it('ol/li 5단계에 사이 연결선 4개(cs-divider)이고 딩뱃 구분자·모노 폰트는 없다', () => {
    const { container } = render(<ScanStepStrip status="ready" hasDoneAnalysis={false} />);
    expect(container.querySelectorAll('ol > li')).toHaveLength(5);
    const connectors = container.querySelectorAll('[data-connector]');
    expect(connectors).toHaveLength(4);
    expect(connectors[0].className).toContain('bg-cs-divider');
    expect(screen.queryByText('›')).toBeNull();
    expect(container.querySelector('ol')?.className).not.toContain('font-mono');
  });

  it('failed여도 hasDoneAnalysis가 완료로 건너뛰지 않는다(실패 표시가 우선)', () => {
    // 재분석 실패 등으로 상태·분석 이력이 어긋난 조합에서도 실패를 숨기면 안 된다.
    render(<ScanStepStrip status="failed" hasDoneAnalysis />);
    expect(step('사전 검사')).toHaveAttribute('aria-current', 'step');
    expect(step('사전 검사').className).toContain('text-cs-error');
  });
});
```

`components/__tests__/unit-confirm-form.test.tsx` — 기존 단언은 클래스 문자열이 없어(그리드 클래스 `lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]`·`w-full`·`sr-only`는 유지한다) 손대지 않는다. 파일 끝에 추가:

```tsx
// T6 Cloudscape 재스킨: 파일 안내는 info Alert, 라디오는 네이티브 + accent 토큰(스펙 §7-6),
// 확정 버튼은 이 뷰의 유일한 primary다. 색은 cs-* 토큰만 본다.
describe('UnitConfirmForm Cloudscape 재스킨 (T6)', () => {
  it('파일 안내는 info Alert, 단위 라디오는 checkClass, 라벨 700, 확정 버튼은 primary다', () => {
    const { container } = render(<UnitConfirmForm scan={scan} userId="u1" />);

    expect(container.querySelector('[data-alert="info"]')).not.toBeNull();
    expect(screen.getByLabelText(/mm/).className).toContain('accent-cs-link');
    expect(screen.getByText('파일 좌표 단위').className).toContain('font-bold');
    expect(screen.getByRole('button', { name: '단위 확정 후 분석 시작' }).className).toContain('bg-cs-link');
  });

  it('높이 뷰 폴백은 warning Alert다', () => {
    const { container } = render(<UnitConfirmForm scan={scanWithView} userId="u1" />);
    fireEvent.error(screen.getByRole('img', { name: /높이 뷰/ }));

    expect(container.querySelector('[data-alert="warning"]')).not.toBeNull();
    expect(screen.getByText(/높이 뷰를 불러오지 못했습니다/)).toBeInTheDocument();
  });

  it('원본 열기 링크는 cs-link 700이고 구 팔레트 클래스가 남아 있지 않다', () => {
    const { container } = render(<UnitConfirmForm scan={scanWithView} userId="u1" />);

    expect(container.querySelector('[data-icon="external"]')).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-/);
  });
});
```

`components/__tests__/analysis-progress.test.tsx` — 파일 끝에 추가:

```tsx
// T6 Cloudscape 재스킨: 진행·실패 문구는 StatusIndicator(data-status), done은 normal 알약 링크.
describe('AnalysisProgress Cloudscape 재스킨 (T6)', () => {
  it('진행 중이면 StatusIndicator in-progress로 상태 라벨 + 자동 갱신 안내를 그린다', () => {
    useRowStatusMock.mockReturnValue('processing');
    render(<AnalysisProgress analysisId="a1" initialStatus="processing" scanId="s1" />);

    const el = screen.getByText(/워커가 처리 중입니다/);
    expect(el).toHaveAttribute('data-status', 'in-progress');
    expect(el.textContent).toContain('분석 중');
  });

  it('실패하면 StatusIndicator error + 원인 안내다', () => {
    useRowStatusMock.mockReturnValue('failed');
    render(<AnalysisProgress analysisId="a1" initialStatus="failed" scanId="s1" />);

    expect(screen.getByText('분석에 실패했습니다.')).toHaveAttribute('data-status', 'error');
    expect(screen.getByText(/3회 자동 재시도 후에도 실패한 상태입니다/)).toBeInTheDocument();
  });

  it('done 링크는 normal 알약 버튼(파랑 보더, 채움 없음)이다', () => {
    useRowStatusMock.mockReturnValue('done');
    render(<AnalysisProgress analysisId="a1" initialStatus="done" scanId="s1" />);

    const link = screen.getByText('분석 완료 - 결과 보기');
    expect(link.className).toContain('border-cs-link');
    expect(link.className).not.toContain('bg-cs-link');
  });
});
```

`components/__tests__/reanalyze-button.test.tsx` — 파일 끝에 추가:

```tsx
// T6 Cloudscape 재스킨: 버튼은 normal 알약(진행 중이면 cs-disabled 보더), 구배 기준 라디오는
// FormField 안 네이티브 라디오(checkClass)이고 순서는 RPC 반환 순서 그대로다(재정렬 금지).
describe('ReanalyzeButton Cloudscape 재스킨 (T6)', () => {
  it('활성 버튼은 normal(cs-link 보더), 진행 중이면 disabled(cs-disabled 보더)다', () => {
    const { rerender } = render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness"
      criteriaId="cr1" latestStatus="done" isImport={false} />);
    expect(screen.getByRole('button', { name: '평활도 분석' }).className).toContain('border-cs-link');

    rerender(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="flatness"
      criteriaId="cr1" latestStatus="processing" isImport={false} />);
    const btn = screen.getByRole('button', { name: '평활도 분석' });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('border-cs-disabled');
    expect(screen.getByText(/진행 중인 분석이 끝난 뒤/).className).toContain('text-cs-text-secondary');
  });

  it('구배 기준 라디오는 checkClass를 쓰고 RPC 반환 순서를 그대로 유지한다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabaseSlope(slopeCriteriaRows) as never);
    render(<ReanalyzeButton scanId="s1" userId="u1" surface="floor" kind="slope" siteId="site1"
      isImport={false} />);
    await waitFor(() => expect(screen.getByText('실내 평바닥')).toBeInTheDocument());

    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios[0].className).toContain('accent-cs-link');
    // 픽스처 순서(옥상 → 욕실 → 실내) 그대로 - is_default(실내)를 앞으로 끌어올리지 않는다.
    const names = radios.map((r) => r.closest('label')?.querySelector('span > span')?.textContent);
    expect(names).toEqual(['옥상 슬래브(노출방수)', '욕실·화장실 바닥', '실내 평바닥']);
    expect(screen.getByText('적용 기준').className).toContain('font-bold');
  });
});
```

- [ ] **Step 4: 실패 확인**

```bash
cd dashboard && npx vitest run "app/scans" components/__tests__/scan-step-strip.test.tsx components/__tests__/unit-confirm-form.test.tsx components/__tests__/analysis-progress.test.tsx components/__tests__/reanalyze-button.test.tsx
```
기대 실패: `page.test.tsx` — `analysisSections`가 0건(Container 미사용)이라 'H'·'이전 분석 목록' FAIL, `linkHrefs`는 옛 `Link`도 세므로 href 단언은 통과하지만 `PAGE_MAIN` 단언·T6 describe 4건 FAIL. `scan-step-strip.test.tsx` — `aria-current` 없음·`data-icon` 없음으로 대부분 FAIL. `unit-confirm-form`·`analysis-progress`·`reanalyze-button`의 T6 describe — `data-alert`·`data-status`·`accent-cs-link`·`border-cs-link` 없음으로 FAIL. 기존 동작 단언은 전부 PASS여야 한다(여기서 하나라도 깨지면 헬퍼 교체가 잘못된 것이다 — 구현으로 넘어가지 말고 헬퍼를 고친다).

- [ ] **Step 5: scan-step-strip.tsx 재작성** — props·`currentIndex`·상단 주석 그대로, 렌더만 가로 스텝. 전체 교체:

```tsx
// D5 스캔 작업대: 스캔의 진행 단계를 한 줄로 보여주는 스트립.
// 업로드 → 사전 검사 → 단위 확정 → 분석 → 완료
//
// "현재 단계" 매핑(스캔 status는 워커·화면이 전이시키는 값이다):
// - uploaded: 사전 검사를 기다리는 중 → 현재 = 사전 검사
// - failed: 사전 검사가 실패한 상태(워커의 precheck 실패 전이) → 사전 검사를 실패 톤으로
// - awaiting_unit_confirm: 현재 = 단위 확정
// - ready/archived: 현재 = 분석. 단, 완료된 분석이 하나라도 있으면(hasDoneAnalysis)
//   현재 = 완료 (status에는 "분석 끝남"이 따로 없다 - analyses가 진실이다)
//
// Cloudscape 재스킨(스펙 §4 ScanStepStrip): 가로 스텝 = 아이콘 + 라벨, 스텝 사이 1px·40px
// 연결선(아트보드). 완료=success check-circle, 현재=cs-link 700 clock(마지막 '완료' 단계가
// 현재면 check-circle - 종결 상태에 시계를 달면 "완료를 기다리는 중"으로 읽힌다),
// 이후=cs-disabled minus-circle, 실패=cs-error x-circle. 현재 단계의 진실은 스타일이 아니라
// li의 aria-current="step"이다(테스트·접근성 모두 이 속성을 본다).
import type { ScanRow } from '@/lib/domain/types';
import { Icon, type IconName } from '@/components/ui/icons';

const STEPS = ['업로드', '사전 검사', '단위 확정', '분석', '완료'] as const;

function currentIndex(status: ScanRow['status'], hasDoneAnalysis: boolean): number {
  // 실패가 우선한다 - 상태와 분석 이력이 어긋난 조합에서도 실패를 숨기면 안 된다.
  if (status === 'failed' || status === 'uploaded') return 1;
  if (status === 'awaiting_unit_confirm') return 2;
  return hasDoneAnalysis ? 4 : 3; // ready/archived
}

function toneOf(i: number, cur: number, failed: boolean): { className: string; icon: IconName } {
  if (i < cur) return { className: 'text-cs-success', icon: 'check-circle' };
  if (i > cur) return { className: 'text-cs-disabled', icon: 'minus-circle' };
  if (failed) return { className: 'font-bold text-cs-error', icon: 'x-circle' };
  return { className: 'font-bold text-cs-link', icon: i === STEPS.length - 1 ? 'check-circle' : 'clock' };
}

export function ScanStepStrip({ status, hasDoneAnalysis }: {
  status: ScanRow['status'];
  hasDoneAnalysis: boolean;
}) {
  const cur = currentIndex(status, hasDoneAnalysis);
  const failed = status === 'failed';
  return (
    <ol aria-label="스캔 진행 단계" className="flex flex-wrap items-center gap-3 text-sm leading-5">
      {STEPS.map((label, i) => {
        const t = toneOf(i, cur, failed);
        return (
          <li key={label} aria-current={i === cur ? 'step' : undefined}
            className={`flex items-center gap-3 ${t.className}`}>
            {i > 0 && <span aria-hidden data-connector className="h-px w-10 bg-cs-divider" />}
            <span className="inline-flex items-center gap-1.5">
              <Icon name={t.icon} />
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 6: analysis-progress.tsx 재작성** — 훅·분기·문구 그대로, 렌더만 StatusIndicator/LinkButton. 전체 교체:

```tsx
// Realtime 진행 상태 (스펙 §3.2.⑤)
'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useRowStatus } from '@/lib/hooks/use-row-status';
import { ANALYSIS_STATUS_LABEL } from '@/lib/domain/labels';
import type { AnalysisStatus } from '@/lib/domain/types';
import { LinkButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { StatusIndicator } from '@/components/ui/status-indicator';

export function AnalysisProgress({ analysisId, initialStatus, scanId }: {
  analysisId: string;
  initialStatus: AnalysisStatus;
  // D6: 결과 보기 링크가 이 스캔의 작업대(?analysis= 선택 렌더)로 바로 가도록 부모가
  // 이미 알고 있는 scanId를 받는다 - /analyses/[id]로 보내면 D6 리다이렉트가 한 홉
  // 더 거쳐 같은 곳으로 보내지만, 이 화면 자체를 그리는 부모(app/scans/[id]/page.tsx)가
  // scanId를 이미 갖고 있으니 그 홉을 건너뛴다.
  scanId: string;
}) {
  const router = useRouter();
  const status = useRowStatus('analyses', analysisId, initialStatus);

  useEffect(() => {
    if (status === 'done') router.refresh(); // 완료되면 서버 데이터(판정 배지 등) 갱신
  }, [status, router]);

  if (status === 'done') {
    // 아트보드(ScanDone): normal 알약 링크 + check-circle. 텍스트는 <a>의 직접 자식으로 둔다 -
    // analysis-progress.test.tsx가 getByText로 잡은 요소의 href를 본다.
    return (
      <div className="flex">
        <LinkButton href={`/scans/${scanId}?analysis=${analysisId}`} variant="normal">
          <Icon name="check-circle" />
          분석 완료 - 결과 보기
        </LinkButton>
      </div>
    );
  }
  if (status === 'failed') {
    return (
      <div className="flex flex-col gap-1">
        <StatusIndicator type="error">분석에 실패했습니다.</StatusIndicator>
        <p className="text-xs leading-4 text-cs-text-secondary">
          지원 포맷(ply/las/laz/xyz/txt/csv/pts)·인코딩·단위 설정을 확인하세요. 상세 원인은
          워커 실행 창의 로그에 남습니다. 3회 자동 재시도 후에도 실패한 상태입니다.
        </p>
      </div>
    );
  }
  return (
    <StatusIndicator type="in-progress">
      {ANALYSIS_STATUS_LABEL[status]}... (워커가 처리 중입니다. 이 화면은 자동 갱신됩니다)
    </StatusIndicator>
  );
}
```

- [ ] **Step 7: reanalyze-button.tsx 렌더 교체** — 상단 주석·Props·useEffect·onClick(1~172행)은 그대로. import 2줄 추가 + `const label =` 이하 return 블록 교체.

import(옛 → 새):
```tsx
import { ANALYSIS_KIND_LABEL } from '@/lib/domain/labels';
import { isDirectionAwareCriteria } from '@/lib/domain/slope-direction';
import type { AnalysisKind, AnalysisStatus, CriteriaRow, SlopeThreshold, Surface } from '@/lib/domain/types';
```
→
```tsx
import { ANALYSIS_KIND_LABEL } from '@/lib/domain/labels';
import { isDirectionAwareCriteria } from '@/lib/domain/slope-direction';
import type { AnalysisKind, AnalysisStatus, CriteriaRow, SlopeThreshold, Surface } from '@/lib/domain/types';
import { Button } from '@/components/ui/button';
import { FormField, checkClass } from '@/components/ui/form';
```

렌더(옛: `const label = …`부터 파일 끝까지 → 새):
```tsx
  const label = `${ANALYSIS_KIND_LABEL[kind]} 분석`;
  return (
    <div className="flex flex-col items-end gap-1">
      {/* N1: 구배 기준 선택 - upload-form.tsx의 "적용 기준" 라디오 목록과 같은 패턴.
          thresholds[0].use(옥상 슬래브(노출방수) / 욕실·화장실 바닥 / 주차장 바닥 /
          실내 평바닥 등, 007_slope_analysis.sql:118-133)를 보여준다.
          순서는 fn_resolve_criteria 반환 순서 그대로다 - 재정렬하지 않는다. */}
      {kind === 'slope' && slopeCriteria.length > 0 && (
        <FormField label="적용 기준">
          <div className="flex flex-col gap-2">
            {slopeCriteria.map((c) => {
              // CriteriaRow.thresholds는 컴파일 타임에는 평활도 Threshold[]지만
              // kind='slope' 행의 실제 jsonb 내용은 SlopeThreshold다(런타임
              // 형태가 다르다 - slope-result.tsx의 stats 캐스팅과 같은 사정).
              const t = c.thresholds?.[0] as unknown as SlopeThreshold | undefined;
              const aware = isDirectionAwareCriteria(t ?? null);
              return (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={`slope-criteria-${scanId}`} checked={slopeCriteriaId === c.id}
                    onChange={() => setSlopeCriteriaId(c.id)} disabled={busy || inProgress}
                    className={checkClass} />
                  <span className="inline-flex flex-wrap items-baseline gap-1.5">
                    <span>{t?.use ?? c.name}</span>
                    {c.is_default && <span className="text-cs-text-secondary">(기본)</span>}
                    {!aware && <span className="text-cs-disabled">- 방향 판정 안 함</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </FormField>
      )}
      {kind === 'slope' && criteriaLoadError && (
        <p className="max-w-xs text-xs leading-4 text-cs-error">{criteriaLoadError}</p>
      )}
      <Button variant="normal" onClick={onClick}
        disabled={busy || inProgress || (kind === 'slope' && !slopeCriteriaId)}
        title={inProgress ? '이미 진행 중인 분석이 끝난 뒤 다시 시도하세요.' : undefined}>
        {busy ? '요청 중...' : label}
      </Button>
      {inProgress && (
        <p className="text-xs leading-4 text-cs-text-secondary">진행 중인 분석이 끝난 뒤 다시 시도하세요.</p>
      )}
      {error && <p className="text-xs leading-4 text-cs-error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 8: unit-confirm-form.tsx 렌더 교체** — 훅·onSubmit·failAndRevert·가드(`if (!scan.height_view_path) return form;`)·주석은 그대로. import 4줄 추가 + `const form =` 블록 + 2열 return 블록 교체.

import(옛 → 새):
```tsx
import type { ScanRow } from '@/lib/domain/types';
import { UNIT_OPTIONS } from '@/lib/upload/validate';

export function UnitConfirmForm({ scan, userId }: { scan: ScanRow; userId: string }) {
```
→
```tsx
import type { ScanRow } from '@/lib/domain/types';
import { UNIT_OPTIONS } from '@/lib/upload/validate';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField, checkClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

export function UnitConfirmForm({ scan, userId }: { scan: ScanRow; userId: string }) {
```

`const form = (` 블록(옛 98~121행 → 새):
```tsx
  const form = (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* 아트보드(ScanUnitConfirm) 우열: info Alert(파일명 mono 700 + 12px 설명) → 라디오 → primary. */}
      <Alert type="info" title={<span className="font-mono">{scan.original_filename ?? '(파일명 없음)'}</span>}>
        <p className="text-xs leading-4 text-cs-text-secondary">
          파일 좌표의 길이 단위를 확정해야 분석을 시작할 수 있습니다. 단위가 틀리면
          결과 전체가 왜곡되므로 스캔 앱의 내보내기 설정을 확인하세요.
        </p>
      </Alert>
      <FormField label="파일 좌표 단위">
        <div className="flex flex-col gap-2">
          {UNIT_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="unit-scale" className={checkClass}
                checked={unitScale === o.value} onChange={() => setUnitScale(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      </FormField>
      {error && <p className="text-sm text-cs-error">{error}</p>}
      <div className="flex">
        <Button type="submit" variant="primary" disabled={busy}>
          <Icon name="check-circle" />
          단위 확정 후 분석 시작
        </Button>
      </div>
    </form>
  );
```

2열 return 블록(옛 141~189행: `return (` ~ `);` → 새). 그리드 클래스는 아트보드의 `minmax(0, 3fr) minmax(0, 2fr)`과 같고 기존 테스트가 이 문자열을 고정하므로 그대로 둔다(`3fr 2fr`만 쓰면 이미지의 min-content 폭이 열을 밀어낸다):
```tsx
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <section className="flex flex-col gap-2">
        {/* 리뷰 6: PNG 안에 matplotlib가 같은 제목("높이 뷰 (평면도)")을 이미 구워
            넣는다. 눈에 보이는 h2를 그대로 두면 한 화면에 제목이 두 번 뜬다. 제목
            자체를 지우는 대신 sr-only로 돌린 이유는 접근성이다: 스크린리더는 PNG
            안의 글자를 읽지 못하므로, 제목을 지우면 이 영역이 heading 없는 익명
            블록이 되어 건너뛰기 탐색에서 사라진다. 보이는 라벨 역할은 아래
            "원본 크기로 열기" 링크와 설명 문단이 대신한다. */}
        <h2 className="sr-only">높이 뷰 (평면도)</h2>
        {viewFailed ? (
          <Alert type="warning">
            높이 뷰를 불러오지 못했습니다. 그림 없이도 단위는 확정할 수 있습니다.
            파일명과 스캔 앱의 내보내기 설정을 확인해 단위를 고르세요.
          </Alert>
        ) : (
          <>
            {/* 리뷰 3: 좁은 화면에서 그림은 원본의 22.6%까지 줄어 축 눈금 숫자가
                뭉개진다(실측). 축 눈금을 읽는 것이 이 화면의 전부이므로 원본을 새 탭
                으로 여는 길이 반드시 있어야 한다 - "데스크톱 전용"으로 선언하는 대신
                모든 뷰포트에서 통하는 링크 하나로 푼다. 그림과 라벨을 한 링크로 묶어
                (그림 클릭 = 라벨 클릭) 링크가 둘로 갈라지지 않게 했다. */}
            <a href={dataUrl(scan.height_view_path)} target="_blank" rel="noopener noreferrer"
              className="group block">
              {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
                  (components/analysis/slope-result.tsx와 같은 판단) */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imgRef} src={dataUrl(scan.height_view_path)}
                alt="높이 뷰: 위에서 내려다본 점군의 상대 높이"
                onError={() => setViewFailed(true)}
                className="w-full rounded-lg border border-cs-divider bg-white" />
              <span className="mt-2 flex items-center justify-end gap-1 text-xs font-bold leading-4 text-cs-link group-hover:text-cs-link-hover group-hover:underline">
                원본 크기로 열기 (새 탭)
                <Icon name="external" size={14} />
              </span>
            </a>
            <p className="text-xs leading-4 text-cs-text-secondary">
              위에서 내려다본 점군의 상대 높이입니다. 축 눈금은 미터가 아니라
              <span className="font-bold text-cs-text"> 파일 단위</span>이므로, 눈금이 가리키는
              크기와 실제 공간 크기를 견주어 단위를 고르세요. 예를 들어 8m짜리 방인데
              눈금이 8000까지 간다면 mm입니다. 점이 성겨 색이 거의 없거나 &quot;유효
              데이터 없음&quot; 경고가 찍힌 그림이어도 축 눈금은 유효하니 눈금만 보고
              판단하면 됩니다.
            </p>
          </>
        )}
      </section>
      {form}
    </div>
  );
}
```

- [ ] **Step 9: page.tsx — import·상수·JSX 교체** (Step 2가 뽑은 영역은 건드리지 않는다)

import(옛 → 새):
```tsx
import { UnitConfirmForm } from '@/components/unit-confirm-form';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import {
  ANALYSIS_KIND_LABEL, ANALYSIS_STATUS_LABEL, GRADE_LABEL, LINEAGE_LABEL,
  SCAN_STATUS_LABEL, SURFACE_LABEL,
} from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { isExternalImport, isSlopeStats } from '@/lib/domain/stats';
import type { AnalysisRow, LocationRow, PhotoRow, ScanRow, SiteRow } from '@/lib/domain/types';
```
→
```tsx
import { UnitConfirmForm } from '@/components/unit-confirm-form';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { KeyValuePairs } from '@/components/ui/key-value';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { StatusIndicator, type StatusType } from '@/components/ui/status-indicator';
import {
  ANALYSIS_KIND_LABEL, ANALYSIS_STATUS_LABEL, GRADE_LABEL, LINEAGE_LABEL,
  SCAN_STATUS_LABEL, SURFACE_LABEL,
} from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { isExternalImport, isSlopeStats } from '@/lib/domain/stats';
import type { AnalysisRow, LocationRow, PhotoRow, ScanRow, ScanStatus, SiteRow } from '@/lib/domain/types';

// 스캔 상태 → StatusIndicator 타입(표시 매핑, 스캔 정보의 '상태' 칸). 종결(ready)=success,
// 실패=error, 사전 검사 대기(uploaded)=in-progress(워커가 곧 처리), 사용자 입력 대기·
// 보관=pending. 아트보드: UnitConfirm '단위 확인 대기' minus-circle, Done '분석 준비됨' check.
const SCAN_STATUS_TYPE: Record<ScanStatus, StatusType> = {
  uploaded: 'in-progress', awaiting_unit_confirm: 'pending', ready: 'success',
  archived: 'pending', failed: 'error',
};
```
(이 상수는 `WATCHED_SCAN_STATUSES` **위**에 둔다 — Step 2의 sed 범위 밖이어야 가드 diff가 비어 있다.)

JSX(옛: `  return (`부터 파일 끝 `}`까지, 현재 230~481행 전체 → 새). JSX 주석은 옛 것을 그대로 옮긴다:
```tsx
  return (
    <main className={PAGE_MAIN}>
      <PageHeader
        crumbs={crumbs}
        title={<>스캔 · {SURFACE_LABEL[s.surface]} · <span className="font-mono text-[22px]">{s.scanned_at}</span></>}
        actions={hasDoneAnalysis ? (
          // 뷰당 primary 1개(Global Constraints·스펙 §4): 이 화면의 primary는 이 보고서 원클릭뿐이다.
          // 결과 패널(T7 VerdictPanel)의 '저장'은 normal - 아트보드·스펙 §6은 둘 다 채움으로 그리지만
          // §4 규칙을 따른다.
          <LinkButton href={`/reports/new?location=${s.location_id}`} variant="primary">
            이 위치의 보고서 생성
          </LinkButton>
        ) : undefined}
      />
      <ScanStepStrip status={s.status} hasDoneAnalysis={hasDoneAnalysis} />
      {/* 스펙 §7-8: '스캔 정보' 제목은 아트보드의 컨테이너 크롬 - 항목은 옛 dl과 같은 7개다. */}
      <Container title="스캔 정보">
        <KeyValuePairs columns={4} items={[
          { label: '측정위치', value: locLabel },
          { label: '원본 파일', value: <span className="font-mono text-[13px]">{s.original_filename ?? '-'}</span> },
          { label: '장비', value: s.device ?? '-' },
          { label: '데이터 계보', value: LINEAGE_LABEL[s.lineage] },
          // point_count는 001_schema.sql에 선언만 되고 비어 있다가 단계 E의
          // precheck 잡부터 채워진다(worker/flatworker/jobs.py). 그 전에 올라온
          // 스캔은 계속 null이므로 '-'로 둔다. 단위 확정의 근거는 아니다
          // (점 개수는 파일 단위가 m이든 mm이든 같다) - 스캔 규모를 가늠하는
          // 메타데이터로만 쓴다.
          {
            label: '점 개수',
            value: (
              <span className="font-mono text-[13px] tabular-nums">
                {s.point_count === null ? '-' : s.point_count.toLocaleString('ko-KR')}
              </span>
            ),
          },
          {
            label: '상태',
            value: <StatusIndicator type={SCAN_STATUS_TYPE[s.status]}>{SCAN_STATUS_LABEL[s.status]}</StatusIndicator>,
          },
          { label: '단위 배율', value: <span className="font-mono text-[13px] tabular-nums">{s.unit_scale ?? '미확정'}</span> },
        ]} />
      </Container>
      {s.lineage === 'registered' && (
        <Alert type="warning" title="두 스캔을 정합해 만든 병합 스캔입니다.">
          <p>
            분석하기 전에 정합이 실제로 맞았는지 확인하세요. 정합 RMSE는 수직 방향만
            보증하므로, 두 스캔이 수평으로 어긋나 있어도 수치는 정상으로 나옵니다.
            정합 화면의 겹쳐보기가 그 방향을 확인하는 유일한 수단입니다.
          </p>
          {registrationId ? (
            <LinkButton href={`/registrations/${registrationId}`} variant="normal" className="mt-3">
              정합 결과·겹쳐보기 확인
            </LinkButton>
          ) : (
            <p className="mt-1 text-cs-text-secondary">
              이 스캔을 만든 정합 이력을 찾지 못했습니다(이력이 삭제됐거나 아직 반영되지
              않았습니다). 겹쳐보기를 볼 수 없으므로 이 스캔의 분석 결과를 판단 근거로
              쓸 때 주의하세요.
            </p>
          )}
        </Alert>
      )}
      {WATCHED_SCAN_STATUSES.has(s.status) && (
        <ScanStatusWatcher scanId={id} initialStatus={s.status} />
      )}
      {s.status === 'awaiting_unit_confirm' && user && (
        // D5: 별도 confirm-unit 화면으로 링크하는 대신 그 화면이 렌더하던 것(높이 뷰
        // 이미지 + 단위 확정 폼 - 둘 다 UnitConfirmForm 안에 있다)을 여기 섹션으로
        // 렌더한다. 안내 문구는 app/scans/[id]/confirm-unit/page.tsx에서 그대로 옮겼다.
        <Container title="단위 확인">
          <div className="flex flex-col gap-4">
            <p className="text-cs-text-secondary">
              파일 좌표가 m·cm·mm 중 무엇인지 확정하는 단계입니다. 높이 뷰가 있으면 그
              축 눈금과 실제 공간 크기를 견주어 고르고, 없으면 파일명과 스캔 앱의 내보내기
              설정으로 판단하세요.
            </p>
            <UnitConfirmForm scan={s} userId={user.id} />
          </div>
        </Container>
      )}
      {s.status === 'uploaded' && (
        // E1: 옛 문구는 "워커가 실행 중인지 확인하세요(python -m flatworker)"였다.
        // 운영자 지시문이지 사용자 안내가 아니다 - 대시보드만 쓰는 사용자는 워커를
        // 실행할 수도 확인할 수도 없어서, 정상적인 대기를 장애로 오인한다. 단계 E부터
        // precheck가 높이 뷰까지 렌더하므로 대기 시간 자체도 눈에 띄게 길어졌다.
        <Alert type="info">
          사전 검사 대기 중입니다. 파일 크기에 따라 수십 초 걸릴 수 있습니다.
          이 화면을 새로고침하면 상태가 갱신됩니다.
        </Alert>
      )}
      {s.status === 'failed' && (
        <Alert type="error" title="사전 검사에 실패했습니다.">
          <p>
            가장 흔한 원인은 지원하지 않는 파일 포맷이나 손상·불완전한 파일입니다.
            파일을 확인한 뒤 업로드 화면에서 새 스캔으로 다시 시도하세요. 상세 원인은
            워커 실행 창의 로그에 남습니다(3회 자동 재시도 후에도 실패한 상태입니다).
          </p>
          {/* D5: 재시도를 한 클릭으로 - 업로드 화면이 현장·측정위치를 쿼리로 프리필한다(D4). */}
          <LinkButton
            href={loc ? `/upload?site=${loc.site_id}&location=${s.location_id}` : '/upload'}
            variant="normal" className="mt-3">
            다시 업로드
          </LinkButton>
        </Alert>
      )}
      {showFirstFlatness && (
        <Container
          title={`${ANALYSIS_KIND_LABEL.flatness} 분석`}
          actions={user ? (
            // latestStatus를 넘기지 않는다 - 이 종류의 분석이 한 번도 없었다는 뜻이므로
            // ReanalyzeButton은 이를 "진행 중 아님"으로 보고 버튼을 활성 상태로 둔다
            // (구배 첫 분석과 같은 취급). criteriaId는 스캔에 현재 적용된 기준이다;
            // 병합 스캔은 이 값을 원본 A에서 물려받는다(worker의 _merged_scan_fields).
            //
            // isImport={false}는 가정이 아니라 provenNotImport가 증명한 값이다 - 이
            // 섹션은 임포트가 아님이 증명된 스캔에서만 그려진다(위 주석). 이 게이트를
            // 지우면 Colab CSV에 'analyze' 잡이 걸린다.
            <ReanalyzeButton scanId={id} userId={user.id} surface={s.surface} kind="flatness"
              criteriaId={s.selected_criteria_id ?? undefined}
              isImport={false} />
          ) : undefined}>
          <p className="text-cs-text-secondary">
            {s.lineage === 'registered'
              ? '병합 점군은 이미 미터로 환산돼 있어 단위 확인 없이 바로 분석할 수 있습니다. 다만 정합이 실제로 맞았는지는 위 겹쳐보기로 먼저 확인하세요 - 분석은 어긋난 정합도 그대로 받아 수치를 냅니다.'
              : '단위가 확정된 스캔인데 아직 분석이 없습니다. 위 버튼으로 첫 분석을 시작하세요.'}
          </p>
        </Container>
      )}
      {latestFlatness && (
        <Container
          title={`${ANALYSIS_KIND_LABEL.flatness} 분석`}
          actions={user ? (
            // 코드리뷰 Critical(C1): latestFlatness.engine_version/meta로 임포트 결과
            // 여부를 판별해 재분석 잡 타입 분기 근거로 전달한다(isExternalImport, 정의는
            // lib/domain/stats.ts - 배지 표시와 동일 기준 재사용).
            //
            // 코드리뷰 Minor(M3): 판정 기준은 스캔에 현재 적용된
            // scan.selected_criteria_id를 우선한다. latestFlatness.criteria_id(직전
            // 분석이 만들어질 때 스냅샷된 기준)로만 쓰면 사용자가 이후에 스캔의
            // 적용 기준을 바꿔도 재분석이 옛 기준을 그대로 따라가 버려, 버튼이
            // 내건 "판정 기준 변경 후 다시 돌리기" 취지와 어긋난다.
            // selected_criteria_id가 비어 있는 드문 레거시 데이터에서만
            // latestFlatness.criteria_id로 폴백한다.
            <ReanalyzeButton scanId={id} userId={user.id} surface={s.surface} kind="flatness"
              criteriaId={s.selected_criteria_id ?? latestFlatness.criteria_id}
              latestStatus={latestFlatness.status}
              isImport={isImport} />
          ) : undefined}>
          <div className="flex flex-col gap-3">
            <AnalysisProgress analysisId={latestFlatness.id} initialStatus={latestFlatness.status} scanId={id} />
            {flatnessAnalyses.length > 1 && (
              <ul className="flex flex-col gap-2 text-cs-text-secondary">
                {flatnessAnalyses.slice(1).map((a) => (
                  <li key={a.id}>
                    {/* D5: 별도 화면 대신 같은 작업대의 ?analysis= 선택 렌더로 간다. */}
                    <Link href={`/scans/${id}?analysis=${a.id}`}
                      className="inline-flex items-center gap-2 text-cs-link hover:text-cs-link-hover hover:underline">
                      이전 분석 <span className="font-mono text-[13px]">{a.created_at.slice(0, 16).replace('T', ' ')}</span>
                      {a.overall_verdict && (
                        <Badge tone={GRADE_TONE[a.overall_verdict]}>{GRADE_LABEL[a.overall_verdict]}</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Container>
      )}
      {showSlopeSection && (
        // 본문은 latestSlope가 있을 때만 있다(옛 코드와 같다). 없으면 빈 20px 본문이 남지 않게
        // padding도 끈다 - 소스에 없는 안내 문구를 채우지 않는다(스펙 §7-8).
        <Container
          title={`${ANALYSIS_KIND_LABEL.slope} 분석`}
          padded={!!latestSlope}
          actions={user && showSlopeButton ? (
            // 구배는 항상 클릭 시점에 fn_resolve_criteria(site, 'floor', 'slope')로
            // 기준을 새로 해석하므로 criteriaId를 넘기지 않는다(컨트롤러 보강 확정 1).
            // showSlopeButton이 이미 !isImportUnknownOrTrue로 걸렀으므로 이 버튼은
            // 항상 'analyze' 잡만 건다. 재리뷰 수정: 섹션 자체는 showSlopeSection이
            // 따로 관리하므로(latestSlope 존재만으로도 그려진다) 버튼만 이 조건으로
            // 별도 게이트한다 - 이미 있는 구배 결과를 숨기지 않으면서도 새 구배
            // 분석은 임포트 여부가 확실할 때만 시작하게 한다.
            <ReanalyzeButton scanId={id} userId={user.id} surface="floor" kind="slope"
              siteId={loc?.site_id}
              latestStatus={latestSlope?.status}
              isImport={false} />
          ) : undefined}>
          {latestSlope && (
            <div className="flex flex-col gap-3">
              <AnalysisProgress analysisId={latestSlope.id} initialStatus={latestSlope.status} scanId={id} />
              {slopeAnalyses.length > 1 && (
                <ul className="flex flex-col gap-2 text-cs-text-secondary">
                  {slopeAnalyses.slice(1).map((a) => (
                    <li key={a.id}>
                      {/* D5: 별도 화면 대신 같은 작업대의 ?analysis= 선택 렌더로 간다. */}
                      <Link href={`/scans/${id}?analysis=${a.id}`}
                        className="inline-flex items-center gap-2 text-cs-link hover:text-cs-link-hover hover:underline">
                        이전 분석 <span className="font-mono text-[13px]">{a.created_at.slice(0, 16).replace('T', ' ')}</span>
                        {a.overall_verdict && (
                          <Badge tone={GRADE_TONE[a.overall_verdict]}>{GRADE_LABEL[a.overall_verdict]}</Badge>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Container>
      )}
      {resultAnalysis && (
        // D5: app/analyses/[id]/page.tsx가 하던 결과 렌더를 이 화면으로 옮겼다.
        // 헤더 제목 옆 보조 텍스트(일시 · 엔진)는 아트보드(ScanDone '평활도 결과')를 따른다.
        // 본문(탭·히트맵·판정 패널)은 T7이 components/analysis/*에서 재스킨한다.
        <Container title={
          <>
            {ANALYSIS_KIND_LABEL[resultAnalysis.kind ?? 'flatness']} 결과
            <span className="ml-3 font-mono text-xs font-normal text-cs-text-secondary">
              {resultAnalysis.created_at.slice(0, 16).replace('T', ' ')}
              {' · '}엔진 {resultAnalysis.engine_version ?? '-'}
            </span>
          </>
        }>
          {isSlopeStats(resultAnalysis.stats) ? (
            // 단계 C 회귀 차단(analyses/[id]에서 이관): ?analysis=는 이 스캔의 analyses
            // 목록에서 id로만 고르므로 어떤 쿼리 필터로도 종류를 못 거른다. stats.format
            // 내용 기반으로 갈라 AnalysisResult로 흘려보내면 lib/domain/stats.ts의
            // coverageLabel이 stats.meta를 옵셔널 체이닝 없이 읽어 TypeError로 페이지가
            // 죽는다 - 구배 결과(단계 D)는 SlopeResult로.
            <SlopeResult analysis={resultAnalysis} />
          ) : (
            <AnalysisResult analysis={resultAnalysis} scan={s} photos={photos} />
          )}
        </Container>
      )}
      {staleSelectedAnalysis && (
        // 리뷰 Important(F1): app/analyses/[id]/page.tsx 원본이 항상 보여주던
        // "아직 완료되지 않았습니다" 안내를 그대로 복원한다. 링크는 ?analysis= 없는
        // 기본 뷰(최신 완료 분석 또는 AnalysisProgress)로 되돌아간다.
        //
        // 후속 리뷰(M4 문구 분기): status==='done'인데 stats가 없는(레거시) 케이스는
        // "아직 완료되지 않았습니다 (상태: 완료)"가 자기모순이라 별도 문구로 갈랐다.
        // resultAnalysis는 selectedAnalysis 단독으로(latest 여부와 무관하게) done && stats를
        // 요구하므로, staleSelectedAnalysis.status==='done'이면 항상 stats가 없는 경우다
        // (stats가 있었다면 resultAnalysis가 채워져 이 분기 자체에 들어오지 못한다) -
        // 그래서 상태만으로 분기해도 안전하다. 미완료(대기/처리/실패) 문구는 그대로 둔다.
        <Alert type="info">
          {staleSelectedAnalysis.status === 'done'
            ? '분석은 완료됐지만 결과 데이터(stats)가 없습니다. 오래된 형식의 분석일 수 있으니 재분석을 권장합니다.'
            : `이 분석은 아직 완료되지 않았습니다 (상태: ${ANALYSIS_STATUS_LABEL[staleSelectedAnalysis.status]}).`}{' '}
          <Link href={`/scans/${id}`}
            className="font-bold text-cs-link hover:text-cs-link-hover hover:underline">스캔 상세에서 진행 상태 보기</Link>
        </Alert>
      )}
    </main>
  );
}
```

- [ ] **Step 10: 가드 diff 확인(필수)** — 비어 있어야 한다. 한 줄이라도 나오면 Step 9에서 JSX 밖을 건드린 것이다: 되돌리고 다시 한다.

```bash
cd dashboard
sed -n '/^const WATCHED_SCAN_STATUSES/,/^  return ($/p' 'app/scans/[id]/page.tsx' > /tmp/guards-after.txt
diff /tmp/guards-before.txt /tmp/guards-after.txt && echo "GUARDS UNCHANGED"
# 잔재 스윕(이 태스크 담당 파일에서 구 팔레트 0건)
grep -n -E 'zinc-|amber-|red-|green-|emerald-|purple-|blue-' 'app/scans/[id]/page.tsx' components/scan-step-strip.tsx components/unit-confirm-form.tsx components/analysis-progress.tsx components/reanalyze-button.tsx ; echo "exit=$? (1이어야 한다: 0건)"
```

- [ ] **Step 11: 통과 확인** — `cd dashboard && npx vitest run` → 전체 PASS(Step 3에서 실패하던 `app/scans`·`scan-step-strip`·`unit-confirm-form`·`analysis-progress`·`reanalyze-button`의 새 단언이 전부 초록이고, 손대지 않은 `analyze-buttons`·`scan-status-watcher`와 나머지 70개 파일도 그대로 초록). `npx tsc --noEmit -p .` → 0 에러. 그다음 `npm run dev`로 `/scans/<id>`를 awaiting_unit_confirm·processing·done 스캔 하나씩 열어 `docs/design/cloudscape/ScanUnitConfirm.dc.html`·`ScanProcessing.dc.html`·`ScanDone.dc.html`과 나란히 캡처 대조(사용자 상시 지시). 확인 포인트: 스텝 스트립 연결선 40px·현재 단계 파랑 700, 스캔 정보 4열 구분선, 단위 확인 3:2 그리드, 헤더 액션 primary 1개(화면 전체에서도 이것 하나 — 결과 패널 '저장'은 T7이 normal로 그리므로 여기서는 채움 파랑 버튼이 헤더 밖에 없어야 한다), 콘솔 오류 0. `ScanDone`의 결과 본문(탭·히트맵·판정 패널)은 아직 옛 모습이다 — T7 몫이므로 여기서는 헤더의 `일시 · 엔진` 보조 텍스트까지만 대조한다.

- [ ] **Step 12: 커밋**

```bash
git add "dashboard/app/scans/[id]/page.tsx" "dashboard/app/scans/[id]/__tests__/page.test.tsx" \
  dashboard/components/scan-step-strip.tsx dashboard/components/unit-confirm-form.tsx \
  dashboard/components/analysis-progress.tsx dashboard/components/reanalyze-button.tsx \
  dashboard/components/__tests__/scan-step-strip.test.tsx dashboard/components/__tests__/unit-confirm-form.test.tsx \
  dashboard/components/__tests__/analysis-progress.test.tsx dashboard/components/__tests__/reanalyze-button.test.tsx
git commit -m "feat(dashboard): 스캔 작업대 Cloudscape 골격(3상태) - 스텝 스트립·스캔 정보·단위 확인·분석 컨테이너 재스킨

가드(provenNotImport·isImportUnknownOrTrue·showFirstFlatness·showSlopeButton/Section)와 주석은
문장 그대로 보존(sed 스냅샷 diff 0줄). 결과 본문 재스킨은 T7.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

---

### Task 7: 분석 결과 컴포넌트(평활도·구배)

**Files:**
- Modify: `dashboard/components/analysis/analysis-result.tsx`, `verdict-panel.tsx`, `result-table.tsx`, `heatmap-view.tsx`, `deviation-view.tsx`, `slope-result.tsx`, `slope-verdict-panel.tsx`, `slope-result-table.tsx`, `slope-heatmap-view.tsx`
- Modify: `dashboard/lib/domain/grade-tone.ts` — `SLOPE_GRADE_TONE` 추가(구배 5등급 → Badge/StatusIndicator 톤)
- 무변경(참고만): `dashboard/app/scans/[id]/page.tsx`(T6가 `<Container title="… 결과">`로 감싼다 — 이 태스크의 컴포넌트는 **컨테이너를 그리지 않는다**), `dashboard/components/photo-gallery.tsx`·`refresh-on-upload.tsx`(T4, props 동일), `dashboard/lib/domain/labels.ts`(`GRADE_COLOR` hex 그대로), `dashboard/lib/domain/slope-heatmap.ts`(`SLOPE_GRADE_COLOR` hex 그대로 — 캔버스·범례 전용)
- Test(갱신): `dashboard/components/analysis/__tests__/analysis-result.test.tsx`, `verdict-panel.test.tsx`, `result-table.test.tsx`, `heatmap-view.test.tsx`, `deviation-view.test.tsx`, `slope-result.test.tsx`, `slope-verdict-panel.test.tsx`, `slope-result-table.test.tsx`, `slope-heatmap-view.test.tsx`, `dashboard/lib/domain/__tests__/grade-tone.test.ts`

**Interfaces:**
- Consumes(T1·T2):
  - `<TabBar tabs={{id,label}[]} active onChange />`(`components/ui/tab-bar`, client; `role="tab"` + `aria-selected`) — 결과 탭 4종과 벽면 히트맵의 벽 선택에 쓴다. `id`는 string이어야 하므로 `wall_id`(number)는 `String()`/`Number()`로 오간다.
  - `<StatusIndicator type>`, `TONE_STATUS`(`components/ui/status-indicator`, `data-status={type}`) — 판정 헤드라인·수직도 판정·구배 등급·재판정 진행 배너.
  - `<KeyValuePairs items columns={2} />`(`components/ui/key-value`) — 평활도 수치 6종, 구배 편차 통계 3종.
  - `<Alert type title? className?>`(`components/ui/alert`, `data-alert={type}`, error는 `role="alert"`) — 경고 목록(warning), 재판정 불가·방향 비대상 안내(info), 클릭 오류·재판정 실패(error), 재fetch 실패·셀 누락 배너(warning).
  - `<Badge tone>`(`components/ui/badge`, T2 재작성판) — `external`(외부 결과), `neutral`(구배 종류 배지), `fail`(역구배), `warn`(방향 편차), `GRADE_TONE[...]`(셀 클릭 상세의 판정).
  - `<Button>`(normal, `components/ui/button`) — 종합의견 `저장`. 이 뷰(ScanDone)의 유일한 primary는 페이지 헤더의 `이 위치의 보고서 생성`(T6 `page.tsx` actions)이므로 저장은 normal이다(Global Constraints·스펙 §4 '뷰당 primary 1개'). 이 태스크의 컴포넌트 트리에는 primary가 없다.
  - `textareaClass`(`components/ui/form`) — 종합의견 textarea.
  - `tableClass = {table, thead, th, thNum, td, tdNum, row, link}`(`components/ui/data-table`) — 구간별 결과표·셀별 결과표.
  - 소스에 이미 있는 것: `GRADE_COLOR`·`GRADE_LABEL`·`ZONE_STATUS_LABEL`·`ANALYSIS_KIND_LABEL`·`fmtMm`·`warningLabel`(`lib/domain/labels`), `GRADE_TONE`(`lib/domain/grade-tone`), `coverageLabel`·`isExternalImport`(`lib/domain/stats`), `SLOPE_GRADE_COLOR`·`drawSlopeHeatmap`(`lib/domain/slope-heatmap`), `computeZoneStats`, `correctionDirectionLabel`, `artifactUrl`·`dataUrl`, `PhotoGallery`, `RefreshOnUpload`.
  - **컨테이너 계약(T6)**: `app/scans/[id]/page.tsx`가 `<Container title="평활도 결과|구배 결과" …>`(헤더에 일시·엔진, 본문 `p-5`)로 감싸고 그 안에 `<AnalysisResult …/>` 또는 `<SlopeResult …/>`를 넣는다. 두 컴포넌트의 루트는 `flex flex-col gap-5`(아트보드 본문 gap 20px)이며 자체 제목·그림자·라운드를 만들지 않는다. props는 그대로(`AnalysisResult {analysis, scan, photos}`, `SlopeResult {analysis}`).
- Produces:
  - `SLOPE_GRADE_TONE: Record<SlopeGrade, 'pass'|'warn'|'fail'|'unknown'>`(`lib/domain/grade-tone.ts`) — `{ 적합: 'pass', 경계: 'warn', 보수: 'fail', 재시공: 'fail', 판정불가: 'unknown' }`. 구배 등급을 화면 배지·StatusIndicator 톤으로 접는 유일한 표(`GRADE_TONE`과 같은 3버킷 규칙). 이후 태스크(T8 보고서 포함 분석 목록 등)가 구배 등급을 시스템 색으로 그릴 때 이 표를 쓴다.
  - 컴포넌트의 공개 props는 전부 무변경.

- [ ] **Step 1: 아트보드 확인** — `docs/design/cloudscape/ScanDone.dc.html`을 Read(또는 브라우저)로 열어 **'평활도 결과' 컨테이너의 본문**(215~402행)만 이 태스크로 옮긴다. 헤더(제목 + `2026-09-03 11:32 · 엔진 p4-0.5.0`)는 T6의 `Container`가 그린다. 옮길 섹션(위→아래):
  1. 본문 = `flex-col gap 20px` → ① 3:2 그리드(`grid-template-columns: minmax(0,3fr) minmax(0,2fr); gap 20px; align-items start`) ② 그 아래 `구간별 결과표`(16px/20px 700 제목 + 1px `cs-divider` radius 8px 테두리 안의 테이블: 헤더 40px 700, 행 44px, 셀 padding 0 20px, 수치 열 우측 tabular).
  2. 그리드 좌(`flex-col gap 16px`): 탭 줄(히트맵 / 정밀 편차맵 / 3D 프리뷰 / 현장 사진 — 활성 = 하단 4px `cs-link`, 비활성 `cs-nav-text` 700 = `TabBar`) → 캔버스(`border 1px cs-divider; radius 8px`) → 범례(12px/16px, 12px 사각 스와치 `radius 2px`, gap 4px 12px). 스와치 색은 아트보드가 아니라 **`GRADE_COLOR` hex 5색**(스펙 §3 예외·§7-4 — 캔버스·PDF와 같은 색이어야 한다). 아트보드의 `산출물 PNG 자리` 캡션은 소스에 없으므로 옮기지 않는다.
  3. 그리드 우 = 판정 패널(`padding 20px; border 1px cs-divider; radius 16px; gap 16px`): 판정 헤드라인(아이콘 + 18px/22px 700 등급 라벨 — 아이콘은 태스크 결정대로 `StatusIndicator` 기본 16px) → 수치 2열(라벨 700 / 값 tabular, 최대 편차만 700) → `축소 스팬 적용 셀 n개 (허용치 선형 환산)` 12px 보조색 → `등급 분포`(라벨 700 + 8px 바 radius 4px 트랙 `cs-divider` + 12px 보조색 tabular 캡션) → `적용 기준`(라벨 700 + 코드 + 출처·임계 12px 보조색) → `경고`(라벨 700 + warning Alert, 본문 12px/16px) → `종합의견`(라벨 700 + 자동 의견 박스 `padding 12px; border 1px cs-divider; radius 8px; 12px/16px cs-nav-text` + `종합의견(사용자 수정)` 라벨 700 + textarea `min-height 96px` + `저장` 버튼 — 아트보드·스펙 §6 표는 primary로 그리지만 같은 뷰의 헤더에 primary `이 위치의 보고서 생성`(T6)이 이미 있으므로 스펙 §4·Global Constraints '뷰당 primary 1개'에 따라 **normal**로 내린다).
  4. 소스에 있으나 아트보드에 없는 것은 **그대로 유지**한다: `외부 결과` 배지(`<Badge tone="external">`), `판정 없음` 헤드라인(overall_verdict null), 셀 클릭 상세 `<dl>`, 벽면 히트맵의 벽 선택, 3D 프리뷰 안내문, 편차맵 안내문 3종, 저장 결과 문구. 구배 화면(`slope-*`)은 아트보드가 없다 — 같은 어휘(StatusIndicator·KeyValuePairs·Alert·tableClass·Badge)로 평활도 패널과 동일한 해부를 쓴다.
  5. 이 태스크는 새 Next.js API를 쓰지 않는다(`useRouter`·`Link` 그대로) — `node_modules/next/dist/docs/` 추가 확인 불필요.

  **소스 대비 바뀌는 것은 JSX 구조와 클래스뿐**: 상태·이펙트·fetch·저장·클릭 핸들러·가드(`canRejudge`·`judgeBusy`·`directionAware`·`isExternalImport`)·문구는 한 글자도 바꾸지 않는다. 결과표 제목은 소스 문구 `구간별 결과표`·`셀별 결과표` 그대로(h2 → h3: 컨테이너 제목이 h2가 된다).

- [ ] **Step 2: 실패하는 테스트 작성/갱신**

`lib/domain/__tests__/grade-tone.test.ts` — 전체 교체(기존 `it` 유지 + `SLOPE_GRADE_TONE`).

```ts
import { describe, expect, it } from 'vitest';
import { GRADE_TONE, SLOPE_GRADE_TONE } from '../grade-tone';

// D8 브리프 Step 1: GRADE_COLOR <-> Badge tone 매핑표. app/page.tsx의 toBarCounts와
// 같은 3버킷 규칙(경계=warn, 보수·재시공=fail) 위에 na=unknown을 얹었다(D3에서 확립).
describe('GRADE_TONE (D8: GRADE_COLOR <-> Badge tone 매핑)', () => {
  it('5등급을 4개 Badge tone으로 접는다', () => {
    expect(GRADE_TONE).toEqual({
      pass: 'pass', borderline: 'warn', repair: 'fail', rework: 'fail', na: 'unknown',
    });
  });
});

// T7(Cloudscape): 구배 5등급(한글 문자열)도 같은 3버킷 규칙으로 접는다. SLOPE_GRADE_COLOR(hex)는
// 캔버스·범례 전용이고 화면 배지·StatusIndicator는 이 표로 시스템 색을 얻는다(스펙 §7-4).
describe('SLOPE_GRADE_TONE (T7: 구배 등급 -> tone)', () => {
  it('구배 5등급을 GRADE_TONE과 같은 규칙으로 접는다', () => {
    expect(SLOPE_GRADE_TONE).toEqual({
      적합: 'pass', 경계: 'warn', 보수: 'fail', 재시공: 'fail', 판정불가: 'unknown',
    });
  });
});
```

`components/analysis/__tests__/analysis-result.test.tsx` — 전체 교체. 기존 3개 `it`의 동작 단언은 그대로이고 탭이 `TabBar`(`role="tab"`)가 되므로 `getByRole('button', …)` → `getByRole('tab', …)` 세 곳만 바뀐다. 해부 describe 1개 추가.

```tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { AnalysisResult } from '../analysis-result';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';

const stats: Stats = {
  n_cells: 1, n_valid: 1,
  grade_counts: { pass: 1, borderline: 0, repair: 0, rework: 0, na: 0 },
  grade_pct: { pass: 100, borderline: 0, repair: 0, rework: 0, na: 0 },
  value_max_mm: 3.2, value_min_mm: 3.2, value_mean_mm: 3.2, value_p95_mm: 3.2,
  worst: { value_mm: 3.2, cell_ix: 0, cell_iy: 0, point_x: 0.5, point_y: 0.5, zone_id: 1 },
  coverage_pct: 98.0, reduced_span_cells: 0,
  applied_criteria: { name: 'floor-kcs-exposed', source: 'KCS 14 20 10', span_m: 3,
                      pass_mm: 7, rework_mm: 21, u_mm: 5 },
  warnings: [], zones: [],
  meta: { file: 'raw.ply', n_points: 100, surface: 'floor', engine_version: 'p1d-0.4.0' },
  auto_summary: '자동 의견',
  deviation_paths: ['deviation.png'],
};

const analysis: AnalysisRow = {
  id: 'an1', scan_id: 'scan1', surface: 'floor', criteria_id: 'c1', applied_criteria: null,
  params: {}, engine_version: 'p1d-0.4.0', status: 'done', stats, coverage_pct: 98.0,
  overall_verdict: 'pass', warnings: [], artifacts_dir: 'artifacts/an1',
  auto_summary: '자동 의견', user_summary: null, is_current: true, deleted_at: null,
  created_at: '2026-07-29', created_by: null, kind: 'flatness',
};

const scan: ScanRow = {
  id: 'scan1', location_id: 'loc1', surface: 'floor', scanned_at: '2026-07-20', device: null,
  operator_id: null, operator_name_manual: null, selected_criteria_id: null,
  raw_file_path: null, original_filename: null, file_format: null, point_count: null,
  unit_scale: null, lineage: 'raw', status: 'ready', height_view_path: null, deleted_at: null,
  created_at: '2026-07-20', updated_at: '2026-07-20',
};

// cells.json fetch는 히트맵 탭 전용이라 빈 배열로 스텁한다
function stubCellsFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] } as unknown as Response)));
}

describe('AnalysisResult 정밀 편차맵 탭', () => {
  it('탭을 누르면 stats.deviation_paths의 이미지를 보여준다', async () => {
    stubCellsFetch();

    render(<AnalysisResult analysis={analysis} scan={scan} photos={[]} />);
    // Cloudscape 리스킨(T7): 탭은 TabBar(role=tab)다 - 동작(클릭 -> 이미지)은 그대로
    fireEvent.click(screen.getByRole('tab', { name: '정밀 편차맵' }));

    await waitFor(() => {
      const img = screen.getByAltText('정밀 편차맵(10cm)') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('/api/data/artifacts/an1/deviation.png');
    });
  });

  it('편차맵이 없는 분석에서는 안내 문구를 보여준다', async () => {
    stubCellsFetch();
    const without = { ...analysis, stats: { ...stats, deviation_paths: undefined } };

    render(<AnalysisResult analysis={without} scan={scan} photos={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: '정밀 편차맵' }));

    await waitFor(() => {
      expect(screen.getByText(/정밀 편차맵이 없습니다/)).toBeInTheDocument();
    });
  });

  it('임포트(Colab) 결과에서는 편차맵 재분석을 권하지 않는다 (스펙 §8/계약 §2: 임포트 경로는 편차맵 미생성)', async () => {
    stubCellsFetch();
    const imported: AnalysisRow = {
      ...analysis, engine_version: 'external-colab-v1',
      stats: { ...stats, deviation_paths: undefined,
                meta: { ...stats.meta, engine_version: 'external-colab-v1', source: 'colab-import' } },
    };

    render(<AnalysisResult analysis={imported} scan={scan} photos={[]} />);
    fireEvent.click(screen.getByRole('tab', { name: '정밀 편차맵' }));

    await waitFor(() => {
      expect(screen.getByText(/외부\(Colab\) 임포트 결과에는 정밀 편차맵을 생성하지 않습니다/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/재분석하면 생성됩니다/)).not.toBeInTheDocument();
  });
});

// Cloudscape 리스킨(T7): 컨테이너는 페이지(T6)가 그리고 이 컴포넌트는 본문만 그린다 -
// TabBar → 3:2 그리드(좌 히트맵 / 우 판정 패널) → 구간별 결과표.
describe('AnalysisResult Cloudscape 본문 (T7)', () => {
  it('TabBar 4탭(히트맵 활성) + 3:2 그리드 + 구간별 결과표 제목, 구 팔레트 클래스 없음', async () => {
    stubCellsFetch();
    const { container } = render(<AnalysisResult analysis={analysis} scan={scan} photos={[]} />);

    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['히트맵', '정밀 편차맵', '3D 프리뷰', '현장 사진']);
    expect(screen.getByRole('tab', { name: '히트맵' })).toHaveAttribute('aria-selected', 'true');

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('flex flex-col gap-5');
    const grid = root.firstElementChild as HTMLElement;
    expect(grid.className).toContain('md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]');
    expect(grid.className).toContain('gap-5');
    expect(screen.getByRole('heading', { level: 3, name: '구간별 결과표' })).toBeInTheDocument();

    // 빈 cells가 도착하면 히트맵 자리에는 "표시할 셀 데이터가 없습니다." (fetch 이펙트를 기다려 act 경고를 막는다)
    await waitFor(() => expect(screen.getByText('표시할 셀 데이터가 없습니다.')).toBeInTheDocument());
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-|green-|purple-/);
  });
});
```

`components/analysis/__tests__/verdict-panel.test.tsx` — 전체 교체. 기존 3개 `it`은 문장 그대로, 해부 describe 추가.

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

import { VerdictPanel } from '../verdict-panel';
import type { AnalysisRow, Stats } from '@/lib/domain/types';

const stats: Stats = {
  n_cells: 40, n_valid: 36,
  grade_counts: { pass: 30, borderline: 4, repair: 2, rework: 0, na: 4 },
  grade_pct: { pass: 75, borderline: 10, repair: 5, rework: 0, na: 10 },
  value_max_mm: 12.34, value_min_mm: 0.5, value_mean_mm: 3.21, value_p95_mm: 9.87,
  worst: { value_mm: 12.34, cell_ix: 3, cell_iy: 4, point_x: 3.5, point_y: 4.5, zone_id: 1 },
  coverage_pct: 88.5, reduced_span_cells: 6,
  applied_criteria: { name: 'floor-kcs-exposed', source: 'KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)', span_m: 3, pass_mm: 7, rework_mm: 21, u_mm: 5 },
  warnings: ['low_coverage'],
  zones: [{ zone_id: 1, level_m: 0.001, area_m2: 35.2, status: 'ok', plane_abc: [0, 0, 0] }],
  meta: { file: 'raw.ply', n_points: 100000, surface: 'floor', engine_version: 'p1d-0.4.0' },
  auto_summary: '자동 종합의견 본문입니다. 본 결과는 스크리닝이며 공식 검측을 대체하지 않습니다.',
};

const analysis = {
  id: 'a1', scan_id: 'c1', surface: 'floor', criteria_id: 'cr1',
  applied_criteria: stats.applied_criteria, params: {}, engine_version: 'p1d-0.4.0',
  status: 'done', stats, coverage_pct: 88.5, overall_verdict: 'repair',
  warnings: ['low_coverage'], artifacts_dir: 'artifacts/a1',
  auto_summary: stats.auto_summary, user_summary: null, is_current: true,
  deleted_at: null, created_at: '2026-07-28T00:00:00Z', created_by: null, kind: 'flatness',
} as AnalysisRow;

const imported = {
  ...analysis, engine_version: 'external-colab-v1',
  stats: { ...stats, meta: { ...stats.meta, source: 'colab-import' } },
} as AnalysisRow;

describe('VerdictPanel (C안 우측 고정 패널)', () => {
  it('종합 판정 배지·핵심 수치·기준·경고·종합의견을 렌더한다', () => {
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    expect(screen.getByText('보수')).toBeInTheDocument();          // 종합 판정
    expect(screen.getByText('12.34')).toBeInTheDocument();          // 최대 편차
    // coverage 라벨 분기 - low_coverage 경고 문구도 '바닥 인식률'을 포함하므로 정확 일치로 dt만 매칭
    expect(screen.getByText('바닥 인식률')).toBeInTheDocument();
    expect(screen.getByText(/88.5/)).toBeInTheDocument();
    expect(screen.getByText('floor-kcs-exposed')).toBeInTheDocument();
    expect(screen.getByText(/70% 미만/)).toBeInTheDocument();       // warning 한국어
    expect(screen.getByText(/축소 스팬 적용 셀 6/)).toBeInTheDocument();
    expect(screen.getByText(/스크리닝/)).toBeInTheDocument();       // auto_summary
    expect(screen.getByLabelText('종합의견(사용자 수정)')).toBeInTheDocument();
  });
  it('계보 경고(fused_mesh_smoothed)를 한국어 문구로 보여준다', () => {
    // 업로드 화면이 "결과에 경고가 표시됩니다"라고 약속한 그 화면이 여기다.
    // 워커가 stats.warnings에 코드를 넣어도(flatworker/lineage.py) 이 패널이
    // 라벨을 못 붙이면 사용자는 `fused_mesh_smoothed`라는 슬러그를 보게 된다.
    const fused = { ...stats, warnings: ['low_coverage', 'fused_mesh_smoothed'] };
    render(<VerdictPanel analysis={analysis} stats={fused} />);
    expect(screen.getByText(/융합 메시는 스캐너 앱이/)).toBeInTheDocument();
    expect(screen.queryByText('fused_mesh_smoothed')).not.toBeInTheDocument();
  });
  it('임포트 결과면 외부 결과 배지를 보여준다', () => {
    render(<VerdictPanel analysis={imported} stats={imported.stats!} />);
    expect(screen.getByText('외부 결과')).toBeInTheDocument();
  });
});

// Cloudscape 리스킨(T7): 동작은 위 describe가 지키고 여기서는 해부(프리미티브·토큰·의미 속성)만 본다.
describe('VerdictPanel Cloudscape 해부 (T7)', () => {
  it('판정 헤드라인은 StatusIndicator(data-status=error, 18px 700)이고 외부 결과 배지는 external 톤이다', () => {
    render(<VerdictPanel analysis={imported} stats={imported.stats!} />);
    const head = screen.getByText('보수');
    expect(head).toHaveAttribute('data-status', 'error');
    expect(head.className).toContain('font-bold');
    // text-lg 금지: Tailwind v4는 .text-lg를 .text-sm보다 앞에 내보내 StatusIndicator의 text-sm이 이긴다
    expect(head.className).toContain('text-[18px]');
    expect(head.className).not.toContain('text-lg');
    const badge = screen.getByText('외부 결과');
    expect(badge.className).toContain('bg-cs-external-bg');
    expect(badge.className).toContain('text-cs-external');
  });

  it('overall_verdict가 없으면 pending 헤드라인 "판정 없음"을 그린다', () => {
    render(<VerdictPanel analysis={{ ...analysis, overall_verdict: null } as AnalysisRow} stats={stats} />);
    expect(screen.getByText('판정 없음')).toHaveAttribute('data-status', 'pending');
    expect(screen.queryByText('외부 결과')).not.toBeInTheDocument();
  });

  it('수치는 KeyValuePairs 2열(라벨 700, 값 mono tabular, 최대 편차만 700)이다', () => {
    const { container } = render(<VerdictPanel analysis={analysis} stats={stats} />);
    expect(container.querySelector('dl')?.className).toContain('grid-cols-2');
    expect(screen.getByText('최대 편차(mm)').className).toContain('font-bold');
    expect(screen.getByText('12.34').className).toContain('font-mono');
    expect(screen.getByText('12.34').className).toContain('font-bold');
    expect(screen.getByText('0.50').className).not.toContain('font-bold');
    expect(screen.getByText('36 / 40').className).toContain('tabular-nums');
  });

  it('등급 분포 바는 5등급 세그먼트(GRADE_COLOR hex, 비율 폭)이고 경고는 warning Alert 안에 있다', () => {
    const { container } = render(<VerdictPanel analysis={analysis} stats={stats} />);
    const segs = container.querySelectorAll('[data-grade]');
    expect(Array.from(segs).map((s) => s.getAttribute('data-grade'))).toEqual(['pass', 'borderline', 'repair', 'rework', 'na']);
    expect(segs[0]).toHaveStyle({ backgroundColor: 'rgb(46, 125, 50)' }); // GRADE_COLOR.pass #2e7d32
    expect((segs[0] as HTMLElement).style.width).toBe('75%');            // 30/40
    expect(segs[0].parentElement?.className).toContain('bg-cs-divider');
    expect(screen.getByText('적합 30 · 경계 4 · 보수 2 · 재시공 0 · 판정 불가 4')).toBeInTheDocument();
    const alert = container.querySelector('[data-alert="warning"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.textContent).toContain('70% 미만');
  });

  it('적용 기준 코드는 mono, 종합의견 textarea는 textareaClass, 저장은 normal 버튼이고 이 패널에 primary는 없다', () => {
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    expect(screen.getByText('floor-kcs-exposed').className).toContain('font-mono');
    expect(screen.getByLabelText('종합의견(사용자 수정)').className).toContain('border-cs-input-border');
    // 뷰당 primary 1개(스펙 §4): ScanDone 뷰의 primary는 헤더의 '이 위치의 보고서 생성'(T6)이므로 저장은 normal
    const save = screen.getByRole('button', { name: '저장' });
    expect(save.className).toContain('border-cs-link');
    expect(save.className).not.toContain('bg-cs-link');
    expect(save.className).toContain('rounded-full');
    expect(screen.getAllByRole('button').filter((b) => b.className.includes('bg-cs-link'))).toHaveLength(0);
  });

  it('구 팔레트 클래스(zinc/amber/purple/red/green)가 남아 있지 않다', () => {
    const { container } = render(<VerdictPanel analysis={imported} stats={imported.stats!} />);
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|purple-|red-|green-/);
  });
});
```

`components/analysis/__tests__/result-table.test.tsx` — 전체 교체(기존 2개 `it` 그대로 + 해부 describe).

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResultTable } from '../result-table';
import type { CellRow, Stats } from '@/lib/domain/types';

const base: Omit<Stats, 'zones' | 'walls' | 'meta'> = {
  n_cells: 3, n_valid: 3,
  grade_counts: { pass: 2, borderline: 0, repair: 1, rework: 0, na: 0 },
  grade_pct: { pass: 66.7, borderline: 0, repair: 33.3, rework: 0, na: 0 },
  value_max_mm: 10, value_min_mm: 1, value_mean_mm: 5, value_p95_mm: 9,
  worst: null, coverage_pct: 100, reduced_span_cells: 0,
  applied_criteria: { name: 'x', source: 'y', span_m: 3, pass_mm: 7, rework_mm: 21, u_mm: 5 },
  warnings: [], auto_summary: '',
};

const cell = (zone: number | null, v: number, grade: CellRow['grade']): CellRow => ({
  ix: 0, iy: 0, center_x: 0, center_y: 0, value_mm: v, span_used_m: 3,
  occupancy: 1, grade, worst_x: null, worst_y: null, zone_id: zone,
});

const floorStats: Stats = {
  ...base,
  zones: [{ zone_id: 1, level_m: 0.002, area_m2: 12.5, status: 'ok', plane_abc: [0, 0, 0] }],
  meta: { file: 'f', n_points: 1, surface: 'floor' },
};

const wallStats: Stats = {
  ...base, zones: [],
  walls: [{
    wall_id: 1, n_cells: 2, height_m: 2.4, length_m: 5.1, plumbness_mm: 8.5,
    plumb_grade: 'pass',
    plane_abc: [0, 0, 0],
    frame: { p0: [0, 0], direction: [1, 0], normal: [0, 1], u_min: 0, u_max: 5.1, z_min: 0, z_max: 2.4 },
  }],
  meta: { file: 'f', n_points: 1, surface: 'wall' },
};

describe('ResultTable (하단 구간별 결과표 - 스펙 §5.1.7 필드와 동일 컬럼)', () => {
  it('floor: 구역별 행에 레벨·면적·상태·집계를 렌더한다', () => {
    render(<ResultTable stats={floorStats} cells={[cell(1, 10, 'repair'), cell(1, 1, 'pass')]} />);
    expect(screen.getByText('구역 1')).toBeInTheDocument();
    expect(screen.getByText('정상')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();  // 면적
    expect(screen.getByText('10.00')).toBeInTheDocument(); // 최대
    expect(screen.getByText(/1 \(50%\)/)).toBeInTheDocument(); // 보수 이상 셀(비율)
  });
  it('wall: 벽별 행에 수직도·수직도 등급을 렌더한다', () => {
    render(<ResultTable stats={wallStats} cells={[cell(1, 3, 'pass'), cell(1, 5, 'pass')]} />);
    expect(screen.getByText('벽 1')).toBeInTheDocument();
    expect(screen.getByText('8.50')).toBeInTheDocument(); // 수직도 mm
    expect(screen.getAllByText('적합').length).toBeGreaterThan(0); // plumb_grade
  });
});

// Cloudscape 리스킨(T7): tableClass 프리셋(헤더 40px 700, 행 44px, 수치 열 우측 mono) + StatusIndicator
describe('ResultTable Cloudscape 해부 (T7)', () => {
  it('헤더는 h-10 700, 수치 열은 text-right mono, 행 구분은 cs-divider, 첫 열은 700이다', () => {
    const { container } = render(<ResultTable stats={floorStats} cells={[cell(1, 10, 'repair')]} />);
    expect(container.firstElementChild?.className).toContain('border-cs-divider');
    const th = screen.getByRole('columnheader', { name: '최대(mm)' });
    expect(th.className).toContain('h-10');
    expect(th.className).toContain('font-bold');
    expect(th.className).toContain('text-right');
    expect(screen.getByRole('columnheader', { name: '상태' }).className).not.toContain('text-right');
    const td = screen.getByText('10.00');
    expect(td.className).toContain('font-mono');
    expect(td.className).toContain('text-right');
    expect(td.className).toContain('h-11');
    expect(td.closest('tr')?.className).toContain('border-cs-divider');
    expect(screen.getByText('구역 1').className).toContain('font-bold');
    expect(container.innerHTML).not.toMatch(/zinc-/);
  });
  it('wall: 수직도 판정은 StatusIndicator(data-status=success)로 그린다', () => {
    render(<ResultTable stats={wallStats} cells={[cell(1, 3, 'pass')]} />);
    expect(screen.getByText('적합')).toHaveAttribute('data-status', 'success');
    expect(screen.getByRole('columnheader', { name: '수직도(mm)' }).className).toContain('text-right');
  });
});
```

`components/analysis/__tests__/heatmap-view.test.tsx` — 전체 교체(기존 클릭 보정 `it` 그대로 + 해부 describe: 범례 GRADE_COLOR·벽 TabBar·상세 dl).

```tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HeatmapView } from '../heatmap-view';
import type { CellRow, WallInfo } from '@/lib/domain/types';

const cell = (ix: number, iy: number, value: number): CellRow => ({
  ix, iy, center_x: ix + 0.5, center_y: iy + 0.5, value_mm: value, span_used_m: 3,
  occupancy: 1, grade: 'pass', worst_x: null, worst_y: null, zone_id: 1,
});

const wall = (id: number): WallInfo => ({
  wall_id: id, n_cells: 1, height_m: 2.4, length_m: 5.1, plumbness_mm: 3, plumb_grade: 'pass',
  plane_abc: [0, 0, 0],
  frame: { p0: [0, 0], direction: [1, 0], normal: [0, 1], u_min: 0, u_max: 5.1, z_min: 0, z_max: 2.4 },
});

// jsdom은 레이아웃을 계산하지 않으므로 캔버스 rect를 직접 스텁한다(CSS 축소 없음 = 실 픽셀과 동일)
function stubRect(canvas: HTMLCanvasElement, width: number, height: number) {
  Object.defineProperty(canvas, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON() {} }),
  });
}

describe('HeatmapView 클릭 좌표 보정 (리뷰 Important #2: className="max-w-full" CSS 축소 대응)', () => {
  it('캔버스가 CSS로 절반 축소돼도 스케일 보정을 거쳐 올바른 셀을 선택한다', () => {
    // cells = [ix0,iy0], [ix1,iy0] -> gridGeometry: cols=2, rows=1
    // cellPxFor(geom, 640, 480) = min(640/2, 480/1) = 320 -> canvas.width=640, height=320
    const cells = [cell(0, 0, 1), cell(1, 0, 99)];
    const { container } = render(<HeatmapView surface="floor" cells={cells} zones={[]} />);
    const canvas = container.querySelector('canvas')!;

    // getBoundingClientRect가 실제 캔버스 픽셀(640x320)의 절반(320x160)을 보고하도록 스텁
    // (jsdom은 레이아웃을 계산하지 않으므로 CSS 축소 상황을 직접 흉내낸다)
    stubRect(canvas, 320, 160);

    // 화면 좌표 200은 CSS 폭(320)의 62.5% 지점 - 스케일 보정 없이 그대로 쓰면 실 픽셀
    // 200(<320)이라 왼쪽 셀(ix=0)로 오판된다. 보정하면 200*2=400(>=320)이라 ix=1(오른쪽 셀)이 맞다.
    fireEvent.click(canvas, { clientX: 200, clientY: 80 });

    expect(screen.getByText(/99\.00/)).toBeInTheDocument(); // ix=1 셀(value_mm=99)이 선택돼야 함
    expect(screen.queryByText(/^1\.00 mm$/)).not.toBeInTheDocument();
  });
});

// Cloudscape 리스킨(T7): 캔버스·범례 색은 산출물 팔레트(GRADE_COLOR) 그대로(스펙 §7-4),
// 크롬(보더·라벨·벽 선택)만 토큰과 TabBar로.
describe('HeatmapView Cloudscape 해부 (T7)', () => {
  it('범례는 GRADE_COLOR 5색 12px 사각 스와치이고 캔버스 보더는 cs-divider다', () => {
    const { container } = render(<HeatmapView surface="floor" cells={[cell(0, 0, 1)]} zones={[]} />);
    expect(container.querySelector('canvas')?.className).toContain('border-cs-divider');
    const swatches = container.querySelectorAll('[data-grade]');
    expect(Array.from(swatches).map((s) => s.getAttribute('data-grade'))).toEqual(['pass', 'borderline', 'repair', 'rework', 'na']);
    expect(swatches[0]).toHaveStyle({ backgroundColor: 'rgb(46, 125, 50)' });  // #2e7d32
    expect(swatches[3]).toHaveStyle({ backgroundColor: 'rgb(197, 34, 31)' });  // #c5221f
    expect(swatches[0].className).toContain('h-3 w-3');
    for (const label of ['적합', '경계', '보수', '재시공', '판정 불가']) expect(screen.getByText(label)).toBeInTheDocument();
    // getByText는 자기 텍스트 노드를 가진 범례 항목 span을 돌려준다 - 12px/16px 클래스는 그 span에 있어야 한다
    expect(screen.getByText('적합').className).toContain('text-xs');
    expect(screen.getByText('적합').className).toContain('leading-4');
  });

  it('벽면: 벽 선택은 TabBar(role=tab)이고 클릭하면 활성 탭이 바뀐다', () => {
    const cells = [cell(0, 0, 1), { ...cell(0, 0, 2), zone_id: 2 }];
    render(<HeatmapView surface="wall" cells={cells} walls={[wall(1), wall(2)]} zones={[]} />);
    const tab1 = screen.getByRole('tab', { name: '벽 1 (5.1m x 2.4m)' });
    const tab2 = screen.getByRole('tab', { name: '벽 2 (5.1m x 2.4m)' });
    expect(tab1).toHaveAttribute('aria-selected', 'true');
    expect(tab2).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(tab2);
    expect(tab2).toHaveAttribute('aria-selected', 'true');
    expect(tab1).toHaveAttribute('aria-selected', 'false');
  });

  it('셀 클릭 상세의 라벨은 보조색이고 판정은 Badge, 구 팔레트 클래스가 없다', () => {
    const { container } = render(<HeatmapView surface="floor" cells={[cell(0, 0, 1)]} zones={[]} />);
    const canvas = container.querySelector('canvas')!;
    stubRect(canvas, 480, 480); // cols=1, rows=1 -> cellPx=min(640,480)=480
    fireEvent.click(canvas, { clientX: 240, clientY: 240 });
    expect(screen.getByText('직선자 값').className).toContain('text-cs-text-secondary');
    expect(screen.getByText('직선자 값').closest('dl')?.className).toContain('border-cs-divider');
    expect(screen.getAllByText('적합').some((el) => el.className.includes('bg-cs-success-bg'))).toBe(true);
    expect(container.innerHTML).not.toMatch(/zinc-/);
  });
});
```

`components/analysis/__tests__/deviation-view.test.tsx` — 파일 끝의 마지막 `it`(`임포트(Colab) 결과에서는 …`) 뒤, `});`(describe 닫힘) **앞**에 다음 `it`을 추가한다(기존 5개 `it`은 무변경).

```tsx

  // Cloudscape 리스킨(T7): 캡션 nav-text, 안내 보조색, 이미지 보더 cs-divider
  it('캡션·안내·이미지 보더가 cs 토큰이고 구 팔레트 클래스가 없다', () => {
    const { container } = render(<DeviationView artifactsDir="artifacts/an1" paths={['deviation.png']} isImport={false} />);
    expect(screen.getByText('정밀 편차맵(10cm)').className).toContain('text-cs-nav-text');
    expect(screen.getByText(/판정 등급 산출에는 사용되지 않으며/).className).toContain('text-cs-text-secondary');
    expect(container.querySelector('img')?.className).toContain('border-cs-divider');
    expect(container.innerHTML).not.toMatch(/zinc-/);
  });
```

`components/analysis/__tests__/slope-result.test.tsx` — 610행 파일은 다음 세 `it`만 old→new로 손댄다(픽스처·mock·나머지 `it`은 무변경).

(a) `describe('SlopeResult - cells_json 없는 분석(D7)…')`의 첫 `it` — 재판정 불가 안내가 info Alert, 경고가 warning Alert, 종류 배지가 neutral Badge인지 덧붙인다.

```tsx
    // (old)
    expect(screen.getByText('이 분석은 재판정할 수 없습니다. 구배 분석을 다시 실행하면 배수구를 지정할 수 있습니다.')).toBeInTheDocument();
    // 클릭 안내(배수구 클릭 상단 안내)는 재판정 불가 분기에서는 보이지 않아야 한다.
    expect(screen.queryByText(/배수구 위치를 클릭하세요/)).not.toBeInTheDocument();
  });
```
```tsx
    // (new)
    expect(screen.getByText('이 분석은 재판정할 수 없습니다. 구배 분석을 다시 실행하면 배수구를 지정할 수 있습니다.')).toBeInTheDocument();
    // 클릭 안내(배수구 클릭 상단 안내)는 재판정 불가 분기에서는 보이지 않아야 한다.
    expect(screen.queryByText(/배수구 위치를 클릭하세요/)).not.toBeInTheDocument();
    // Cloudscape 리스킨(T7): 안내는 info Alert, 경고 목록은 warning Alert, 종류 배지는 neutral Badge
    expect(screen.getByText(/이 분석은 재판정할 수 없습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
    expect(screen.getByText(/방향\(역구배\)을 판정하지 않았습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
    expect(screen.getByText('구배').className).toContain('bg-cs-divider');
    expect(screen.getByText('경고').className).toContain('font-bold');
    expect(document.body.innerHTML).not.toMatch(/zinc-|amber-|red-/);
  });
```

(b) `it('배수구 클릭: 엔큐가 23505로 실패하면 params를 건드리지 않고 안내 메시지를 보여준다', …)`의 마지막 `waitFor` — 오류 안내가 error Alert인지 덧붙인다.

```tsx
    // (old)
    await waitFor(() => {
      expect(screen.getByText(/이미 같은 대상의 작업이 대기 중이거나 실행 중입니다/)).toBeInTheDocument();
    });
  });
```
```tsx
    // (new)
    await waitFor(() => {
      expect(screen.getByText(/이미 같은 대상의 작업이 대기 중이거나 실행 중입니다/)).toBeInTheDocument();
    });
    // Cloudscape 리스킨(T7): 클릭 오류는 error Alert(role=alert)
    expect(screen.getByText(/이미 같은 대상의 작업이 대기 중이거나 실행 중입니다/).closest('[data-alert]'))
      .toHaveAttribute('data-alert', 'error');
  });
```

(c) `it('두 파일의 셀 수가 어긋나면(한쪽에만 있는 셀) 손실 개수를 배너로 알린다', …)`의 마지막 `waitFor`.

```tsx
    // (old)
    await waitFor(() => {
      expect(screen.getByText(/1개 셀이 화면에서 빠졌습니다/)).toBeInTheDocument();
    });
  });
```
```tsx
    // (new)
    await waitFor(() => {
      expect(screen.getByText(/1개 셀이 화면에서 빠졌습니다/)).toBeInTheDocument();
    });
    // Cloudscape 리스킨(T7): 셀 누락 배너는 warning Alert
    expect(screen.getByText(/1개 셀이 화면에서 빠졌습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
  });
```

`components/analysis/__tests__/slope-verdict-panel.test.tsx` — 파일 끝(마지막 `});` 뒤)에 describe 1개 추가(기존 13개 `it` 무변경).

```tsx

// Cloudscape 리스킨(T7): 진행 배너 StatusIndicator(in-progress), 실패 배너 error Alert,
// 편차 통계 KeyValuePairs 2열, 배수구 힌트 cs-warning, 경고 warning Alert.
describe('SlopeVerdictPanel Cloudscape 해부 (T7)', () => {
  it('진행 배너는 StatusIndicator in-progress, 실패 배너는 error Alert다', () => {
    const { rerender } = render(
      <SlopeVerdictPanel stats={stats} judge={{ state: 'processing', at: 't0' }} drainPoints={[]} directionAware />,
    );
    expect(screen.getByText(/재판정 진행 중/)).toHaveAttribute('data-status', 'in-progress');
    rerender(
      <SlopeVerdictPanel stats={stats} judge={{ state: 'failed', at: 't0', error: '사유X' }} drainPoints={[]} directionAware />,
    );
    expect(screen.getByText(/재판정에 실패했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.getByText(/사유: 사유X/)).toBeInTheDocument();
  });

  it('편차 통계는 KeyValuePairs 2열, 배수구 미지정 안내는 cs-warning, 경고는 warning Alert, 구 팔레트 없음', () => {
    const { container } = render(
      <SlopeVerdictPanel stats={{ ...stats, direction_judged: false, warnings: ['w1'] }} judge={null}
        drainPoints={[{ x: 3.2, y: 5.1 }]} directionAware />,
    );
    expect(container.firstElementChild?.className).toContain('rounded-cs-container');
    expect(container.querySelector('dl')?.className).toContain('grid-cols-2');
    expect(screen.getByText('평균 편차').className).toContain('font-bold');
    expect(screen.getByText('(3.2, 5.1)').className).toContain('font-mono');
    expect(screen.getByText(/지도에서 배수구 위치를 클릭하세요/).className).toContain('text-cs-warning');
    expect(screen.getByText('w1').closest('[data-alert]')).toHaveAttribute('data-alert', 'warning'); // 미지 코드는 원문(warningLabel)
    expect(screen.getByText(/구역별 통계는 후속 단계/).className).toContain('text-cs-text-secondary');
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-/);
  });
});
```

`components/analysis/__tests__/slope-result-table.test.tsx` — 두 곳. (1) M1 `it`을 교체(색 인라인 style → `data-status`), (2) 파일 끝에 describe 추가.

(1) old→new:
```tsx
  // (old)
  // ★ 코드리뷰 M1: jsonb 무결성 미보장 - grade가 SLOPE_GRADE_COLOR에 없는
  // 문자열이어도 배지가 안 보이는 조용한 오표시 대신 판정불가 회색으로 강제한다.
  it('SLOPE_GRADE_COLOR에 없는 미지 등급 문자열도 판정불가 색으로 폴백해 배지를 보여준다', () => {
    const rows = [result({ grade: '알수없음' as unknown as SlopeCellResult['grade'] })];
    render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
    const badge = screen.getByText('알수없음');
    expect(badge).toHaveStyle({ backgroundColor: 'rgb(158, 158, 158)' }); // #9e9e9e = 판정불가
  });
```
```tsx
  // (new)
  // ★ 코드리뷰 M1: jsonb 무결성 미보장 - grade가 SLOPE_GRADE_TONE에 없는
  // 문자열이어도 배지가 안 보이는 조용한 오표시 대신 판정불가(pending)로 강제한다.
  // (T7: 화면 배지는 SLOPE_GRADE_COLOR hex가 아니라 시스템 톤 - 캔버스만 hex를 쓴다)
  it('SLOPE_GRADE_TONE에 없는 미지 등급 문자열도 판정불가(pending)로 폴백해 표시한다', () => {
    const rows = [result({ grade: '알수없음' as unknown as SlopeCellResult['grade'] })];
    render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
    const badge = screen.getByText('알수없음');
    expect(badge).toHaveAttribute('data-status', 'pending');
    expect(badge.className).toContain('text-cs-na');
  });
```

(2) 파일 끝(마지막 `});` 뒤)에 추가:
```tsx

// Cloudscape 리스킨(T7): 등급 StatusIndicator, 역구배 fail Badge, 방향 편차 warn Badge, tableClass 수치 열.
describe('SlopeResultTable Cloudscape 해부 (T7)', () => {
  it('등급은 StatusIndicator, 역구배·방향 편차는 Badge 톤, 수치 열은 우측 mono, 사유는 보조색', () => {
    const rows = [
      result({ dir_err_deg: 45.3 }),
      result({ cell: cell({ cx: 1 }), grade: '재시공', reason: '역구배(물이 배수구 반대로 흐름)', reverse: true }),
    ];
    const { container } = render(<SlopeResultTable results={rows} designPct={2.0} dirPassDeg={30} />);
    expect(screen.getByText('적합')).toHaveAttribute('data-status', 'success');
    expect(screen.getByText('재시공')).toHaveAttribute('data-status', 'error');
    expect(screen.getByText('역구배').className).toContain('bg-cs-error-bg');
    expect(screen.getByText('45.3도(허용 30도 초과)').className).toContain('bg-cs-warning-bg');
    const th = screen.getByRole('columnheader', { name: '구배(%)' });
    expect(th.className).toContain('text-right');
    expect(th.className).toContain('h-10');
    expect(screen.getAllByText('1.50%')[0].className).toContain('font-mono');
    expect(screen.getByText('크기·방향 모두 허용 안').className).toContain('text-cs-text-secondary');
    expect(screen.getByText('(0, 0)').className).toContain('font-bold');
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|red-/);
  });
});
```

`components/analysis/__tests__/slope-heatmap-view.test.tsx` — 파일 끝(마지막 `});` 뒤)에 describe 추가(기존 6개 `it` 무변경).

```tsx

// Cloudscape 리스킨(T7): 캔버스·범례 색은 엔진 PNG와 같은 SLOPE_GRADE_COLOR hex 그대로,
// 크롬(보더·안내 문구)만 토큰.
describe('SlopeHeatmapView Cloudscape 해부 (T7)', () => {
  it('캔버스 보더 cs-divider, 범례 스와치 5종은 SLOPE_GRADE_COLOR, 화살표 안내는 보조색', () => {
    const { container } = render(
      <SlopeHeatmapView results={[result()]} cellM={2.0} drainPoints={[]} clickable onDrainClick={vi.fn()} />,
    );
    expect(container.querySelector('canvas')?.className).toContain('border-cs-divider');
    expect(container.querySelector('canvas')?.className).toContain('cursor-crosshair');
    const swatches = container.querySelectorAll('[data-grade]');
    expect(Array.from(swatches).map((s) => s.getAttribute('data-grade'))).toEqual(['적합', '경계', '보수', '재시공', '판정불가']);
    expect(swatches[0]).toHaveStyle({ backgroundColor: 'rgb(61, 139, 61)' }); // #3d8b3d
    expect(container.querySelector('[data-legend="drain"]')).toHaveStyle({ backgroundColor: 'rgb(26, 115, 232)' }); // #1a73e8
    expect(screen.getByText(/얇은 화살표/).className).toContain('text-cs-text-secondary');
    expect(container.innerHTML).not.toMatch(/zinc-/);
  });

  it('clickable=false면 not-allowed 커서를 쓴다', () => {
    const { container } = render(
      <SlopeHeatmapView results={[result()]} cellM={2.0} drainPoints={[]} clickable={false} onDrainClick={vi.fn()} />,
    );
    expect(container.querySelector('canvas')?.className).toContain('cursor-not-allowed');
  });
});
```
이 파일은 `screen`을 아직 import하지 않는다 — 2행을 `import { fireEvent, render, screen } from '@testing-library/react';`로 바꾼다.

- [ ] **Step 3: 실패 확인** — `cd dashboard && npx vitest run components/analysis lib/domain/__tests__/grade-tone.test.ts` → FAIL. 기대 실패: `grade-tone.test.ts`(`SLOPE_GRADE_TONE` undefined), `analysis-result.test.tsx` 4건(`role="tab"` 없음), `verdict-panel.test.tsx` 해부 6건(`data-status`·`data-alert`·`data-grade`·`bg-cs-*` 없음), `result-table.test.tsx` 2건, `heatmap-view.test.tsx` 3건, `deviation-view.test.tsx` 1건, `slope-result.test.tsx` 3건(`closest('[data-alert]')`가 null), `slope-verdict-panel.test.tsx` 2건, `slope-result-table.test.tsx` 2건(M1 교체분 포함), `slope-heatmap-view.test.tsx` 2건. 기존 동작 단언은 전부 그대로 PASS여야 한다(FAIL이면 테스트를 잘못 고친 것이다).

- [ ] **Step 4: `lib/domain/grade-tone.ts`에 `SLOPE_GRADE_TONE` 추가** — 파일 끝에 덧붙이고 import를 넓힌다.

```ts
// (old)
import type { Grade } from './types';

export const GRADE_TONE: Record<Grade, 'pass' | 'warn' | 'fail' | 'unknown'> = {
  pass: 'pass',
  borderline: 'warn',
  repair: 'fail',
  rework: 'fail',
  na: 'unknown',
};
```
```ts
// (new)
import type { Grade, SlopeGrade } from './types';

export const GRADE_TONE: Record<Grade, 'pass' | 'warn' | 'fail' | 'unknown'> = {
  pass: 'pass',
  borderline: 'warn',
  repair: 'fail',
  rework: 'fail',
  na: 'unknown',
};

// T7(Cloudscape): 구배 5등급(SlopeGrade, 한글 문자열)도 같은 3버킷 규칙으로 접는다.
// SLOPE_GRADE_COLOR(lib/domain/slope-heatmap.ts, 엔진 PNG와 같은 hex)는 캔버스·범례 전용이고,
// 화면 배지·StatusIndicator는 이 표로 시스템 색을 얻는다(스펙 §7-4: 배지는 시스템 색).
export const SLOPE_GRADE_TONE: Record<SlopeGrade, 'pass' | 'warn' | 'fail' | 'unknown'> = {
  적합: 'pass',
  경계: 'warn',
  보수: 'fail',
  재시공: 'fail',
  판정불가: 'unknown',
};
```

- [ ] **Step 5: `analysis-result.tsx` 교체(전체)** — 상태·이펙트·fetch·분기는 원본 그대로, JSX만 TabBar + 3:2 그리드 + 결과표.

```tsx
// C안 전체 골격 - Cloudscape 리스킨(T7). 컨테이너('평활도 결과' 헤더)는 페이지가 그리고(T6),
// 이 컴포넌트는 그 본문(TabBar → 3:2 그리드[히트맵 | 판정 패널] → 구간별 결과표)만 그린다.
'use client';
import { useEffect, useState } from 'react';
import { artifactUrl } from '@/lib/domain/paths';
import { isExternalImport } from '@/lib/domain/stats';
import type { AnalysisRow, CellRow, PhotoRow, ScanRow, Stats } from '@/lib/domain/types';
import { TabBar } from '@/components/ui/tab-bar';
import { HeatmapView } from './heatmap-view';
import { DeviationView } from './deviation-view';
import { VerdictPanel } from './verdict-panel';
import { ResultTable } from './result-table';
import { PhotoGallery } from '@/components/photo-gallery';
import { RefreshOnUpload } from '@/components/refresh-on-upload';

type Tab = 'heatmap' | 'deviation' | 'preview3d' | 'photos';

// 탭 순서·문구는 기존 그대로(아트보드 ScanDone의 4탭과 같다)
const TABS: { id: Tab; label: string }[] = [
  { id: 'heatmap', label: '히트맵' },
  { id: 'deviation', label: '정밀 편차맵' },
  { id: 'preview3d', label: '3D 프리뷰' },
  { id: 'photos', label: '현장 사진' },
];

// 3:2 그리드(아트보드 minmax(0,3fr) minmax(0,2fr), gap 20px). md 미만은 세로 스택(스펙 §5).
// slope-result.tsx가 같은 문자열을 갖는다(구배 화면이 평활도 모듈 전체를 끌어오지 않도록 import 대신 복제).
const RESULT_GRID = 'grid items-start gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]';
const MUTED = 'text-sm text-cs-text-secondary';

export function AnalysisResult({ analysis, scan, photos }: {
  analysis: AnalysisRow;
  scan: ScanRow;
  photos: PhotoRow[];
}) {
  const stats = analysis.stats as Stats; // status done 전제(페이지에서 보장)
  const [tab, setTab] = useState<Tab>('heatmap');
  const [cells, setCells] = useState<CellRow[] | null>(null);
  const [cellsError, setCellsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 이펙트 본문 최상단 동기 setState는 린트 경고 대상이라 IIFE 내부로 통일한다
      if (!analysis.artifacts_dir) { setCellsError('산출물 경로가 없습니다'); return; }
      const res = await fetch(artifactUrl(analysis.artifacts_dir, 'cells.json'));
      if (!res.ok) {
        if (!cancelled) setCellsError('셀 데이터를 저장소에서 찾을 수 없습니다. 파일이 삭제되었거나 아직 업로드되지 않았을 수 있습니다. 스캔 상세에서 재분석을 시도하세요.');
        return;
      }
      const data = (await res.json()) as CellRow[];
      if (!cancelled) setCells(data);
    })();
    return () => { cancelled = true; };
  }, [analysis.artifacts_dir]);

  const preview3d = (stats.preview3d_paths ?? []).filter(Boolean);
  const deviation = (stats.deviation_paths ?? []).filter(Boolean);
  const isImport = isExternalImport(analysis.engine_version, stats.meta);

  return (
    <div className="flex flex-col gap-5">
      <div className={RESULT_GRID}>
        <section className="flex min-w-0 flex-col gap-4">
          <TabBar tabs={TABS} active={tab} onChange={setTab} />
          {tab === 'heatmap' && (
            cells ? (
              <HeatmapView surface={analysis.surface} cells={cells} walls={stats.walls} zones={stats.zones} />
            ) : (
              <p className={MUTED}>{cellsError ?? '셀 데이터 로딩 중...'}</p>
            )
          )}
          {tab === 'deviation' && (
            <DeviationView artifactsDir={analysis.artifacts_dir} paths={deviation} isImport={isImport} />
          )}
          {tab === 'preview3d' && (
            preview3d.length > 0 ? (
              <div className="flex flex-col gap-3">
                {preview3d.map((name) => (
                  // 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={name} src={artifactUrl(analysis.artifacts_dir!, name)} alt={`3D 프리뷰 ${name}`}
                    className="max-w-full rounded-lg border border-cs-divider bg-white" />
                ))}
                <p className="text-xs leading-4 text-cs-text-secondary">
                  워커가 생성한 정적 3D 프리뷰입니다(회전·줌 가능한 뷰어는 정식 단계 백로그).
                </p>
              </div>
            ) : (
              <p className={MUTED}>
                3D 프리뷰가 없습니다{analysis.surface === 'wall' ? ' (벽면 분석은 3D 프리뷰를 생성하지 않습니다)' : ''}.
              </p>
            )
          )}
          {tab === 'photos' && (
            <div className="flex flex-col gap-2">
              <RefreshOnUpload target={{ scan_id: scan.id }} />
              <PhotoGallery photos={photos} />
            </div>
          )}
        </section>
        <div className="min-w-0 md:sticky md:top-5 md:self-start">
          <VerdictPanel analysis={analysis} stats={stats} />
        </div>
      </div>
      <section className="flex flex-col gap-2">
        {/* 컨테이너 제목이 h2이므로 본문 소제목은 h3 */}
        <h3 className="text-base font-bold leading-5">구간별 결과표</h3>
        {cells ? <ResultTable stats={stats} cells={cells} /> :
          <p className={MUTED}>{cellsError ?? '셀 데이터 로딩 중...'}</p>}
      </section>
    </div>
  );
}
```

- [ ] **Step 6: `verdict-panel.tsx` 교체(전체)** — 저장 로직·문구·`isExternalImport` 판별 그대로. 헤드라인은 `StatusIndicator`, 수치는 `KeyValuePairs`, 경고는 `Alert`, 저장은 normal `Button`(이 뷰의 primary는 T6 헤더의 `이 위치의 보고서 생성` 하나다).

```tsx
// C안 우측 판정 패널 - Cloudscape 리스킨(T7). 저장 로직·문구·판별(isExternalImport)은 그대로.
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { GRADE_COLOR, GRADE_LABEL, fmtMm, warningLabel } from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { coverageLabel, isExternalImport } from '@/lib/domain/stats';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { textareaClass } from '@/components/ui/form';
import { KeyValuePairs } from '@/components/ui/key-value';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
import type { AnalysisRow, Grade, Stats } from '@/lib/domain/types';

const BAR_ORDER: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];
const LABEL = 'text-sm font-bold';
const NOTE = 'text-xs leading-4 text-cs-text-secondary';
const NUM = 'font-mono tabular-nums';
// 판정 헤드라인 18px/22px 700(아트보드). ★ text-lg를 쓰면 안 된다 - Tailwind v4는 .text-lg를
// .text-sm보다 앞에 내보내므로(속성 수 같으면 이름순) StatusIndicator 자체의 text-sm이 이긴다
// (v4.3.3에서 확인). 임의값 text-[18px]는 속성이 하나라 그 뒤에 나와 font-size를 확실히 덮고,
// leading-[22px]가 --tw-leading으로 line-height를 덮는다.
const HEADLINE = 'text-[18px] font-bold leading-[22px]';

export function VerdictPanel({ analysis, stats }: { analysis: AnalysisRow; stats: Stats }) {
  const [summary, setSummary] = useState(analysis.user_summary ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const external = isExternalImport(analysis.engine_version, stats.meta);

  async function saveSummary() {
    const { error } = await createClient().from('analyses')
      .update({ user_summary: summary || null }).eq('id', analysis.id);
    setSaved(error ? `저장 실패: ${error.message}` : '저장되었습니다');
  }

  const c = stats.applied_criteria;

  return (
    <aside className="flex flex-col gap-4 rounded-cs-container border border-cs-divider bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        {analysis.overall_verdict ? (
          // D8 픽스 계승: 색은 GRADE_TONE -> TONE_STATUS(시스템 색)로만 얻는다(인라인 hex 금지).
          <StatusIndicator type={TONE_STATUS[GRADE_TONE[analysis.overall_verdict]]} className={HEADLINE}>
            {GRADE_LABEL[analysis.overall_verdict]}
          </StatusIndicator>
        ) : (
          <StatusIndicator type="pending" className={HEADLINE}>판정 없음</StatusIndicator>
        )}
        {external && <Badge tone="external">외부 결과</Badge>}
      </div>

      <KeyValuePairs columns={2} items={[
        { label: '최대 편차(mm)', value: <span className={`${NUM} font-bold`}>{fmtMm(stats.value_max_mm)}</span> },
        { label: '최소(mm)', value: <span className={NUM}>{fmtMm(stats.value_min_mm)}</span> },
        { label: '평균(mm)', value: <span className={NUM}>{fmtMm(stats.value_mean_mm)}</span> },
        { label: '95퍼센타일(mm)', value: <span className={NUM}>{fmtMm(stats.value_p95_mm)}</span> },
        { label: '판정 셀(유효/전체)', value: <span className={NUM}>{stats.n_valid} / {stats.n_cells}</span> },
        { label: coverageLabel(stats), value: <span className={NUM}>{stats.coverage_pct}%</span> },
      ]} />
      {stats.reduced_span_cells > 0 && (
        <p className={NOTE}>축소 스팬 적용 셀 {stats.reduced_span_cells}개 (허용치 선형 환산)</p>
      )}

      <div className="flex flex-col gap-1">
        <h3 className={LABEL}>등급 분포</h3>
        {/* 5등급 분포 바 - 표시 로직(폭 = 등급 수/전체 셀)은 기존 그대로. 색은 바로 옆 범례·캔버스와
            같은 GRADE_COLOR(태스크 결정 - 같은 등급이 패널과 범례에서 다른 색으로 보이지 않게). */}
        <div className="flex h-2 overflow-hidden rounded bg-cs-divider">
          {BAR_ORDER.map((g) => (
            <div key={g} data-grade={g} style={{
              backgroundColor: GRADE_COLOR[g],
              width: `${stats.n_cells ? (stats.grade_counts[g] / stats.n_cells) * 100 : 0}%`,
            }} />
          ))}
        </div>
        <p className={`${NOTE} tabular-nums`}>
          {BAR_ORDER.map((g) => `${GRADE_LABEL[g]} ${stats.grade_counts[g]}`).join(' · ')}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className={LABEL}>적용 기준</h3>
        <p className="font-mono text-sm">{c.name}</p>
        <p className={NOTE}>{c.source}</p>
        <p className={NOTE}>
          {c.span_m !== null
            ? `${c.span_m}m당 허용 ${c.pass_mm}mm / 재시공 ${c.rework_mm}mm`
            : `수직도 허용 ${c.pass_mm}mm / 재시공 ${c.rework_mm}mm`}
          {' · '}불확도 U={c.u_mm}mm
        </p>
      </div>

      {stats.warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>경고</h3>
          <Alert type="warning">
            <ul className="flex flex-col gap-1 text-xs leading-4">
              {stats.warnings.map((w) => <li key={w}>{warningLabel(w)}</li>)}
            </ul>
          </Alert>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className={LABEL}>종합의견</h3>
        {/* 자동 의견은 줄바꿈이 든 한 문자열 - 문단으로 쪼개는 로직을 더하지 않고 pre-wrap으로 그대로 */}
        <p className="whitespace-pre-wrap rounded-lg border border-cs-divider p-3 text-xs leading-4 text-cs-nav-text">
          {analysis.auto_summary ?? stats.auto_summary}
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="user-summary" className={LABEL}>종합의견(사용자 수정)</label>
          <textarea id="user-summary" rows={4} value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={textareaClass}
            placeholder="자동 의견에 덧붙일 해석·조치 계획을 적습니다. 보고서(P4)에 함께 실립니다." />
        </div>
        <div className="flex items-center gap-2">
          {/* 뷰당 primary 1개(스펙 §4): 이 뷰(ScanDone)의 primary는 페이지 헤더의 '이 위치의 보고서 생성'이므로
              저장은 normal(기본 variant). 아트보드는 primary로 그렸지만 §4 규칙이 우선한다. */}
          <Button onClick={saveSummary}>저장</Button>
          {saved && <span className={NOTE}>{saved}</span>}
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 7: `result-table.tsx` 교체(전체)** — 컬럼·문구·집계 그대로, `tableClass` + 수직도 판정 `StatusIndicator`.

```tsx
// 하단 구간별 결과표 - Cloudscape 리스킨(T7): tableClass 프리셋(헤더 40px 700, 행 44px, 수치 열 우측 mono)
// 구역(벽)별 max/min/mean·보수 이상 셀은 cells.json에서 재집계(computeZoneStats)
import { computeZoneStats } from '@/lib/domain/cells';
import { GRADE_LABEL, ZONE_STATUS_LABEL, fmtMm } from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { tableClass } from '@/components/ui/data-table';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
import type { CellRow, Stats } from '@/lib/domain/types';

export function ResultTable({ stats, cells }: { stats: Stats; cells: CellRow[] }) {
  const zoneStats = computeZoneStats(cells);
  const isWall = stats.meta.surface === 'wall';
  return (
    <div className="overflow-x-auto rounded-lg border border-cs-divider bg-white">
      <table className={tableClass.table}>
        <thead className={tableClass.thead}>
          <tr>
            <th className={tableClass.th}>{isWall ? '벽' : '구역'}</th>
            {!isWall && <th className={tableClass.th}>상태</th>}
            {!isWall && <th className={tableClass.thNum}>레벨(m)</th>}
            {!isWall && <th className={tableClass.thNum}>면적(m²)</th>}
            {isWall && <th className={tableClass.thNum}>크기(m)</th>}
            {isWall && <th className={tableClass.thNum}>수직도(mm)</th>}
            {isWall && <th className={tableClass.th}>수직도 판정</th>}
            <th className={tableClass.thNum}>셀(유효/전체)</th>
            <th className={tableClass.thNum}>최대(mm)</th>
            <th className={tableClass.thNum}>최소(mm)</th>
            <th className={tableClass.thNum}>평균(mm)</th>
            <th className={tableClass.thNum}>보수 이상 셀(비율)</th>
          </tr>
        </thead>
        <tbody>
          {zoneStats.map((z) => {
            const zone = stats.zones.find((zi) => zi.zone_id === z.zone_id);
            const wall = stats.walls?.find((w) => w.wall_id === z.zone_id);
            return (
              <tr key={String(z.zone_id)} className={tableClass.row}>
                <td className={`${tableClass.td} font-bold`}>
                  {z.zone_id === null ? '전체' : isWall ? `벽 ${z.zone_id}` : `구역 ${z.zone_id}`}
                </td>
                {!isWall && <td className={tableClass.td}>{zone ? ZONE_STATUS_LABEL[zone.status] : '-'}</td>}
                {!isWall && <td className={tableClass.tdNum}>{zone ? zone.level_m : '-'}</td>}
                {!isWall && <td className={tableClass.tdNum}>{zone ? zone.area_m2 : '-'}</td>}
                {isWall && <td className={tableClass.tdNum}>{wall ? `${wall.length_m} x ${wall.height_m}` : '-'}</td>}
                {isWall && <td className={tableClass.tdNum}>{wall ? fmtMm(wall.plumbness_mm) : '-'}</td>}
                {isWall && (
                  <td className={tableClass.td}>
                    {wall && (
                      <StatusIndicator type={TONE_STATUS[GRADE_TONE[wall.plumb_grade]]}>
                        {GRADE_LABEL[wall.plumb_grade]}
                      </StatusIndicator>
                    )}
                  </td>
                )}
                <td className={tableClass.tdNum}>{z.n_valid} / {z.n_cells}</td>
                <td className={tableClass.tdNum}>{fmtMm(z.max_mm)}</td>
                <td className={tableClass.tdNum}>{fmtMm(z.min_mm)}</td>
                <td className={tableClass.tdNum}>{fmtMm(z.mean_mm)}</td>
                <td className={tableClass.tdNum}>{z.over_cells} ({z.over_pct}%)</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: `heatmap-view.tsx` 교체(전체)** — 캔버스 그리기·클릭 보정·셀 선택 로직 그대로. 벽 선택 버튼은 `TabBar`, 범례 스와치는 12px 사각 + `GRADE_COLOR` hex, 상세 `<dl>`은 토큰만.

```tsx
// 히트맵 탭(셀 클릭 상세 포함) - Cloudscape 리스킨(T7).
// 캔버스·범례 색은 산출물 팔레트 GRADE_COLOR 그대로(스펙 §3 예외·§7-4: PDF와 같은 색), 크롬만 토큰.
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cellAt, cellPxFor, drawHeatmap, gridGeometry } from '@/lib/viz/heatmap';
import { GRADE_COLOR, GRADE_LABEL, ZONE_STATUS_LABEL, fmtMm } from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { Badge } from '@/components/ui/badge';
import { TabBar } from '@/components/ui/tab-bar';
import type { CellRow, Grade, Stats, Surface, WallInfo } from '@/lib/domain/types';

const LEGEND: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];
const DT = 'text-cs-text-secondary';

export function HeatmapView({ surface, cells, walls, zones }: {
  surface: Surface;
  cells: CellRow[];
  walls?: WallInfo[];
  zones: Stats['zones'];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wallId, setWallId] = useState<number | null>(walls?.[0]?.wall_id ?? null);
  const [selected, setSelected] = useState<CellRow | null>(null);

  // 벽면은 zone_id가 wall_id - 선택한 벽의 셀만 표시
  const shown = useMemo(
    () => (surface === 'wall' && wallId !== null ? cells.filter((c) => c.zone_id === wallId) : cells),
    [surface, wallId, cells],
  );
  const geom = useMemo(() => gridGeometry(shown), [shown]);
  const cellPx = geom ? cellPxFor(geom, 640, 480) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !geom) return;
    canvas.width = geom.cols * cellPx;
    canvas.height = geom.rows * cellPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // jsdom 등 캔버스 미지원 환경 방어
    drawHeatmap(ctx, shown, geom, cellPx);
  }, [shown, geom, cellPx]);

  function onClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!geom) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    // 리뷰 Important #2: className="max-w-full"로 캔버스가 CSS상 축소되면
    // canvas.width(실 픽셀)와 rect.width(화면 픽셀)가 달라져 클릭 좌표가 어긋난다.
    // 화면 좌표를 실 픽셀 좌표로 환산해 히트테스트한다(rect가 0이면 보정하지 않는다).
    const sx = rect.width ? canvas.width / rect.width : 1;
    const sy = rect.height ? canvas.height / rect.height : 1;
    const px = (e.clientX - rect.left) * sx;
    const py = (e.clientY - rect.top) * sy;
    setSelected(cellAt(geom, shown, cellPx, px, py));
  }

  const zoneOf = (zoneId: number | null) => zones.find((z) => z.zone_id === zoneId);

  return (
    <div className="flex flex-col gap-3">
      {surface === 'wall' && (walls?.length ?? 0) > 0 && (
        // 벽 선택: 기존 토글 버튼을 TabBar(role=tab)로. TabBar의 id는 string이라 wall_id(number)는
        // String()/Number()로 오간다(정수 id라 왕복 손실 없음). 선택 로직(setWallId + 상세 초기화)은 그대로.
        <TabBar
          tabs={walls!.map((w) => ({ id: String(w.wall_id), label: `벽 ${w.wall_id} (${w.length_m}m x ${w.height_m}m)` }))}
          active={String(wallId)}
          onChange={(id) => { setWallId(Number(id)); setSelected(null); }}
        />
      )}
      {geom ? (
        <canvas ref={canvasRef} onClick={onClick}
          className="max-w-full cursor-crosshair rounded-lg border border-cs-divider bg-white" />
      ) : (
        <p className="text-sm text-cs-text-secondary">표시할 셀 데이터가 없습니다.</p>
      )}
      {/* 범례: 12px 사각 스와치 5종 = GRADE_COLOR hex(캔버스·PDF와 같은 색).
          text-xs leading-4는 항목 span 자체에 둔다 - 테스트의 getByText('적합')는 자기 텍스트 노드를 가진
          이 span을 돌려주므로 부모 div에만 두면 클래스 단언이 잡지 못한다. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {LEGEND.map((g) => (
          <span key={g} className="inline-flex items-center gap-1 text-xs leading-4">
            <span aria-hidden data-grade={g} className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: GRADE_COLOR[g] }} />
            {GRADE_LABEL[g]}
          </span>
        ))}
      </div>
      {selected && (
        <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-cs-divider bg-white p-3 text-sm">
          <dt className={DT}>판정</dt>
          <dd>
            <Badge tone={GRADE_TONE[selected.grade]}>{GRADE_LABEL[selected.grade]}</Badge>
          </dd>
          <dt className={DT}>직선자 값</dt><dd className="font-mono tabular-nums">{fmtMm(selected.value_mm)} mm</dd>
          <dt className={DT}>사용 스팬</dt><dd className="font-mono tabular-nums">{selected.span_used_m} m</dd>
          <dt className={DT}>셀 점유율</dt><dd className="font-mono tabular-nums">{Math.round(selected.occupancy * 100)}%</dd>
          <dt className={DT}>최악 지점</dt>
          <dd className="font-mono tabular-nums">{selected.worst_x !== null ? `(${selected.worst_x}, ${selected.worst_y})` : '-'}</dd>
          <dt className={DT}>{surface === 'wall' ? '벽' : '구역'}</dt>
          <dd>
            {selected.zone_id ?? '-'}
            {surface === 'floor' && zoneOf(selected.zone_id) &&
              ` (${ZONE_STATUS_LABEL[zoneOf(selected.zone_id)!.status]})`}
          </dd>
        </dl>
      )}
    </div>
  );
}
```

- [ ] **Step 9: `deviation-view.tsx` 교체(전체)** — 문구·`isImport` 분기·`deviationLabel` 그대로, 클래스만.

```tsx
// 정밀 편차맵 탭 - 10cm 해상도 원시 편차(판정과 무관한 보조 시각화). Cloudscape 리스킨(T7): 클래스만.
import { artifactUrl } from '@/lib/domain/paths';

const WALL_FILE = /^deviation_wall(\d+)\.png$/;
const MUTED = 'text-sm text-cs-text-secondary';

// 워커 flatworker/report/assets.deviation_label과 같은 문구를 만든다
// (화면 캡션과 PDF 캡션이 갈리면 같은 그림이 다른 이름으로 불린다)
export function deviationLabel(name: string): string {
  const m = WALL_FILE.exec(name);
  return m ? `벽 ${m[1]} 정밀 편차맵(10cm)` : '정밀 편차맵(10cm)';
}

export function DeviationView({ artifactsDir, paths, isImport }: {
  artifactsDir: string | null;
  paths: string[];
  // 외부(Colab) 임포트 결과 여부 — 스펙 §8/계약 §2: 임포트 경로는 편차맵을 아예 생성하지
  // 않으므로 재분석을 권해선 안 된다(무한 재시도 유도 방지). 판별은 호출부가
  // lib/domain/stats.ts의 isExternalImport로 넘긴다(3D 프리뷰 탭과 동일한 분기 선례)
  isImport: boolean;
}) {
  if (!artifactsDir || paths.length === 0) {
    if (isImport) {
      return (
        <p className={MUTED}>
          외부(Colab) 임포트 결과에는 정밀 편차맵을 생성하지 않습니다.
        </p>
      );
    }
    return (
      <p className={MUTED}>
        정밀 편차맵이 없습니다. 이 기능이 추가되기 전 엔진으로 분석한 결과이거나,
        유효 편차 데이터가 없는 경우이거나, 이미지 생성에 실패한 경우입니다(경고 목록 확인).
        재분석하면 생성됩니다.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {paths.map((name) => (
        <figure key={name} className="flex flex-col gap-1">
          {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifactUrl(artifactsDir, name)} alt={deviationLabel(name)}
            className="max-w-full rounded-lg border border-cs-divider bg-white" />
          <figcaption className="text-xs leading-4 text-cs-nav-text">{deviationLabel(name)}</figcaption>
        </figure>
      ))}
      <p className="text-xs leading-4 text-cs-text-secondary">
        10cm 격자의 원시 편차 분포입니다. 0mm가 중앙(연노랑)이고 붉을수록 융기(벽은 돌출),
        초록일수록 침하(벽은 함몰)이며 회색은 데이터가 없는 구간입니다.
        판정 등급 산출에는 사용되지 않으며, 등급은 히트맵 탭의 1m 판정 셀 기준입니다.
      </p>
    </div>
  );
}
```

- [ ] **Step 10: `slope-result.tsx` — import 3줄·토큰 상수 추가 + `return (` 블록 교체** — 1~171행(헤더 주석·상태·이펙트·`handleDrainClick`)은 **한 글자도 바꾸지 않는다**.

(a) import — old→new:
```tsx
// (old)
import { SlopeHeatmapView } from './slope-heatmap-view';
import { SlopeResultTable } from './slope-result-table';
import { SlopeVerdictPanel } from './slope-verdict-panel';
import type { AnalysisRow, DrainPoint, SlopeParams, SlopeStats } from '@/lib/domain/types';

const COUNT_ORDER = ['적합', '경계', '보수', '재시공', '판정불가'] as const;
```
```tsx
// (new)
import { SlopeHeatmapView } from './slope-heatmap-view';
import { SlopeResultTable } from './slope-result-table';
import { SlopeVerdictPanel } from './slope-verdict-panel';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { KeyValuePairs } from '@/components/ui/key-value';
import type { AnalysisRow, DrainPoint, SlopeParams, SlopeStats } from '@/lib/domain/types';

const COUNT_ORDER = ['적합', '경계', '보수', '재시공', '판정불가'] as const;
// Cloudscape 리스킨(T7) 토큰 - 평활도 AnalysisResult/VerdictPanel과 같은 어휘.
// RESULT_GRID는 analysis-result.tsx와 같은 문자열(평활도 모듈 전체를 import하지 않으려고 복제).
const RESULT_GRID = 'grid items-start gap-5 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]';
const LABEL = 'text-sm font-bold';
const NOTE = 'text-xs leading-4 text-cs-text-secondary';
const MUTED = 'text-sm text-cs-text-secondary';
const LINK = 'text-cs-link hover:text-cs-link-hover hover:underline';
```

(b) `  return (` (원본 172행, 직전 3줄은 `    setClickedDrainPoints([pt]); // 낙관적 갱신 - …` / `  }` / 빈 줄)부터 파일 끝 `}`까지를 다음으로 교체한다. 분기 구조(`!canRejudge` / `directionAware` / `clickError` / `loadError && cells` / `unmatchedCount > 0`)·문구·주석은 그대로다.

```tsx
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <Badge tone="neutral">{ANALYSIS_KIND_LABEL.slope}</Badge>
      </div>

      {!canRejudge ? (
        <div className="flex flex-col gap-4 rounded-cs-container border border-cs-divider bg-white p-5">
          <div className="flex flex-col gap-1">
            <h3 className={LABEL}>판정 요약</h3>
            <p className="text-sm">
              {COUNT_ORDER.map((k) => `${k} ${counts[k] ?? 0}`).join(' · ')}
            </p>
            <p className={NOTE}>판정 가능 비율 {(summary.coverage_pct ?? 0).toFixed(1)}%</p>
          </div>

          <KeyValuePairs columns={2} items={[
            { label: '평균 편차', value: fmtDevPct(summary.mean_dev_pct) },
            { label: '편차 표준편차', value: fmtDevPct(summary.std_dev_pct) },
            { label: '최대 편차', value: fmtDevPct(summary.max_dev_pct) },
          ]} />

          {warnings.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className={LABEL}>경고</h3>
              <Alert type="warning">
                <ul className="flex flex-col gap-1 text-xs leading-4">
                  {warnings.map((w) => <li key={w}>{warningLabel(w)}</li>)}
                </ul>
              </Alert>
            </div>
          )}

          {mapPng && (
            <div className="flex flex-col gap-1">
              <h3 className={LABEL}>구배 판정 지도</h3>
              {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={dataUrl(mapPng)} alt="구배 판정 지도"
                className="max-w-full rounded-lg border border-cs-divider bg-white" />
            </div>
          )}

          <Alert type="info">
            이 분석은 재판정할 수 없습니다. 구배 분석을 다시 실행하면 배수구를 지정할 수 있습니다.
          </Alert>
        </div>
      ) : (
        <>
          {/* 코드리뷰(2차) I1: 방향 판정 대상이 아닌 기준에서는 클릭을 권하지 않고
              이유를 알린다. */}
          {directionAware ? (
            <p className="text-sm">
              배수구 위치를 클릭하세요. 클릭하면 그 지점을 기준으로 재판정 작업이 시작되고, 완료되면
              화면이 자동으로 갱신됩니다.
              {/* 코드리뷰 M5: 브리프 D3 - 엔진 PNG는 화면에 다시 그리지 않되(Canvas와
                  색표가 다를 수 있음) 다운로드 링크로는 둔다. */}
              {mapPng && (
                <>
                  {' '}
                  <a href={dataUrl(mapPng)} download className={LINK}>
                    구배 판정 지도(PNG) 다운로드
                  </a>
                </>
              )}
            </p>
          ) : (
            <Alert type="info">
              이 기준({stats.threshold?.use ?? '적용 기준'})은 방향(역구배)을 판정하지 않습니다.
              배수구를 지정해도 방향 결과를 신뢰할 수 없어 클릭을 비활성화했습니다.
              {mapPng && (
                <>
                  {' '}
                  <a href={dataUrl(mapPng)} download className={LINK}>
                    구배 판정 지도(PNG) 다운로드
                  </a>
                </>
              )}
            </Alert>
          )}
          {clickError && <Alert type="error">{clickError}</Alert>}
          {/* 코드리뷰 Important-2: cells가 채워진 뒤(성공적으로 로드된 뒤) 재판정으로
              재fetch가 실패하면, 아래 히트맵/결과표는 옛 cells를 계속 보여주므로
              loadError가 else 분기에 묻혀 전혀 안 보였다 - "화면은 최신, 데이터는
              구식"이라는 조용한 실패를 막기 위해 cells 유무와 무관하게 여기서도
              띄운다. */}
          {loadError && cells && (
            <Alert type="warning">
              최신 판정을 불러오지 못해 이전 판정 결과가 표시되고 있습니다. {loadError}
            </Alert>
          )}
          {/* 코드리뷰 M3: 조용한 셀 누락 방지. */}
          {unmatchedCount > 0 && (
            <Alert type="warning">
              셀 데이터 파일과 판정 결과 파일이 어긋나 {unmatchedCount}개 셀이 화면에서 빠졌습니다.
              구배 분석을 다시 실행하는 것을 권장합니다.
            </Alert>
          )}

          <div className={RESULT_GRID}>
            <section className="min-w-0">
              {cells ? (
                <SlopeHeatmapView
                  results={cells}
                  cellM={stats.cell_m}
                  drainPoints={drainPoints}
                  clickable={!busy && !judgeBusy && directionAware}
                  onDrainClick={handleDrainClick}
                />
              ) : (
                <p className={MUTED}>{loadError ?? '셀 데이터 로딩 중...'}</p>
              )}
            </section>
            <div className="min-w-0 md:sticky md:top-5 md:self-start">
              <SlopeVerdictPanel stats={stats} judge={judge} drainPoints={drainPoints} directionAware={directionAware} />
            </div>
          </div>

          <section className="flex flex-col gap-2">
            {/* 컨테이너 제목이 h2이므로 본문 소제목은 h3 */}
            <h3 className="text-base font-bold leading-5">셀별 결과표</h3>
            {cells ? (
              <SlopeResultTable
                results={cells}
                designPct={stats.threshold?.design_pct ?? null}
                dirPassDeg={stats.threshold?.dir_pass_deg ?? 180}
              />
            ) : (
              <p className={MUTED}>{loadError ?? '셀 데이터 로딩 중...'}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 11: `slope-verdict-panel.tsx` 교체(전체)** — 포맷 함수·분기·문구 그대로. 진행 배너 `StatusIndicator`, 실패 배너 `Alert error`, 편차 통계 `KeyValuePairs`, 경고 `Alert warning`.

```tsx
// 구배 판정 요약 + 재판정 진행 상태 (브리프 D5/D7/D8, 스펙 §5.4) - Cloudscape 리스킨(T7)
//
// 여기 나오는 pass_pct·re_pct·dir_pass_deg는 판정에 쓰이지 않는다 - 이미 엔진이
// 적용한 기준을 사용자에게 그대로 보여주는 텍스트일 뿐이다(평활도 VerdictPanel이
// applied_criteria.pass_mm/rework_mm을 그대로 찍는 것과 같은 관례). 이 파일
// 어디에서도 그 값들과 실측치를 비교하지 않는다(리트머스 통과).
import { warningLabel } from '@/lib/domain/labels';
import { Alert } from '@/components/ui/alert';
import { KeyValuePairs } from '@/components/ui/key-value';
import { StatusIndicator } from '@/components/ui/status-indicator';
import type { DrainPoint, JudgeInfo, SlopeStats } from '@/lib/domain/types';

const COUNT_ORDER = ['적합', '경계', '보수', '재시공', '판정불가'] as const;
const LABEL = 'text-sm font-bold';
const NOTE = 'text-xs leading-4 text-cs-text-secondary';
const HINT = 'text-xs leading-4 text-cs-warning';

function fmtDevPct(v: number | null | undefined): string {
  return v == null ? '판정 가능한 셀 없음' : `${v.toFixed(2)}%`;
}

function fmtDrainPoints(pts: DrainPoint[] | null | undefined): string {
  if (!pts || pts.length === 0) return '없음';
  return pts.map((p) => `(${p.x}, ${p.y})`).join(', ');
}

// stats.drain_points는 slope_judge_cells가 판정에 실제로 쓴 좌표를 [x,y] 쌍
// 배열로 echo한 것이다({x,y} 객체가 아니다 - engine/flatness/core/pipeline.py
// judge_slope_cells 참고). DrainPoint[]([{x,y}]) 형태의 drainPoints(현재 지정,
// 낙관적)와 별개다.
function fmtDrainPointPairs(pts: [number, number][] | null | undefined): string {
  if (!pts || pts.length === 0) return '없음';
  return pts.map(([x, y]) => `(${x}, ${y})`).join(', ');
}

function JudgeBanner({ judge }: { judge: JudgeInfo | null }) {
  if (!judge) return null;
  if (judge.state === 'processing' || judge.state === 'queued') {
    return (
      <StatusIndicator type="in-progress">
        재판정 {judge.state === 'processing' ? '진행 중' : '대기 중'}... 완료되면 화면이 자동으로 갱신됩니다.
      </StatusIndicator>
    );
  }
  if (judge.state === 'failed') {
    // 대시보드 계약(009): error는 state==='failed'일 때만 노출한다. 이전 판정
    // 결과(아래 요약·히트맵)는 analyses.status가 계속 'done'이므로 그대로 보인다.
    return (
      <Alert type="error" title="재판정에 실패했습니다. 이전 판정 결과가 표시되고 있습니다.">
        {judge.error && <p className="text-xs leading-4">사유: {judge.error}</p>}
      </Alert>
    );
  }
  return null;
}

export function SlopeVerdictPanel({ stats, judge, drainPoints, directionAware }: {
  stats: SlopeStats;
  judge: JudgeInfo | null;
  drainPoints: DrainPoint[];
  /** 코드리뷰(2차) I1: 방향 판정 대상이 아닌 기준이면 클릭 자체가 비활성화되므로
   * "지도에서 배수구 위치를 클릭하세요" 안내가 모순된다 - 문구를 갈라 낸다. */
  directionAware: boolean;
}) {
  const summary = stats.summary ?? ({} as SlopeStats['summary']);
  const counts = summary.counts ?? ({} as SlopeStats['summary']['counts']);
  const warnings = stats.warnings ?? [];
  const threshold = stats.threshold;

  return (
    <aside className="flex flex-col gap-4 rounded-cs-container border border-cs-divider bg-white p-5">
      <JudgeBanner judge={judge} />

      <div className="flex flex-col gap-1">
        <h3 className={LABEL}>판정 요약</h3>
        <p className="text-sm">
          {COUNT_ORDER.map((k) => `${k} ${counts[k] ?? 0}`).join(' · ')}
        </p>
        <p className={NOTE}>판정 가능 비율 {(summary.coverage_pct ?? 0).toFixed(1)}%</p>
      </div>

      <KeyValuePairs columns={2} items={[
        { label: '평균 편차', value: fmtDevPct(summary.mean_dev_pct) },
        { label: '편차 표준편차', value: fmtDevPct(summary.std_dev_pct) },
        { label: '최대 편차', value: fmtDevPct(summary.max_dev_pct) },
      ]} />

      <div className="flex flex-col gap-1">
        <h3 className={LABEL}>현재 배수구</h3>
        <p className="font-mono text-sm tabular-nums">{fmtDrainPoints(drainPoints)}</p>
        {/* 코드리뷰(2차) Minor: 재판정 실패 시 지도에는 거부된 새 배수구가 찍히는데
            히트맵·결과표는 옛 배수구 기준 판정을 보여준다 - "지금 보이는 판정이
            쓴 배수구"가 어디에도 없어 혼란스러웠다. stats.drain_points는 현재
            화면의 grade·히트맵을 낸 그 판정이 실제로 쓴 좌표다. */}
        <p className={NOTE}>
          이 판정에 사용됨: {fmtDrainPointPairs(stats.drain_points)}
        </p>
        {judge?.previous_drain_points && judge.previous_drain_points.length > 0 && (
          <p className={NOTE}>
            직전 배수구: {fmtDrainPoints(judge.previous_drain_points)}
          </p>
        )}
        {/* 코드리뷰(4차) N3: 조건을 !stats.direction_judged가 아니라
            !directionAware로 옮긴다. 예전 조건은 direction_judged가 이미 true인
            "오염된" 분석(방향 비대상 기준인데도 과거에 배수구를 클릭해 역구배·
            재시공이 노이즈로 찍혀버린 경우)에서는 아예 안 떴다 - I1이 신규
            클릭만 막을 뿐 기존 오탐을 알리지도 되돌리지도 못했다. directionAware
            기준으로 갈면 오염된 분석에서도 경고가 뜬다. */}
        {!directionAware ? (
          <p className={HINT}>
            이 기준은 방향(역구배)을 판정 대상으로 삼지 않습니다.
            {stats.direction_judged && (
              ' 그런데도 이 판정에는 방향 결과가 포함돼 있어 역구배·재시공 표시가 노이즈일 수 있습니다. '
              + '구배 분석을 다시 실행해(배수구 지정 없이) 재판정하는 것을 권장합니다.'
            )}
          </p>
        ) : !stats.direction_judged && (
          <p className={HINT}>
            배수구가 지정되지 않아 방향(역구배)은 판정하지 않았습니다. 지도에서 배수구 위치를 클릭하세요.
          </p>
        )}
      </div>

      {threshold && (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>적용 기준</h3>
          <p className={NOTE}>
            {threshold.use} · 설계 구배 {threshold.design_pct}% · 허용 {threshold.pass_pct}% ·
            {' '}재시공 {threshold.re_pct}% · 방향 허용 {threshold.dir_pass_deg}도
          </p>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className={LABEL}>경고</h3>
          <Alert type="warning">
            <ul className="flex flex-col gap-1 text-xs leading-4">
              {warnings.map((w) => <li key={w}>{warningLabel(w)}</li>)}
            </ul>
          </Alert>
        </div>
      )}

      <p className={NOTE}>
        구역별 통계는 후속 단계에서 제공됩니다. 위 통계는 전역(바닥 전체) 기준입니다.
      </p>
    </aside>
  );
}
```

- [ ] **Step 12: `slope-result-table.tsx` 교체(전체)** — 정렬·`directionDeviationLabel`·`correctionDirectionLabel` 배선 그대로. 등급은 `SLOPE_GRADE_TONE` → `StatusIndicator`(미지 문자열은 `unknown`=pending 폴백, M1 유지), 역구배·방향 편차는 `Badge`.

```tsx
// 셀별 결과표 (스펙 §7.2·§5.3): 구배 %, 설계 대비 편차, 보정 높이차(mm), 등급,
// 역구배 표시. 판정 로직은 없다 - joinSlopeCells가 이미 조인해 낸 grade·dev_pct·
// correction_mm을 그대로 표로 옮기고, 보정 방향 문구만 slope-direction.ts로
// 계산한다(임계값 비교 없음 - 리트머스 통과).
// Cloudscape 리스킨(T7): tableClass + StatusIndicator/Badge. 색은 SLOPE_GRADE_TONE(시스템 톤)으로만.
import { correctionDirectionLabel } from '@/lib/domain/slope-direction';
import { SLOPE_GRADE_TONE } from '@/lib/domain/grade-tone';
import { Badge } from '@/components/ui/badge';
import { tableClass } from '@/components/ui/data-table';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
import type { SlopeCellResult } from '@/lib/domain/slope-judged';

function fmtPct(v: number | null): string {
  return v === null ? '-' : `${v.toFixed(2)}%`;
}

// 코드리뷰(2차) I2: dir_err_deg가 dir_pass_deg를 넘는(그러나 90도는 안 넘는,
// 즉 reverse가 아닌) 셀은 방향 결함이 있는데도 보정란이 크기 기준 문구만
// 내서 편차가 작으면 "0.0mm"에 가깝게 보여 드러나지 않는다. 역구배 배지와는
// 별도로 방향 편차를 명시한다.
//
// ★ 리트머스 대상이 아니다: 이 함수는 grade를 계산하지 않는다(grade는 이미
// joinSlopeCells가 엔진 judged 파일에서 그대로 가져온 값이고 여기서 절대
// 바뀌지 않는다). dir_pass_deg는 오직 "이 숫자를 하이라이트로 보여줄지"를
// 정하는 표시 조건으로만 쓰인다 - 등급표 어디에도 pass/fail을 새로 정하지
// 않는다(reverse 셀은 이미 별도 배지가 있으므로 여기서 제외해 중복 강조를
// 피한다).
function directionDeviationLabel(dirErrDeg: number | null, dirPassDeg: number, reverse: boolean): string | null {
  if (reverse || dirErrDeg === null || dirErrDeg <= dirPassDeg) return null;
  return `${dirErrDeg.toFixed(1)}도(허용 ${dirPassDeg}도 초과)`;
}

export function SlopeResultTable({ results, designPct, dirPassDeg }: {
  results: SlopeCellResult[];
  // 코드리뷰(2차) Minor: threshold 결측 시 `?? 0`으로 채워 넘기지 않는다 -
  // correctionDirectionLabel이 null을 받으면 방향을 추측하지 않고 '-'를 낸다.
  designPct: number | null;
  dirPassDeg: number;
}) {
  const rows = [...results].sort((a, b) => (
    a.cell.cy - b.cell.cy || a.cell.cx - b.cell.cx
  ));

  return (
    <div className="overflow-x-auto rounded-lg border border-cs-divider bg-white">
      <table className={tableClass.table}>
        <thead className={tableClass.thead}>
          <tr>
            <th className={tableClass.th}>위치(cx,cy)</th>
            <th className={tableClass.thNum}>구배(%)</th>
            <th className={tableClass.thNum}>설계 대비 편차(%)</th>
            <th className={tableClass.th}>보정</th>
            <th className={tableClass.th}>등급</th>
            <th className={tableClass.th}>역구배 여부</th>
            <th className={tableClass.th}>방향 편차</th>
            <th className={tableClass.th}>사유</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const correction = correctionDirectionLabel(r.cell, r.correction_mm, designPct, r.reverse);
            const dirDeviation = directionDeviationLabel(r.dir_err_deg, dirPassDeg, r.reverse);
            return (
              <tr key={`${r.cell.cx},${r.cell.cy}`} className={tableClass.row}>
                <td className={`${tableClass.td} font-mono font-bold tabular-nums`}>({r.cell.cx}, {r.cell.cy})</td>
                <td className={tableClass.tdNum}>{fmtPct(r.cell.slope_pct)}</td>
                <td className={tableClass.tdNum}>{fmtPct(r.dev_pct)}</td>
                <td className={tableClass.td}>{correction ?? '-'}</td>
                <td className={tableClass.td}>
                  {/* 코드리뷰 M1: jsonb는 무결성을 보장하지 않는다 - grade가 알 수 없는
                      문자열이어도 표시가 안 보이는 조용한 오표시 대신 판정불가(pending)로
                      강제한다(slopeCellFillColor의 ok=false 강제와 같은 관례). */}
                  <StatusIndicator type={TONE_STATUS[SLOPE_GRADE_TONE[r.grade] ?? 'unknown']}>
                    {r.grade}
                  </StatusIndicator>
                </td>
                <td className={tableClass.td}>
                  {/* 색만으로는 안 드러나므로(스펙 §7.2) 별도 배지로 표시한다 */}
                  {r.reverse && <Badge tone="fail">역구배</Badge>}
                </td>
                <td className={tableClass.td}>
                  {dirDeviation && <Badge tone="warn">{dirDeviation}</Badge>}
                </td>
                <td className={`${tableClass.td} text-xs text-cs-text-secondary`}>{r.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 13: `slope-heatmap-view.tsx` — `return (` 블록만 교체** — 1~79행(헤더 주석·상수·`useMemo`·`useEffect`·`onClick`)은 무변경. `DRAIN_COLOR`·`SLOPE_GRADE_COLOR` hex는 캔버스와 범례가 공유하므로 그대로(엔진 PNG와 같은 색).

```tsx
// (old)
  return (
    <div className="space-y-3">
      {bounds ? (
        <canvas ref={canvasRef} onClick={onClick}
          className={`max-w-full rounded border bg-white ${clickable ? 'cursor-crosshair' : 'cursor-not-allowed opacity-90'}`} />
      ) : (
        <p className="text-sm text-zinc-500">표시할 셀 데이터가 없습니다.</p>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {LEGEND.map((g) => (
          <span key={g} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: SLOPE_GRADE_COLOR[g] }} />
            {g}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: DRAIN_COLOR }} />
          배수구
        </span>
        {/* 코드리뷰(2차) Minor: 엔진 PNG 제목에는 화살표 의미가 적혀 있는데
            Canvas 범례에는 없었다 - 화살표를 오르막으로 오독하면 판정 근거를
            정반대로 이해하게 된다. */}
        <span className="text-zinc-400">얇은 화살표 = 내리막(물이 흐르는) 방향</span>
        <span className="text-zinc-400">굵은 화살표 = 역구배(물이 배수구 반대로 흐름)</span>
      </div>
    </div>
  );
}
```
```tsx
// (new)
  return (
    <div className="flex flex-col gap-3">
      {bounds ? (
        <canvas ref={canvasRef} onClick={onClick}
          className={`max-w-full rounded-lg border border-cs-divider bg-white ${clickable ? 'cursor-crosshair' : 'cursor-not-allowed opacity-90'}`} />
      ) : (
        <p className="text-sm text-cs-text-secondary">표시할 셀 데이터가 없습니다.</p>
      )}
      {/* 범례: 12px 사각 스와치 = SLOPE_GRADE_COLOR hex(캔버스·엔진 PNG와 같은 색) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-4">
        {LEGEND.map((g) => (
          <span key={g} className="inline-flex items-center gap-1">
            <span aria-hidden data-grade={g} className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: SLOPE_GRADE_COLOR[g] }} />
            {g}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span aria-hidden data-legend="drain" className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: DRAIN_COLOR }} />
          배수구
        </span>
        {/* 코드리뷰(2차) Minor: 엔진 PNG 제목에는 화살표 의미가 적혀 있는데
            Canvas 범례에는 없었다 - 화살표를 오르막으로 오독하면 판정 근거를
            정반대로 이해하게 된다. */}
        <span className="text-cs-text-secondary">얇은 화살표 = 내리막(물이 흐르는) 방향</span>
        <span className="text-cs-text-secondary">굵은 화살표 = 역구배(물이 배수구 반대로 흐름)</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 14: 통과 확인** — `cd dashboard && npx vitest run` → 전체 PASS(analysis 9파일 + grade-tone). `npx tsc --noEmit -p .` → 0 에러. 잔재 스윕: `grep -rnE "zinc-|amber-|red-|green-|emerald-|purple-|blue-" components/analysis lib/domain/grade-tone.ts --include=*.ts --include=*.tsx | grep -v __tests__` → 0건(`GRADE_COLOR`·`SLOPE_GRADE_COLOR`·`DRAIN_COLOR`의 hex 문자열은 클래스가 아니므로 무관). `app/scans/[id]/__tests__/page.test.tsx`는 `findAll(el, AnalysisResult)` 엘리먼트 트리 탐색이라 내부 마크업 변경에 영향받지 않는다 — 그래도 전체 실행 결과에서 PASS를 눈으로 확인한다. dev server(`/scans/<done 스캔 id>`)에서 `ScanDone.dc.html`과 나란히 캡처 대조: 탭 줄, 3:2 그리드, 판정 패널의 순서(헤드라인 → 수치 → 분포 바 → 기준 → 경고 → 종합의견 → 저장), 결과표. 콘솔 오류 0.

- [ ] **Step 15: 커밋**

```bash
git add dashboard/components/analysis dashboard/lib/domain/grade-tone.ts dashboard/lib/domain/__tests__/grade-tone.test.ts
git commit -m "refactor(dashboard): 분석 결과 컴포넌트(평활도·구배) Cloudscape 리스킨 - TabBar·StatusIndicator·KeyValuePairs·Alert·tableClass

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 보고서(목록·생성·상세)

**Files:**
- Create: `dashboard/components/report-table.tsx`(client - 목록 도구 줄 + 테이블), `dashboard/components/__tests__/report-table.test.tsx`
- Modify: `dashboard/app/reports/page.tsx`, `dashboard/app/reports/new/page.tsx`, `dashboard/app/reports/[id]/page.tsx`, `dashboard/components/report/report-actions.tsx`, `dashboard/components/report/report-create-form.tsx`, `dashboard/components/report/report-delete-button.tsx`, `dashboard/components/report/report-location-picker.tsx`, `dashboard/components/report/report-progress.tsx`, `dashboard/components/ui/icons.tsx`(`refresh` 아이콘 1개 추가)
- Test: `dashboard/app/reports/__tests__/page.test.tsx`, `dashboard/app/reports/new/__tests__/page.test.tsx`, `dashboard/app/reports/[id]/__tests__/page.test.tsx`, `dashboard/components/report/__tests__/report-actions.test.tsx`, `report-create-form.test.tsx`, `report-delete-button.test.tsx`, `report-location-picker.test.tsx`, `report-progress.test.tsx`(모두 갱신)
- 무변경(참고만): `dashboard/lib/domain/reports.ts`(`reportStatusBadge`·`canFinalize`·`canRegenerate`·`deleteConfirmText`·`buildDraftOpinion`), `dashboard/lib/domain/labels.ts`, `dashboard/lib/domain/paths.ts`(`dataUrl`), `dashboard/lib/hooks/use-row-status.ts`, `dashboard/app/reports/loading.tsx`(T11이 `PAGE_MAIN`으로 맞춘다), `dashboard/components/supabase-error.tsx`(T11)

**Interfaces:**
- Consumes:
  - T1: `<Icon name={IconName} size?={16} className? />`(`data-icon={name}`) - 이 태스크는 `'plus' | 'search' | 'download'`와 이 태스크가 추가하는 `'refresh'`를 쓴다. 토큰 클래스 `text-cs-*`/`bg-cs-*`/`border-cs-*`, `rounded-cs-container`(→ `rounded-b-cs-container`도 같은 `--radius-cs-container`에서 나온다), `font-mono`.
  - T2: `PAGE_MAIN`, `Button({variant?, ...button props})`, `LinkButton({href, variant?, ...})`, `buttonClass(variant?, opts?)`, `<Container title? counter? description? actions? padded?=true className?>`, `<FormField label htmlFor? description? error?>`, `inputClass`, `selectClass`, `<SelectWrap className?>`, `textareaClass`, `checkClass`, `<StatusIndicator type>`(`data-status={type}`), `TONE_STATUS`, `<PageHeader crumbs? title description? actions? />`, `tableClass = {table, thead, th, thNum, td, tdNum, row, link}`, `<TableToolbar>`, `<Alert type title? className?>`(`data-alert={type}`), `<EmptyState message actionHref actionLabel />`.
  - 소스 기존: `reportStatusBadge(report): { tone: 'pass'|'fail'|'unknown'; label }`, `canFinalize`, `canRegenerate`, `deleteConfirmText`, `REPORT_STATUS_LABEL`(`{ draft: '작성 중', finalized: '발행됨' }` - 상태 필터가 unknown tone을 '작성 중'/'PDF 생성 중·대기'로 가르는 기준), `REPORT_GEN_STATUS_LABEL`, `ANALYSIS_KIND_LABEL`, `SURFACE_LABEL`, `GRADE_LABEL`, `dataUrl`, `enqueueJob`, `useRowStatus`.
- Produces:
  - `components/report-table.tsx`: `export type ReportTone = 'pass' | 'fail' | 'unknown'`(= `reportStatusBadge`의 tone 집합), `export interface ReportTableRow { id: string; title: string; locationLabel: string; tone: ReportTone; statusLabel: string; createdAt: string }`, `export type ReportFilter = 'all' | 'draft' | 'finalized' | 'failed' | 'generating'`(도구 줄 상태 필터 - T3 `VerdictFilter`와 같은 자리), `export function ReportTable({ rows, locationFilter }: { rows: ReportTableRow[]; locationFilter?: string | null })`.
  - `components/ui/icons.tsx`: `IconName`에 `'refresh'` 추가(ReportDetail 아트보드의 'PDF 다시 생성' 아이콘). 이후 태스크(T6 재분석 버튼 등)가 같은 이름을 쓰면 여기 것을 재사용한다.

- [ ] **Step 1: 아트보드 확인** — `docs/design/cloudscape/Reports.dc.html`·`ReportNew.dc.html`·`ReportDetail.dc.html`을 열어(브라우저 또는 Read) 아래 구조를 옮긴다. 옮길 섹션:
  - Reports: 브레드크럼 `현장 › 보고서` → h1 `보고서` → 컨테이너 헤더 `보고서 (6)` + 우측 primary `+ 새 보고서` → 테이블 4열(제목 링크 700 파랑 · 측정위치 · 상태 StatusIndicator(작성 중=minus-circle 보조색, PDF 생성 중=clock, PDF 생성 대기 중=minus-circle, 발행됨=check-circle success, 생성 실패=x-circle error) · 생성일 mono 13px `#414d5c`). 도구 줄은 아트보드에 없지만 스펙 §7-3이 "홈·보고서 목록의 검색 입력과 판정 필터"를 클라이언트 필터로 넣기로 정했다 - T3 `SiteTable`의 도구 줄과 같은 구조로 검색 입력(360px, placeholder `보고서 검색`, search 아이콘) + 상태 필터 셀렉트(`SelectWrap` w-44, `aria-label="상태 필터"`, 옵션 `전체 · 작성 중 · 발행됨 · 생성 실패 · PDF 생성 중·대기` - `reportStatusBadge`가 낼 수 있는 상태를 그대로 나열, 검색과 AND) + 우측 건수 텍스트. 페이지네이션은 넣지 않는다.
  - ReportNew: 브레드크럼 `현장 › 현장명 › 측정위치` → h1 `보고서 생성` + 설명(측정위치 라벨, 보조색) → 컨테이너(헤더 없음, padding 20, 필드 gap 16): `보고서 제목` 입력 / `포함할 분석` 라벨 + 12px 설명 + 1px `cs-divider` 라운드 8 목록(행 padding 12px 16px, 행 사이 1px 구분, 체크박스 + 문구; 차단 행은 `cs-disabled` 글자 + 아래 warning Alert) / `종합의견` 라벨 + 설명 + textarea(min-height 96) → 컨테이너 밖 우측 정렬 primary `보고서 생성`.
  - ReportDetail: 브레드크럼 3단 → h1 제목 + 아래 StatusIndicator(작성 중) → 우측 액션 `삭제`(normal) · `PDF 다운로드`(normal, download 아이콘) · `PDF 다시 생성`(normal, refresh 아이콘) · `발행`(primary) → 컨테이너 `포함 분석 (2)` 행 44px padding 0 20px 링크 700 파랑, 행 사이 1px 구분 → 컨테이너 `PDF 미리보기`(iframe 자리).
  이 태스크는 새 Next.js API를 쓰지 않는다(`next/link`·`next/navigation` 기존 사용 그대로) - `dashboard/node_modules/next/dist/docs/`는 `link` 가이드만 훑어 `<Link className>`가 관례와 맞는지 확인한다.

- [ ] **Step 2: 실패하는 테스트 작성/갱신**

`components/__tests__/report-table.test.tsx` — 신규, 전체:

```tsx
// ReportTable(T8, 클라이언트 섬 - 스펙 §7-3): 서버가 이미 조회한 rows를 제목 includes 검색과
// 상태 필터(AND)로 거르고, ?location= 필터는 서버가 이미 건 것을 "무엇으로 걸렸는지"만 보여준다
// (서버 조회·URL 변경 없음). 상태 열은 StatusIndicator의 data-status로 읽는다(스타일이 아니라
// 의미 속성). 도구 줄 구조·테스트 형식은 T3 site-table.test.tsx를 본떴다.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ReportTable, type ReportTableRow } from '../report-table';

const rows: ReportTableRow[] = [
  { id: 'r1', title: '거실 평활도 보고서', locationLabel: '101동 / 3층 / 거실', tone: 'unknown', statusLabel: '작성 중', createdAt: '2026-09-03' },
  { id: 'r2', title: '안방 구배 보고서', locationLabel: '101동 / 3층 / 안방', tone: 'pass', statusLabel: '발행됨', createdAt: '2026-09-01' },
  { id: 'r3', title: '거실 구배 보고서', locationLabel: '102동 / 5층 / 거실', tone: 'fail', statusLabel: '생성 실패', createdAt: '2026-08-30' },
];

// 상태 필터용 픽스처 - reportStatusBadge가 낼 수 있는 상태 5종(작성 중·발행됨·생성 실패·PDF 생성 중·
// PDF 생성 대기 중)이 한 번씩 나온다. 뒤의 두 행은 tone이 'unknown'으로 '작성 중'과 같다 - 라벨로만 갈린다.
const statusRows: ReportTableRow[] = [
  ...rows,
  { id: 'r4', title: '복도 평활도 보고서', locationLabel: '102동 / 5층 / 복도', tone: 'unknown', statusLabel: 'PDF 생성 중', createdAt: '2026-08-28' },
  { id: 'r5', title: '주방 구배 보고서', locationLabel: '103동 / 1층 / 주방', tone: 'unknown', statusLabel: 'PDF 생성 대기 중', createdAt: '2026-08-27' },
];

// 상태 열은 테이블 안에서 찾는다 - 상태 필터의 <option> 문구('작성 중' 등)가 같은 텍스트라
// screen.getByText로는 둘이 잡힌다.
function statusCell(label: string) {
  return within(screen.getByRole('table')).getByText(label);
}
// 지금 보이는 행의 제목(첫 열 링크) 목록 - 도구 줄의 '전체 보기' 링크는 테이블 밖이라 섞이지 않는다
function reportTitles(): string[] {
  return within(screen.getByRole('table')).queryAllByRole('link').map((l) => l.textContent ?? '');
}
function search(text: string) {
  fireEvent.change(screen.getByRole('textbox', { name: '보고서 검색' }), { target: { value: text } });
}
// 옵션 라벨(화면 문구)로 고른다 - 값 문자열이 아니라 사용자가 보는 텍스트가 계약이다
function pickFilter(label: string) {
  const value = (screen.getByRole('option', { name: label }) as HTMLOptionElement).value;
  fireEvent.change(screen.getByRole('combobox', { name: '상태 필터' }), { target: { value } });
}

describe('ReportTable 열 (아트보드 Reports: 제목·측정위치·상태·생성일)', () => {
  it('제목 링크(cs-link)·측정위치·생성일(mono)을 그리고 건수를 보여준다', () => {
    render(<ReportTable rows={rows} />);
    const link = screen.getByRole('link', { name: '거실 평활도 보고서' });
    expect(link).toHaveAttribute('href', '/reports/r1');
    expect(link.className).toContain('text-cs-link');
    expect(screen.getByText('101동 / 3층 / 거실')).toBeInTheDocument();
    expect(screen.getByText('2026-09-03').className).toContain('font-mono');
    expect(screen.getByText('총 3건')).toBeInTheDocument();
  });

  it.each([
    { label: '작성 중', status: 'pending' },
    { label: '발행됨', status: 'success' },
    { label: '생성 실패', status: 'error' },
  ])('상태 "$label"은 StatusIndicator $status 로 그린다(reportStatusBadge tone → TONE_STATUS)', ({ label, status }) => {
    render(<ReportTable rows={rows} />);
    expect(statusCell(label)).toHaveAttribute('data-status', status);
  });
});

describe('ReportTable 검색 (클라이언트 필터)', () => {
  it('제목 includes로 행을 거르고 건수도 따라간다', () => {
    render(<ReportTable rows={rows} />);
    fireEvent.change(screen.getByLabelText('보고서 검색'), { target: { value: '구배' } });
    expect(screen.queryByRole('link', { name: '거실 평활도 보고서' })).toBeNull();
    expect(screen.getByRole('link', { name: '안방 구배 보고서' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '거실 구배 보고서' })).toBeInTheDocument();
    expect(screen.getByText('총 2건')).toBeInTheDocument();
  });

  it('검색어를 지우면 전체 행이 돌아온다', () => {
    render(<ReportTable rows={rows} />);
    const input = screen.getByLabelText('보고서 검색');
    fireEvent.change(input, { target: { value: '안방' } });
    expect(screen.getAllByRole('row')).toHaveLength(2); // 헤더 1 + 본문 1
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('아무 행도 남지 않으면 안내 행을 그린다', () => {
    render(<ReportTable rows={rows} />);
    fireEvent.change(screen.getByLabelText('보고서 검색'), { target: { value: '없는 제목' } });
    expect(screen.getByText('조건에 맞는 보고서가 없습니다')).toBeInTheDocument();
    expect(screen.getByText('총 0건')).toBeInTheDocument();
  });
});

describe('ReportTable 상태 필터 (클라이언트 필터 - 스펙 §7-3, 검색과 AND)', () => {
  it('상태 필터 5종(전체·작성 중·발행됨·생성 실패·PDF 생성 중·대기)을 SelectWrap(chevron)으로 그리고, 처음은 전체다', () => {
    const { container } = render(<ReportTable rows={statusRows} />);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '전체', '작성 중', '발행됨', '생성 실패', 'PDF 생성 중·대기',
    ]);
    const select = screen.getByRole('combobox', { name: '상태 필터' });
    expect(select.className).toContain('border-cs-input-border');
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
    expect(reportTitles()).toHaveLength(5);
    expect(screen.getByText('총 5건')).toBeInTheDocument();
  });

  it.each([
    { label: '작성 중', expected: ['거실 평활도 보고서'] },
    { label: '발행됨', expected: ['안방 구배 보고서'] },
    { label: '생성 실패', expected: ['거실 구배 보고서'] },
    { label: 'PDF 생성 중·대기', expected: ['복도 평활도 보고서', '주방 구배 보고서'] },
  ])('상태 필터 "$label"', ({ label, expected }) => {
    render(<ReportTable rows={statusRows} />);
    pickFilter(label);
    expect(reportTitles()).toEqual(expected);
    expect(screen.getByText(`총 ${expected.length}건`)).toBeInTheDocument();
  });

  it('검색과 필터는 AND로 겹치고, "전체"로 되돌리면 검색만 남는다', () => {
    render(<ReportTable rows={statusRows} />);
    search('구배');
    pickFilter('생성 실패');
    expect(reportTitles()).toEqual(['거실 구배 보고서']);
    expect(screen.getByText('총 1건')).toBeInTheDocument();
    pickFilter('전체');
    expect(reportTitles()).toEqual(['안방 구배 보고서', '거실 구배 보고서', '주방 구배 보고서']);
    expect(screen.getByText('총 3건')).toBeInTheDocument();
  });

  it('필터만으로 행이 남지 않아도 같은 안내 행을 그린다', () => {
    render(<ReportTable rows={[rows[1]]} />); // 발행됨 하나뿐
    pickFilter('생성 실패');
    expect(screen.getByText('조건에 맞는 보고서가 없습니다')).toBeInTheDocument();
    expect(reportTitles()).toEqual([]);
    expect(screen.getByText('총 0건')).toBeInTheDocument();
  });
});

describe('ReportTable 측정위치 필터 표시 (?location= 은 서버가 이미 걸었다)', () => {
  it('location 필터가 있으면 라벨과 전체 보기 링크(/reports)를 보여준다', () => {
    render(<ReportTable rows={[rows[0]]} locationFilter="101동 / 3층 / 거실" />);
    expect(screen.getByText('측정위치: 101동 / 3층 / 거실')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '전체 보기' })).toHaveAttribute('href', '/reports');
  });

  it('location 필터가 없으면 전체 보기 링크도 라벨도 없다', () => {
    render(<ReportTable rows={rows} />);
    expect(screen.queryByRole('link', { name: '전체 보기' })).toBeNull();
    expect(screen.queryByText(/^측정위치:/)).toBeNull();
  });
});
```

`app/reports/__tests__/page.test.tsx` — 파일 머리 주석(1~3행)과 바로 아래 testing-library import(5행)를 다음으로 교체:

```tsx
// (old)
// D7 Step 2: 목록의 "새 보고서" 버튼 상시 노출 + 빈 목록 EmptyState + tableClass
// 전환을 검증한다. 서버 컴포넌트 함수를 직접 호출해 렌더된 트리를 확인한다
// (app/reports/new/__tests__/page.test.tsx와 같은 방식).
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
```
```tsx
// (new)
// D7 Step 2: 목록의 "새 보고서" 버튼 상시 노출 + 빈 목록 EmptyState + ReportTable(T8)
// 전환을 검증한다. 서버 컴포넌트 함수를 직접 호출해 렌더된 트리를 확인한다
// (app/reports/new/__tests__/page.test.tsx와 같은 방식). ReportTable은 클라이언트
// 컴포넌트지만 render()가 그대로 실행하므로 도구 줄·상태 열까지 이 트리에서 보인다.
// 상태 열은 within(table)로 찾는다 - 도구 줄 상태 필터의 <option> 문구가 같은 텍스트다.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
```

같은 파일의 마지막 describe(`'ReportsPage 목록 테이블 (D7 Step 2: 제목 | 측정위치 | 상태 Badge | 생성일)'`) 전체를 다음으로 교체:

```tsx
describe('ReportsPage 목록 테이블 (D7 Step 2 → T8: 제목 | 측정위치 | 상태 StatusIndicator | 생성일)', () => {
  it('브레드크럼 현장 › 보고서와 컨테이너 카운터를 그린다', async () => {
    mockSupabase([reportRow()], [locationRow]);
    await renderPage();
    expect(screen.getByRole('link', { name: '현장' })).toHaveAttribute('href', '/');
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toContain('보고서(1)');
  });

  it('제목·측정위치·생성일을 보여주고 제목이 상세로 링크한다', async () => {
    mockSupabase([reportRow()], [locationRow]);
    await renderPage();
    expect(screen.getByRole('link', { name: '보고서1' })).toHaveAttribute('href', '/reports/r1');
    expect(screen.getByText('101동 / 3층 / 거실')).toBeInTheDocument();
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
  });

  it('발행된 보고서는 발행됨(success) 상태로 보여준다', async () => {
    mockSupabase([reportRow({ status: 'finalized' })], [locationRow]);
    await renderPage();
    expect(within(screen.getByRole('table')).getByText('발행됨')).toHaveAttribute('data-status', 'success');
  });

  it('PDF 생성에 실패한 초안은 생성 실패(error) 상태로 보여준다', async () => {
    mockSupabase([reportRow({ gen_status: 'failed' })], [locationRow]);
    await renderPage();
    expect(within(screen.getByRole('table')).getByText('생성 실패')).toHaveAttribute('data-status', 'error');
  });

  it('도구 줄에 검색 입력과 상태 필터(5종)가 있다(스펙 §7-3 - 서버 조회에는 관여하지 않는다)', async () => {
    mockSupabase([reportRow()], [locationRow]);
    await renderPage();
    expect(screen.getByRole('textbox', { name: '보고서 검색' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '상태 필터' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(5);
  });

  it('location 필터가 걸린 목록은 도구 줄에 측정위치 라벨과 전체 보기 링크를 보여준다', async () => {
    mockSupabase([reportRow()], [locationRow]);
    await renderPage({ location: 'l1' });
    expect(screen.getByText('측정위치: 101동 / 3층 / 거실')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '전체 보기' })).toHaveAttribute('href', '/reports');
  });
});
```

`app/reports/new/__tests__/page.test.tsx` — `'location 파라미터가 없으면 측정위치 선택 UI를 먼저 보여준다'` it의 끝부분을 교체:

```tsx
    // (old)
    const el = await NewReportPage({ searchParams: Promise.resolve({}) });
    render(el as ReactElement);
    expect(screen.getByLabelText('측정위치')).toBeInTheDocument();
    // 후보 로드 폼은 아직 그려지지 않는다 - location을 고르기 전이라 후보를 알 수 없다
    expect(formProps.current).toBeNull();
  });
```
```tsx
    // (new)
    const el = await NewReportPage({ searchParams: Promise.resolve({}) });
    render(el as ReactElement);
    expect(screen.getByLabelText('측정위치')).toBeInTheDocument();
    // T8: 셀렉트는 '측정위치 선택' 컨테이너 안에 있고, 안내 문구는 그 컨테이너의 설명이다
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toContain('측정위치 선택');
    expect(screen.getByText('보고서를 만들 측정위치를 먼저 선택하세요.')).toBeInTheDocument();
    // 후보 로드 폼은 아직 그려지지 않는다 - location을 고르기 전이라 후보를 알 수 없다
    expect(formProps.current).toBeNull();
  });
```

같은 파일의 `describe('NewReportPage location-있는 경로 브레드크럼 (D8 이월)')` 안 it의 끝부분을 교체하고, describe 하나를 추가:

```tsx
    // (old)
    // 크럼 마지막 단계(측정위치 라벨)는 링크가 아니다 - 현재 화면 자신이라 href가 없다.
    expect(within(nav).getByText('1층')).toBeInTheDocument();
  });
});
```
```tsx
    // (new)
    // 크럼 마지막 단계(측정위치 라벨)는 링크가 아니다 - 현재 화면 자신이라 href가 없다.
    expect(within(nav).getByText('1층')).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: '1층' })).toBeNull();
    // T8: 측정위치 라벨은 h1 아래 설명으로 한 번 더 보인다(ReportNew 아트보드) - h1은 '보고서 생성'
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('보고서 생성');
  });
});

// T8: 완료된 분석이 0건인 측정위치는 폼 대신 info Alert + 업로드 링크(막다른 화면 금지)를
// '보고서 생성' 컨테이너 안에 보여준다. 문구·링크는 리디자인 전과 같다.
describe('NewReportPage 후보 0건 (T8: info Alert)', () => {
  beforeEach(() => { formProps.current = null; });

  it('안내 문구를 info Alert로 보여주고 업로드 화면으로 링크한다', async () => {
    await renderPage([]);
    const notice = screen.getByText(/이 측정위치에는 완료된 분석이 없습니다/);
    expect(notice.closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
    expect(screen.getByRole('link', { name: '스캔 업로드' })).toHaveAttribute('href', '/upload?location=l1');
    expect(formProps.current).toBeNull();
  });
});
```

`app/reports/[id]/__tests__/page.test.tsx` — 파일 머리 주석 1행의 `StatusDot 상태`를 `StatusIndicator 상태(T8)`로 바꾸고, `describe('ReportPage 상태 배지 (D7 Step 3: reportStatusBadge 재사용)')` 전체를 다음으로 교체:

```tsx
describe('ReportPage 상태 표시 (D7 Step 3: reportStatusBadge 재사용 → T8 StatusIndicator)', () => {
  it('초안 + 생성 완료는 작성 중(pending)으로 표시한다', async () => {
    await renderPage(reportRow({ status: 'draft', gen_status: 'done' }));
    expect(screen.getByText('작성 중')).toHaveAttribute('data-status', 'pending');
  });

  it('발행본은 발행됨(success)으로 표시한다', async () => {
    await renderPage(reportRow({ status: 'finalized' }));
    expect(screen.getByText('발행됨')).toHaveAttribute('data-status', 'success');
  });
});
```

같은 파일의 `describe('ReportPage 포함 분석 링크 …')`를 다음으로 교체(기존 it 유지 + 카운터·미리보기 it 추가):

```tsx
describe('ReportPage 포함 분석 링크 (D7 참고: /scans/[scanId]?analysis=[id]로 단축)', () => {
  it('/analyses/[id]가 아니라 스캔 작업대로 바로 링크한다', async () => {
    await renderPage();
    const a = screen.getByRole('link', { name: /바닥.*2026-07-20.*판정/ });
    expect(a).toHaveAttribute('href', '/scans/sc1?analysis=a1');
  });

  it("'포함 분석' 컨테이너가 건수를 카운터로 보여준다(T8)", async () => {
    await renderPage();
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toContain('포함 분석(1)');
  });
});

describe('ReportPage PDF 미리보기 (T8: 컨테이너 안 iframe)', () => {
  it('PDF가 있고 생성 완료면 iframe을 그린다', async () => {
    await renderPage();
    expect(screen.getByTitle('보고서 PDF 미리보기')).toHaveAttribute('src', '/api/data/reports/r1/report.pdf');
  });

  it('PDF가 없으면 안내 문구를 보여준다', async () => {
    await renderPage(reportRow({ pdf_path: null, gen_status: 'processing' }));
    expect(screen.getByText('PDF가 아직 생성되지 않았습니다.')).toBeInTheDocument();
    expect(screen.queryByTitle('보고서 PDF 미리보기')).toBeNull();
  });
});
```

`components/report/__tests__/report-actions.test.tsx` — `'발행 실패(트리거 거부)는 사유를 그대로 보여준다'` it의 마지막 두 줄을 교체하고, describe 끝에 it 두 개 추가:

```tsx
    // (old)
    fireEvent.click(screen.getByRole('button', { name: '발행' }));
    expect(await screen.findByText(/발행할 수 없습니다/)).toBeInTheDocument();
  });
```
```tsx
    // (new)
    fireEvent.click(screen.getByRole('button', { name: '발행' }));
    const msg = await screen.findByText(/발행할 수 없습니다/);
    expect(msg.closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
  });
```
```tsx
  // (추가 - describe 마지막 it 뒤)
  it('발행만 primary이고 다운로드·재생성은 normal 알약이다(뷰당 primary 1개)', () => {
    // gen_status failed + pdf_path 있음: 다운로드·재생성은 있고 발행은 없다
    render(<ReportActions report={{ ...doneDraft, gen_status: 'failed' }} />);
    const download = screen.getByRole('link', { name: 'PDF 다운로드' });
    expect(download).toHaveAttribute('download');
    expect(download.className).toContain('rounded-full');
    expect(download.className).not.toContain('bg-cs-link');
    const regen = screen.getByRole('button', { name: 'PDF 다시 생성' });
    expect(regen.className).toContain('border-cs-link');
    expect(regen.className).not.toContain('bg-cs-link');
  });

  it('발행 버튼은 primary(파랑 채움)다', () => {
    render(<ReportActions report={doneDraft} />);
    expect(screen.getByRole('button', { name: '발행' }).className).toContain('bg-cs-link');
  });
```

`components/report/__tests__/report-create-form.test.tsx` — 첫 describe(`'ReportCreateForm'`)의 `'선택한 분석이 없으면 안내만 하고 삽입하지 않는다'` it을 교체하고 it 하나 추가:

```tsx
  // (old)
  it('선택한 분석이 없으면 안내만 하고 삽입하지 않는다', async () => {
    renderForm();
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    expect(await screen.findByText(/1개 이상 선택/)).toBeInTheDocument();
    expect(state.inserted).toBeNull();
  });
```
```tsx
  // (new)
  it('선택한 분석이 없으면 error Alert로 안내만 하고 삽입하지 않는다', async () => {
    renderForm();
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: '보고서 생성' }));
    const msg = await screen.findByText(/1개 이상 선택/);
    expect(msg.closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(state.inserted).toBeNull();
  });

  it('보고서 생성 버튼은 이 화면의 유일한 primary이고, 체크박스는 accent 색을 쓴다(T8)', () => {
    renderForm();
    expect(screen.getByRole('button', { name: '보고서 생성' }).className).toContain('bg-cs-link');
    for (const box of screen.getAllByRole('checkbox')) expect(box.className).toContain('accent-cs-link');
  });
```

같은 파일 두 번째 describe의 `'선택 불가 사유가 있는 후보는 체크박스가 비활성이고 사유를 보여준다'` it 끝을 교체:

```tsx
    // (old)
    expect(boxes[1].disabled).toBe(true);
    expect(screen.getByText(reason)).toBeInTheDocument();
  });
```
```tsx
    // (new)
    expect(boxes[1].disabled).toBe(true);
    // T8: 사유는 그 행 아래 warning Alert로 보인다(ReportNew 아트보드)
    expect(screen.getByText(reason).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
  });
```

`components/report/__tests__/report-delete-button.test.tsx` — 첫 it을 교체:

```tsx
  // (old)
  it('첫 클릭에는 지우지 않고 확인 단계를 보여준다', () => {
    const spy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(screen.getByText(/삭제할까요/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
```
```tsx
  // (new)
  it('첫 클릭에는 지우지 않고 확인 단계(error Alert)를 보여준다', () => {
    const spy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    // T8: 삭제 버튼은 normal 알약(primary는 상세 화면의 발행뿐)
    expect(screen.getByRole('button', { name: '삭제' }).className).toContain('border-cs-link');
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(screen.getByText(/삭제할까요/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.getByRole('button', { name: '삭제 확인' }).className).not.toContain('bg-cs-link');
    expect(spy).not.toHaveBeenCalled();
  });
```

`components/report/__tests__/report-location-picker.test.tsx` — 첫 it을 교체:

```tsx
  // (old)
  it('현장별 optgroup으로 측정위치를 묶어 보여준다', () => {
    render(<ReportLocationPicker sites={sites} locations={locations} />);
    const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
    const groups = [...sel.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.label)).toEqual(['현장A', '현장B']);
  });
```
```tsx
  // (new)
  it('현장별 optgroup으로 측정위치를 묶어 보여준다', () => {
    const { container } = render(<ReportLocationPicker sites={sites} locations={locations} />);
    const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
    const groups = [...sel.querySelectorAll('optgroup')];
    expect(groups.map((g) => g.label)).toEqual(['현장A', '현장B']);
    // T8: selectClass(2px cs-input-border) + SelectWrap의 chevron
    expect(sel.className).toContain('border-cs-input-border');
    expect(container.querySelector('[data-icon="chevron-down"]')).toBeInTheDocument();
  });
```

`components/report/__tests__/report-progress.test.tsx` — 두 번째·세 번째 it의 마지막 단언을 교체:

```tsx
    // (old - 'reportStatus가 draft면 기존과 동일하게 실패 박스를 보여준다')
    expect(screen.getByText(/PDF 생성에 실패했습니다/)).toBeInTheDocument();
```
```tsx
    // (new)
    expect(screen.getByText(/PDF 생성에 실패했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
```
```tsx
    // (old - 'reportStatus가 draft이고 생성 중이면 진행 안내를 보여준다')
    expect(screen.getByText(/워커가 처리 중입니다/)).toBeInTheDocument();
```
```tsx
    // (new)
    expect(screen.getByText(/워커가 처리 중입니다/)).toHaveAttribute('data-status', 'in-progress');
```

- [ ] **Step 3: 실패 확인** — `cd dashboard && npx vitest run app/reports components/report components/__tests__/report-table.test.tsx` → FAIL: report-table은 `Failed to resolve import "../report-table"`; page 테스트 3개는 `data-status`/`data-alert` 속성 없음(`toHaveAttribute` 실패), heading 목록에 `'보고서(1)'`·`'측정위치 선택'`·`'포함 분석(1)'` 없음, 목록 도구 줄의 `role="textbox"`(보고서 검색)·`role="combobox"`(상태 필터) 없음; 컴포넌트 테스트 5개는 `closest('[data-alert]')`가 null, 클래스에 `bg-cs-link`/`border-cs-link`/`accent-cs-link`/`border-cs-input-border` 없음, `[data-icon="chevron-down"]` 없음.

- [ ] **Step 4: icons.tsx에 refresh 추가** — `components/ui/icons.tsx`(T1)의 `PATHS` 마지막 항목과 `IconName`을 교체:

```tsx
  // (old)
  photo: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></>,
};

export type IconName =
  | 'check-circle' | 'alert-triangle' | 'x-circle' | 'info-circle' | 'clock' | 'minus-circle'
  | 'chevron-right' | 'chevron-down' | 'chevron-left' | 'search' | 'plus' | 'upload' | 'user'
  | 'menu' | 'logout' | 'trend' | 'download' | 'external' | 'photo';
```
```tsx
  // (new)
  photo: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></>,
  // ReportDetail 아트보드의 'PDF 다시 생성' 아이콘(T8 추가). 재분석 등 "다시 실행" 액션 공용.
  refresh: <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v5h-5" /></>,
};

export type IconName =
  | 'check-circle' | 'alert-triangle' | 'x-circle' | 'info-circle' | 'clock' | 'minus-circle'
  | 'chevron-right' | 'chevron-down' | 'chevron-left' | 'search' | 'plus' | 'upload' | 'user'
  | 'menu' | 'logout' | 'trend' | 'download' | 'external' | 'photo' | 'refresh';
```

- [ ] **Step 5: report-table.tsx 작성** — 신규, 전체(T3의 `site-table.tsx`와 같은 도구 줄 마크업):

```tsx
'use client';
// 보고서 목록 테이블 + 도구 줄(클라이언트 섬 - 스펙 §7-3): 서버가 이미 조회한 rows를 제목 includes 검색과
// 상태 필터로 걸러 보여준다(둘은 AND). 서버 조회·URL은 건드리지 않는다. ?location= 필터는 서버가 이미
// 걸었으므로 여기서는 "무엇으로 걸렸는지"만 보여주고 '전체 보기'로 풀 수 있게 한다. 아트보드의
// 페이지네이션(‹ 1 ›)은 현재 데이터 규모에서 YAGNI - 우측에 건수 텍스트만 둔다. 도구 줄 구조는 T3
// site-table.tsx와 같다. 아트보드: docs/design/cloudscape/Reports.dc.html
import Link from 'next/link';
import { useState } from 'react';
import { Icon } from '@/components/ui/icons';
import { inputClass, selectClass, SelectWrap } from '@/components/ui/form';
import { tableClass, TableToolbar } from '@/components/ui/data-table';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
import { REPORT_STATUS_LABEL } from '@/lib/domain/labels';

/** reportStatusBadge(lib/domain/reports.ts)가 돌려주는 tone과 같은 집합. */
export type ReportTone = 'pass' | 'fail' | 'unknown';

export interface ReportTableRow {
  id: string;
  title: string;
  locationLabel: string;
  tone: ReportTone;
  statusLabel: string;
  /** 'YYYY-MM-DD' - 서버(app/reports/page.tsx)가 created_at.slice(0, 10)으로 만든다 */
  createdAt: string;
}

// 상태 필터 선택지 - 값은 reportStatusBadge가 낼 수 있는 상태 중 어느 것인지, 라벨은 화면 문구.
// 행에는 tone·statusLabel만 실리므로(판단은 서버가 reportStatusBadge로 끝냈다) 그 둘로 되짚는다:
// pass = 발행됨, fail = 생성 실패, unknown은 REPORT_STATUS_LABEL.draft('작성 중', gen_status done 초안)와
// 그 밖(REPORT_GEN_STATUS_LABEL의 queued/processing = 'PDF 생성 대기 중'/'PDF 생성 중')으로 갈린다.
export type ReportFilter = 'all' | 'draft' | 'finalized' | 'failed' | 'generating';
const FILTERS: { value: ReportFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'draft', label: '작성 중' },
  { value: 'finalized', label: '발행됨' },
  { value: 'failed', label: '생성 실패' },
  { value: 'generating', label: 'PDF 생성 중·대기' },
];

function matchesFilter(row: ReportTableRow, f: ReportFilter): boolean {
  switch (f) {
    case 'finalized': return row.tone === 'pass';
    case 'failed': return row.tone === 'fail';
    case 'draft': return row.tone === 'unknown' && row.statusLabel === REPORT_STATUS_LABEL.draft;
    case 'generating': return row.tone === 'unknown' && row.statusLabel !== REPORT_STATUS_LABEL.draft;
    default: return true;
  }
}

export function ReportTable({ rows, locationFilter = null }: {
  rows: ReportTableRow[];
  /** ?location= 필터가 걸려 있으면 그 측정위치 라벨, 아니면 null */
  locationFilter?: string | null;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ReportFilter>('all');
  // 제목 includes(앞뒤 공백 제거, 대소문자 무시). 검색과 상태 필터는 AND.
  const q = query.trim().toLowerCase();
  const visible = rows.filter((r) => (q === '' || r.title.toLowerCase().includes(q)) && matchesFilter(r, filter));

  return (
    <>
      <TableToolbar>
        {/* 360px, 2px cs-input-border, 좌측 search 아이콘. inputClass의 px-2는 pl-8이 덮는다(T3과 같은 마크업) */}
        <div className="relative w-[360px] max-w-full">
          <Icon name="search" className="pointer-events-none absolute left-2 top-2 text-cs-text-secondary" />
          <input type="text" aria-label="보고서 검색" placeholder="보고서 검색" value={query}
            onChange={(e) => setQuery(e.target.value)} className={`${inputClass} pl-8`} />
        </div>
        {/* 네이티브 select는 닫힌 상태에 '상태: ' 접두어를 못 그린다 - 옵션 라벨 '전체' + aria-label로 뜻을 준다 */}
        <SelectWrap className="w-44">
          <select aria-label="상태 필터" value={filter} className={selectClass}
            onChange={(e) => setFilter(e.target.value as ReportFilter)}>
            {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </SelectWrap>
        {locationFilter !== null && (
          <span className="inline-flex items-center gap-2 text-sm">
            <span className="text-cs-text-secondary">{`측정위치: ${locationFilter}`}</span>
            <Link href="/reports" className="text-cs-link hover:text-cs-link-hover hover:underline">전체 보기</Link>
          </span>
        )}
        {/* 검색·필터 결과 건수 - 컨테이너 헤더의 (n)은 전체 건수, 여기는 지금 보이는 행 수 */}
        <span className="ml-auto text-sm text-cs-text-secondary tabular-nums">{`총 ${visible.length}건`}</span>
      </TableToolbar>
      <div className="overflow-x-auto">
        <table className={tableClass.table}>
          <thead className={tableClass.thead}>
            <tr>
              <th className={tableClass.th}>제목</th>
              <th className={tableClass.th}>측정위치</th>
              <th className={tableClass.th}>상태</th>
              <th className={tableClass.th}>생성일</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={4} className={`${tableClass.td} text-center text-cs-text-secondary`}>조건에 맞는 보고서가 없습니다</td>
              </tr>
            ) : visible.map((r) => (
              <tr key={r.id} className={tableClass.row}>
                <td className={tableClass.td}>
                  <Link href={`/reports/${r.id}`} className={tableClass.link}>{r.title}</Link>
                </td>
                <td className={tableClass.td}>{r.locationLabel}</td>
                <td className={tableClass.td}>
                  <StatusIndicator type={TONE_STATUS[r.tone]}>{r.statusLabel}</StatusIndicator>
                </td>
                {/* 아트보드: 생성일은 mono 13px, 좌측 정렬(수치 열의 tdNum은 우측 정렬이라 쓰지 않는다) */}
                <td className={`${tableClass.td} font-mono text-[13px] text-cs-nav-text tabular-nums`}>{r.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
```

- [ ] **Step 6: app/reports/page.tsx 교체** — 전체 교체. 보존되는 것: `dynamic`, reports·locations 쿼리와 필터 체인, `labelOf`, `newReportHref`와 D7 Step 2 주석, EmptyState 문구·링크.

```tsx
// 보고서 목록 (전체 또는 ?location= 필터). 아트보드: docs/design/cloudscape/Reports.dc.html
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportTable, type ReportTableRow } from '@/components/report-table';
import { LinkButton } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icons';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { reportStatusBadge } from '@/lib/domain/reports';
import type { LocationRow, ReportRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location: locationId } = await searchParams;
  const supabase = await createClient();
  let query = supabase.from('reports')
    .select('id, location_id, title, status, pdf_path, gen_status, gen_error, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(50);
  if (locationId) query = query.eq('location_id', locationId);
  const { data, error } = await query;
  if (error) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={error.message} /></main>;
  }
  const reports = (data ?? []) as Omit<ReportRow, 'snapshot' | 'opinion_text' | 'created_by'>[];
  const locationIds = [...new Set(reports.map((r) => r.location_id))];
  const { data: locations } = locationIds.length
    ? await supabase.from('locations').select('*').in('id', locationIds)
    : { data: [] };
  const labelOf = new Map((locations ?? []).map((l) => {
    const loc = l as LocationRow;
    return [loc.id, [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ')];
  }));

  // D7 Step 2: 파라미터 유무와 무관하게 항상 노출한다 - location이 있으면 그 위치를
  // 프리필해 한 클릭 흐름(6.3)을 잇고, 없으면 /reports/new가 먼저 측정위치 선택
  // UI를 보여준다(D7 Step 1). 빈 목록은 EmptyState의 primary('새 보고서 만들기')가
  // 같은 다음 행동을 맡는다(뷰당 primary 1개 - 컨테이너 헤더 버튼은 목록이 있을 때만).
  const newReportHref = locationId ? `/reports/new?location=${locationId}` : '/reports/new';

  // 상태 판단(reportStatusBadge)은 서버에서 끝내고, 테이블은 표시용 값만 받는다.
  const rows: ReportTableRow[] = reports.map((r) => {
    const badge = reportStatusBadge(r);
    return {
      id: r.id,
      title: r.title,
      locationLabel: labelOf.get(r.location_id) ?? '-',
      tone: badge.tone,
      statusLabel: badge.label,
      createdAt: r.created_at.slice(0, 10),
    };
  });

  return (
    <main className={PAGE_MAIN}>
      <PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '보고서' }]} title="보고서" />
      {reports.length === 0 ? (
        <EmptyState message="보고서가 없습니다." actionHref="/reports/new" actionLabel="새 보고서 만들기" />
      ) : (
        <Container title="보고서" counter={reports.length} padded={false}
          actions={
            <LinkButton href={newReportHref} variant="primary">
              <Icon name="plus" />새 보고서
            </LinkButton>
          }>
          <ReportTable rows={rows} locationFilter={locationId ? (labelOf.get(locationId) ?? '-') : null} />
        </Container>
      )}
    </main>
  );
}
```

- [ ] **Step 7: report-location-picker.tsx 교체** — 전체 교체. `router.push` 분기·optgroup 규칙·주석 그대로, 마크업만 `FormField` + `SelectWrap` + `selectClass`.

```tsx
// D7 Step 1: /reports/new에 location 쿼리 없이 들어왔을 때 먼저 보여주는 측정위치
// 선택 UI. 선택 즉시 라우트를 바꿔 서버 컴포넌트가 그 location으로 후보를 다시
// 조회하게 한다(로컬 상태로 후보를 들고 있지 않는다 - 후보 쿼리 자체가 서버 전용
// Supabase 클라이언트를 쓴다). optgroup 구성은 upload-form.tsx(T4)와 동일하게
// "현장별로 묶고, 측정위치가 0개인 현장은 목록에서 뺀다".
'use client';
import { useRouter } from 'next/navigation';
import { FormField, SelectWrap, selectClass } from '@/components/ui/form';
import type { LocationRow, SiteRow } from '@/lib/domain/types';

export function ReportLocationPicker({ sites, locations }: {
  sites: SiteRow[];
  locations: LocationRow[];
}) {
  const router = useRouter();
  return (
    <div className="max-w-md">
      <FormField label="측정위치" htmlFor="report-location">
        <SelectWrap>
          <select id="report-location" defaultValue=""
            onChange={(e) => {
              if (e.target.value) router.push(`/reports/new?location=${e.target.value}`);
            }}
            className={selectClass}>
            <option value="">선택...</option>
            {sites.map((s) => {
              const locs = locations.filter((l) => l.site_id === s.id);
              if (locs.length === 0) return null;
              return (
                <optgroup key={s.id} label={s.name}>
                  {locs.map((l) => (
                    <option key={l.id} value={l.id}>
                      {[l.building, l.floor, l.room, l.name].filter(Boolean).join(' / ')}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </SelectWrap>
      </FormField>
    </div>
  );
}
```

- [ ] **Step 8: report-create-form.tsx — import와 JSX만 교체** (`ReportCandidate`, `kindTitleLabel`, `opinionLabel`, state 5개, `toggle`, `submit`과 그 안의 I3 주석은 한 글자도 바꾸지 않는다)

import 블록 교체:

```tsx
// (old)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { ANALYSIS_KIND_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
```
```tsx
// (new)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { FormField, checkClass, inputClass, textareaClass } from '@/components/ui/form';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { ANALYSIS_KIND_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
```

`return (` 부터 파일 끝의 `);` `}` 까지 교체(옛 블록은 `<form onSubmit={submit} className="space-y-4 rounded-lg border bg-white p-4">`로 시작한다):

```tsx
  // 아트보드 ReportNew: 컨테이너(헤더 없음) 안에 필드 3개, primary '보고서 생성'은 컨테이너 밖
  // 우하단. 제출 버튼이 같은 <form> 안에 있어야 하므로 폼이 Container를 감싼다.
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Container>
        <div className="flex flex-col gap-4">
          <FormField label="보고서 제목" htmlFor="report-title">
            <input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)}
              className={inputClass} />
          </FormField>

          <fieldset>
            <legend className="text-sm font-bold">포함할 분석</legend>
            <p className="text-xs leading-4 text-cs-text-secondary">
              같은 측정위치의 완료된 최신 분석만 후보로 표시됩니다(평활도와 구배, 바닥과 벽면을 함께 묶을 수 있습니다).
            </p>
            <div className="mt-2 overflow-hidden rounded-lg border border-cs-divider">
              {candidates.map((c) => (
                <div key={c.analysis_id} className="border-b border-cs-divider px-4 py-3 last:border-b-0">
                  {/* 종류는 **문구로** 앞세운다. 색만으로 구별하지 않는다(스펙 §7.2). */}
                  <label className={`flex items-center gap-3 text-sm${c.blocked_reason ? ' text-cs-disabled' : ''}`}>
                    <input type="checkbox" className={checkClass} checked={selected.includes(c.analysis_id)}
                      disabled={!!c.blocked_reason}
                      onChange={() => toggle(c.analysis_id)} />
                    <span>
                      {ANALYSIS_KIND_LABEL[c.kind]} · {SURFACE_LABEL[c.surface]} · {c.scanned_at} ·
                      {' '}판정 {c.verdict_label}
                    </span>
                  </label>
                  {c.blocked_reason && <Alert type="warning" className="mt-2">{c.blocked_reason}</Alert>}
                </div>
              ))}
            </div>
          </fieldset>

          <FormField label="종합의견" htmlFor="report-opinion"
            description="비워 두면 분석별 자동 의견이 그대로 보고서에 실립니다. 스크리닝 한계 문구는 항상 자동 포함됩니다.">
            <textarea id="report-opinion" rows={8} value={opinion}
              onChange={(e) => setOpinion(e.target.value)} className={textareaClass} />
          </FormField>

          {error && <Alert type="error">{error}</Alert>}
        </div>
      </Container>

      <div className="flex justify-end gap-2">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? '생성 요청 중...' : '보고서 생성'}
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 9: app/reports/new/page.tsx 수정** — `judgeBlockReason`과 그 주석, D7 Step 1·리뷰 F1·D8 이월·kind 필터·params 주석, 쿼리 체인, `candidates` 산출은 무변경. import·오류 `<main>`·반환 JSX 3곳만 바꾼다.

import 블록 교체:

```tsx
// (old)
import { ReportCreateForm, type ReportCandidate } from '@/components/report/report-create-form';
import { ReportLocationPicker } from '@/components/report/report-location-picker';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { GRADE_LABEL } from '@/lib/domain/labels';
```
```tsx
// (new)
import { ReportCreateForm, type ReportCandidate } from '@/components/report/report-create-form';
import { ReportLocationPicker } from '@/components/report/report-location-picker';
import { Alert } from '@/components/ui/alert';
import { Container } from '@/components/ui/container';
import { EmptyState } from '@/components/ui/empty-state';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { GRADE_LABEL } from '@/lib/domain/labels';
```

치환 표(오류 반환 3곳 - `listError`·`error`·`analysesRes.error` 분기, 내용은 그대로):

| 옛 문자열 | 새 문자열 | 위치 |
|---|---|---|
| `<main className="mx-auto max-w-4xl p-6">` | `<main className={PAGE_MAIN}>` | `if (listError)`, `if (error)`, `if (analysesRes.error)` 반환문 3곳 |

리뷰 F1 EmptyState 분기 교체:

```tsx
      // (old)
      return (
        <main className="mx-auto max-w-4xl space-y-4 p-6">
          <PageHeader crumbs={[{ href: '/', label: '현장' }]} title="보고서 생성" />
          <EmptyState
            message="아직 측정위치가 없습니다. 업로드 화면에서 현장·측정위치 생성부터 스캔 업로드까지 한 번에 할 수 있습니다."
            actionHref="/upload"
            actionLabel="업로드로 시작"
          />
        </main>
      );
```
```tsx
      // (new) - 브레드크럼 마지막 항목은 현재 페이지(비링크, 스펙 §7-2)
      return (
        <main className={PAGE_MAIN}>
          <PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '보고서 생성' }]} title="보고서 생성" />
          <EmptyState
            message="아직 측정위치가 없습니다. 업로드 화면에서 현장·측정위치 생성부터 스캔 업로드까지 한 번에 할 수 있습니다."
            actionHref="/upload"
            actionLabel="업로드로 시작"
          />
        </main>
      );
```

측정위치 선택 분기 교체:

```tsx
    // (old)
    return (
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <PageHeader crumbs={[{ href: '/', label: '현장' }]} title="보고서 생성" />
        <p className="text-sm text-zinc-500">보고서를 만들 측정위치를 먼저 선택하세요.</p>
        <ReportLocationPicker sites={(sitesRes.data ?? []) as SiteRow[]} locations={allLocations} />
      </main>
    );
```
```tsx
    // (new) - 안내 문구는 '측정위치 선택' 컨테이너의 설명(스펙 §7-8: 컨테이너 헤더는 시스템 크롬)
    return (
      <main className={PAGE_MAIN}>
        <PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '보고서 생성' }]} title="보고서 생성" />
        <Container title="측정위치 선택" description="보고서를 만들 측정위치를 먼저 선택하세요.">
          <ReportLocationPicker sites={(sitesRes.data ?? []) as SiteRow[]} locations={allLocations} />
        </Container>
      </main>
    );
```

마지막 반환 교체:

```tsx
  // (old)
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <PageHeader crumbs={crumbs} title="보고서 생성" />
      <p className="text-sm text-zinc-500">{locationLabel}</p>
      {candidates.length === 0 ? (
        <p className="rounded border bg-white p-4 text-sm text-zinc-600">
          이 측정위치에는 완료된 분석이 없습니다. 스캔을 업로드하고 분석이 끝난 뒤 다시 시도하세요.{' '}
          <Link href={`/upload?location=${locationId}`}
            className="text-zinc-700 hover:text-zinc-900 hover:underline">스캔 업로드</Link>
        </p>
      ) : (
        <ReportCreateForm locationId={locationId} locationLabel={locationLabel} candidates={candidates} />
      )}
    </main>
  );
```
```tsx
  // (new) - 아트보드 ReportNew: h1 아래 설명이 측정위치 라벨. 후보 0건은 폼 자리에 info Alert
  // (막다른 화면 금지 - 업로드 링크 유지). 폼 자체(컨테이너 + primary)는 ReportCreateForm이 그린다.
  return (
    <main className={PAGE_MAIN}>
      <PageHeader crumbs={crumbs} title="보고서 생성" description={locationLabel} />
      {candidates.length === 0 ? (
        <Container title="보고서 생성">
          <Alert type="info">
            이 측정위치에는 완료된 분석이 없습니다. 스캔을 업로드하고 분석이 끝난 뒤 다시 시도하세요.{' '}
            <Link href={`/upload?location=${locationId}`}
              className="font-bold text-cs-link hover:text-cs-link-hover hover:underline">스캔 업로드</Link>
          </Alert>
        </Container>
      ) : (
        <ReportCreateForm locationId={locationId} locationLabel={locationLabel} candidates={candidates} />
      )}
    </main>
  );
```

- [ ] **Step 10: report-progress.tsx 교체** — 전체 교체. `useRowStatus`·`useEffect`의 refresh 조건·finalized/done 가드와 I2 주석 그대로, 실패 박스 → `Alert error`, 진행 줄 → `StatusIndicator in-progress`.

```tsx
// PDF 생성 진행 상태 (Realtime + 5초 보조 폴링, 스펙 §3.2.⑤)
'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { useRowStatus } from '@/lib/hooks/use-row-status';
import { REPORT_GEN_STATUS_LABEL } from '@/lib/domain/labels';
import type { ReportGenStatus, ReportStatus } from '@/lib/domain/types';

export function ReportProgress({ reportId, initialStatus, genError, reportStatus }: {
  reportId: string;
  initialStatus: ReportGenStatus;
  genError: string | null;
  // 코드리뷰 Important(I2): 발행본(finalized)은 재생성이 불가능해 gen_status가
  // 갱신될 일이 없다 - 재생성 요청 후 워커 클레임 전에 발행하면 워커가 조기
  // 거부(handle_report의 finalized 재확인)로 gen_status='failed'가 남는데, 이
  // 잔여 정보를 발행본 화면에 그대로 보여주면 실패 박스가 영구 표시된다.
  reportStatus: ReportStatus;
}) {
  const router = useRouter();
  const status = useRowStatus<ReportGenStatus>('reports', reportId, initialStatus, 'gen_status');

  useEffect(() => {
    // 생성이 끝나면 서버 데이터(pdf_path·발행 버튼)를 다시 받아온다
    if (status !== initialStatus && (status === 'done' || status === 'failed')) router.refresh();
  }, [status, initialStatus, router]);

  // 발행본은 gen_status가 의미 없는 잔재 정보다 - 재생성 불가라 지울 방법도 없다
  if (reportStatus === 'finalized') return null;

  if (status === 'done') return null;
  if (status === 'failed') {
    return (
      <Alert type="error" title="PDF 생성에 실패했습니다.">
        {genError && <p>사유: {genError}</p>}
        <p className="text-xs leading-4 text-cs-text-secondary">
          포함한 분석이 완료 상태인지, 워커가 실행 중인지 확인한 뒤 다시 생성하세요.
          3회 자동 재시도 후에도 실패한 상태입니다.
        </p>
      </Alert>
    );
  }
  return (
    <StatusIndicator type="in-progress">
      {REPORT_GEN_STATUS_LABEL[status]}... (워커가 처리 중입니다. 이 화면은 자동 갱신됩니다)
    </StatusIndicator>
  );
}
```

- [ ] **Step 11: report-actions.tsx — import와 JSX만 교체** (`finalize`·`regenerate`와 그 주석 무변경)

import 블록 교체:

```tsx
// (old)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
```
```tsx
// (new)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button, buttonClass } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
```

`return (` 부터 파일 끝까지 교체(옛 블록은 `<div className="space-y-2">`로 시작한다):

```tsx
  // 페이지 헤더의 액션 슬롯(우측)에 놓인다 - 버튼 줄 아래로 발행 안내·메시지·오류가 펼쳐지므로
  // 세로 컬럼을 우측 정렬한다. 아트보드 ReportDetail: PDF 다운로드 · PDF 다시 생성 · 발행(primary).
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {report.pdf_path && (
          <a href={dataUrl(report.pdf_path)} download className={buttonClass('normal')}>
            <Icon name="download" />PDF 다운로드
          </a>
        )}
        {canRegenerate(report) && (
          <Button onClick={regenerate} disabled={busy}>
            <Icon name="refresh" />PDF 다시 생성
          </Button>
        )}
        {canFinalize(report) && (
          // 뷰당 primary 1개(스펙 §4) - 발행은 이 화면의 핵심 행동이라 primary는 발행뿐이다.
          // 삭제·다운로드·재생성은 normal.
          <Button variant="primary" onClick={finalize} disabled={busy}>발행</Button>
        )}
      </div>
      {report.status === 'finalized' && (
        <p className="text-xs leading-4 text-cs-text-secondary">
          발행된 보고서는 수정할 수 없습니다(내용 변경은 DB에서 차단됩니다). 내용을 바꾸려면 새 보고서를 만드세요.
        </p>
      )}
      {/* 최종 리뷰 M3: 발행 성공은 판정이 아니라 시스템 메시지이므로 판정색을 쓰지 않는다 - 보조색 텍스트. */}
      {message && <p className="text-sm text-cs-text-secondary">{message}</p>}
      {error && <Alert type="error" className="max-w-lg">{error}</Alert>}
    </div>
  );
}
```

- [ ] **Step 12: report-delete-button.tsx — import와 JSX만 교체** (`remove`와 push/refresh 주석 무변경)

import 블록 교체:

```tsx
// (old)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
```
```tsx
// (new)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
```

`if (!confirming) {` 부터 파일 끝까지 교체:

```tsx
  if (!confirming) {
    return <Button onClick={() => setConfirming(true)}>삭제</Button>;
  }

  // 확인 단계: error Alert 안에 문구 + 삭제 확인/취소. 둘 다 normal - 상세 화면의 primary는
  // 발행 하나뿐이고(스펙 §4), 삭제 확인을 파랑 채움으로 만들면 발행과 구별되지 않는다.
  return (
    <Alert type="error" className="max-w-md">
      <p>{deleteConfirmText(report)}</p>
      <div className="mt-2 flex gap-2">
        <Button onClick={remove} disabled={busy}>삭제 확인</Button>
        <Button onClick={() => { setConfirming(false); setError(null); }} disabled={busy}>취소</Button>
      </div>
      {error && <p className="mt-2 text-cs-error">{error}</p>}
    </Alert>
  );
}
```

- [ ] **Step 13: app/reports/[id]/page.tsx 교체** — 전체 교체. 보존되는 것: `dynamic`, 쿼리 5개와 `Promise.all` 2단 병렬·perf-auth-roundtrips 주석, `scannedAt`, D7 Step 3 브레드크럼 규약과 `loc` 없는 레거시 분기, 포함 분석 링크 문자열과 D7 주석, iframe 조건(`pdf_path && gen_status === 'done'`)·`h-[70vh]`·title. `StatusDot` import는 사라진다(T12가 파일을 지운다).

```tsx
// 보고서 상세: 진행 상태 · PDF 미리보기 · 다운로드 · 발행 (스펙 §7.6 후반부)
// 아트보드: docs/design/cloudscape/ReportDetail.dc.html
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import { ReportActions } from '@/components/report/report-actions';
import { ReportDeleteButton } from '@/components/report/report-delete-button';
import { ReportProgress } from '@/components/report/report-progress';
import { Container } from '@/components/ui/container';
import { tableClass } from '@/components/ui/data-table';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
import { GRADE_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import { dataUrl } from '@/lib/domain/paths';
import { reportStatusBadge } from '@/lib/domain/reports';
import type { LocationRow, ReportRow, ScanRow, SiteRow, Surface, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // snapshot은 용량이 커서 화면에서 쓰지 않는다(렌더러 전용) - 선택 목록에서 제외
  const { data: report, error } = await supabase.from('reports')
    .select('id, location_id, title, status, opinion_text, pdf_path, gen_status, gen_error, created_at')
    .eq('id', id).is('deleted_at', null).maybeSingle();
  if (error) {
    return <main className={PAGE_MAIN}><SupabaseErrorNotice message={error.message} /></main>;
  }
  if (!report) notFound();
  const r = report as Omit<ReportRow, 'snapshot' | 'created_by'>;

  // perf-auth-roundtrips: location과 links는 서로 독립이라 병렬로 돈다.
  // site(loc 의존)와 analyses(links 의존)도 서로 독립이라 2차로 병렬.
  const [{ data: location }, { data: links }] = await Promise.all([
    supabase.from('locations').select('*').eq('id', r.location_id).maybeSingle(),
    supabase.from('report_analyses')
      .select('analysis_id, sort_order').eq('report_id', id).order('sort_order', { ascending: true }),
  ]);
  const loc = location as LocationRow | null;
  const analysisIds = (links ?? []).map((l) => l.analysis_id as string);
  const [{ data: site }, { data: analyses }] = await Promise.all([
    loc
      ? supabase.from('sites').select('*').eq('id', loc.site_id).maybeSingle()
      : Promise.resolve({ data: null }),
    analysisIds.length
      ? supabase.from('analyses').select('id, scan_id, surface, overall_verdict').in('id', analysisIds)
      : Promise.resolve({ data: [] }),
  ]);
  const scanIds = (analyses ?? []).map((a) => a.scan_id as string);
  const { data: scans } = scanIds.length
    ? await supabase.from('scans').select('id, scanned_at').in('id', scanIds)
    : { data: [] };
  const scannedAt = new Map((scans ?? []).map((s) => [s.id as string, (s as ScanRow).scanned_at]));

  // D7 Step 3: scans/[id]와 같은 브레드크럼 규약(현장 홈 › 현장명 › 측정위치 라벨).
  // loc이 없는(측정위치가 지워진 레거시) 경우에도 막다른 화면을 만들지 않고
  // 현장 홈으로는 돌아갈 수 있게 둔다.
  const locLabel = loc ? [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ') : null;
  const crumbs = loc
    ? [
        { href: '/', label: '현장' },
        { href: `/sites/${loc.site_id}`, label: site ? (site as SiteRow).name : '현장 상세' },
        { label: locLabel! },
      ]
    : [{ href: '/', label: '현장' }];
  const badge = reportStatusBadge(r);
  const included = analyses ?? [];

  // 헤더 액션(아트보드 순서): 삭제 · PDF 다운로드 · PDF 다시 생성 · 발행(primary). 삭제 확인 패널과
  // 발행/재생성 메시지는 각 컴포넌트가 버튼 아래로 펼치므로 위쪽 정렬(items-start)로 감싼다.
  return (
    <main className={PAGE_MAIN}>
      <PageHeader crumbs={crumbs} title={r.title}
        description={<StatusIndicator type={TONE_STATUS[badge.tone]}>{badge.label}</StatusIndicator>}
        actions={
          <div className="flex flex-wrap items-start justify-end gap-2">
            <ReportDeleteButton report={{ id: r.id, status: r.status }} redirectTo="/reports" />
            <ReportActions report={{ id: r.id, status: r.status, gen_status: r.gen_status, pdf_path: r.pdf_path }} />
          </div>
        } />

      <ReportProgress reportId={r.id} initialStatus={r.gen_status} genError={r.gen_error} reportStatus={r.status} />

      <Container title="포함 분석" counter={included.length} padded={false}>
        <ul>
          {included.map((a) => (
            <li key={a.id as string} className="flex h-11 items-center border-b border-cs-divider px-5 last:border-b-0">
              {/* D7: /analyses/[id]는 D6 리다이렉트가 여전히 받아주지만, analyses 행에
                  scan_id가 이미 있으니 여기서는 그 리다이렉트 홉을 만들지 않고 스캔
                  작업대로 바로 링크한다(?analysis=로 이 분석을 인라인 선택). */}
              <Link href={`/scans/${a.scan_id}?analysis=${a.id}`} className={tableClass.link}>
                {SURFACE_LABEL[a.surface as Surface]} · {scannedAt.get(a.scan_id as string) ?? '-'} · 판정{' '}
                {a.overall_verdict ? GRADE_LABEL[a.overall_verdict as Verdict] : GRADE_LABEL.na}
              </Link>
            </li>
          ))}
        </ul>
      </Container>

      <Container title="PDF 미리보기" padded={false}>
        {r.pdf_path && r.gen_status === 'done' ? (
          <iframe title="보고서 PDF 미리보기" src={dataUrl(r.pdf_path)}
            className="block h-[70vh] w-full rounded-b-cs-container bg-white" />
        ) : (
          <p className="p-5 text-sm text-cs-text-secondary">PDF가 아직 생성되지 않았습니다.</p>
        )}
      </Container>
    </main>
  );
}
```

- [ ] **Step 14: 통과 확인** — `cd dashboard && npx vitest run` → 전체 PASS(report-table 16건 + reports page 9건 + new page 16건 + [id] page 8건 + report 컴포넌트 테스트 5파일 포함). `npx tsc --noEmit -p .` → 0 에러(테스트 파일도 tsconfig `include`에 들어가므로 테스트의 타입 오류도 여기서 잡힌다). 잔재 확인: `grep -nE "zinc-|amber-|red-|green-|emerald-|purple-|blue-" dashboard/app/reports/page.tsx dashboard/app/reports/new/page.tsx "dashboard/app/reports/[id]/page.tsx" dashboard/components/report/*.tsx dashboard/components/report-table.tsx` → 0건. `grep -rn "StatusDot\|ui/badge" dashboard/app/reports dashboard/components/report` → 0건(`status-dot.tsx`·`badge.tsx` 파일 자체는 그대로 - `badge.tsx`는 다른 화면이 쓰고 `status-dot.tsx`는 T12가 지운다). dev server(`npx next dev`)에서 `/reports`·`/reports/new`·`/reports/new?location=<id>`·`/reports/<id>`를 열어 세 아트보드와 나란히 캡처 대조(사용자 상시 지시), 콘솔 오류 0.

- [ ] **Step 15: 커밋**

```bash
git add dashboard/app/reports dashboard/components/report dashboard/components/report-table.tsx dashboard/components/__tests__/report-table.test.tsx dashboard/components/ui/icons.tsx
git commit -m "feat(dashboard): 보고서 목록·생성·상세를 Cloudscape 화면 구조로 교체 - ReportTable 도구 줄(검색·상태 필터·측정위치 필터 표시), StatusIndicator 상태, 헤더 액션(발행 primary)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: 설정

**Files:**
- Modify: `dashboard/app/settings/page.tsx`, `dashboard/components/settings/profile-form.tsx`, `dashboard/components/settings/uncertainty-form.tsx`, `dashboard/components/settings/criteria-list.tsx`
- Test(갱신): `dashboard/components/settings/__tests__/profile-form.test.tsx`, `dashboard/components/settings/__tests__/uncertainty-form.test.tsx`, `dashboard/components/settings/__tests__/criteria-list.test.tsx`
- Test(신규): `dashboard/app/settings/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `PAGE_MAIN`(`components/ui/page`), `<PageHeader crumbs title />`(`components/ui/page-header`), `<Container title? padded? className>`(`components/ui/container`), `<Button type="submit" variant?>`(`components/ui/button` — 기본값 `normal`, U 저장만 `variant="primary"`), `<FormField label htmlFor>` · `inputClass` · `checkClass`(`components/ui/form`), `<Badge tone="neutral">`(`components/ui/badge`), `tableClass`(`components/ui/data-table` — `table`·`thead`·`th`·`td`·`row`), `<Alert type="error">`(`components/ui/alert`, `data-alert="error"` + `role="alert"`). 소스에 이미 있는 것: `groupCriteria`·`thresholdSummary`(`lib/domain/criteria`), `SURFACE_LABEL`(`lib/domain/labels`), `CriteriaRow`(`lib/domain/types`), `ensureProfile`, `getRequestUser`.
- Produces: 없음(`CriteriaTable`은 `criteria-list.tsx` 내부 비공개 헬퍼 — export 하지 않는다).

- [ ] **Step 1: 아트보드 확인** — `docs/design/cloudscape/Settings.dc.html`을 Read(또는 브라우저)로 열어 `<main>` 안의 구조를 그대로 옮긴다. 옮길 섹션: (1) 브레드크럼 `현장 › 설정` + h1 `설정`, (2) Container `프로필`(본문: 표시 이름 필드 320px + 저장 버튼, `align-items: flex-end; gap: 12px`), (3) Container `측정 불확도 U`(본문: 설명문 보조색 → 바닥 U(mm)·벽면 U(mm) 96px 입력 2개 + 저장, gap 16px), (4) Container `판정 기준`(`overflow: hidden`, 본문 padding 없음: 소제목 `전역 기본 기준` 16px 700 + `(n)` 보조색 · padding 12px 20px → 4열 테이블 `기준 · 출처` / `표면 · 버전` / `임계값` / `활성`(헤더 40px 상하 1px 구분선, 셀 padding 12px 20px, 이름은 mono 13px 700 + `기본` 배지, 출처는 12px/16px 보조색 **전문 표시**, 표면·버전은 `cs-nav-text` nowrap, 임계값 tabular-nums nowrap, 활성은 체크박스) → 하단 안내문 12px 보조색 padding 20px + 상단 1px 구분선). 아트보드는 두 저장 버튼이 모두 파랑 채움이지만 스펙 §6 Settings 행("바닥/벽면 입력 + primary 저장")대로 **U 저장만 `primary`**(파랑 채움)이고 프로필 저장은 `normal`(2px 파랑 보더) — 뷰당 primary 1개 = U 저장. 상단 바·사이드 내비는 T1 셸이 그린다.

- [ ] **Step 2: 실패하는 테스트 작성/갱신**

`components/settings/__tests__/profile-form.test.tsx` — 기존 `describe`의 두 `it`은 그대로 두고, 마지막 `it` 뒤에 다음을 추가한다:

```tsx
  it('저장은 normal 버튼(파랑 보더, 채움 없음)이고 입력·안내는 cs 토큰을 쓴다 - 이 뷰의 primary는 U 저장 하나다', async () => {
    fromMock.mockClear();
    render(<ProfileForm userId="u1" initialName="홍길동" />);
    const btn = screen.getByRole('button', { name: '저장' });
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn.className).toContain('border-cs-link');
    expect(btn.className).not.toContain('bg-cs-link');
    expect(screen.getByLabelText('표시 이름').className).toContain('border-cs-input-border');
    // 안내 메시지는 보조색(옛 text-zinc-500 -> text-cs-text-secondary)
    fireEvent.change(screen.getByLabelText('표시 이름'), { target: { value: ' ' } });
    fireEvent.click(btn);
    expect((await screen.findByText('표시 이름을 입력하세요')).className).toContain('text-cs-text-secondary');
  });
```

`components/settings/__tests__/uncertainty-form.test.tsx` — 기존 `it`은 그대로 두고 그 뒤에 추가한다:

```tsx
  it('초기값을 문자열 그대로 그리고(5 -> "5"), 입력은 mono·cs 보더, 저장은 primary 버튼(파랑 채움)이다', () => {
    fromMock.mockClear();
    render(<UncertaintyForm initial={{ floor: 5, wall: 8 }} />);
    const floor = screen.getByLabelText('바닥 U(mm)') as HTMLInputElement;
    const wall = screen.getByLabelText('벽면 U(mm)') as HTMLInputElement;
    expect(floor.value).toBe('5'); // String(initial.floor) - 소수점 보정 없음(무변경)
    expect(wall.value).toBe('8');
    expect(floor.className).toContain('border-cs-input-border');
    expect(floor.className).toContain('font-mono');
    const btn = screen.getByRole('button', { name: '저장' });
    expect(btn).toHaveAttribute('type', 'submit');
    // 스펙 §6 Settings: U 저장이 이 뷰의 유일한 primary
    expect(btn.className).toContain('bg-cs-link');
  });
```

`components/settings/__tests__/criteria-list.test.tsx` — 파일 전체를 다음으로 교체한다(첫 `it`의 동작 단언은 그대로 유지, RLS 무음 거부 -> Alert 경로와 현장 그룹을 추가):

```tsx
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
```

`app/settings/__tests__/page.test.tsx` — 신규. async 서버 컴포넌트는 `render()`가 아니라 `app/__tests__/page.test.tsx`와 같은 엘리먼트 트리 탐색으로 검증한다:

```tsx
// 설정 페이지 배선: PAGE_MAIN 본문 + PageHeader(현장 › 설정) + Container 3개(프로필 / 측정 불확도 U /
// 판정 기준), app_settings 미설정 시 U 기본값 {floor: 5, wall: 8}, 사용자 없으면 /login 리다이렉트.
// Vitest는 async 서버 컴포넌트 render()를 지원하지 않으므로(node_modules/next/dist/docs/
// 01-app/02-guides/testing/vitest.md) app/__tests__/page.test.tsx와 같이 엘리먼트 트리를 재귀 탐색한다.
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/auth/request-user', () => ({ getRequestUser: vi.fn() }));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfile: vi.fn() }));
vi.mock('next/navigation', () => ({
  // 실제 redirect()는 throw로 렌더를 끊는다 - 같은 계약으로 흉내낸다.
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT:${to}`); }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getRequestUser } from '@/lib/auth/request-user';
import { ensureProfile } from '@/lib/auth/ensure-profile';
import SettingsPage from '../page';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { Container } from '@/components/ui/container';
import { ProfileForm } from '@/components/settings/profile-form';
import { UncertaintyForm } from '@/components/settings/uncertainty-form';
import { CriteriaList } from '@/components/settings/criteria-list';

// 엘리먼트 트리를 재귀 탐색해 특정 컴포넌트/태그 타입이 쓰인 곳을 모두 모은다.
function findAll(node: unknown, type: unknown, acc: { props: Record<string, unknown> }[] = []) {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) acc.push(el as { props: Record<string, unknown> });
  findAll(el.props?.children, type, acc);
  return acc;
}

// 문자열 children을 모아 안내 문구·라벨 회귀를 잡는다.
function collectText(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') { acc.push(String(node)); return acc; }
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, acc)); return acc; }
  collectText((node as { props?: { children?: unknown } }).props?.children, acc);
  return acc;
}

// Supabase 쿼리 빌더 흉내: 체이닝은 자기 자신, await 대상이 되면(thenable) 정해 둔 결과로 resolve.
// app_settings는 .maybeSingle()로 끝나므로 그 메서드만 진짜 Promise를 돌려준다.
function chain(result: { data: unknown; error: null }) {
  const obj: Record<string, unknown> = {
    select: () => obj, order: () => obj, eq: () => obj,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

// criteria / app_settings / sites 세 쿼리가 Promise.all로 나간다(profiles는 ensureProfile 목이 받는다).
function stubSupabase(opts: { criteria?: unknown[]; setting?: { value: unknown } | null; sites?: unknown[] }) {
  return {
    from: (table: string) => {
      if (table === 'criteria') return chain({ data: opts.criteria ?? [], error: null });
      if (table === 'app_settings') return chain({ data: opts.setting ?? null, error: null });
      if (table === 'sites') return chain({ data: opts.sites ?? [], error: null });
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

function loggedIn(opts: Parameters<typeof stubSupabase>[0] = {}) {
  vi.mocked(createClient).mockResolvedValue(stubSupabase(opts) as never);
  vi.mocked(getRequestUser).mockResolvedValue({ id: 'u1', email: 'u1@example.com' });
  vi.mocked(ensureProfile).mockResolvedValue({ id: 'u1', display_name: '홍길동' });
}

const criteriaRow = {
  id: 'g1', site_id: null, surface: 'floor', name: 'floor-kcs-exposed',
  source_text: 'KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감)',
  thresholds: [{ span_m: 3, metric: 'flatness', pass_mm: 7, rework_mm: 21 }],
  is_default: true, is_active: true, version: 1, supersedes_id: null, created_at: '', kind: 'flatness',
};

describe('SettingsPage 가드', () => {
  it('사용자 헤더가 없으면 /login으로 리다이렉트한다(방어 심층 가드 유지)', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase({}) as never);
    vi.mocked(getRequestUser).mockResolvedValue(null);
    await expect(SettingsPage()).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});

describe('SettingsPage 렌더 (Cloudscape 아트보드 Settings)', () => {
  it('PAGE_MAIN 본문 + 브레드크럼 현장 › 설정 + Container 3개를 순서대로 그린다', async () => {
    loggedIn();
    const el = (await SettingsPage()) as { type: unknown; props: Record<string, unknown> };

    expect(el.type).toBe('main');
    expect(el.props.className).toBe(PAGE_MAIN);

    const [header] = findAll(el, PageHeader);
    expect(header.props.title).toBe('설정');
    expect(header.props.crumbs).toEqual([{ href: '/', label: '현장' }, { label: '설정' }]);

    const containers = findAll(el, Container);
    expect(containers.map((c) => c.props.title)).toEqual(['프로필', '측정 불확도 U', '판정 기준']);
    expect(containers[2].props.padded).toBe(false); // 테이블 컨테이너는 본문 padding 없음

    // U 설명문은 컨테이너 본문(폼 위)에 그대로 남는다(문구 무변경)
    expect(collectText(containers[1]).join('')).toContain('판정식의 경계 구간 폭을 결정합니다');

    const [profile] = findAll(el, ProfileForm);
    expect(profile.props).toMatchObject({ userId: 'u1', initialName: '홍길동' });
  });

  it('app_settings에 값이 없으면 U 기본값 {floor: 5, wall: 8}을, 있으면 그 값을 폼에 넘긴다', async () => {
    loggedIn({ setting: null });
    let [form] = findAll(await SettingsPage(), UncertaintyForm);
    expect(form.props.initial).toEqual({ floor: 5, wall: 8 });

    loggedIn({ setting: { value: { floor: 3, wall: 6 } } });
    [form] = findAll(await SettingsPage(), UncertaintyForm);
    expect(form.props.initial).toEqual({ floor: 3, wall: 6 });
  });

  it('criteria 행 전체와 현장명 맵을 CriteriaList에 넘긴다', async () => {
    loggedIn({ criteria: [criteriaRow], sites: [{ id: 's1', name: '현장A' }] });
    const [list] = findAll(await SettingsPage(), CriteriaList);
    expect(list.props.criteria).toEqual([criteriaRow]);
    expect((list.props.siteNames as Map<string, string>).get('s1')).toBe('현장A');
  });
});
```

- [ ] **Step 3: 실패 확인** — `cd dashboard && npx vitest run components/settings app/settings` → FAIL. 기대 실패: profile-form 새 `it`(버튼 클래스가 `bg-zinc-900`라 `border-cs-link` 없음), uncertainty-form 새 `it`(`font-mono`·`border-cs-input-border` 없음), criteria-list 2·3·4번 `it`(`role=table` 없음 — 현재는 `<ul>`, `role=alert` 없음 — 현재는 `<p>`), page 테스트의 'PAGE_MAIN 본문 + …' 1건(`className`이 `mx-auto max-w-6xl …`, `Container` 0개). 기존 동작 단언 3건(공백 이름·trim 동기화·100mm 상한)과 page 테스트의 가드·U 기본값·criteria 배선 3건은 옛 코드로도 이미 PASS여야 한다(회귀 방지용 고정) — 아니면 목 설정을 먼저 고친다.

- [ ] **Step 4: profile-form.tsx 교체** — 로직·문구는 한 글자도 바꾸지 않는다(`trim` 가드, 오류 문구, `setName(trimmed)` 동기화).

```tsx
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormField, inputClass } from '@/components/ui/form';

export function ProfileForm({ userId, initialName }: { userId: string; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    // HTML5 required는 공백만 입력해도 통과시키므로 별도로 막는다(빈 표시 이름 저장 방지)
    if (!trimmed) { setMsg('표시 이름을 입력하세요'); return; }
    // grant: authenticated는 display_name 컬럼만 update 가능 (001)
    const { error } = await createClient().from('profiles')
      .update({ display_name: trimmed }).eq('id', userId);
    if (!error) setName(trimmed); // 입력창도 저장된 값(trim됨)과 동기화
    setMsg(error ? `저장 실패: ${error.message}` : '저장되었습니다');
  }

  // 아트보드 Settings: 필드 320px + 저장 버튼, 하단 정렬, gap 12px.
  // 이 뷰의 primary는 U 저장 하나(스펙 §6 Settings)이므로 프로필 저장은 normal(뷰당 primary 1개 규칙).
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="w-80">
        <FormField label="표시 이름" htmlFor="display-name">
          <input id="display-name" required value={name} onChange={(e) => setName(e.target.value)}
            className={inputClass} />
        </FormField>
      </div>
      <Button type="submit">저장</Button>
      {msg && <span className="pb-1.5 text-xs text-cs-text-secondary">{msg}</span>}
    </form>
  );
}
```

- [ ] **Step 5: uncertainty-form.tsx 교체** — `String(initial.floor)` 초기화, 0 초과·100 이하 가드, RLS 0행 실패 판정, 세 문구 전부 무변경.

```tsx
// U 값 (스펙 §4.2: app_settings, 분석 시점에 스냅샷되므로 수정해도 과거 분석은 불변. 수정 권한은 admin RLS)
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { FormField, inputClass } from '@/components/ui/form';

// 수치 입력은 mono + tabular(스펙 §3). 아트보드 폭 96px = w-24.
const numberInputClass = `${inputClass} font-mono tabular-nums`;

export function UncertaintyForm({ initial }: { initial: { floor: number; wall: number } }) {
  const [floor, setFloor] = useState(String(initial.floor));
  const [wall, setWall] = useState(String(initial.wall));
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = { floor: parseFloat(floor), wall: parseFloat(wall) };
    if (!Number.isFinite(value.floor) || !Number.isFinite(value.wall) || value.floor <= 0 || value.wall <= 0) {
      setMsg('U는 0보다 큰 수치여야 합니다'); return;
    }
    if (value.floor > 100 || value.wall > 100) {
      setMsg('U는 100mm 이하여야 합니다'); return;
    }
    // RLS 무음 거부 주의(criteria와 동일): 0행 갱신을 실패로 판정
    const { data, error } = await createClient().from('app_settings')
      .update({ value }).eq('key', 'uncertainty_mm').select('key');
    setMsg(error || !data || data.length === 0
      ? '수정에 실패했습니다. 측정 불확도는 관리자만 수정할 수 있습니다.'
      : '저장되었습니다 (이후 분석부터 적용)');
  }

  // 저장은 이 뷰의 primary(스펙 §6 Settings: "바닥/벽면 입력 + primary 저장" - 뷰당 primary 1개).
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
      <div className="w-24">
        <FormField label="바닥 U(mm)" htmlFor="u-floor">
          <input id="u-floor" value={floor} onChange={(e) => setFloor(e.target.value)} className={numberInputClass} />
        </FormField>
      </div>
      <div className="w-24">
        <FormField label="벽면 U(mm)" htmlFor="u-wall">
          <input id="u-wall" value={wall} onChange={(e) => setWall(e.target.value)} className={numberInputClass} />
        </FormField>
      </div>
      <Button type="submit" variant="primary">저장</Button>
      {msg && <span className="pb-1.5 text-xs text-cs-text-secondary">{msg}</span>}
    </form>
  );
}
```

- [ ] **Step 6: criteria-list.tsx 교체** — `Row`의 `toggle`(RLS 0행 실패 판정, 전역/현장 분기 문구, `router.refresh()`)과 `groupCriteria` 사용, 하단 안내문은 무변경. `<ul>/<li>` → `<table>`(`tableClass`), 오류 `<p>` → `<Alert type="error">`, 기본 배지 → `<Badge tone="neutral">`, 체크박스 → `checkClass`. 행의 보이는 "활성" 글자는 열 머리글 `활성`로 옮겨 가고 `aria-label`(`<이름> 활성`)은 그대로다.

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { groupCriteria, thresholdSummary } from '@/lib/domain/criteria';
import { SURFACE_LABEL } from '@/lib/domain/labels';
import type { CriteriaRow } from '@/lib/domain/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { tableClass } from '@/components/ui/data-table';
import { checkClass } from '@/components/ui/form';

// 아트보드 Settings의 셀: padding 12px 20px, 세로 중앙(첫 열이 두 줄이라 h-11은 최소 높이로만 작동).
const cell = `${tableClass.td} py-3 align-middle`;

function Row({ c, onError }: { c: CriteriaRow; onError: (m: string) => void }) {
  const router = useRouter();
  const [active, setActive] = useState(c.is_active);

  async function toggle() {
    const next = !active;
    // RLS 무음 거부 주의: USING 절이 거르면 오류 없이 0행이 갱신된다.
    // .select()로 갱신된 행을 돌려받아 0행이면 실패로 처리한다.
    const { data, error } = await createClient().from('criteria')
      .update({ is_active: next }).eq('id', c.id).select('id');
    if (error || !data || data.length === 0) {
      // RLS: 전역 행(site_id null)은 admin만 수정 가능 (001 site_write 정책)
      onError(c.site_id === null
        ? '전역 기준은 관리자만 수정할 수 있습니다 (is_admin은 SQL Editor에서 부여).'
        : `수정 실패: ${error?.message ?? '권한이 없습니다'}`);
      return;
    }
    setActive(next);
    router.refresh();
  }

  return (
    <tr className={tableClass.row}>
      <td className={cell}>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] font-bold">{c.name}</span>
            {c.is_default && <Badge tone="neutral">기본</Badge>}
          </div>
          {/* 출처는 전문 표시 - 말줄임(truncate/line-clamp) 금지(스펙 §6 Settings) */}
          <span className="block text-xs leading-4 text-cs-text-secondary">{c.source_text}</span>
        </div>
      </td>
      <td className={`${cell} whitespace-nowrap text-cs-nav-text`}>{SURFACE_LABEL[c.surface]} · v{c.version}</td>
      <td className={`${cell} whitespace-nowrap tabular-nums`}>{c.thresholds.map(thresholdSummary).join(' · ')}</td>
      <td className={cell}>
        <input type="checkbox" checked={active} onChange={toggle} aria-label={`${c.name} 활성`} className={checkClass} />
      </td>
    </tr>
  );
}

// 전역·현장 그룹이 같은 4열 표를 쓴다. 비공개 헬퍼 - export 하지 않는다.
function CriteriaTable({ rows, onError }: { rows: CriteriaRow[]; onError: (m: string) => void }) {
  return (
    <table className={tableClass.table}>
      <thead className={tableClass.thead}>
        <tr>
          <th className={tableClass.th}>기준 · 출처</th>
          <th className={tableClass.th}>표면 · 버전</th>
          <th className={tableClass.th}>임계값</th>
          <th className={tableClass.th}>활성</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => <Row key={c.id} c={c} onError={onError} />)}
      </tbody>
    </table>
  );
}

// 소제목 16px 700 + (n) 보조색, padding 12px 20px(아트보드 "전역 기본 기준 (16)").
function GroupTitle({ title, count, divided }: { title: React.ReactNode; count: number; divided?: boolean }) {
  return (
    <div className={`flex items-baseline gap-1.5 px-5 py-3${divided ? ' border-t border-cs-divider' : ''}`}>
      <h3 className="text-base font-bold leading-5">{title}</h3>
      <span className="text-base leading-5 text-cs-text-secondary">({count})</span>
    </div>
  );
}

export function CriteriaList({ criteria, siteNames }: {
  criteria: CriteriaRow[];
  siteNames: Map<string, string>;
}) {
  const [error, setError] = useState<string | null>(null);
  const { global, bySite } = groupCriteria(criteria);
  // padded={false} 컨테이너 안이므로 여백은 여기서 준다.
  return (
    <div className="flex flex-col">
      {error && <div className="px-5 pt-5"><Alert type="error">{error}</Alert></div>}
      <section>
        <GroupTitle title="전역 기본 기준" count={global.length} />
        <CriteriaTable rows={global} onError={setError} />
      </section>
      {[...bySite.entries()].map(([siteId, rows]) => (
        <section key={siteId}>
          <GroupTitle title={<>현장 기준: {siteNames.get(siteId) ?? siteId}</>} count={rows.length} divided />
          <CriteriaTable rows={rows} onError={setError} />
        </section>
      ))}
      <p className="border-t border-cs-divider p-5 text-xs leading-4 text-cs-text-secondary">
        기준 신설·버전 개정·현장별 재정의 추가는 데모 범위 밖입니다. Supabase SQL Editor에서
        criteria 테이블에 직접 추가하세요(부분 유니크 제약: 활성 행 기준 (surface, name) 유일).
      </p>
    </div>
  );
}
```

- [ ] **Step 7: app/settings/page.tsx 교체** — 조회 3건(`Promise.all`)·`ensureProfile` 복구·`redirect` 가드·U 기본값 `{ floor: 5.0, wall: 8.0 }`·주석(최종 리뷰 M1) 전부 무변경. `<section>+<h2>` 셋을 `<Container>` 셋으로, 본문 클래스를 `PAGE_MAIN`으로.

```tsx
// 설정 화면 (스펙 §7.7) - Cloudscape 아트보드 docs/design/cloudscape/Settings.dc.html
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ensureProfile } from '@/lib/auth/ensure-profile';
import { getRequestUser } from '@/lib/auth/request-user';
import { CriteriaList } from '@/components/settings/criteria-list';
import { ProfileForm } from '@/components/settings/profile-form';
import { UncertaintyForm } from '@/components/settings/uncertainty-form';
import { Container } from '@/components/ui/container';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import type { CriteriaRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  // proxy가 검증한 헤더를 읽는다(Auth 왕복 0회). 가드는 방어 심층으로 유지 -
  // 헬퍼가 null을 주는 경로가 생겨도 여전히 안전해야 한다.
  const user = await getRequestUser();
  if (!user) redirect('/login');
  const profile = await ensureProfile(supabase, user); // 로그인 직후 실패했어도 여기서 복구
  const [criteriaRes, settingRes, sitesRes] = await Promise.all([
    supabase.from('criteria').select('*')
      .order('site_id', { ascending: true, nullsFirst: true })
      .order('surface').order('name'),
    supabase.from('app_settings').select('value').eq('key', 'uncertainty_mm').maybeSingle(),
    supabase.from('sites').select('id, name'),
  ]);
  const u = (settingRes.data?.value ?? { floor: 5.0, wall: 8.0 }) as { floor: number; wall: number };
  const siteNames = new Map((sitesRes.data ?? []).map((s) => [s.id as string, s.name as string]));
  return (
    <main className={PAGE_MAIN}>
      {/* 최종 리뷰 M1: 타 상세 화면과 같은 루트 크럼 라벨('현장')로 통일한다
          (스펙 §6.4는 "홈 ›"이라 적었지만, 실제로는 모든 화면이 '현장'을 쓴다 -
          app/sites/[id]/page.tsx, app/scans/[id]/page.tsx 등). */}
      <PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '설정' }]} title="설정" />
      <Container title="프로필">
        <ProfileForm userId={user.id} initialName={profile.display_name} />
      </Container>
      <Container title="측정 불확도 U">
        {/* 설명문은 아트보드대로 컨테이너 본문(폼 위)에 둔다 - Container description은 헤더 안이라 쓰지 않는다 */}
        <div className="flex flex-col gap-4">
          <p className="text-cs-text-secondary">
            판정식의 경계 구간 폭을 결정합니다. 분석 시점 값이 결과에 스냅샷되므로 수정해도
            과거 분석·보고서는 바뀌지 않습니다. P5 반복 스캔 재현성 시험 후 갱신 예정.
          </p>
          <UncertaintyForm initial={u} />
        </div>
      </Container>
      {/* 테이블 컨테이너: 본문 padding 없음 + overflow-hidden(행 경계가 16px 라운드를 넘지 않게, 아트보드와 동일) */}
      <Container title="판정 기준" padded={false} className="overflow-hidden">
        <CriteriaList criteria={(criteriaRes.data ?? []) as CriteriaRow[]} siteNames={siteNames} />
      </Container>
    </main>
  );
}
```

- [ ] **Step 8: 잔재 확인** — `grep -n "zinc-\|red-\|amber-\|green-\|emerald-\|purple-\|blue-" dashboard/app/settings/page.tsx dashboard/components/settings/*.tsx` → 0건. 이모지·`›` 같은 딩뱃 글자도 0건(브레드크럼 구분은 `PageHeader`→`Breadcrumbs`의 `<Icon name="chevron-right">`).

- [ ] **Step 9: 통과 확인** — `cd dashboard && npx vitest run` → 전체 PASS(settings 4 파일: profile 3건 · uncertainty 2건 · criteria 4건 · page 4건 포함). `npx tsc --noEmit -p .` → 0 에러. dev server(`npm run dev`)에서 `/settings`를 열어 `docs/design/cloudscape/Settings.dc.html`과 나란히 캡처 대조(사용자 상시 지시): 컨테이너 3개·테이블 4열·출처 전문 표시·U 저장은 파랑 채움(primary)·프로필 저장은 파랑 보더(채움 없음, normal)인지, 콘솔 오류 0.

- [ ] **Step 10: 커밋**

```bash
git add dashboard/app/settings dashboard/components/settings
git commit -m "refactor(dashboard): 설정 화면 Cloudscape 리스킨 - Container 3개 + 판정 기준 4열 테이블

- 프로필/측정 불확도 U/판정 기준을 Container로, 본문은 PAGE_MAIN
- 판정 기준: ul -> table(tableClass), 출처 전문 표시, 오류는 Alert(error), 기본 배지는 Badge(neutral)
- U 저장만 primary(스펙 §6 Settings), 프로필 저장은 normal(뷰당 primary 1개)
- 로직·문구·가드·U 초기값(String(initial.floor)) 무변경, 설정 페이지 배선 테스트 추가

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

---

### Task 10: 정합(생성·상세)

**Files:**
- Modify: `dashboard/app/registrations/new/page.tsx`, `dashboard/app/registrations/[id]/page.tsx`, `dashboard/components/registration/registration-create-form.tsx`, `dashboard/components/registration/registration-workbench.tsx`, `dashboard/components/registration/point-picker.tsx`, `dashboard/components/registration/overlay-view.tsx`
- Test: `dashboard/app/registrations/new/__tests__/page.test.tsx`, `dashboard/app/registrations/[id]/__tests__/page.test.tsx`, `dashboard/components/registration/__tests__/registration-create-form.test.tsx`, `dashboard/components/registration/__tests__/registration-workbench.test.tsx`, `dashboard/components/registration/__tests__/point-picker.test.tsx`, `dashboard/components/registration/__tests__/overlay-view.test.tsx` (`canvas-stub.ts`는 손대지 않는다)

**Interfaces:**
- Consumes:
  - T1: `<Icon name>`(직접 쓰지 않는다 - `Alert`·`StatusIndicator`·`SelectWrap`이 내부에서 쓴다), 토큰 클래스 `text-cs-*`/`bg-cs-*`/`border-cs-*`/`rounded-cs-container`/`shadow-cs-container`.
  - T2: `PAGE_MAIN`(`components/ui/page`), `Button`·`LinkButton`(`components/ui/button`, `variant?: 'primary'|'normal'`), `Container`(`title? counter? actions? padded?=true`), `FormField`(`label htmlFor? description? error?`)·`SelectWrap`·`selectClass`·`checkClass`(`components/ui/form`), `StatusIndicator`(`type`, `data-status`)·`TONE_STATUS`(`components/ui/status-indicator`), `PageHeader`(`crumbs? title description? actions?`), `KeyValuePairs`(`items columns?`), `Alert`(`type title?`, `data-alert`).
  - 소스 기존: `statusTone`(`app/registrations/[id]/page.tsx`), `REGISTRATION_STATUS_LABEL`, `HORIZONTAL_SENSITIVITY_MIN`·`MIN_CORRESPONDENCES`·`horizontalCheck`·`trueOverlapPct`(`lib/domain/registration`), `useRowStatus`, `PointPicker`·`RegistrationOverlay`.
- Produces: 없음(이후 태스크가 쓰는 새 export 없음. `statusTone`의 반환 타입만 `'pass'|'fail'|'unknown'`으로 좁힌다 - 매핑은 그대로).

**이 태스크의 규칙(요약)** - 로직·문구·가드는 한 글자도 바꾸지 않는다. JSX 구조와 클래스만 바꾼다. 캔버스 그리기·좌표 환산·상태 전이·Supabase 호출은 무변경. 뷰당 primary 1개(생성: '대응점 찍기 시작' / 대응점 지정: '정합 실행' / 실패: '대응점 다시 찍기' / 완료: '병합 스캔 열기' 슬롯). 상태·알림 단언은 `data-status`·`data-alert`로 읽는다.

- [ ] **Step 1: 아트보드 확인** — `docs/design/cloudscape/RegistrationNew.dc.html`과 `RegistrationDetail.dc.html`을 Read(또는 브라우저)로 열어 다음 구조를 그대로 옮긴다.
  - RegistrationNew: 브레드크럼(현장 › 현장명 › 측정위치) → h1 '스캔 정합 시작' + 안내문(보조색, h1 아래 gap 4px) → 컨테이너 '스캔 선택'(헤더 12px 20px + 1px 구분선, 본문 padding 20px, 필드 gap 16px, 필드 `max-width: 640px`; 각 필드 = 라벨 700 / 설명 12px 보조색 / 셀렉트 32px·2px `#8c8c94`·radius 8px·chevron) → 컨테이너 밖 우측 정렬 primary '대응점 찍기 시작'.
  - RegistrationDetail: 브레드크럼 → h1 '스캔 정합' + StatusIndicator(success '정합 완료') → 컨테이너 '정합 결과'(본문 gap 16px: 3열 key-value(정합 잔차 RMSE·ICP 반복·겹친 영역(추정), 값 mono tabular, 2·3열 좌측 1px 구분선+padding-left 20px) → warning Alert(수직 방향만 보증) → info Alert(제목 700 '수평 검증 가능성: 낮음 (…)' + 문단 2개)) → 컨테이너 '겹쳐보기 (정합 결과 육안 확인)'(본문 좌 562px 캔버스 틀(1px `#e9ebed`, radius 8px) / 우 flex-1: 슬라이더 줄(12px 보조색) + 설명 + '겹쳐보기의 한계' 박스; 하단 footer 1px 구분선 위 padding 12px 20px: 체크박스 줄 → 버튼 줄(disabled '병합 스캔 열기' + normal '대응점 다시 찍기') → 12px 보조색 안내문).
  - 아트보드에만 있는 것: 캔버스 아래 캡션 "산출물 PNG 자리 (…)"는 플레이스홀더라 옮기지 않는다. '겹쳐보기의 한계' 박스는 결정대로 `Alert type="info"`로 올린다(소스는 회색 박스, 스펙 §7-8 승인). 대응점 지정·진행 중·실패 상태는 아트보드가 없다 - 스펙 §4 해부(Alert info 안내 / Container / StatusIndicator in-progress / Alert error)로 그린다.

- [ ] **Step 2: 실패하는 테스트 작성/갱신** — 여섯 파일 모두 기존 동작 단언은 그대로 두고, 아래 old→new만 적용한다.

`components/registration/__tests__/registration-create-form.test.tsx` — "같은 스캔" 테스트에 알림 단언 추가:
```tsx
// old
    expect(await screen.findByText(/서로 다른 스캔/)).toBeInTheDocument();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
// new
    expect(await screen.findByText(/서로 다른 스캔/)).toBeInTheDocument();
    // 검증 실패는 error Alert로 - 스타일 문자열이 아니라 의미 속성으로 읽는다
    expect(screen.getByText(/서로 다른 스캔/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(insertSpy).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });
```
같은 파일 끝, describe 마지막 테스트 뒤에 구조 테스트 추가:
```tsx
// old
    expect(await screen.findByText(/권한이 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /대응점 찍기 시작/ })).toBeEnabled();
  });
});
// new
    expect(await screen.findByText(/권한이 없습니다/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /대응점 찍기 시작/ })).toBeEnabled();
  });

  // Cloudscape 리스킨(아트보드 RegistrationNew): 컨테이너 '스캔 선택' 안 FormField 두 개
  // (라벨/설명 분리), 컨테이너 밖 우측 primary. 검증·제출 로직은 위 세 테스트가 그대로 잠근다.
  it('컨테이너 "스캔 선택" 안에 A/B 셀렉트를 FormField로, 밖에 primary 제출 버튼을 그린다', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase() as never);
    render(<RegistrationCreateForm scans={SCANS} userId="u1" />);

    expect(screen.getByRole('heading', { level: 2, name: '스캔 선택' })).toBeInTheDocument();
    const a = screen.getByLabelText('기준 스캔 (A)');
    const b = screen.getByLabelText('맞출 스캔 (B)');
    expect(a.className).toContain('border-cs-input-border');
    expect(b.className).toContain('appearance-none');
    expect(screen.getByText('이 스캔의 좌표계를 유지합니다').className).toContain('text-cs-text-secondary');
    expect(screen.getByText('A에 맞춰 회전·이동합니다')).toBeInTheDocument();
    // 셀렉트 옵션 문구(optionLabel, ISO 원문)는 그대로 - 두 셀렉트에 하나씩
    expect(screen.getAllByRole('option', { name: '동쪽.ply · 2026-08-01' })).toHaveLength(2);
    const submit = screen.getByRole('button', { name: /대응점 찍기 시작/ });
    expect(submit.className).toContain('bg-cs-link');
    expect(submit.className).toContain('rounded-full');
  });
});
```

`components/registration/__tests__/point-picker.test.tsx`:
```tsx
// old
    const img = screen.getByRole('img', { name: /A 스캔/ });
    expect(img).toHaveAttribute('src', PLAIN_URL);
    expect(img).not.toHaveAttribute('src', DECORATED_URL);
// new
    const img = screen.getByRole('img', { name: /A 스캔/ });
    expect(img).toHaveAttribute('src', PLAIN_URL);
    expect(img).not.toHaveAttribute('src', DECORATED_URL);
    expect(img.className).toContain('border-cs-divider');
```
```tsx
// old
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/높이 값이 없어/)).toBeInTheDocument();
  });
// new
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/높이 값이 없어/)).toBeInTheDocument();
    expect(screen.getByText(/높이 값이 없어/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
  });
```
```tsx
// old
  it('찍은 점을 순번 마커로 표시한다', () => {
    renderPicker({ markers: [{ px: 0, py: 2, label: '1' }, { px: 4, py: 0, label: '2' }] });
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
// new
  it('찍은 점을 순번 마커로 표시한다', () => {
    renderPicker({ markers: [{ px: 0, py: 2, label: '1' }, { px: 4, py: 0, label: '2' }] });
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('확정 마커는 cs-link, 짝을 기다리는 마커는 cs-warning으로 구분한다', () => {
    renderPicker({ markers: [{ px: 0, py: 2, label: '1' }, { px: 4, py: 0, label: '2', pending: true }] });
    expect(screen.getByText('1').className).toContain('bg-cs-link');
    expect(screen.getByText('2').className).toContain('bg-cs-warning');
  });
```
```tsx
// old
    const { onPick } = renderPicker({ meta: null, metaError: '좌표 정보를 불러오지 못했습니다.' });
    expect(screen.getByText(/좌표 정보를 불러오지 못했습니다/)).toBeInTheDocument();
// new
    const { onPick } = renderPicker({ meta: null, metaError: '좌표 정보를 불러오지 못했습니다.' });
    expect(screen.getByText(/좌표 정보를 불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/좌표 정보를 불러오지 못했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
```
```tsx
// old
      expect(screen.queryByRole('img', { name: /A 스캔/ })).toBeNull();
      expect(screen.getByText(/높이 뷰를 불러오지 못했습니다/)).toBeInTheDocument();
// new
      expect(screen.queryByRole('img', { name: /A 스캔/ })).toBeNull();
      expect(screen.getByText(/높이 뷰를 불러오지 못했습니다/)).toBeInTheDocument();
      expect(screen.getByText(/높이 뷰를 불러오지 못했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
```

`components/registration/__tests__/overlay-view.test.tsx`:
```tsx
// old
    expect(calls[0].alpha).toBe(1);
    expect(calls[1].alpha).toBeCloseTo(0.55, 6);
    expect(calls[1].alpha).toBeLessThan(1);
  });
// new
    expect(calls[0].alpha).toBe(1);
    expect(calls[1].alpha).toBeCloseTo(0.55, 6);
    expect(calls[1].alpha).toBeLessThan(1);
  });

  // 아트보드 RegistrationDetail: 캔버스는 1px 구분선 틀(radius 8px) 안, 슬라이더는 accent 색.
  it('캔버스는 cs-divider 틀 안에, 슬라이더는 accent-cs-link로 그린다', async () => {
    const { container, calls } = mount();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(container.querySelector('canvas')?.parentElement?.className).toContain('border-cs-divider');
    expect(screen.getByRole('slider').className).toContain('accent-cs-link');
  });
```
```tsx
// old
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText(/좌표 정보\(사이드카\)를 불러오지 못해/)).toBeInTheDocument();
    expect(screen.getByText(/수치만으로 이 정합을 승인하지 마세요/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
// new
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText(/좌표 정보\(사이드카\)를 불러오지 못해/)).toBeInTheDocument();
    expect(screen.getByText(/좌표 정보\(사이드카\)를 불러오지 못해/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.getByText(/수치만으로 이 정합을 승인하지 마세요/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
```
```tsx
// old
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText(/정합 변환이 저장되지 않아/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
// new
    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText(/정합 변환이 저장되지 않아/)).toBeInTheDocument();
    expect(screen.getByText(/정합 변환이 저장되지 않아/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(calls).toHaveLength(0);
```
```tsx
// old
    FakeImage.fail = true;
    mount();
    expect(await screen.findByText(/겹쳐보기 그림을 불러오지 못했습니다/)).toBeInTheDocument();
// new
    FakeImage.fail = true;
    mount();
    const warn = await screen.findByText(/겹쳐보기 그림을 불러오지 못했습니다/);
    expect(warn).toBeInTheDocument();
    expect(warn.closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
```
```tsx
// old
    const limit = screen.getByText(/수십 cm급은 정합된 것과/);
    expect(limit).toBeInTheDocument();
    expect(limit).toHaveTextContent('수평 감도가 낮게 나오는 바닥이 정확히 이 경우');
// new
    const limit = screen.getByText(/수십 cm급은 정합된 것과/);
    expect(limit).toBeInTheDocument();
    // 리디자인 결정: 회색 박스였던 한계 안내를 info Alert로 올린다(스펙 §7-8). 경고가 아니다.
    expect(limit.closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
    expect(limit).toHaveTextContent('수평 감도가 낮게 나오는 바닥이 정확히 이 경우');
```

`components/registration/__tests__/registration-workbench.test.tsx`:
```tsx
// old
    mount(reg(), {}, scan({ id: 'sb', height_view_path: null }));

    expect(screen.getByText(/정합을 시작할 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /정합 실행/ })).toBeNull();
// new
    mount(reg(), {}, scan({ id: 'sb', height_view_path: null }));

    expect(screen.getByText(/정합을 시작할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/정합을 시작할 수 없습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
    expect(screen.queryByRole('button', { name: /정합 실행/ })).toBeNull();
```
```tsx
// old
    pickPair(450, 50);

    expect(screen.getByRole('button', { name: /정합 실행/ })).toBeEnabled();
  });
// new
    pickPair(450, 50);

    const run = screen.getByRole('button', { name: /정합 실행/ });
    expect(run).toBeEnabled();
    // 대응점 지정 뷰의 유일한 primary. 안내문은 info Alert.
    expect(run.className).toContain('bg-cs-link');
    expect(screen.getByText(/번갈아 클릭해 쌍을 만드세요/).closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
  });
```
```tsx
// old
  it.each(['queued', 'processing'] as const)('%s면 진행 중임을 알린다', async (status) => {
    mount(reg({ status }));
    expect(await screen.findByText(/정합 중|정합 대기 중/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /정합 실행/ })).toBeNull();
  });
// new
  it.each(['queued', 'processing'] as const)('%s면 진행 중임을 알린다', async (status) => {
    mount(reg({ status }));
    const indicator = await screen.findByText(/정합 중|정합 대기 중/);
    expect(indicator).toBeInTheDocument();
    // 진행 상태는 StatusIndicator in-progress - 스타일이 아니라 의미 속성으로 읽는다
    expect(indicator).toHaveAttribute('data-status', 'in-progress');
    expect(screen.queryByRole('button', { name: /정합 실행/ })).toBeNull();
  });
```
```tsx
// old
    expect(await screen.findByText(/중첩이 부족합니다\(약 6%\)/)).toBeInTheDocument();
  });
});
// new
    expect(await screen.findByText(/중첩이 부족합니다\(약 6%\)/)).toBeInTheDocument();
    // 실패는 error Alert, 다음 행동(대응점 다시 찍기)이 이 뷰의 primary
    expect(screen.getByText(/정합에 실패했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.getByRole('button', { name: /대응점 다시 찍기/ }).className).toContain('bg-cs-link');
  });
});
```
```tsx
// old
    expect(screen.getByRole('heading', { name: /겹쳐보기/ })).toBeInTheDocument();
    expect(container.querySelector('canvas')).not.toBeNull();
  });
// new
    expect(screen.getByRole('heading', { name: /겹쳐보기/ })).toBeInTheDocument();
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  // 아트보드 RegistrationDetail: 컨테이너 '정합 결과'(KeyValuePairs 3열 + warning Alert) →
  // 컨테이너 '겹쳐보기'(체크박스 checkClass, disabled 버튼, 보조색 안내문). 컨테이너는 정확히 둘.
  it('정합 결과·겹쳐보기를 컨테이너와 Cloudscape 프리미티브로 그린다', async () => {
    const { container } = mount(done);
    await screen.findByText(/1\.01/);

    expect(screen.getByRole('heading', { level: 2, name: '정합 결과' })).toBeInTheDocument();
    expect(container.querySelectorAll('.rounded-cs-container')).toHaveLength(2);
    expect(screen.getByText('정합 잔차 RMSE').className).toContain('font-bold');
    expect(screen.getByText(/1\.01/).className).toContain('font-mono');
    expect(screen.getByText(/수직 방향 일치만 보증/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
    expect(screen.getByRole('checkbox', { name: /포개지는/ }).className).toContain('accent-cs-link');
    expect(screen.getByRole('button', { name: /병합 스캔/ }).className).toContain('border-cs-disabled');
    expect(screen.getByRole('button', { name: /대응점 다시 찍기/ }).className).toContain('text-cs-link');
    expect(screen.getByText(/시스템 차원의 승인 절차가 아닙니다/).className).toContain('text-cs-text-secondary');
  });
```
```tsx
// old
    // 경고 색(빨강)으로 칠하지 않는다 - 실패 박스와 같은 무게로 보이면 안 된다.
    expect(box.className).not.toMatch(/red/);
    expect(container.querySelector('.border-red-300')).toBeNull();
  });
// new
    // 정보 알림(info)으로 제시한다 - 실패 알림(error)과 같은 무게로 보이면 안 된다.
    // 스타일 문자열 대신 Alert의 의미 속성(data-alert)으로 읽는다.
    expect(box.closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
    expect(container.querySelector('[data-alert="error"]')).toBeNull();
  });
```

`app/registrations/new/__tests__/page.test.tsx` — 서버 컴포넌트라 `render()` 없이 엘리먼트 트리를 걷는 기존 패턴(`findByType`/`textOf`)을 유지한다. `Alert`·`PageHeader`는 문구를 `title`/`description` prop으로 받으므로 `textOf`가 그 prop도 걷게 한다:
```tsx
// old
import { RegistrationCreateForm } from '@/components/registration/registration-create-form';
import { PageHeader } from '@/components/ui/page-header';
import type { ScanRow } from '@/lib/domain/types';
// new
import { RegistrationCreateForm } from '@/components/registration/registration-create-form';
import { Alert } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import type { ScanRow } from '@/lib/domain/types';
```
```tsx
// old
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!node || typeof node !== 'object') return '';
  return textOf((node as ReactElement & { props?: { children?: unknown } }).props?.children);
}
// new
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!node || typeof node !== 'object') return '';
  // Cloudscape 프리미티브(Alert·PageHeader)는 문구를 title/description prop으로 받는다 -
  // children만 걷으면 제목 문장('… 두 개 이상 필요합니다.')을 놓친다.
  const props = (node as ReactElement<{ title?: unknown; description?: unknown; children?: unknown }>).props;
  return [props?.title, props?.description, props?.children].map(textOf).join('');
}
```
```tsx
// old
    const el = await mount([scan('ok1')]);

    expect(findByType(el, RegistrationCreateForm)).toBeNull();
    expect(textOf(el)).toContain('두 개 이상');
  });
// new
    const el = await mount([scan('ok1')]);

    expect(findByType(el, RegistrationCreateForm)).toBeNull();
    expect(textOf(el)).toContain('두 개 이상');
    expect(textOf(el)).toContain('후보는 1개');
    // 안내는 warning Alert + 막다른 화면 금지(업로드로 가는 primary LinkButton)
    const alert = findByType(el, Alert);
    expect(alert).not.toBeNull();
    expect((alert!.props as { type: string; title: string }).type).toBe('warning');
    expect((alert!.props as { title: string }).title).toBe('정합할 수 있는 스캔이 두 개 이상 필요합니다.');
    const upload = findByType(el, LinkButton);
    expect((upload!.props as { href: string }).href).toBe('/upload?site=s1&location=l1');
    expect((upload!.props as { variant: string }).variant).toBe('primary');
  });
```
```tsx
// old
    expect(props.title).toBe('스캔 정합 시작');
  });
});
// new
    expect(props.title).toBe('스캔 정합 시작');
  });

  // 아트보드 RegistrationNew: 안내문은 h1 아래 설명(PageHeader description), 본문은 공용 PAGE_MAIN.
  it('안내문을 PageHeader description으로, 본문을 PAGE_MAIN으로 그린다', async () => {
    const el = await mount([scan('a'), scan('b')]);
    expect(el.type).toBe('main');
    expect((el.props as { className: string }).className).toBe(PAGE_MAIN);
    const props = findByType(el, PageHeader)!.props as { description: string };
    expect(props.description).toContain('본관 / 1층 / 로비 / 로비 측정위치의 바닥 스캔 두 개를 하나로 합칩니다');
    expect(props.description).toContain('서브셀 중앙값 점군 하나로 병합합니다.');
  });
});
```

`app/registrations/[id]/__tests__/page.test.tsx`:
```tsx
// old
import RegistrationPage, { statusTone } from '../page';
import { RegistrationWorkbench } from '@/components/registration/registration-workbench';
import { PageHeader } from '@/components/ui/page-header';
import type { RegistrationRow, RegistrationStatus, ScanRow } from '@/lib/domain/types';
// new
import RegistrationPage, { statusTone } from '../page';
import { RegistrationWorkbench } from '@/components/registration/registration-workbench';
import { Alert } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { StatusIndicator } from '@/components/ui/status-indicator';
import type { RegistrationRow, RegistrationStatus, ScanRow } from '@/lib/domain/types';
```
```tsx
// old (기존 tsc 오류 - RegistrationRow에 필수인 horizontal_sensitivity가 빠져 있다. 이 태스크가 파일을 만지는 김에 고친다)
const REG: RegistrationRow = {
  id: 'r1', source_scan_ids: ['scanA', 'scanB'], correspondences: [], transform: null,
  rmse_mm: null, iterations: null, overlap_ratio: null, status: 'awaiting_points',
  error_text: null, result_scan_id: null, created_by: null, created_at: '', updated_at: '',
};
// new
const REG: RegistrationRow = {
  id: 'r1', source_scan_ids: ['scanA', 'scanB'], correspondences: [], transform: null,
  rmse_mm: null, iterations: null, overlap_ratio: null, horizontal_sensitivity: null,
  status: 'awaiting_points',
  error_text: null, result_scan_id: null, created_by: null, created_at: '', updated_at: '',
};
```
```tsx
// old
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!node || typeof node !== 'object') return '';
  return textOf((node as ReactElement & { props?: { children?: unknown } }).props?.children);
}
// new
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!node || typeof node !== 'object') return '';
  // Cloudscape 프리미티브(Alert·PageHeader)는 문구를 title/description prop으로 받는다 -
  // children만 걷으면 제목 문장('원본 스캔을 찾을 수 없습니다.')을 놓친다.
  const props = (node as ReactElement<{ title?: unknown; description?: unknown; children?: unknown }>).props;
  return [props?.title, props?.description, props?.children].map(textOf).join('');
}
```
```tsx
// old
    const el = await mount({ scans: [scan('scanA')] });

    expect(findByType(el, RegistrationWorkbench)).toBeNull();
    expect(textOf(el)).toContain('원본 스캔');
  });
// new
    const el = await mount({ scans: [scan('scanA')] });

    expect(findByType(el, RegistrationWorkbench)).toBeNull();
    expect(textOf(el)).toContain('원본 스캔');
    expect((findByType(el, Alert)!.props as { type: string }).type).toBe('warning');
  });

  it('원본 스캔이 없어도 병합 스캔이 남아 있으면 그 링크를 LinkButton으로 낸다', async () => {
    const el = await mount({ registration: { ...REG, result_scan_id: 'merged-9' }, scans: [] });
    const link = findByType(el, LinkButton);
    expect(link).not.toBeNull();
    expect((link!.props as { href: string }).href).toBe('/scans/merged-9');
    expect(textOf(link)).toBe('이 정합이 만든 병합 스캔 열기');
  });
```
```tsx
// old
    expect(props.title).toBe('스캔 정합');
  });

  it('원본 스캔이 둘 다 없으면 현장 홈 크럼만 남긴다', async () => {
// new
    expect(props.title).toBe('스캔 정합');
  });

  // 아트보드 RegistrationDetail: h1 옆 진행 상태는 배지가 아니라 StatusIndicator. 색·아이콘은
  // statusTone(F2) → TONE_STATUS 매핑으로 정해진다(done→success, failed→error, 나머지→pending).
  it.each([
    ['awaiting_points', 'pending', '대응점 지정 대기'],
    ['done', 'success', '정합 완료'],
    ['failed', 'error', '정합 실패'],
  ] as const)('%s 상태를 PageHeader description의 StatusIndicator(%s)로 그린다', async (status, type, label) => {
    const el = await mount({ registration: { ...REG, status } });
    expect(el.type).toBe('main');
    expect((el.props as { className: string }).className).toBe(PAGE_MAIN);
    const desc = (findByType(el, PageHeader)!.props as { description: ReactElement }).description;
    expect(desc.type).toBe(StatusIndicator);
    expect((desc.props as { type: string }).type).toBe(type);
    expect((desc.props as { children: string }).children).toBe(label);
  });

  it('원본 스캔이 둘 다 없으면 현장 홈 크럼만 남긴다', async () => {
```

- [ ] **Step 3: 실패 확인** — `cd dashboard && npx vitest run app/registrations components/registration` → FAIL. 기대 실패: create-form `heading '스캔 선택'` 없음·`getByLabelText('기준 스캔 (A)')` 없음(현재 라벨은 "기준 스캔 (A) - …"); `closest('[data-alert]')`가 null이라 `toHaveAttribute`가 "received value must be an HTMLElement" 로 실패(6개 파일 전부); workbench `data-status` 없음·`.rounded-cs-container` 0개·`border-cs-disabled` 없음; point-picker 마커 `bg-cs-link` 없음; overlay `slider` 클래스에 `accent-cs-link` 없음; 페이지 테스트 `className !== PAGE_MAIN`·`description` undefined·`findByType(el, Alert)` null. 기존 동작 단언은 여전히 PASS 여야 한다(이 단계에서 실패하면 old→new를 잘못 적용한 것).

- [ ] **Step 4: 생성 폼 교체** — `components/registration/registration-create-form.tsx` 전체:

```tsx
// 정합 시작 폼 (단계 F Task 5, 스펙 §6.2 2단계)
//
// registrations 행을 status='awaiting_points'로 만들고 정합 화면으로 보낸다.
// 잡은 아직 걸지 않는다 - 대응점이 있어야 정합을 실행할 수 있다.
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { FormField, SelectWrap, selectClass } from '@/components/ui/form';
import type { ScanRow } from '@/lib/domain/types';

function optionLabel(s: ScanRow): string {
  return `${s.original_filename ?? '(파일명 없음)'} · ${s.scanned_at}`;
}

export function RegistrationCreateForm({ scans, userId }: { scans: ScanRow[]; userId: string }) {
  const router = useRouter();
  const [aId, setAId] = useState(scans[0]?.id ?? '');
  const [bId, setBId] = useState(scans[1]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!aId || !bId || aId === bId) {
      setError('서로 다른 스캔 두 개를 고르세요. 같은 스캔끼리는 정합할 수 없습니다.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    // ★ source_scan_ids의 순서가 계약이다 - a가 [0](기준), b가 [1](맞출 대상)이다
    //   (worker/flatworker/registration.py correspondence_arrays).
    const { data, error: insErr } = await supabase.from('registrations').insert({
      source_scan_ids: [aId, bId],
      correspondences: [],
      status: 'awaiting_points',
      created_by: userId,
    }).select('id').single();
    if (insErr || !data) {
      setError(`정합을 시작하지 못했습니다: ${insErr?.message ?? '알 수 없는 오류'}`);
      setBusy(false);
      return;
    }
    // push만 한다 - 뒤에 refresh를 붙이면 진행 중이던 이동이 취소된다
    // (unit-confirm-form.tsx가 문서화한 회귀).
    router.push(`/registrations/${data.id}`);
  }

  return (
    // 아트보드 RegistrationNew: 컨테이너 '스캔 선택' 안에 A/B 셀렉트(필드 max-w 640px),
    // 컨테이너 밖 우측 정렬 primary. 옛 라벨 "기준 스캔 (A) - 이 스캔의 좌표계를 유지합니다"는
    // " - " 앞뒤를 라벨/설명으로 나눠 옮겼다(문구는 그대로).
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Container title="스캔 선택">
        <div className="flex max-w-[640px] flex-col gap-4">
          <FormField label="기준 스캔 (A)" htmlFor="scan-a" description="이 스캔의 좌표계를 유지합니다">
            <SelectWrap>
              <select id="scan-a" value={aId} onChange={(e) => setAId(e.target.value)} className={selectClass}>
                {scans.map((s) => <option key={s.id} value={s.id}>{optionLabel(s)}</option>)}
              </select>
            </SelectWrap>
          </FormField>
          <FormField label="맞출 스캔 (B)" htmlFor="scan-b" description="A에 맞춰 회전·이동합니다">
            <SelectWrap>
              <select id="scan-b" value={bId} onChange={(e) => setBId(e.target.value)} className={selectClass}>
                {scans.map((s) => <option key={s.id} value={s.id}>{optionLabel(s)}</option>)}
              </select>
            </SelectWrap>
          </FormField>
          {error && <Alert type="error">{error}</Alert>}
        </div>
      </Container>
      <div className="flex items-center justify-end gap-2">
        <Button type="submit" variant="primary" disabled={busy}>대응점 찍기 시작</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: 생성 페이지 교체** — `app/registrations/new/page.tsx` 전체(쿼리·후보 조건·주석 무변경, 안내문은 `description`, 후보 부족 안내는 warning Alert + primary LinkButton):

```tsx
// 정합 시작 화면 (단계 F Task 5, 스펙 §6.2 2단계)
import { notFound, redirect } from 'next/navigation';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { RegistrationCreateForm } from '@/components/registration/registration-create-form';
import { Alert } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import type { LocationRow, ScanRow, SiteRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function NewRegistrationPage(
  { searchParams }: { searchParams: Promise<{ location?: string }> },
) {
  const { location: locationId } = await searchParams;
  const supabase = await createClient();
  // proxy가 검증한 헤더를 읽는다(Auth 왕복 0회). 가드는 방어 심층으로 유지.
  const user = await getRequestUser();
  if (!user) redirect('/login');
  if (!locationId) notFound();

  const { data: location } = await supabase.from('locations').select('*')
    .eq('id', locationId).maybeSingle();
  if (!location) notFound();
  const loc = location as LocationRow;
  const locationLabel = [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ');
  // D8 브리프 Step 2: registrations/*는 현장 › 현장명 › 측정위치 3단계 브레드크럼
  // (scans/[id]·reports/[id]와 같은 규약). 사이트 쿼리 하나만 늘어날 뿐 후보 산출·
  // 제출 로직은 그대로다.
  // perf-auth-roundtrips: site와 scanRows는 서로 독립이라 병렬로 돈다.
  // 벽 스캔은 범위 밖이다 - 높이 뷰가 256x1 픽셀 띠라 클릭이 성립하지 않는다.
  const [{ data: site }, { data: scanRows }] = await Promise.all([
    supabase.from('sites').select('*').eq('id', loc.site_id).maybeSingle(),
    supabase.from('scans').select('*')
      .eq('location_id', locationId).eq('surface', 'floor').is('deleted_at', null)
      .order('scanned_at', { ascending: false }),
  ]);
  const crumbs = [
    { href: '/', label: '현장' },
    { href: `/sites/${loc.site_id}`, label: site ? (site as SiteRow).name : '현장 상세' },
    { label: locationLabel },
  ];

  // 후보 조건은 세 가지다. 셋 다 정합의 전제이며 하나라도 빠지면 워커가 죽는다:
  //   - height_view_path: 대응점을 찍을 그림과 사이드카가 있어야 한다(설계 결정 F7).
  //     산출물 3종은 전부-있음 아니면 전부-없음이라 이 컬럼 하나로 판별된다.
  //   - unit_scale: 워커 load_source_points가 "단위가 확정되지 않아 정합할 수
  //     없습니다"로 거부한다.
  //   - status='ready': 단위 확정이 끝나 분석 가능한 상태.
  const candidates = ((scanRows ?? []) as ScanRow[]).filter(
    (s) => !!s.height_view_path && s.unit_scale !== null && s.status === 'ready',
  );

  // 아트보드 RegistrationNew: 안내문은 h1 아래 설명(PageHeader description) - 문구는 그대로.
  const description = `${locationLabel} 측정위치의 바닥 스캔 두 개를 하나로 합칩니다. 같은 공간을 나눠 찍은 스캔에서 같은 지점을 번갈아 찍어 대응점을 만들고, 그 대응점으로 정합한 뒤 서브셀 중앙값 점군 하나로 병합합니다.`;

  return (
    <main className={PAGE_MAIN}>
      <PageHeader crumbs={crumbs} title="스캔 정합 시작" description={description} />
      {candidates.length < 2 ? (
        // 막다른 화면 금지: 후보가 모자라면 업로드로 가는 버튼이 이 뷰의 유일한(primary) 행동이다.
        <Alert type="warning" title="정합할 수 있는 스캔이 두 개 이상 필요합니다.">
          <p>
            후보가 되려면 바닥 스캔이면서 사전 검사가 끝나 높이 뷰가 있고 단위가 확정된
            (분석 준비됨) 상태여야 합니다. 현재 이 측정위치의 후보는 {candidates.length}개입니다.
          </p>
          <div className="mt-3">
            <LinkButton href={`/upload?site=${loc.site_id}&location=${loc.id}`} variant="primary">
              스캔 업로드
            </LinkButton>
          </div>
        </Alert>
      ) : (
        <RegistrationCreateForm scans={candidates} userId={user.id} />
      )}
    </main>
  );
}
```

- [ ] **Step 6: 상세 페이지 교체** — `app/registrations/[id]/page.tsx` 전체(쿼리·순서 복원·브레드크럼 로직과 주석 무변경. `Badge` → `StatusIndicator`, `statusTone` 매핑 그대로 - 반환 타입만 `TONE_STATUS` 색인용으로 좁힌다):

```tsx
// 정합 화면 (단계 F Task 5, 스펙 §7.4)
import { notFound, redirect } from 'next/navigation';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { RegistrationWorkbench } from '@/components/registration/registration-workbench';
import { Alert } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
import { REGISTRATION_STATUS_LABEL } from '@/lib/domain/labels';
import type { LocationRow, RegistrationRow, RegistrationStatus, ScanRow, SiteRow } from '@/lib/domain/types';

// 진행 상태 배지는 판정이 아니라 "진행이 어디까지 왔나"를 보여준다 - 완료만 pass,
// 실패만 fail, 나머지(대응점 대기·정합 대기·정합 중)는 아직 결과가 없으니 unknown.
// export: F2 픽스 - 단위 테스트가 페이지 서버 함수를 거치지 않고 이 매핑만 직접 검증한다.
// 반환 타입을 세 톤으로 좁힌 것은 TONE_STATUS(pass/warn/fail/unknown/busy) 색인을 위해서다 -
// 매핑 자체는 그대로다.
export function statusTone(status: RegistrationStatus): 'pass' | 'fail' | 'unknown' {
  if (status === 'done') return 'pass';
  if (status === 'failed') return 'fail';
  return 'unknown';
}

export const dynamic = 'force-dynamic';

export default async function RegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // proxy가 검증한 헤더를 읽는다(Auth 왕복 0회). 가드는 방어 심층으로 유지.
  const user = await getRequestUser();
  if (!user) redirect('/login');

  // ★ 진행 상태는 registrations에서만 읽는다(설계 결정 F10). jobs 테이블은 RLS
  //   정책이 0개라 대시보드가 아예 읽지 못한다.
  const { data: row } = await supabase.from('registrations').select('*')
    .eq('id', id).maybeSingle();
  if (!row) notFound();
  const registration = row as RegistrationRow;

  const { data: scanRows } = await supabase.from('scans').select('*')
    .in('id', registration.source_scan_ids);
  // ★ .in()은 배열 순서를 보장하지 않는다. source_scan_ids 순서로 다시 세우지 않으면
  //   A와 B가 뒤바뀌어, 워커가 대응점 a를 source_scan_ids[0]으로 해석하는 계약이
  //   깨진다 - 대응점이 서로 반대 스캔에 붙어 정합이 통째로 틀린다(조용한 실패).
  const byId = new Map(((scanRows ?? []) as ScanRow[]).map((s) => [s.id, s]));
  const scanA = byId.get(registration.source_scan_ids[0]);
  const scanB = byId.get(registration.source_scan_ids[1]);

  // D8 브리프 Step 2: scans/[id]·reports/[id]와 같은 3단계 브레드크럼(현장 › 현장명 ›
  // 측정위치)을 이 화면에도 맞춘다. registrations 행 자체에는 위치 정보가 없어
  // 원본 스캔의 location_id를 거쳐 조회한다 - 원본 스캔이 둘 다 지워졌으면(위 "원본
  // 스캔을 찾을 수 없습니다" 분기) 위치를 알 수 없으니 현장 홈 링크만 남긴다.
  const scanForLocation = scanA ?? scanB;
  let crumbs: { href?: string; label: string }[] = [{ href: '/', label: '현장' }];
  if (scanForLocation) {
    const { data: locRow } = await supabase.from('locations').select('*')
      .eq('id', scanForLocation.location_id).maybeSingle();
    if (locRow) {
      const loc = locRow as LocationRow;
      const { data: siteRow } = await supabase.from('sites').select('*')
        .eq('id', loc.site_id).maybeSingle();
      const locationLabel = [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ');
      crumbs = [
        { href: '/', label: '현장' },
        { href: `/sites/${loc.site_id}`, label: siteRow ? (siteRow as SiteRow).name : '현장 상세' },
        { label: locationLabel },
      ];
    }
  }

  return (
    <main className={PAGE_MAIN}>
      {/* 아트보드 RegistrationDetail: h1 '스캔 정합' + 진행 상태 StatusIndicator(배지 → 상태 표시기) */}
      <PageHeader crumbs={crumbs} title="스캔 정합" description={
        <StatusIndicator type={TONE_STATUS[statusTone(registration.status)]}>
          {REGISTRATION_STATUS_LABEL[registration.status]}
        </StatusIndicator>
      } />
      {scanA && scanB ? (
        <RegistrationWorkbench registration={registration} scanA={scanA} scanB={scanB} />
      ) : (
        // registrations.source_scan_ids는 배열이라 FK가 없다 - 원본 스캔이 지워지면
        // 죽은 id가 남는 것을 007이 이력 테이블로서 의도적으로 허용했다. 화면이 견딘다.
        <Alert type="warning" title="원본 스캔을 찾을 수 없습니다.">
          <p>
            정합에 쓰인 스캔이 삭제된 것 같습니다. 이 정합 이력은 남지만 대응점을 다시
            찍을 수는 없습니다. 새 정합을 시작하세요.
          </p>
          {registration.result_scan_id && (
            <div className="mt-3">
              <LinkButton href={`/scans/${registration.result_scan_id}`}>이 정합이 만든 병합 스캔 열기</LinkButton>
            </div>
          )}
        </Alert>
      )}
    </main>
  );
}
```

- [ ] **Step 7: PointPicker 재스킨** — `components/registration/point-picker.tsx`. 클릭 → 좌표 환산·`viewFailed`·`cellError` 로직은 손대지 않는다. 두 곳만 바꾼다.

import 추가:
```tsx
// old
'use client';
import { useEffect, useRef, useState } from 'react';
import { imageSize, pixelToWorld, plainPngUrl } from '@/lib/domain/height-view';
// new
'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { imageSize, pixelToWorld, plainPngUrl } from '@/lib/domain/height-view';
```
return 블록 전체(`const size = meta ? imageSize(meta) : null;` 다음 줄부터 함수 끝까지):
```tsx
// old
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {viewFailed ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-zinc-700">
          높이 뷰를 불러오지 못했습니다. 이 스캔의 산출물이 지워졌거나 아직 사전 검사가
          끝나지 않았을 수 있습니다. 스캔 상세에서 상태를 확인하세요.
        </p>
      ) : (
        <div className="relative inline-block w-full">
          {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
              (components/unit-confirm-form.tsx와 같은 판단) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={plainPngUrl(heightViewPath)}
            alt={`${title} 높이 뷰(무장식) - 클릭해 대응점을 찍습니다`}
            onError={() => setViewFailed(true)}
            onClick={onClick}
            // image-rendering: pixelated - 격자 1칸이 1픽셀이라 확대하면 뭉개진다.
            // 셀 경계가 보여야 사용자가 "어느 칸을 찍는지" 알 수 있다.
            style={{ imageRendering: 'pixelated' }}
            className={`block w-full rounded border bg-white ${clickable ? 'cursor-crosshair' : 'cursor-not-allowed opacity-90'}`} />
          {size && markers.map((m) => (
            <span key={`${m.label}-${m.px}-${m.py}`}
              style={{
                left: `${((m.px + 0.5) / size.width) * 100}%`,
                top: `${((m.py + 0.5) / size.height) * 100}%`,
              }}
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white px-1.5 text-[10px] font-bold leading-4 text-white ${m.pending ? 'bg-amber-600' : 'bg-zinc-900'}`}>
              {m.label}
            </span>
          ))}
        </div>
      )}
      {metaError && (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-zinc-700">
          {metaError}
        </p>
      )}
      {cellError && <p className="text-xs text-red-600">{cellError}</p>}
    </section>
  );
}
// new
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-bold">{title}</h3>
      {viewFailed ? (
        <Alert type="warning">
          높이 뷰를 불러오지 못했습니다. 이 스캔의 산출물이 지워졌거나 아직 사전 검사가
          끝나지 않았을 수 있습니다. 스캔 상세에서 상태를 확인하세요.
        </Alert>
      ) : (
        <div className="relative inline-block w-full">
          {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
              (components/unit-confirm-form.tsx와 같은 판단) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={plainPngUrl(heightViewPath)}
            alt={`${title} 높이 뷰(무장식) - 클릭해 대응점을 찍습니다`}
            onError={() => setViewFailed(true)}
            onClick={onClick}
            // image-rendering: pixelated - 격자 1칸이 1픽셀이라 확대하면 뭉개진다.
            // 셀 경계가 보여야 사용자가 "어느 칸을 찍는지" 알 수 있다.
            style={{ imageRendering: 'pixelated' }}
            className={`block w-full rounded-lg border border-cs-divider bg-white ${clickable ? 'cursor-crosshair' : 'cursor-not-allowed opacity-90'}`} />
          {/* 마커: 확정 쌍은 cs-link, 반대쪽을 기다리는 점은 cs-warning. img 바로 다음 span이어야
              한다 - 작업대 테스트가 img.parentElement의 첫 span을 마커로 읽는다. */}
          {size && markers.map((m) => (
            <span key={`${m.label}-${m.px}-${m.py}`}
              style={{
                left: `${((m.px + 0.5) / size.width) * 100}%`,
                top: `${((m.py + 0.5) / size.height) * 100}%`,
              }}
              className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white px-1.5 text-[10px] font-bold leading-4 text-white ${m.pending ? 'bg-cs-warning' : 'bg-cs-link'}`}>
              {m.label}
            </span>
          ))}
        </div>
      )}
      {metaError && <Alert type="warning">{metaError}</Alert>}
      {cellError && <Alert type="error">{cellError}</Alert>}
    </section>
  );
}
```

- [ ] **Step 8: 겹쳐보기 재스킨** — `components/registration/overlay-view.tsx`. `unavailable`·`view`·`useEffect`(캔버스 그리기)는 무변경. import와 두 return만 바꾼다.

```tsx
// old
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { plainPngUrl } from '@/lib/domain/height-view';
// new
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { plainPngUrl } from '@/lib/domain/height-view';
```
```tsx
// old
  if (unavailable) {
    return (
      <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-zinc-700">
        <span className="font-medium text-red-700">{unavailable}</span>
        <span className="mt-1 block text-xs">
          겹쳐보기는 RMSE가 원리적으로 못 보는 수평 방향 어긋남을 확인하는 유일한 수단입니다.
          그림 없이 수치만으로 이 정합을 승인하지 마세요. 스캔 산출물을 복구한 뒤 이 화면을
          새로고침하거나, 대응점을 다시 찍어 정합을 다시 실행하세요.
        </span>
      </p>
    );
  }
// new
  if (unavailable) {
    return (
      <Alert type="error" title={unavailable}>
        겹쳐보기는 RMSE가 원리적으로 못 보는 수평 방향 어긋남을 확인하는 유일한 수단입니다.
        그림 없이 수치만으로 이 정합을 승인하지 마세요. 스캔 산출물을 복구한 뒤 이 화면을
        새로고침하거나, 대응점을 다시 찍어 정합을 다시 실행하세요.
      </Alert>
    );
  }
```
```tsx
// old
  return (
    <div className="space-y-2">
      {failed && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-xs text-zinc-700">
          겹쳐보기 그림을 불러오지 못했습니다. 두 스캔의 높이 뷰 산출물을 확인하세요.
          그림 없이 RMSE만으로 승인하지 마세요.
        </p>
      )}
      <canvas ref={canvasRef} className="max-w-full rounded border bg-white" />
      <label className="flex items-center gap-2 text-xs text-zinc-600">
        <span className="whitespace-nowrap">맞춘 스캔(B) 진하기</span>
        <input type="range" min={0} max={100} value={Math.round(opacity * 100)}
          onChange={(e) => setOpacity(Number(e.target.value) / 100)}
          className="w-40" />
        <span className="tabular-nums">{Math.round(opacity * 100)}%</span>
      </label>
      <p className="text-xs text-zinc-500">
        슬라이더를 좌우로 움직이며 두 그림의 벽·기둥·모서리 같은 특징이 같은 자리에
        오는지 보세요. 겹쳐지지 않고 나란히 밀려 있으면 수평으로 어긋난 정합입니다.
      </p>
      {/* ★ 리뷰 I4·I5: 이 그림을 최종 심급으로 읽으면 안 된다. 겹친 영역 무늬의 상관을
          실측하면 미터급은 확실히 드러나지만(정합 +0.896 대 3m +0.129) 30cm급은 정합과
          거의 구별되지 않고(+0.840), 특징이 없는 완전 평면에서는 신호 자체가 0이다
          (+0.014 대 +0.043). 한계를 밝히지 않으면 "겹쳐 봤으니 괜찮다"가 근거 없는
          안심이 된다.
          ★ 위쪽 "수평 검증 가능성" 안내와 **같은 현상의 두 얼굴**이다 - 감도가 낮게
          나오는 평탄한 바닥이 정확히 이 그림도 안 통하는 바닥이다. 두 안내가 같은
          이야기를 하도록 문구를 맞춰 둔다. */}
      <p className="rounded bg-zinc-100 p-2 text-xs text-zinc-600">
        겹쳐보기의 한계: 미터급 어긋남은 확실히 드러나지만 수십 cm급은 정합된 것과
        구별하기 어렵습니다(실측 30cm 오정합의 무늬 상관 0.840 대 정합 0.896).
        평탄해서 벽·기둥·요철 같은 특징이 없는 바닥일수록 그렇습니다 - 수평 감도가 낮게
        나오는 바닥이 정확히 이 경우입니다. 이 방향의 보장은 결국 대응점을 넓게 분산해
        찍었는가에 달려 있습니다.
      </p>
    </div>
  );
}
// new
  return (
    // 아트보드 RegistrationDetail '겹쳐보기' 본문: 좌 562px 캔버스 틀(1px 구분선, radius 8px) /
    // 우 flex-1 설명(슬라이더 줄 → 안내 → 한계 Alert). 좁은 화면(<lg)은 세로 스택.
    <div className="flex flex-col items-start gap-5 lg:flex-row">
      <div className="flex w-full shrink-0 flex-col gap-1 lg:w-[562px]">
        {failed && (
          <Alert type="error">
            겹쳐보기 그림을 불러오지 못했습니다. 두 스캔의 높이 뷰 산출물을 확인하세요.
            그림 없이 RMSE만으로 승인하지 마세요.
          </Alert>
        )}
        <div className="flex overflow-hidden rounded-lg border border-cs-divider bg-white">
          <canvas ref={canvasRef} className="max-w-full" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <label className="flex items-center gap-2 text-xs leading-4 text-cs-text-secondary">
          <span className="whitespace-nowrap">맞춘 스캔(B) 진하기</span>
          <input type="range" min={0} max={100} value={Math.round(opacity * 100)}
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            className="w-40 accent-cs-link" />
          <span className="tabular-nums">{Math.round(opacity * 100)}%</span>
        </label>
        <p className="text-xs leading-4 text-cs-text-secondary">
          슬라이더를 좌우로 움직이며 두 그림의 벽·기둥·모서리 같은 특징이 같은 자리에
          오는지 보세요. 겹쳐지지 않고 나란히 밀려 있으면 수평으로 어긋난 정합입니다.
        </p>
        {/* ★ 리뷰 I4·I5: 이 그림을 최종 심급으로 읽으면 안 된다. 겹친 영역 무늬의 상관을
            실측하면 미터급은 확실히 드러나지만(정합 +0.896 대 3m +0.129) 30cm급은 정합과
            거의 구별되지 않고(+0.840), 특징이 없는 완전 평면에서는 신호 자체가 0이다
            (+0.014 대 +0.043). 한계를 밝히지 않으면 "겹쳐 봤으니 괜찮다"가 근거 없는
            안심이 된다.
            ★ 위쪽 "수평 검증 가능성" 안내와 **같은 현상의 두 얼굴**이다 - 감도가 낮게
            나오는 평탄한 바닥이 정확히 이 그림도 안 통하는 바닥이다. 두 안내가 같은
            이야기를 하도록 문구를 맞춰 둔다.
            리디자인: 회색 박스 → info Alert(스펙 §7-8). 경고(warning)가 아니다 - 늑대소년 방지. */}
        <Alert type="info">
          겹쳐보기의 한계: 미터급 어긋남은 확실히 드러나지만 수십 cm급은 정합된 것과
          구별하기 어렵습니다(실측 30cm 오정합의 무늬 상관 0.840 대 정합 0.896).
          평탄해서 벽·기둥·요철 같은 특징이 없는 바닥일수록 그렇습니다 - 수평 감도가 낮게
          나오는 바닥이 정확히 이 경우입니다. 이 방향의 보장은 결국 대응점을 넓게 분산해
          찍었는가에 달려 있습니다.
        </Alert>
      </div>
    </div>
  );
}
```

- [ ] **Step 9: 작업대 재스킨** — `components/registration/registration-workbench.tsx`. 상태·효과·`onPickA/B`·`removePair`·`runRegistration`·`repick`·`overlayBlocked` 계산과 그 주석은 한 줄도 바꾸지 않는다. import와 다섯 분기의 JSX만 바꾼다.

import:
```tsx
// old
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
// new
'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button, LinkButton } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { checkClass } from '@/components/ui/form';
import { KeyValuePairs } from '@/components/ui/key-value';
import { StatusIndicator } from '@/components/ui/status-indicator';
import { createClient } from '@/lib/supabase/client';
```

(a) 높이 뷰 없음:
```tsx
// old
  if (!ready) {
    return (
      <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-medium">정합을 시작할 수 없습니다.</p>
        <p className="mt-1 text-xs text-zinc-700">
          두 스캔 모두 높이 뷰가 있어야 대응점을 찍을 수 있습니다. 높이 뷰가 없는 스캔은
          {' '}{!pathA ? scanLabel(scanA) : scanLabel(scanB)}입니다. 사전 검사를 돌지 않았거나
          산출물 생성이 실패한 스캔이므로, 스캔 상세에서 상태를 확인하고 필요하면 다시
          업로드하세요.
        </p>
      </div>
    );
  }
// new
  if (!ready) {
    return (
      <Alert type="warning" title="정합을 시작할 수 없습니다.">
        두 스캔 모두 높이 뷰가 있어야 대응점을 찍을 수 있습니다. 높이 뷰가 없는 스캔은
        {' '}{!pathA ? scanLabel(scanA) : scanLabel(scanB)}입니다. 사전 검사를 돌지 않았거나
        산출물 생성이 실패한 스캔이므로, 스캔 상세에서 상태를 확인하고 필요하면 다시
        업로드하세요.
      </Alert>
    );
  }
```

(b) 진행 중:
```tsx
// old
  if (liveStatus === 'queued' || liveStatus === 'processing') {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-600">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-zinc-500" />
        {REGISTRATION_STATUS_LABEL[liveStatus]}... 워커가 두 점군을 읽어 정합하는 중입니다.
        점 수에 따라 수십 초에서 수 분 걸릴 수 있고, 이 화면은 자동 갱신됩니다.
      </p>
    );
  }
// new
  if (liveStatus === 'queued' || liveStatus === 'processing') {
    return (
      <Container>
        <StatusIndicator type="in-progress">
          {REGISTRATION_STATUS_LABEL[liveStatus]}... 워커가 두 점군을 읽어 정합하는 중입니다.
          점 수에 따라 수십 초에서 수 분 걸릴 수 있고, 이 화면은 자동 갱신됩니다.
        </StatusIndicator>
      </Container>
    );
  }
```

(c) 실패:
```tsx
// old
  if (liveStatus === 'failed') {
    return (
      <div className="space-y-3">
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-700">정합에 실패했습니다.</p>
          <p className="mt-1 text-zinc-700">
            {registration.error_text ?? '사유가 기록되지 않았습니다. 잠시 후 다시 시도하세요.'}
          </p>
        </div>
        <button type="button" onClick={repick} disabled={busy}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
          대응점 다시 찍기
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }
// new
  if (liveStatus === 'failed') {
    return (
      <div className="flex flex-col gap-4">
        <Alert type="error" title="정합에 실패했습니다.">
          {registration.error_text ?? '사유가 기록되지 않았습니다. 잠시 후 다시 시도하세요.'}
        </Alert>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={repick} disabled={busy}>대응점 다시 찍기</Button>
        </div>
        {error && <Alert type="error">{error}</Alert>}
      </div>
    );
  }
```

(d) 완료 - `if (liveStatus === 'done') {` 안에서 `const overlayBlocked = …;` 계산 다음의 `return ( … );` 전체를 교체한다. 옛 블록(정확히 이 범위):
```tsx
// old
    return (
      <div className="space-y-4">
        <section className="space-y-2">
          <h2 className="font-semibold">정합 결과</h2>
          <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 rounded border bg-white p-4 text-sm">
            <dt className="text-zinc-500">정합 잔차 RMSE</dt>
            <dd className="font-mono tabular-nums">
              {registration.rmse_mm === null ? '-' : `${registration.rmse_mm.toFixed(2)} mm`}
            </dd>
            <dt className="text-zinc-500">ICP 반복</dt>
            <dd className="font-mono tabular-nums">{registration.iterations ?? '-'}</dd>
            {/* ★ overlap_ratio 원값을 그대로 쓰지 않는다(스펙 §9.3.4). trimmed ICP가
                항상 하위 80%만 쓰므로 100% 겹쳐도 원값은 0.8이 최대다 - 그대로
                보여주면 "80%밖에 안 겹쳤네"로 오해한다. */}
            <dt className="text-zinc-500">겹친 영역(추정)</dt>
            <dd className="font-mono tabular-nums">{overlap === null ? '-' : `${overlap.toFixed(0)}%`}</dd>
          </dl>
          {/* ★ RMSE 하나만 크게 띄우지 않는다(스펙 §9.3.2 남는 위험). 리뷰 I4·I5:
              두 지표가 **서로 다른 축**을 본다는 사실을 먼저 말한다 - 그러지 않으면
              겹쳐보기가 RMSE의 상위 심급처럼 읽힌다. */}
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-zinc-700">
            이 수치는 수직 방향 일치만 보증합니다. 평탄한 바닥에서는 두 스캔이 수평으로 수
            미터 어긋나 있어도 이 값이 1mm 근처로 나옵니다(설계 검증에서 실측한 사실입니다).
            RMSE는 수직, 아래 겹쳐보기는 수평 - 두 확인은 서로 다른 축을 보며 어느 한쪽이
            다른 쪽을 대신하지 못합니다. 이 숫자만 보고 승인하지 마세요.
          </p>
          {/* ★ 엔진 감도 프로브(HORIZONTAL_SENSITIVITY_MIN). 세 게이트(수렴·중첩·RMSE)가
              전부 침묵하는 사각에서 유일하게 신호를 내는 값이다 - 실측: 완전 평면 대응점
              통째 3m 오클릭에서 면내 3.000m / RMSE 1.008mm / converged=True / 사유 없음인데
              감도 0.994.

              ★★ 이것을 "이상 경고"로 쓰면 안 된다(재리뷰 정정). 바닥이 평탄할수록 값이
              낮아지고(±12mm 1.710 / ±6mm 1.218 / ±3.5mm 1.084 / ±2.5mm 1.038, 교차점
              약 ±4.5mm), 스펙이 정의한 이 용역의 대상이 ±5mm 평탄 바닥이라 **스펙을
              만족하는 좋은 바닥일수록 'weak'가 나온다.** 거의 항상 뜨는 안내를 빨간
              경고로 만들면 늑대소년이 되어 사용자가 곧 무시한다. 그래서 "오류·이상·실패"
              라는 말을 쓰지 않고 정보로 제시하며, 전달할 것은 **왜**와 **그래서 뭘
              해야 하나** 둘뿐이다. 값이 없으면(구 데이터·012 미적용 DB) 아무것도 안 띄운다. */}
          {horizontal === 'weak' && (
            <div className="rounded border border-zinc-300 bg-zinc-50 p-3 text-xs text-zinc-700">
              <p className="font-medium">
                수평 검증 가능성: 낮음 (수평 감도 {sensitivityText}, 기준 {HORIZONTAL_SENSITIVITY_MIN})
              </p>
              <p className="mt-1">
                바닥이 평탄할수록 이 값은 낮게 나옵니다. 평탄한 면은 자기 위로 밀어도 모양이
                같아서, 두 스캔의 수평 위치를 데이터만으로 판별할 정보가 원래 없기 때문입니다.
                이 용역의 대상인 ±5mm 평탄 바닥에서는 낮게 나오는 것이 정상이고 흔합니다.
              </p>
              <p className="mt-1">
                같은 이유로 아래 겹쳐보기도 이 바닥에서는 신호가 약합니다. 즉 수치로도
                그림으로도 수평 방향을 확실히 보장할 수는 없습니다. 대응점을 서로 멀리
                떨어뜨려 넓게 분산해 찍은 것이 이 방향의 유일한 보장이므로, 찍은 자리가 두
                스캔에서 정말 같은 지점이었는지 되짚어 보세요. 확신이 없으면 대응점을 다시
                찍되 더 넓게 흩어 고르세요.
              </p>
            </div>
          )}
          {horizontal === 'ok' && (
            <p className="rounded border border-zinc-200 bg-white p-3 text-xs text-zinc-600">
              수평 검증 가능성: 있음 (수평 감도 {sensitivityText}, 기준 {HORIZONTAL_SENSITIVITY_MIN}).
              이 장면에는 수평 위치를 구속하는 특징(벽·기둥·요철)이 있어, 수평으로 어긋나면
              위 RMSE도 함께 올라갑니다. 그래도 아래 겹쳐보기로 한 번 더 확인하세요.
            </p>
          )}
        </section>
        <section className="space-y-2">
          <h2 className="font-semibold">겹쳐보기 (정합 결과 육안 확인)</h2>
          <RegistrationOverlay pathA={pathA} pathB={pathB} metaA={metaA} metaB={metaB}
            unitScaleA={scanA.unit_scale ?? 1} unitScaleB={scanB.unit_scale ?? 1}
            transform={registration.transform} />
        </section>
        <section className="space-y-2">
          {/* ★ 리뷰 C1: 겹쳐보기를 못 그렸으면 "확인했습니다"를 체크할 수 없어야 한다.
              그러지 않으면 사용자가 빈 상자를 보고 체크해 방어가 조용히 0이 된다. */}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmedVisually && !overlayBlocked} className="mt-1"
              disabled={!!overlayBlocked}
              onChange={(e) => setConfirmedVisually(e.target.checked)} />
            <span className={overlayBlocked ? 'text-zinc-400' : undefined}>
              겹쳐보기에서 두 스캔이 실제로 포개지는 것을 확인했습니다.
            </span>
          </label>
          {overlayBlocked && (
            <p className="text-xs text-red-700">
              {overlayBlocked} 겹쳐보기를 볼 수 없는 상태에서는 이 확인을 체크할 수 없습니다.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {confirmedVisually && !overlayBlocked && registration.result_scan_id ? (
              <Link href={`/scans/${registration.result_scan_id}`}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">
                병합 스캔 열기
              </Link>
            ) : (
              <button type="button" disabled
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white opacity-50">
                병합 스캔 열기
              </button>
            )}
            {askRepick ? (
              <span className="flex items-center gap-2 text-sm">
                <span className="text-red-700">
                  이 정합으로 만들어진 병합 스캔이 삭제됩니다. 계속할까요?
                </span>
                <button type="button" onClick={repick} disabled={busy}
                  className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50">
                  삭제하고 다시 찍기
                </button>
                <button type="button" onClick={() => setAskRepick(false)}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
                  취소
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setAskRepick(true)}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
                대응점 다시 찍기
              </button>
            )}
          </div>
          {/* ★ 리뷰 I1: 이 체크는 승인 게이트가 아니라 권고다. 정직하게 밝힌다 -
              "체크해야만 쓸 수 있다"고 읽히면, 다른 경로로 들어온 사용자가 검증을
              건너뛰었다는 사실 자체가 감춰진다. */}
          <p className="text-xs text-zinc-500">
            병합 스캔은 정합이 성공한 시점에 이미 만들어져 있습니다(데이터 계보 &quot;정합 병합&quot;).
            위 확인은 이 화면의 안내 장치일 뿐 시스템 차원의 승인 절차가 아닙니다.
            체크하지 않아도 병합 스캔은 측정위치 목록과 스캔 상세에 이미 나타나 있고,
            스캔 상세의 &quot;평활도 분석&quot; 버튼을 누르면 이 겹쳐보기를 한 번도 보지 않은
            채로 분석이 시작됩니다. 그러니 이 정합을 쓰지 않기로 했다면
            아래 &quot;대응점 다시 찍기&quot;로 병합 스캔을 정리하세요.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>
      </div>
    );
  }
// new
    return (
      <div className="flex flex-col gap-5">
        {/* 아트보드 RegistrationDetail: 컨테이너 '정합 결과' = KeyValuePairs 3열 → warning Alert → info Alert */}
        <Container title="정합 결과">
          <div className="flex flex-col gap-4">
            <KeyValuePairs columns={3} items={[
              {
                label: '정합 잔차 RMSE',
                value: (
                  <span className="font-mono tabular-nums">
                    {registration.rmse_mm === null ? '-' : `${registration.rmse_mm.toFixed(2)} mm`}
                  </span>
                ),
              },
              {
                label: 'ICP 반복',
                value: <span className="font-mono tabular-nums">{registration.iterations ?? '-'}</span>,
              },
              // ★ overlap_ratio 원값을 그대로 쓰지 않는다(스펙 §9.3.4). trimmed ICP가
              //   항상 하위 80%만 쓰므로 100% 겹쳐도 원값은 0.8이 최대다 - 그대로
              //   보여주면 "80%밖에 안 겹쳤네"로 오해한다.
              {
                label: '겹친 영역(추정)',
                value: <span className="font-mono tabular-nums">{overlap === null ? '-' : `${overlap.toFixed(0)}%`}</span>,
              },
            ]} />
            {/* ★ RMSE 하나만 크게 띄우지 않는다(스펙 §9.3.2 남는 위험). 리뷰 I4·I5:
                두 지표가 **서로 다른 축**을 본다는 사실을 먼저 말한다 - 그러지 않으면
                겹쳐보기가 RMSE의 상위 심급처럼 읽힌다. */}
            <Alert type="warning">
              이 수치는 수직 방향 일치만 보증합니다. 평탄한 바닥에서는 두 스캔이 수평으로 수
              미터 어긋나 있어도 이 값이 1mm 근처로 나옵니다(설계 검증에서 실측한 사실입니다).
              RMSE는 수직, 아래 겹쳐보기는 수평 - 두 확인은 서로 다른 축을 보며 어느 한쪽이
              다른 쪽을 대신하지 못합니다. 이 숫자만 보고 승인하지 마세요.
            </Alert>
            {/* ★ 엔진 감도 프로브(HORIZONTAL_SENSITIVITY_MIN). 세 게이트(수렴·중첩·RMSE)가
                전부 침묵하는 사각에서 유일하게 신호를 내는 값이다 - 실측: 완전 평면 대응점
                통째 3m 오클릭에서 면내 3.000m / RMSE 1.008mm / converged=True / 사유 없음인데
                감도 0.994.

                ★★ 이것을 "이상 경고"로 쓰면 안 된다(재리뷰 정정). 바닥이 평탄할수록 값이
                낮아지고(±12mm 1.710 / ±6mm 1.218 / ±3.5mm 1.084 / ±2.5mm 1.038, 교차점
                약 ±4.5mm), 스펙이 정의한 이 용역의 대상이 ±5mm 평탄 바닥이라 **스펙을
                만족하는 좋은 바닥일수록 'weak'가 나온다.** 거의 항상 뜨는 안내를 빨간
                경고로 만들면 늑대소년이 되어 사용자가 곧 무시한다. 그래서 "오류·이상·실패"
                라는 말을 쓰지 않고 정보로 제시하며, 전달할 것은 **왜**와 **그래서 뭘
                해야 하나** 둘뿐이다. 값이 없으면(구 데이터·012 미적용 DB) 아무것도 안 띄운다.
                리디자인: 회색 박스 → info Alert(스펙 §7-8 승인). warning/error가 아니다. */}
            {horizontal === 'weak' && (
              <Alert type="info"
                title={`수평 검증 가능성: 낮음 (수평 감도 ${sensitivityText}, 기준 ${HORIZONTAL_SENSITIVITY_MIN})`}>
                <p>
                  바닥이 평탄할수록 이 값은 낮게 나옵니다. 평탄한 면은 자기 위로 밀어도 모양이
                  같아서, 두 스캔의 수평 위치를 데이터만으로 판별할 정보가 원래 없기 때문입니다.
                  이 용역의 대상인 ±5mm 평탄 바닥에서는 낮게 나오는 것이 정상이고 흔합니다.
                </p>
                <p className="mt-1">
                  같은 이유로 아래 겹쳐보기도 이 바닥에서는 신호가 약합니다. 즉 수치로도
                  그림으로도 수평 방향을 확실히 보장할 수는 없습니다. 대응점을 서로 멀리
                  떨어뜨려 넓게 분산해 찍은 것이 이 방향의 유일한 보장이므로, 찍은 자리가 두
                  스캔에서 정말 같은 지점이었는지 되짚어 보세요. 확신이 없으면 대응점을 다시
                  찍되 더 넓게 흩어 고르세요.
                </p>
              </Alert>
            )}
            {horizontal === 'ok' && (
              <Alert type="info">
                수평 검증 가능성: 있음 (수평 감도 {sensitivityText}, 기준 {HORIZONTAL_SENSITIVITY_MIN}).
                이 장면에는 수평 위치를 구속하는 특징(벽·기둥·요철)이 있어, 수평으로 어긋나면
                위 RMSE도 함께 올라갑니다. 그래도 아래 겹쳐보기로 한 번 더 확인하세요.
              </Alert>
            )}
          </div>
        </Container>
        {/* 컨테이너 '겹쳐보기': 본문(캔버스 + 우측 설명)은 RegistrationOverlay가 그리고, 하단
            확인 줄(체크박스·버튼·안내)은 1px 구분선 위 footer(padding 12px 20px) - padded={false}로
            본문/footer를 직접 나눈다. */}
        <Container title="겹쳐보기 (정합 결과 육안 확인)" padded={false}>
          <div className="p-5">
            <RegistrationOverlay pathA={pathA} pathB={pathB} metaA={metaA} metaB={metaB}
              unitScaleA={scanA.unit_scale ?? 1} unitScaleB={scanB.unit_scale ?? 1}
              transform={registration.transform} />
          </div>
          <div className="flex flex-col gap-3 border-t border-cs-divider px-5 py-3">
            {/* ★ 리뷰 C1: 겹쳐보기를 못 그렸으면 "확인했습니다"를 체크할 수 없어야 한다.
                그러지 않으면 사용자가 빈 상자를 보고 체크해 방어가 조용히 0이 된다. */}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirmedVisually && !overlayBlocked} className={checkClass}
                disabled={!!overlayBlocked}
                onChange={(e) => setConfirmedVisually(e.target.checked)} />
              <span className={overlayBlocked ? 'text-cs-disabled' : undefined}>
                겹쳐보기에서 두 스캔이 실제로 포개지는 것을 확인했습니다.
              </span>
            </label>
            {overlayBlocked && (
              <Alert type="error">
                {overlayBlocked} 겹쳐보기를 볼 수 없는 상태에서는 이 확인을 체크할 수 없습니다.
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {/* '병합 스캔 열기' 슬롯이 이 뷰의 primary - 확인 전에는 disabled(버튼), 확인 후 링크 */}
              {confirmedVisually && !overlayBlocked && registration.result_scan_id ? (
                <LinkButton href={`/scans/${registration.result_scan_id}`} variant="primary">병합 스캔 열기</LinkButton>
              ) : (
                <Button variant="primary" disabled>병합 스캔 열기</Button>
              )}
              {askRepick ? (
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-cs-error">
                    이 정합으로 만들어진 병합 스캔이 삭제됩니다. 계속할까요?
                  </span>
                  <Button onClick={repick} disabled={busy}>삭제하고 다시 찍기</Button>
                  <Button onClick={() => setAskRepick(false)}>취소</Button>
                </span>
              ) : (
                <Button onClick={() => setAskRepick(true)}>대응점 다시 찍기</Button>
              )}
            </div>
            {/* ★ 리뷰 I1: 이 체크는 승인 게이트가 아니라 권고다. 정직하게 밝힌다 -
                "체크해야만 쓸 수 있다"고 읽히면, 다른 경로로 들어온 사용자가 검증을
                건너뛰었다는 사실 자체가 감춰진다. */}
            <p className="text-xs leading-4 text-cs-text-secondary">
              병합 스캔은 정합이 성공한 시점에 이미 만들어져 있습니다(데이터 계보 &quot;정합 병합&quot;).
              위 확인은 이 화면의 안내 장치일 뿐 시스템 차원의 승인 절차가 아닙니다.
              체크하지 않아도 병합 스캔은 측정위치 목록과 스캔 상세에 이미 나타나 있고,
              스캔 상세의 &quot;평활도 분석&quot; 버튼을 누르면 이 겹쳐보기를 한 번도 보지 않은
              채로 분석이 시작됩니다. 그러니 이 정합을 쓰지 않기로 했다면
              아래 &quot;대응점 다시 찍기&quot;로 병합 스캔을 정리하세요.
            </p>
            {error && <Alert type="error">{error}</Alert>}
          </div>
        </Container>
      </div>
    );
  }
```
주의: `{overlayBlocked} 겹쳐보기를 볼 수 없는 …`은 **같은 줄**에 둔다 - 줄을 나누면 JSX가 앞 공백을 지워 "…불명겹쳐보기를"로 붙는다(테스트 정규식 `/겹쳐보기를 볼 수 없는 상태에서는/`은 여전히 맞지만 문구가 틀어진다).

(e) 대응점 지정 - 파일 마지막 `return ( … );`(`const canRun = …;` 다음) 전체 교체. 옛 블록(정확히 이 범위):
```tsx
// old
  return (
    <div className="space-y-4">
      <p className="rounded-md bg-zinc-100 p-3 text-sm">
        두 그림에서 <span className="font-medium">같은 지점</span>을 번갈아 클릭해 쌍을 만드세요.
        최소 {MIN_CORRESPONDENCES}쌍이 필요하고 4쌍 이상을 권장합니다. 쌍은 서로 1m 넘게
        떨어뜨리고 한 직선 위에 놓이지 않게 넓게 흩어 고르세요. 한곳에 몰리거나 일직선이면
        정합이 거부됩니다. 색이 없는(비어 있는) 칸은 높이 값이 없어 쓸 수 없습니다.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <PointPicker title={`A 스캔 (기준) · ${scanLabel(scanA)}`} heightViewPath={pathA}
          meta={metaA} metaError={metaErrA} markers={markersA} onPick={onPickA} disabled={busy} />
        <PointPicker title={`B 스캔 (맞출 대상) · ${scanLabel(scanB)}`} heightViewPath={pathB}
          meta={metaB} metaError={metaErrB} markers={markersB} onPick={onPickB} disabled={busy} />
      </div>
      <section className="space-y-2">
        <h2 className="font-semibold">대응점 {pairs.length}쌍</h2>
        {pairs.length === 0 ? (
          <p className="text-sm text-zinc-500">아직 찍은 쌍이 없습니다.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {pairs.map((p, i) => (
              <li key={i}
                className="flex items-center gap-2 rounded border bg-white px-2 py-1">
                <span className="font-medium">{i + 1}</span>
                <span className="font-mono tabular-nums text-zinc-600">
                  A({p.a.x.toFixed(2)}, {p.a.y.toFixed(2)}, {p.a.z?.toFixed(2)})
                  {' / '}
                  B({p.b.x.toFixed(2)}, {p.b.y.toFixed(2)}, {p.b.z?.toFixed(2)})
                </span>
                <button type="button" onClick={() => removePair(i)}
                  className="ml-auto text-red-700 hover:underline">지우기</button>
              </li>
            ))}
          </ul>
        )}
        {(pendingA || pendingB) && (
          <p className="text-xs text-amber-700">
            {pendingA ? 'A' : 'B'} 쪽 점을 찍었습니다. 반대쪽 그림에서 같은 지점을 클릭하면
            한 쌍이 완성됩니다.
          </p>
        )}
        <p className="text-xs text-zinc-500">
          좌표는 각 스캔 파일의 단위 그대로입니다(미터로 환산하지 않습니다).
        </p>
      </section>
      {metaLoading ? (
        <p className="text-sm text-zinc-600">높이 뷰 좌표 정보를 불러오는 중입니다...</p>
      ) : (
        <button type="button" onClick={runRegistration} disabled={!canRun}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
          정합 실행
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
// new
  return (
    // 아트보드 없음(스펙 §4 해부로 구성): info Alert 안내 → PointPicker 2열 → 컨테이너 '대응점 N쌍'
    // → 우측 primary '정합 실행'. 문구·MIN_CORRESPONDENCES·canRun 판단은 그대로.
    <div className="flex flex-col gap-5">
      <Alert type="info">
        두 그림에서 <span className="font-bold">같은 지점</span>을 번갈아 클릭해 쌍을 만드세요.
        최소 {MIN_CORRESPONDENCES}쌍이 필요하고 4쌍 이상을 권장합니다. 쌍은 서로 1m 넘게
        떨어뜨리고 한 직선 위에 놓이지 않게 넓게 흩어 고르세요. 한곳에 몰리거나 일직선이면
        정합이 거부됩니다. 색이 없는(비어 있는) 칸은 높이 값이 없어 쓸 수 없습니다.
      </Alert>
      <div className="grid gap-5 lg:grid-cols-2">
        <PointPicker title={`A 스캔 (기준) · ${scanLabel(scanA)}`} heightViewPath={pathA}
          meta={metaA} metaError={metaErrA} markers={markersA} onPick={onPickA} disabled={busy} />
        <PointPicker title={`B 스캔 (맞출 대상) · ${scanLabel(scanB)}`} heightViewPath={pathB}
          meta={metaB} metaError={metaErrB} markers={markersB} onPick={onPickB} disabled={busy} />
      </div>
      <Container title={`대응점 ${pairs.length}쌍`}>
        <div className="flex flex-col gap-2">
          {pairs.length === 0 ? (
            <p className="text-sm text-cs-text-secondary">아직 찍은 쌍이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs">
              {pairs.map((p, i) => (
                <li key={i}
                  className="flex items-center gap-2 rounded-lg border border-cs-divider bg-white px-2 py-1">
                  <span className="font-bold">{i + 1}</span>
                  <span className="font-mono tabular-nums text-cs-text-secondary">
                    A({p.a.x.toFixed(2)}, {p.a.y.toFixed(2)}, {p.a.z?.toFixed(2)})
                    {' / '}
                    B({p.b.x.toFixed(2)}, {p.b.y.toFixed(2)}, {p.b.z?.toFixed(2)})
                  </span>
                  <button type="button" onClick={() => removePair(i)}
                    className="ml-auto font-bold text-cs-link hover:text-cs-link-hover hover:underline">지우기</button>
                </li>
              ))}
            </ul>
          )}
          {(pendingA || pendingB) && (
            <p className="text-xs leading-4 text-cs-warning">
              {pendingA ? 'A' : 'B'} 쪽 점을 찍었습니다. 반대쪽 그림에서 같은 지점을 클릭하면
              한 쌍이 완성됩니다.
            </p>
          )}
          <p className="text-xs leading-4 text-cs-text-secondary">
            좌표는 각 스캔 파일의 단위 그대로입니다(미터로 환산하지 않습니다).
          </p>
        </div>
      </Container>
      {metaLoading ? (
        <StatusIndicator type="in-progress">높이 뷰 좌표 정보를 불러오는 중입니다...</StatusIndicator>
      ) : (
        <div className="flex items-center justify-end gap-2">
          <Button variant="primary" onClick={runRegistration} disabled={!canRun}>정합 실행</Button>
        </div>
      )}
      {error && <Alert type="error">{error}</Alert>}
    </div>
  );
}
```

- [ ] **Step 10: 잔재 스윕(이 태스크 범위)** — `cd dashboard && grep -rnE "zinc-|amber-|red-|green-|emerald-|purple-|blue-" app/registrations components/registration --include=*.tsx | grep -v __tests__` → 0건. `grep -rn "from 'next/link'" app/registrations components/registration --include=*.tsx | grep -v __tests__` → 0건(전부 `LinkButton`으로 옮겨졌다).

- [ ] **Step 11: 통과 확인** — `cd dashboard && npx vitest run` → 전체 PASS(이 태스크의 6개 테스트 파일: 기존 동작 단언 + Step 2 추가분 전부). `npx tsc --noEmit -p .` → `app/registrations/**`·`components/registration/**`에서 0 에러. 저장소 기준선에는 이 태스크 밖의 tsc 오류가 이미 있다(`lib/hooks/__tests__/use-row-status.test.ts` 3건, `.next/dev/types/validator.ts`의 지워진 `api/diag/latency` 잔재 1건 - `.next` 재생성 문제) - 그 둘이 남아 있어도 이 태스크의 통과 기준은 위 두 경로가 깨끗한 것이다. 추가로 dev server에서 `/registrations/new?location=<id>`와 `/registrations/<id>`(done 상태 하나)를 열어 `RegistrationNew.dc.html`·`RegistrationDetail.dc.html`과 나란히 캡처 대조(사용자 상시 지시), 콘솔 오류 0.

- [ ] **Step 12: 커밋**

```bash
git add dashboard/app/registrations dashboard/components/registration
git commit -m "feat(dashboard): 정합 생성·상세 화면 Cloudscape 리스킨(PageHeader·Container·KeyValuePairs·Alert)

- 생성: 컨테이너 '스캔 선택' + FormField/SelectWrap, 우측 primary '대응점 찍기 시작'
- 상세: 진행 상태 StatusIndicator, '정합 결과' KeyValuePairs 3열 + warning/info Alert,
  '겹쳐보기' 캔버스 틀 + footer(체크박스·버튼·안내), 한계 안내 info Alert
- 로직·문구·가드 무변경. 테스트는 data-alert/data-status로 상태를 읽는다

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

---

### Task 11: 로그인 · 로딩 · Supabase 오류 알림

**Files:**
- Modify: `dashboard/app/login/page.tsx`, `dashboard/app/login/login-form.tsx`, `dashboard/app/loading.tsx`, `dashboard/app/reports/loading.tsx`, `dashboard/app/scans/[id]/loading.tsx`, `dashboard/app/sites/[id]/loading.tsx`, `dashboard/components/supabase-error.tsx`
- Modify(조건부): `dashboard/components/ui/spinner.tsx` — 색 2개만 토큰으로(스펙 §4 "Spinner 유지(색만 토큰으로)"). T2 파일 목록에 spinner.tsx가 없어 로딩 담당인 이 태스크가 맡는다. 이미 `zinc`가 없으면 건너뛴다(Step 8).
- Test: `dashboard/app/login/__tests__/login-form.test.tsx`(갱신 — 기존 동작 단언 전부 유지), `dashboard/app/login/__tests__/login-page.test.tsx`(신규), `dashboard/app/__tests__/loading.test.tsx`(신규), `dashboard/components/__tests__/supabase-error.test.tsx`(신규)

**Interfaces:**
- Consumes:
  - `PAGE_MAIN: string`(T2 `components/ui/page.tsx`) — `'flex flex-col gap-5 px-10 pb-10 pt-5'`.
  - `<Container padded?=true className?>children</Container>`(T2 `components/ui/container.tsx`) — `title`·`actions`를 주지 않으면 헤더 없이 `<section>` + 본문 래퍼만 그린다.
  - `<FormField label htmlFor?>{control}</FormField>`, `inputClass`(T2 `components/ui/form.tsx`).
  - `<Button variant? disabled? className? type?>`(T2 `components/ui/button.tsx`) — disabled면 `buttonClass`가 `border-cs-disabled`로 바꾸고 `bg-cs-link`를 뺀다. `className`은 뒤에 이어 붙는다.
  - `<Alert type={'info'|'success'|'warning'|'error'} title?>children</Alert>`(T2 `components/ui/alert.tsx`) — `data-alert={type}`, `error`만 `role="alert"`, 아이콘은 `<Icon>`(T1)이라 `data-icon`으로 식별(warning=`alert-triangle`, error=`x-circle`).
  - `<Spinner size?={'sm'|'md'} />`(`components/ui/spinner.tsx`, 기본 `md`, `role="status"` + sr-only '불러오는 중').
  - `ConsoleShell`(T1) — `usePathname()==='/login'`이면 사이드 내비를 이미 생략한다. 이 태스크는 셸을 건드리지 않는다.
  - 토큰 클래스(T1): `text-cs-text-secondary`, `border-cs-divider`, `border-t-cs-text`, `shadow-cs-container`, `rounded-cs-container`.
- Produces: 없음

- [ ] **Step 1: 아트보드 확인** — `docs/design/cloudscape/Login.dc.html`을 열어 구조를 옮긴다. 옮길 섹션: (1) 상단 바 44px `#0f1b2a` + FLATNESS 로고, 사용자 메뉴 없음 → T1 `TopNav`가 이미 그린다(로그인 전이라 `getRequestUser()`가 null이어서 메뉴가 안 나온다) — 손대지 않는다. (2) `main` 중앙 정렬 → 카드 400px, 흰 배경, `0 1px 1px 1px #e9ebed, 0 1px 8px 2px rgba(0,7,22,.12)` 그림자, 16px 라운드. (3) 카드 헤더 `padding 12px 20px` + 하단 1px `#e9ebed`, h1 24px/30px 700 '평활도 분석 대시보드'. (4) 카드 본문 `padding 20px`, `gap 16px`: 라벨 700 + 입력 32px·2px `#8c8c94`·radius 8px(이메일/비밀번호), primary 전폭 '로그인'(32px 알약), 안내 12px/16px `#5f6b7a`. 로딩 화면·Supabase 오류 알림은 아트보드가 없다 — 스펙 §4의 Spinner/Alert 해부와 §5의 loading 규칙(페이지와 같은 `PAGE_MAIN`)을 따른다. 셸 분기는 `grep -n "'/login'" dashboard/components/shell/console-shell.tsx`로 T1 결과를 확인만 한다.

- [ ] **Step 2: 실패하는 테스트 작성/갱신**

`app/login/__tests__/login-form.test.tsx` — 기존 `describe('LoginForm')` 블록과 mock·`beforeEach`·`afterEach`는 한 줄도 바꾸지 않는다. 파일 끝을 다음으로 교체(새 describe 추가):

old:
```tsx
    expect(await screen.findByText(/로그인에 실패했습니다/)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    // 재시도할 수 있어야 하므로 버튼이 다시 활성화된다
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled();
  });
});
```
new:
```tsx
    expect(await screen.findByText(/로그인에 실패했습니다/)).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    // 재시도할 수 있어야 하므로 버튼이 다시 활성화된다
    expect(screen.getByRole('button', { name: '로그인' })).toBeEnabled();
  });
});

// Cloudscape 해부(스펙 §4·아트보드 Login): FormField + inputClass, 오류는 error Alert,
// primary 전폭 버튼, 안내 12px 보조색. 동작 단언은 위 블록이 그대로 지킨다.
describe('LoginForm 시각(Cloudscape 해부)', () => {
  it('입력은 inputClass(2px cs-input-border, radius 8px), 라벨은 700이다', () => {
    render(<LoginForm />);
    for (const name of ['이메일', '비밀번호']) {
      const input = screen.getByLabelText(name);
      expect(input.className).toContain('border-cs-input-border');
      expect(input.className).toContain('rounded-lg');
      expect(screen.getByText(name).className).toContain('font-bold');
    }
  });

  it('로그인 버튼은 뷰의 유일한 primary이고 전폭이다', () => {
    render(<LoginForm />);
    const button = screen.getByRole('button', { name: '로그인' });
    for (const c of ['bg-cs-link', 'rounded-full', 'w-full']) expect(button.className).toContain(c);
    expect(button).toHaveAttribute('type', 'submit');
  });

  it('제출 중에는 버튼이 disabled(cs-disabled 보더)로 바뀐다', async () => {
    // 끝나지 않는 로그인 요청으로 busy 상태를 고정한다
    signInWithPassword.mockReturnValue(new Promise(() => {}));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    const button = screen.getByRole('button', { name: '로그인' });
    await waitFor(() => expect(button).toBeDisabled());
    expect(button.className).toContain('border-cs-disabled');
    expect(button.className).not.toContain('bg-cs-link');
  });

  it('실패 안내는 error Alert(role="alert", data-alert="error")로 뜬다', async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } });
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: '로그인' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveAttribute('data-alert', 'error');
    expect(alert.textContent).toContain('로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.');
    expect(alert.querySelector('[data-icon="x-circle"]')).not.toBeNull();
  });

  it('안내 문구는 12px 보조색이고 문장은 그대로다', () => {
    render(<LoginForm />);
    const hint = screen.getByText('계정은 관리자가 Supabase 대시보드(Authentication)에서 생성합니다.');
    expect(hint.className).toContain('text-xs');
    expect(hint.className).toContain('text-cs-text-secondary');
    expect(hint.className).not.toMatch(/zinc-/);
  });
});
```

`app/login/__tests__/login-page.test.tsx` (신규)

```tsx
// 로그인 화면 구조(스펙 §5·§6 Login, 아트보드 Login.dc.html): 상단 바(44px) 아래 남은 높이의
// 중앙에 400px 흰 카드(그림자·16px 라운드), 카드 헤더 = 페이지 h1(24px/30px 700) + 1px 구분선,
// 본문 padding 20px 안에 LoginForm. LoginPage는 데이터가 없는 동기 서버 컴포넌트라 render()로
// 그릴 수 있다(async 페이지의 엘리먼트 트리 탐색 패턴은 필요 없다). 사이드 내비 생략은
// ConsoleShell(T1) 테스트가 맡는다.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signInWithPassword: vi.fn() } }),
}));
vi.mock('@/lib/auth/ensure-profile', () => ({ ensureProfile: vi.fn() }));

import LoginPage from '../page';

describe('LoginPage', () => {
  it('main은 상단 바 44px을 뺀 높이의 중앙에 카드를 놓는다', () => {
    render(<LoginPage />);
    const main = screen.getByRole('main');
    for (const c of ['min-h-[calc(100vh-44px)]', 'items-center', 'justify-center', 'px-4']) {
      expect(main.className).toContain(c);
    }
    expect(main.className).not.toMatch(/zinc-/);
  });

  it('카드: 400px 컨테이너(그림자·16px 라운드), 헤더 h1 24px 700 + cs-divider 구분선, 본문 p-5', () => {
    const { container } = render(<LoginPage />);
    const card = container.querySelector('section') as HTMLElement;
    expect(card).not.toBeNull();
    for (const c of ['shadow-cs-container', 'rounded-cs-container', 'max-w-[400px]']) {
      expect(card.className).toContain(c);
    }
    const h1 = screen.getByRole('heading', { level: 1, name: '평활도 분석 대시보드' });
    expect(h1.className).toContain('text-2xl');
    expect(h1.className).toContain('font-bold');
    expect(h1.parentElement?.className).toContain('border-b');
    expect(h1.parentElement?.className).toContain('border-cs-divider');
    const form = screen.getByRole('button', { name: '로그인' }).closest('form');
    expect(form?.parentElement?.className).toContain('p-5');
  });

  it('카드 안에 이메일·비밀번호 입력과 로그인 버튼이 있다', () => {
    render(<LoginPage />);
    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument();
  });
});
```

`app/__tests__/loading.test.tsx` (신규)

```tsx
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
```

`components/__tests__/supabase-error.test.tsx` (신규)

```tsx
// Supabase 오류 알림: warning Alert(스펙 §4)로 갈아끼우되 문구는 그대로다(Free 일시정지 안내).
// 상세 메시지는 mono 12px 보조색.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SupabaseErrorNotice } from '../supabase-error';

describe('SupabaseErrorNotice', () => {
  it('warning Alert 안에 제목(700)·안내 문장·상세(mono 12px)를 그린다', () => {
    const { container } = render(<SupabaseErrorNotice message="fetch failed" />);
    const alert = container.querySelector('[data-alert="warning"]') as HTMLElement;
    expect(alert).not.toBeNull();
    expect(alert.className).toContain('border-cs-warning');
    expect(alert.className).toContain('bg-cs-warning-bg');
    expect(container.querySelector('[data-icon="alert-triangle"]')).toBeInTheDocument();

    expect(screen.getByText('Supabase 연결에 실패했습니다').className).toContain('font-bold');
    expect(screen.getByText(/Free 프로젝트는 7일 미사용 시 일시정지됩니다/)).toBeInTheDocument();
    expect(screen.getByText(/Restore\(재개\)한 뒤 새로고침하세요/)).toBeInTheDocument();
    expect(screen.getByText(/\.env\.local의 URL·anon key를 확인하세요/)).toBeInTheDocument();

    // '상세: ' + {message} 두 텍스트 노드를 getByText가 이어 붙여 비교한다
    const detail = screen.getByText('상세: fetch failed');
    expect(detail.className).toContain('font-mono');
    expect(detail.className).toContain('text-xs');
    expect(detail.className).toContain('text-cs-text-secondary');
  });

  it('옛 amber/zinc 클래스가 남아 있지 않다(T12 스윕 선반영)', () => {
    const { container } = render(<SupabaseErrorNotice message="x" />);
    expect(container.innerHTML).not.toMatch(/amber-|zinc-/);
  });
});
```

- [ ] **Step 3: 실패 확인** — `cd dashboard && npx vitest run app/login app/__tests__/loading.test.tsx components/__tests__/supabase-error.test.tsx` → FAIL:
  - `login-page.test.tsx` 2건 FAIL: `main.className`에 `min-h-[calc(100vh-44px)]` 없음(현재 `min-h-screen bg-zinc-50`), `section` 없음(`card`가 null → `card.className` TypeError). 세 번째(입력·버튼 존재)는 현재 구현으로도 PASS — 회귀 방지용.
  - `login-form.test.tsx` 새 describe 5건 FAIL: 입력에 `border-cs-input-border` 없음, 버튼이 `bg-zinc-900`(`bg-cs-link` 없음), busy 버튼에 `border-cs-disabled` 없음, `findByRole('alert')` 없음, 안내가 `text-zinc-500`.
  - `loading.test.tsx` 5건 FAIL: 4건은 `expected 'p-6' to be 'flex flex-col gap-5 px-10 pb-10 pt-5'`(reports·scans·sites는 `mx-auto max-w-… p-6`), Spinner 색 1건은 `border-zinc-200`(T2가 이미 토큰화했다면 이 1건만 PASS).
  - `supabase-error.test.tsx` 2건 FAIL: `[data-alert="warning"]` null → TypeError, `amber-` 매치.
  - 기존 `describe('LoginForm')` 3건은 그대로 PASS여야 한다(동작 단언은 UI와 무관).

- [ ] **Step 4: app/login/page.tsx 교체** (전체)

```tsx
import { Container } from '@/components/ui/container';
import { LoginForm } from './login-form';

// 로그인 화면(아트보드 Login): 상단 바(44px) 아래 남은 높이의 중앙에 400px 흰 카드.
// 사이드 내비는 ConsoleShell이 /login에서 생략한다(스펙 §5) - 여기서는 본문만 그린다.
// 카드 헤더가 곧 페이지 h1이므로 Container의 title(h2 18px)을 쓰지 않고 같은 해부
// (padding 12px 20px + 하단 1px 구분선)를 직접 그린다 - h2 안에 h1을 중첩할 수 없다.
// 폭은 아트보드의 400px 고정 대신 max-w로 둔다(375px에서 카드가 화면을 넘지 않게, 스펙 §5).
export default function LoginPage() {
  return (
    <main className="flex min-h-[calc(100vh-44px)] items-center justify-center px-4">
      <Container padded={false} className="w-full max-w-[400px]">
        <div className="border-b border-cs-divider px-5 py-3">
          <h1 className="text-2xl font-bold leading-[30px]">평활도 분석 대시보드</h1>
        </div>
        <div className="p-5">
          <LoginForm />
        </div>
      </Container>
    </main>
  );
}
```

- [ ] **Step 5: app/login/login-form.tsx — import와 JSX만 교체** (`useState` 4개, `onSubmit` 본문, 그 안의 router.push/refresh 주석은 한 글자도 바꾸지 않는다)

old:
```tsx
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ensureProfile } from '@/lib/auth/ensure-profile';

export function LoginForm() {
```
new:
```tsx
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ensureProfile } from '@/lib/auth/ensure-profile';
import { FormField, inputClass } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export function LoginForm() {
```

old:
```tsx
    window.location.assign('/');
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">이메일</label>
        <input id="email" type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">비밀번호</label>
        <input id="password" type="password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="w-full rounded-md bg-zinc-900 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50">
        로그인
      </button>
      <p className="text-xs text-zinc-500">
        계정은 관리자가 Supabase 대시보드(Authentication)에서 생성합니다.
      </p>
    </form>
  );
}
```
new:
```tsx
    window.location.assign('/');
  }

  // 아트보드 Login 본문: 필드 사이 gap 16px, 라벨 700 + 32px 입력, 오류는 error Alert,
  // primary 전폭 '로그인'(뷰의 유일한 primary), 안내 12px/16px 보조색.
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FormField label="이메일" htmlFor="email">
        <input id="email" type="email" required value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass} />
      </FormField>
      <FormField label="비밀번호" htmlFor="password">
        <input id="password" type="password" required value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputClass} />
      </FormField>
      {error && <Alert type="error">{error}</Alert>}
      {/* busy면 Button이 cs-disabled 보더로 바꾼다(재시도는 실패 시 setBusy(false)로 다시 열린다) */}
      <Button type="submit" variant="primary" disabled={busy} className="w-full">
        로그인
      </Button>
      <p className="text-xs leading-4 text-cs-text-secondary">
        계정은 관리자가 Supabase 대시보드(Authentication)에서 생성합니다.
      </p>
    </form>
  );
}
```

- [ ] **Step 6: loading.tsx 4종 교체** — 넷 다 `<main className={PAGE_MAIN} aria-busy="true">`. 내부(중앙 스피너 + 안내)는 기존 그대로, 안내 색만 토큰.

`app/loading.tsx` (전체)
```tsx
// 루트 로딩 화면(loading.tsx 규약: layout 안 page 영역만 Suspense로 감싼다 -
// 셸(상단 바·사이드 내비)은 layout 소속이라 그대로 남는다). 스켈레톤 대신 중앙 스피너로
// "로딩 중"임을 명시적으로 알린다(사용자 피드백: 스켈레톤만으로는 인지 못 함).
// 본문 클래스는 page.tsx와 같은 PAGE_MAIN - 전환 시 레이아웃 점프 방지(스펙 §5).
import { Spinner } from '@/components/ui/spinner';
import { PAGE_MAIN } from '@/components/ui/page';

export default function Loading() {
  return (
    <main className={PAGE_MAIN} aria-busy="true">
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <Spinner size="md" />
        <p className="text-sm text-cs-text-secondary">불러오는 중…</p>
      </div>
    </main>
  );
}
```

`app/reports/loading.tsx` (전체)
```tsx
// 보고서 목록 로딩 화면 - 중앙 스피너로 로딩 중임을 명시한다. 본문 클래스는 PAGE_MAIN(스펙 §5).
import { Spinner } from '@/components/ui/spinner';
import { PAGE_MAIN } from '@/components/ui/page';

export default function Loading() {
  return (
    <main className={PAGE_MAIN} aria-busy="true">
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <Spinner size="md" />
        <p className="text-sm text-cs-text-secondary">불러오는 중…</p>
      </div>
    </main>
  );
}
```

`app/scans/[id]/loading.tsx` (전체)
```tsx
// 스캔 작업대 로딩 화면 - 중앙 스피너로 로딩 중임을 명시한다. 본문 클래스는 PAGE_MAIN(스펙 §5).
import { Spinner } from '@/components/ui/spinner';
import { PAGE_MAIN } from '@/components/ui/page';

export default function Loading() {
  return (
    <main className={PAGE_MAIN} aria-busy="true">
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <Spinner size="md" />
        <p className="text-sm text-cs-text-secondary">불러오는 중…</p>
      </div>
    </main>
  );
}
```

`app/sites/[id]/loading.tsx` (전체)
```tsx
// 현장 상세 로딩 화면 - 중앙 스피너로 로딩 중임을 명시한다. 본문 클래스는 PAGE_MAIN(스펙 §5).
import { Spinner } from '@/components/ui/spinner';
import { PAGE_MAIN } from '@/components/ui/page';

export default function Loading() {
  return (
    <main className={PAGE_MAIN} aria-busy="true">
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
        <Spinner size="md" />
        <p className="text-sm text-cs-text-secondary">불러오는 중…</p>
      </div>
    </main>
  );
}
```

- [ ] **Step 7: components/supabase-error.tsx 교체** (전체 — 문구 무변경, warning Alert로)

```tsx
// Free 일시정지 안내 (스펙 §3.3). Cloudscape warning Alert(스펙 §4)로 그리고 문구는 그대로 둔다.
// 상세(원문 오류 메시지)는 mono 12px/16px 보조색.
import { Alert } from '@/components/ui/alert';

export function SupabaseErrorNotice({ message }: { message: string }) {
  return (
    <Alert type="warning" title="Supabase 연결에 실패했습니다">
      <p>
        Free 프로젝트는 7일 미사용 시 일시정지됩니다. Supabase 대시보드에서 프로젝트를
        Restore(재개)한 뒤 새로고침하세요. 그 밖의 원인이면 .env.local의 URL·anon key를 확인하세요.
      </p>
      <p className="mt-1 font-mono text-xs leading-4 text-cs-text-secondary">상세: {message}</p>
    </Alert>
  );
}
```

호출부(`app/page.tsx`·`app/reports/page.tsx`·`app/reports/[id]/page.tsx`·`app/reports/new/page.tsx`·`app/sites/[id]/page.tsx`)의 `<main className="p-6">`·`mx-auto max-w-… p-6` 래퍼는 각 화면 태스크(T3·T4·T8)가 `PAGE_MAIN`으로 바꾼다 — 이 태스크는 컴포넌트만 바꾼다. props(`message`)는 동일하므로 호출부 컴파일에 영향이 없다.

- [ ] **Step 8: components/ui/spinner.tsx 색 토큰화(조건부)** — `grep -n "zinc" dashboard/components/ui/spinner.tsx`가 0건이면(T2가 이미 처리) 이 단계를 건너뛴다. 남아 있으면 아래 old→new를 적용한다. 크기·`animate-spin`·`role="status"`·sr-only는 그대로(T2 ui.test.tsx의 Spinner 단언이 이것만 본다).

old:
```tsx
// 계측 콘솔 톤의 절제된 회전 스피너 - 의미색 4종(green/amber/red/zinc-busy) 대신
// zinc 중립만 사용한다. 상단 테두리만 진하게 칠해 회전을 눈으로 읽게 한다.
// prefers-reduced-motion 사용자는 motion-reduce:animate-none으로 회전을 끈다
// (정지된 링만 남고 layout은 그대로 - 정보 손실 없음).
const SIZE = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
} as const;

export function Spinner({ size = 'md' }: { size?: keyof typeof SIZE }) {
  return (
    <span
      role="status"
      className={`inline-block animate-spin rounded-full border-zinc-200 border-t-zinc-900 motion-reduce:animate-none ${SIZE[size]}`}
    >
```
new:
```tsx
// 계측 콘솔 톤의 절제된 회전 스피너 - 의미색(success/warning/error) 대신 토큰만 쓴다
// (트랙 cs-divider, 회전 호만 진행 색 cs-link로 칠해 회전을 눈으로 읽게 한다 -
// ProgressBar 채움·활성 내비와 같은 색, T12 Step 6과 동일 값).
// prefers-reduced-motion 사용자는 motion-reduce:animate-none으로 회전을 끈다
// (정지된 링만 남고 layout은 그대로 - 정보 손실 없음).
const SIZE = {
  sm: 'h-4 w-4 border-2',
  md: 'h-8 w-8 border-2',
} as const;

export function Spinner({ size = 'md' }: { size?: keyof typeof SIZE }) {
  return (
    <span
      role="status"
      className={`inline-block animate-spin rounded-full border-cs-divider border-t-cs-text motion-reduce:animate-none ${SIZE[size]}`}
    >
```

- [ ] **Step 9: 통과 확인** — `cd dashboard && npx vitest run` → 전체 PASS(이 태스크의 새 테스트 15건 — login-form 5 · login-page 3 · loading 5 · supabase-error 2 — + 기존 `LoginForm` 3건 포함). `npx tsc --noEmit -p .` → 0 에러. 잔재 확인: `cd dashboard && grep -rnE "zinc-|amber-|red-|blue-" app/login app/loading.tsx app/reports/loading.tsx "app/scans/[id]/loading.tsx" "app/sites/[id]/loading.tsx" components/supabase-error.tsx components/ui/spinner.tsx` → 0건. 화면 대조(사용자 상시 지시): dev server에서 `/login`(로그인 없이 열린다)을 1440px로 캡처해 `docs/design/cloudscape/Login.dc.html`과 나란히 놓고 카드 400px·헤더 구분선·버튼 전폭·안내 12px을 대조하고, 375px에서 카드가 화면 안에 들어오는지 본다. 로딩 화면은 사이드 내비 '보고서' 클릭 직후 캡처해 본문 여백이 도착 화면과 같은지(점프 없음) 본다. 콘솔 오류 0.

- [ ] **Step 10: 커밋**

```bash
git add dashboard/app/login dashboard/app/loading.tsx dashboard/app/reports/loading.tsx "dashboard/app/scans/[id]/loading.tsx" "dashboard/app/sites/[id]/loading.tsx" dashboard/app/__tests__/loading.test.tsx dashboard/components/supabase-error.tsx dashboard/components/__tests__/supabase-error.test.tsx dashboard/components/ui/spinner.tsx
git commit -m "refactor(dashboard): 로그인·로딩·Supabase 오류 알림을 Cloudscape 해부로(Container·FormField·Alert·PAGE_MAIN)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: 잔재 스윕 · 삭제 · 시각 대조

**Files:**
- Delete: `dashboard/components/ui/metric-card.tsx`, `dashboard/components/ui/status-dot.tsx`
- Modify: `dashboard/components/ui/badge.tsx`(주석 1줄), `dashboard/components/ui/status-indicator.tsx`(주석 1줄), `dashboard/lib/domain/reports.ts`(주석 2줄), `dashboard/lib/hooks/__tests__/use-row-status.test.ts`(스텁 타입), `dashboard/app/registrations/[id]/__tests__/page.test.tsx`(픽스처 필드 1개), `dashboard/lib/domain/__tests__/reports.test.ts`(주석), `dashboard/components/registration/__tests__/registration-workbench.test.tsx`(조건부 단언 2줄), 그리고 Step 7의 grep 전수 목록에 잡히는 파일 전부. `dashboard/components/ui/spinner.tsx`는 **T11 Files(Step 8)가 담당** - 여기서는 손대지 않고 Step 6에서 확인만 한다
- Create: `dashboard/__tests__/palette-sweep.test.ts`(가드 테스트), 스크래치패드 `t12/targets.json`·`t12/shots.mjs`·`t12/compare.md`(커밋하지 않는다)
- Test: `dashboard/__tests__/palette-sweep.test.ts`(Spinner 색 단언은 T11의 `app/__tests__/loading.test.tsx` 'Spinner 색 토큰'이 이미 `border-t-cs-text`로 갖고 있다 - 여기서 추가하지 않는다)

**Interfaces:**
- Consumes: T1의 `<Icon name>`·cs-* 토큰 클래스(`text-cs-*`/`bg-cs-*`/`border-cs-*`/`shadow-cs-container`/`rounded-cs-container`). T2의 `StatusIndicator`/`TONE_STATUS`(`status-indicator.tsx`), `VerdictBar`/`VerdictLegend`(`verdict-bar.tsx`), `KeyValuePairs`/`StatValue`, `Container`, `buttonClass`/`Button`/`LinkButton`, `Alert`, `Badge`/`TONE`, `inputClass`/`selectClass`/`textareaClass`/`checkClass`, `tableClass`, `PAGE_MAIN`. 기존 `Spinner`(`spinner.tsx`, `size?: 'sm'|'md'`). 이 태스크는 이들을 **치환의 목적지**로만 쓴다 - 새 화면을 만들지 않는다.
- Produces: 없음(런타임 export 없음. `palette-sweep.test.ts`는 가드 테스트다).

**이 태스크의 성격**: T3~T11이 화면을 옮긴 뒤 남은 것을 **기계적으로 0으로** 만들고(옛 팔레트 grep 0건 · 삭제 대상 파일 소비자 0건 · 검증 3종 통과), 14장 아트보드와 실제 화면을 **나란히 대조**해 토큰·간격 차이를 즉시 고친다. 로직·문구·가드는 무변경 - 클래스와 JSX 구조만 만진다. 화면을 다시 구현해야 할 정도로 남아 있으면 그 화면의 태스크(T3~T11)가 미완인 것이니 거기로 돌아가 끝내고 여기로 돌아온다(이 태스크 안에서 임시 치환하지 않는다).

**측정된 출발점(2026-09-04 main `d0361b7`, T1~T11 적용 전)**: 옛 팔레트 클래스 소스 311건/57파일(테스트 단언 25건까지 336건). 어떤 태스크의 Files에도 들어 있지 않아 **반드시 여기까지 남는 파일**: `components/ui/metric-card.tsx`(삭제). `components/ui/spinner.tsx`(출발점 `border-zinc-200 border-t-zinc-900`)는 T11 Files(Step 8)가 `border-cs-divider border-t-cs-text`로 토큰화하고 T11의 `app/__tests__/loading.test.tsx` 'Spinner 색 토큰'이 그 문자열을 단언하므로, 이 태스크에 도달했을 때는 이미 0건이다 - Step 6에서 확인만 한다(같은 파일의 같은 클래스를 다른 값으로 만들면 T11 테스트가 깨진다). 검증 3종의 출발점: `npx vitest run` 70파일 PASS · `npx tsc --noEmit -p .` **사전 존재 오류 4건**(`lib/hooks/__tests__/use-row-status.test.ts` 3, `app/registrations/[id]/__tests__/page.test.tsx` 1 - 테스트 스텁 타입 문제, vitest는 타입을 안 봐서 통과) · `npx next build`는 **묵은 `.next/dev/types/validator.ts`가 삭제된 `app/api/diag/latency` 라우트를 참조해 실패**하지만 `rm -rf .next` 뒤에는 exit 0(실측). 이 태스크가 셋 다 통과로 만든다.

- [ ] **Step 1: 아트보드 확인** — `docs/design/cloudscape/Main.dc.html`을 브라우저(또는 Read)로 열어 셸(상단 바 44px `#0f1b2a` · 사이드 내비 280px · 본문 padding 20/40/40 · 섹션 gap 20) → 페이지 헤더(h1 24px + 우측 normal '스캔 업로드') → Container '개요'(4열 StatValue, 2열부터 `border-left` 1px + `padding-left` 20px, 4열째에 8px 분포 바 + 범례) → Container '현장 (6)'(primary '새 현장', 도구 줄, 표 헤더 40px/행 44px, 첫 열 파랑 700 링크, 수치 우측 tabular, 상태 StatusIndicator) 순서를 눈에 넣는다. 이 태스크는 **옮기지 않고 대조한다** - 14장 전부가 대상이다. 대조 표(화면 → 아트보드 → 라우트 → 프레임 높이 → 도달 방법):

| 아트보드 | 라우트 | 프레임(1440×) | 도달 방법 |
|---|---|---|---|
| `Main` | `/` | 900 | 사이드 내비 '현장' |
| `Upload` | `/upload` | 1080 | 사이드 내비 '업로드' |
| `SiteNew` | `/sites/new` | 900 | 홈 '새 현장' |
| `SiteDetail` | `/sites/<siteId>` | 2040 | 홈 표 첫 열 링크 |
| `ScanDone` | `/scans/<scanId>` (분석 완료 스캔) | 2240 | 현장 상세 측정위치 카드의 스캔 행(판정 StatusIndicator가 있는 행) |
| `ScanUnitConfirm` | `/scans/<scanId>` (`awaiting_unit_confirm`) | 1240 | 워커(`cd worker && python -m flatworker`) 기동 + `/upload`로 새 스캔 업로드 → 사전 검사 직후. **실 Supabase에 행이 생기므로 사용자에게 먼저 묻는다**. 못 만들면 '미재현'으로 기록 |
| `ScanProcessing` | `/scans/<scanId>` (`processing`) | 900 | 위 화면에서 '단위 확정 후 분석 시작' 직후(워커 필요). 못 만들면 '미재현' |
| `Reports` | `/reports` | 900 | 사이드 내비 '보고서' |
| `ReportNew` | `/reports/new?location=<locationId>` | 1380 | 현장 상세 측정위치 카드 '보고서' → 목록 '새 보고서' (또는 `/reports/new` 무파라미터 = 위치 선택 드롭다운 먼저, 스펙 §6 ReportNew) |
| `ReportDetail` | `/reports/<reportId>` | 1080 | 보고서 목록 제목 링크. 보고서가 0건이면 '미재현'(만들려면 사용자에게 묻는다) |
| `Settings` | `/settings` | 1840 | 사이드 내비 '설정' |
| `RegistrationNew` | `/registrations/new?location=<locationId>` | 900 | 현장 상세 측정위치 카드 '정합' 링크(`location-tree.tsx`의 `/registrations/new?location=`) |
| `RegistrationDetail` | `/registrations/<registrationId>` | 1400 | 정합 이력이 있을 때만. 없으면 '미재현' |
| `Login` | `/login` | 900 | **맨 마지막**에 사이드 내비 '로그아웃'(전체 이동으로 `/login` 도착) |

아트보드는 `<script src="./support.js">`가 404지만(저장소에 없음) 마크업·인라인 스타일·`<link>` 폰트는 그대로 렌더되므로 `file:///D:/Projects/Flatness/docs/design/cloudscape/<이름>.dc.html`을 브라우저 패널에서 바로 연다. 프레임은 1440px 고정 폭이라 앱 쪽 뷰포트도 1440×900으로 맞춘다.

- [ ] **Step 2: 실패하는 테스트 작성/갱신**

`dashboard/__tests__/palette-sweep.test.ts` (신규 - 스펙 §3 "이 표 밖의 색을 쓰지 않는다"와 §9-2 grep 검증의 기계화. 사람이 하는 grep은 한 번이지만 이 테스트는 영원히 돈다)

```ts
// 팔레트 잔재 가드(스펙 §3 "이 표 밖의 색을 쓰지 않는다" + §9-2의 기계 검증).
// 옛 Tailwind 팔레트 클래스가 app/components/lib에 하나라도 남으면 파일:줄과 함께 실패한다.
// __tests__도 검사 대상이다(옛 클래스 단언이 남았다면 스타일이 아니라 단언이 틀린 것).
// GRADE_COLOR(lib/domain/labels.ts)는 hex 문자열이라 이 정규식에 잡히지 않는다(스펙 §3 예외).
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// vitest는 __dirname을 준다. import.meta.url은 file: 스킴이 아니라 fileURLToPath가 던진다(실측).
const ROOT = join(__dirname, '..'); // dashboard/
const SCAN_DIRS = ['app', 'components', 'lib'];
// 색 이름 앞의 \b 덕에 -translate-x-1/2 같은 부분 문자열(2026-08-11 스윕의 false positive)은
// 잡히지 않는다. 앞뒤 [\w:/-]*는 표시용 - 실패 메시지에 hover:bg-zinc-700처럼 클래스 전체가 찍힌다.
const OLD_PALETTE = /[\w:/-]*\b(zinc|amber|red|green|emerald|purple|blue)-[0-9]{2,3}\b[\w/]*/;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const files = () => SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
const rel = (f: string) => relative(ROOT, f).split(sep).join('/');

function paletteHits(): string[] {
  const found: string[] = [];
  for (const file of files()) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const m = line.match(OLD_PALETTE);
      if (m) found.push(`${rel(file)}:${i + 1}: ${m[0]}`);
    });
  }
  return found;
}

describe('팔레트 잔재 스윕 (T12)', () => {
  it('app/components/lib(테스트 포함)에 옛 팔레트 클래스가 0건이다', () => {
    expect(paletteHits()).toEqual([]);
  });

  it('MetricCard·StatusDot 파일은 삭제됐고 어디서도 import하지 않는다', () => {
    expect(existsSync(join(ROOT, 'components/ui/metric-card.tsx'))).toBe(false);
    expect(existsSync(join(ROOT, 'components/ui/status-dot.tsx'))).toBe(false);
    const importers = files()
      .filter((f) => /ui\/(metric-card|status-dot)'/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(importers).toEqual([]);
  });
});
```

`dashboard/components/ui/__tests__/ui.test.tsx`는 **손대지 않는다** - Spinner 색 단언은 T11의 `app/__tests__/loading.test.tsx` 'Spinner 색 토큰'(`border-cs-divider` + `border-t-cs-text`)이 이미 갖고 있고, 여기서 다른 문자열을 단언하면 두 테스트가 같은 파일을 두고 충돌한다.

`dashboard/components/registration/__tests__/registration-workbench.test.tsx` — 낮은 수평 감도 박스가 오류 색이 아님을 옛 클래스로 단언하던 2줄(T10이 이미 바꿨으면 old가 없으니 건너뛴다). old→new:

```tsx
    // 경고 색(빨강)으로 칠하지 않는다 - 실패 박스와 같은 무게로 보이면 안 된다.
    expect(box.className).not.toMatch(/red/);
    expect(container.querySelector('.border-red-300')).toBeNull();
```
→
```tsx
    // 경고 색(error 토큰)으로 칠하지 않는다 - 실패 박스(Alert error)와 같은 무게로 보이면 안 된다.
    expect(box.className).not.toMatch(/cs-error/);
    expect(container.querySelector('[data-alert="error"]')).toBeNull();
```

`dashboard/lib/hooks/__tests__/use-row-status.test.ts` — 사전 존재 tsc 오류 3건(51·72·98행)의 원인은 기본 스텁의 `data: null` 리터럴로 반환 타입이 `{ data: null }`로 좁혀지는 것. 스텁 정의만 넓힌다(동작 무변경). old→new:

```ts
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
    })),
```
→
```ts
    // data를 null 리터럴로 두면 반환 타입이 { data: null }로 좁혀져 아래 테스트들의
    // mockImplementation({ data: { status } })가 tsc에서 거부된다(T12 검증 게이트).
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null as Record<string, string> | null }) }) }),
    })),
```

`dashboard/app/registrations/[id]/__tests__/page.test.tsx` — 사전 존재 tsc 오류 1건(47행): `RegistrationRow`에 012에서 추가된 `horizontal_sensitivity`가 픽스처에 없다. `null`은 타입 주석대로 "알 수 없음" 정상 경로(`horizontalCheck` → `'unknown'`)라 렌더 결과가 같다. old→new:

```ts
const REG: RegistrationRow = {
  id: 'r1', source_scan_ids: ['scanA', 'scanB'], correspondences: [], transform: null,
  rmse_mm: null, iterations: null, overlap_ratio: null, status: 'awaiting_points',
  error_text: null, result_scan_id: null, created_by: null, created_at: '', updated_at: '',
};
```
→
```ts
const REG: RegistrationRow = {
  id: 'r1', source_scan_ids: ['scanA', 'scanB'], correspondences: [], transform: null,
  rmse_mm: null, iterations: null, overlap_ratio: null, horizontal_sensitivity: null,
  status: 'awaiting_points',
  error_text: null, result_scan_id: null, created_by: null, created_at: '', updated_at: '',
};
```

`dashboard/lib/domain/__tests__/reports.test.ts` — 삭제되는 컴포넌트를 가리키는 주석(old→new):

```ts
// D7: 목록(Badge)·상세(StatusDot) 양쪽에서 같은 판단을 재사용한다. 두 컴포넌트의
// tone 타입 교집합(pass/warn/fail/unknown)만 반환해 어댑터 없이 그대로 꽂을 수 있게 한다.
```
→
```ts
// D7: 목록(Badge)·상세(StatusIndicator, TONE_STATUS로 변환) 양쪽에서 같은 판단을 재사용한다.
// 두 표의 교집합(pass/warn/fail/unknown)만 반환해 어댑터 없이 그대로 꽂을 수 있게 한다.
```

옛 클래스 단언이 남아 있을 수 있는 다른 테스트(가드 테스트가 파일:줄로 알려 준다)는 아래 표로 갱신한다. 상태를 스타일로 읽던 단언은 의미 속성으로 바꾼다.

| 테스트 파일(담당 태스크) | 남아 있으면 | 새 단언 |
|---|---|---|
| `components/__tests__/scan-step-strip.test.tsx`(T6) | `text-zinc-900`(현재 단계) / `text-red-700`(실패) / `text-zinc-400`(지난) / `text-zinc-300`(미래) | `text-cs-link`+`font-bold` / `text-cs-error` / `text-cs-success` / `text-cs-disabled` (스펙 §4 ScanStepStrip) |
| `components/__tests__/sidebar-nav.test.tsx`(T1) | 파일이 존재 | T1 Step 11 미완 - `git rm` |
| `components/ui/__tests__/ui.test.tsx`(T2) | `bg-green-50`·`bg-zinc-100` 등 | T2 Step 1 미완 - T2의 파일로 교체 |
| 그 밖의 파일 | `.border-red-300` 같은 selector / `toContain('text-zinc-500')` | `[data-alert="error"]`·`[data-status="error"]` / `toContain('text-cs-text-secondary')` (Step 7 치환 표의 짝) |

- [ ] **Step 3: 실패 확인** — `cd dashboard && npx vitest run __tests__/palette-sweep.test.ts` → FAIL 2건: (1) 잔재 목록이 비어 있지 않음 - 최소 `components/ui/metric-card.tsx:7: border-zinc-200`·`components/ui/metric-card.tsx:8: text-zinc-500` 같은 줄들이 `expected [ Array(n) ] to deeply equal []`로 출력된다(출발점 트리에서 실측: 336건 = 소스 311 + 테스트 25. T1~T11 적용 뒤에는 그보다 적고, `components/ui/spinner.tsx`는 T11 Step 8이 이미 토큰화했으므로 목록에 **없어야** 한다 - 있으면 T11 미완), (2) `existsSync(...metric-card.tsx)`가 `true`(`expected true to be false`). 나머지 테스트는 그대로 PASS. `npx tsc --noEmit -p .`에 이 가드 파일로 인한 새 오류는 0건(실측).

- [ ] **Step 4: 삭제 대상의 소비자 0건 확인 → `git rm`**

```bash
cd dashboard
grep -rn "ui/metric-card\|ui/status-dot" app components lib     # 반드시 0건
grep -rnw "MetricCard\|StatusDot" app components lib              # 주석 포함 - Step 5까지 끝나면 0건
```

첫 grep에 잡히는 경우의 처리(치환이 아니라 **앞 태스크 완료**가 원칙):
- `app/page.tsx` 또는 `app/__tests__/page.test.tsx`가 `@/components/ui/metric-card`를 import → T3 미완(홈 개요가 `KeyValuePairs`+`StatValue`+`VerdictBar`/`VerdictLegend`로 옮겨가지 않았다). T3로 돌아가 끝낸다.
- `app/reports/[id]/page.tsx`의 `StatusDot` 한 줄만 남아 있으면 여기서 바꾼다(스펙 §6 ReportDetail "h1 제목 + StatusIndicator 상태"와 같다). old→new:

```tsx
import { StatusDot } from '@/components/ui/status-dot';
```
→
```tsx
import { StatusIndicator, TONE_STATUS } from '@/components/ui/status-indicator';
```
```tsx
      <StatusDot tone={badge.tone} label={badge.label} />
```
→
```tsx
      <StatusIndicator type={TONE_STATUS[badge.tone]}>{badge.label}</StatusIndicator>
```
(`reportStatusBadge`의 tone은 `'pass'|'fail'|'unknown'`이라 `TONE_STATUS`의 키 안에 있다 - 로직 무변경.)

둘 다 0건이 되면:

```bash
git rm dashboard/components/ui/metric-card.tsx dashboard/components/ui/status-dot.tsx
```

`metric-card.tsx`에 T2가 남긴 `export { VerdictBar } from './verdict-bar'` 재export도 함께 사라진다 - 첫 grep이 0건이면 모든 소비자가 이미 `@/components/ui/verdict-bar`를 쓰고 있다는 뜻이다.

- [ ] **Step 5: 삭제된 이름을 가리키는 주석 갱신** — 코드가 아니라 주석이지만 없는 컴포넌트를 가리키면 다음 사람을 속인다. `grep -rnw "MetricCard\|StatusDot"`이 0건이 될 때까지. 각각 old→new:

`dashboard/components/ui/badge.tsx` (T2가 쓴 줄)
```tsx
// Badge는 busy를 제외한 톤만 허용(busy는 StatusDot/StatusIndicator 전용)
```
→
```tsx
// Badge는 busy를 제외한 톤만 허용(busy는 StatusIndicator(TONE_STATUS) 전용)
```

`dashboard/components/ui/status-indicator.tsx` (T2가 쓴 줄)
```tsx
// Badge 톤(pass/warn/fail/unknown/busy) -> 상태 타입. StatusDot 소비자가 이 표로 옮겨온다.
```
→
```tsx
// Badge 톤(pass/warn/fail/unknown/busy) -> 상태 타입. 상태를 점으로 그리던 옛 컴포넌트의
// 소비자는 전부 이 표를 거쳐 StatusIndicator로 옮겨왔다(T12에서 옛 파일 삭제).
```

`dashboard/lib/domain/reports.ts`
```ts
// D7: 보고서 목록(Badge)·상세(StatusDot)가 같은 판단을 재사용한다. tone은 두 컴포넌트
// tone 타입의 교집합만 쓴다(BadgeTone엔 'busy'가, StatusDot tone엔 'neutral'이 없다) -
```
→
```ts
// D7: 보고서 목록(Badge)·상세(StatusIndicator, TONE_STATUS로 변환)가 같은 판단을 재사용한다.
// tone은 두 표의 교집합만 쓴다(BadgeTone엔 'busy'가, TONE_STATUS엔 'neutral'이 없다) -
```

`dashboard/app/reports/[id]/__tests__/page.test.tsx` 1행(T8이 이미 고쳤으면 건너뛴다)
```tsx
// D7 Step 3: PageHeader 브레드크럼(현장 › 측정위치) + StatusDot 상태 + "포함 분석"
```
→
```tsx
// D7 Step 3: PageHeader 브레드크럼(현장 › 측정위치) + StatusIndicator 상태 + "포함 분석"
```

- [ ] **Step 6: `spinner.tsx` 확인만(T11 Step 8에서 완료 - 여기서 바꾸지 않는다)** — 스펙 §4 "Spinner: 유지(색만 토큰으로)"는 T11이 `border-cs-divider border-t-cs-text`로 끝냈고, T11의 `app/__tests__/loading.test.tsx` 'Spinner 색 토큰'이 그 두 문자열을 단언한다. 이 태스크는 같은 파일을 다른 값(`border-t-cs-link` 등)으로 다시 쓰지 않는다 - 쓰면 T11 테스트가 깨져 Step 8/12의 전체 PASS가 불가능하다. 확인 명령과 기대 출력:

```bash
cd dashboard
grep -n "border-cs-divider border-t-cs-text" components/ui/spinner.tsx   # 1건: className 줄
grep -n "zinc" components/ui/spinner.tsx                                  # 0건
```

첫 grep이 0건이거나 둘째 grep에 출력이 있으면 T11 Step 8이 미완이다 - T11로 돌아가 그 단계의 old→new를 적용하고 T11 Step 9(`npx vitest run` 전체 PASS)를 다시 통과시킨 뒤 여기로 돌아온다. 이 태스크 안에서 임시 치환하지 않는다(서두의 원칙).

- [ ] **Step 7: 잔재 스윕(grep이 0건이 될 때까지)**

전수 목록을 뽑는다(테스트 포함 - 결정 사항 "테스트의 옛 클래스 단언도 0건"):

```bash
cd dashboard
grep -rnE "\b(zinc|amber|red|green|emerald|purple|blue)-[0-9]{2,3}\b" app components lib --include=*.tsx --include=*.ts
```

출력의 각 줄을 **파일 → 남은 클래스 → 대체**로 아래 표에 대응시켜 고친다. 잡힌 줄 하나하나를 표에 적고(이 표가 커밋 본문에 들어간다), 다 고친 뒤 grep을 다시 돌려 0건을 확인한다. `git diff --stat`로 손댄 파일이 이 표와 일치하는지 본다.

**치환 표(옛 클래스 → 자리 → 대체).** 출발점에서 실제로 존재하던 41종 전부다. 표에 없는 클래스가 잡히면 같은 색조의 행을 따른다(예: `text-red-500` → `text-cs-error`).

| 옛 클래스 | 쓰이던 자리 | 대체 |
|---|---|---|
| `text-zinc-900`, 문자열 조각 `zinc-900` | 본문·제목 강조 | `text-cs-text`(body 기본색이므로 대개는 클래스 삭제) |
| `text-zinc-700` | 본문 | `text-cs-text` |
| `text-zinc-600`, `text-zinc-500`, `text-zinc-400` | 보조·설명·플레이스홀더·대기 상태 | `text-cs-text-secondary` |
| `text-zinc-300` | 미래 단계·비활성 글자 | `text-cs-disabled` |
| `bg-zinc-900` + `text-white`, `hover:bg-zinc-700` | primary 버튼 | `buttonClass('primary')` / `<Button variant="primary">` / `<LinkButton variant="primary">` - **뷰당 1개**, 나머지는 `'normal'` |
| `border-zinc-900` | 활성 표시·outline 버튼 | `border-cs-link`(내비 활성은 T1의 `aria-current` + `text-cs-link font-bold`) |
| `border-t-zinc-900` | 스피너 회전 호 | `border-t-cs-text` - T11 Step 8에서 완료, Step 6에서 확인만(여기서 바꾸지 않는다) |
| `border-zinc-300` | 입력·셀렉트·텍스트영역 보더 | `inputClass` / `selectClass`(+`SelectWrap`) / `textareaClass`(직접 쓰면 `border-2 border-cs-input-border rounded-lg`) |
| `border-zinc-200`, `border-zinc-100` | 카드·행·구분선 | `border-cs-divider`(카드 전체면 `<Container>`) |
| `bg-zinc-100` | 중립 배지 배경·트랙·hover | `bg-cs-divider` |
| `bg-zinc-50` | 옅은 패널·표 헤더 배경 | 삭제(흰 배경). 패널 경계가 필요하면 `border border-cs-divider rounded-lg`(스펙 §6 SiteDetail 카드), 표 헤더는 `tableClass.thead` |
| `bg-zinc-500`, `bg-zinc-400` | 상태 점 | 점 자체를 `<StatusIndicator type={TONE_STATUS[tone]}>`로. 점을 남겨야 하면 `TONE.busy.dot`(`bg-cs-text-secondary`) / `TONE.unknown.dot`(`bg-cs-na`) |
| `text-red-700`, `text-red-600`, `text-red-800` | 오류 글자 | `text-cs-error` |
| `border-red-300`, `border-red-400`, `border-red-200`, `bg-red-50` | 오류 박스 | `<Alert type="error">`(직접이면 `rounded-xl border-2 border-cs-error bg-cs-error-bg`) |
| `bg-red-600`, `bg-red-700`, `bg-red-800` | 위험 버튼 채움 | `buttonClass('normal')` - 스펙 §6 ReportDetail: 삭제는 normal. 빨간 버튼은 시스템에 없다 |
| `text-amber-700`, `text-amber-800` | 경고 글자 | `text-cs-warning` |
| `border-amber-300`, `border-amber-400`, `bg-amber-50` | 경고 박스 | `<Alert type="warning">`(직접이면 `rounded-xl border-2 border-cs-warning bg-cs-warning-bg`) |
| `bg-amber-500`, `bg-amber-600` | 경고 점·채움 | `bg-cs-warning` |
| `text-green-700`, `emerald-700` | 성공 글자 | `text-cs-success` |
| `bg-green-50` | 성공 배경 | `bg-cs-success-bg` |
| `bg-green-600` | 성공 점·채움 | `bg-cs-success` |
| `text-purple-700`, `border-purple-400` | '외부 결과' 배지 | `<Badge tone="external">`(직접이면 `text-cs-external border-cs-external bg-cs-external-bg`) |
| `blue-*`(출발점 0건) | 링크 | `text-cs-link hover:text-cs-link-hover` |

치환 규칙:
1. **버튼은 클래스 치환이 아니라 프리미티브로 간다.** `className`에 `bg-zinc-900 … hover:bg-zinc-700`을 늘어놓은 `<Link>`/`<button>`은 `<LinkButton>`/`<Button>`(또는 `buttonClass()`)로 바꾸고 옛 클래스는 전부 지운다. 한 뷰에 primary가 둘이 되면 나중 것을 `normal`로.
2. **박스는 `<Alert>`로.** `border-amber-300 bg-amber-50 p-3 text-amber-800` 류의 div는 `<Alert type="warning" title?>`로 감싸고 내용 JSX는 그대로 둔다. `role="alert"`는 `Alert`가 error일 때 스스로 붙인다 - 중복해서 붙이지 않는다.
3. **`app/scans/[id]/page.tsx`의 가드 5개(`provenNotImport`·`isImportUnknownOrTrue`·`showFirstFlatness`·`showSlopeButton`·`showSlopeSection`)와 그 주석은 문장 그대로.** 치환 뒤 아래 명령의 두 출력이 같아야 한다(출발점 5줄):

```bash
git show "d0361b7:dashboard/app/scans/[id]/page.tsx" | grep -E "const (provenNotImport|isImportUnknownOrTrue|showFirstFlatness|showSlopeButton|showSlopeSection)\b"
grep -E "const (provenNotImport|isImportUnknownOrTrue|showFirstFlatness|showSlopeButton|showSlopeSection)\b" "dashboard/app/scans/[id]/page.tsx"
```
4. `lib/domain/labels.ts`의 `GRADE_COLOR` hex와 그것을 인라인 `style`로 쓰는 히트맵 범례(`components/analysis/*`)는 **손대지 않는다**(스펙 §3 예외). grep에 안 잡힌다.
5. 정규식이 클래스가 아닌 것을 잡으면(예: 데이터 문자열) 그것은 코드 냄새다 - 이름을 바꿔 가드가 통과하게 한다. 출발점에서는 그런 줄이 없다.

셸·본문 컨테이너 일관성도 여기서 같이 확인한다(스펙 §5 "loading.tsx 4종은 페이지와 같은 본문 컨테이너 클래스"):

```bash
cd dashboard
grep -L "PAGE_MAIN" app/loading.tsx app/reports/loading.tsx "app/scans/[id]/loading.tsx" "app/sites/[id]/loading.tsx"   # 출력 없어야 한다
grep -L "PAGE_MAIN" $(find app -name page.tsx | grep -v "analyses/\[id\]\|confirm-unit\|app/login")                    # 출력 없어야 한다(리다이렉트 전용 2개·로그인은 제외)
```
출력이 있으면 그 파일의 담당 태스크(T3~T11)가 미완이다 - 거기서 `PAGE_MAIN`으로 바꾼다.

- [ ] **Step 8: 검증 3종 통과 확인(1차)**

```bash
cd dashboard
npx vitest run                     # 전체 PASS (palette-sweep 2건 포함. T11의 loading.test 'Spinner 색 토큰' 1건도 그대로 PASS - spinner.tsx 무변경이므로)
rm -rf .next && npx next build     # exit 0. 묵은 .next/dev/types가 삭제된 diag 라우트를 참조하므로 반드시 비우고 빌드한다
npx tsc --noEmit -p .              # 0 에러 (Step 2의 두 테스트 파일 수정으로 사전 존재 4건이 사라진다)
```
순서가 중요하다: `tsc`는 tsconfig `include`의 `.next/types/**`도 읽으므로 `next build`가 `validator.ts`를 새로 만든 **뒤**에 돌린다. 셋 중 하나라도 실패하면 출력 그대로 보고하고 다음 단계로 가지 않는다.

- [ ] **Step 9: 시각 대조(브라우저 패널) — 사용자 상시 지시**

준비: `dashboard/.env.local`이 있어야 한다(현재 존재). dev 서버는 실 Supabase에 붙는다 - 조회는 자유지만 **업로드·생성은 실 데이터를 만든다**(ScanUnitConfirm·ScanProcessing·ReportDetail 재현용 데이터가 필요하면 먼저 사용자에게 묻는다).

1. `preview_start name="dashboard"`(`.claude/launch.json`의 `npm run dev`, 포트 3000, cwd `dashboard` - 이미 있다). 패널이 `http://localhost:3000`을 열면 프록시가 `/login`으로 보낸다.
2. 사용자에게 로그인을 요청하고 **답을 기다린다**(비밀번호는 절대 입력하지 않는다 - 전역 규칙). 요청 문구:
   > 브라우저 패널에 로그인 화면이 떠 있습니다. 직접 로그인해 주세요(계정 test@gmail.com, 비밀번호는 제가 입력하지 않습니다). 홈(현장 목록)이 뜨면 "됐다"고 알려 주세요.
   답을 받으면 `read_page`로 h1 '현장'이 있는지 확인한다(없으면 다시 요청).
3. `resize_window width=1440 height=900`(아트보드 프레임과 동일 폭). `tabs_create`(background)로 아트보드용 탭 B를 하나 만들어 둔다(앱 탭 A와 번갈아 `tabId`를 지정).
4. Step 1 표의 순서대로, 화면마다:
   - 탭 A: `navigate` 라우트 → `computer screenshot`(필요하면 `zoom`으로 버튼·표 헤더 확대) → `read_console_messages onlyErrors=true`(**0건**이어야 한다. 있으면 원인을 고치거나, 이 태스크 밖 원인이면 문구 그대로 compare.md에 적는다).
   - 탭 B: `navigate file:///D:/Projects/Flatness/docs/design/cloudscape/<이름>.dc.html` → `computer screenshot`.
   - 아래 체크리스트로 비교하고 차이를 `t12/compare.md`에 한 줄씩 적는다.
   - `file://`이 패널에서 막히면(권한 거부) `.claude/launch.json`(추적되지 않는 로컬 파일)에 아래 항목을 넣고 `preview_start name="artboards"` 후 `http://localhost:5180/<이름>.dc.html`을 쓴다(`npx -y serve`는 기존 `design-preview` 항목과 같은 방식):
     ```json
     { "name": "artboards", "runtimeExecutable": "npx",
       "runtimeArgs": ["-y", "serve", "-l", "5180", "--no-clipboard", "docs/design/cloudscape"], "port": 5180 }
     ```

   체크리스트(스펙 §3~§5 수치 - 아트보드 인라인 스타일이 정본):
   | 항목 | 기대 |
   |---|---|
   | 상단 바 | 44px, `#0f1b2a`, 좌 아이콘+FLATNESS 700, 우 사용자 아이콘+이메일(mono) - 검색·알림 없음 |
   | 사이드 내비 | 280px 흰 배경, 우측 1px 구분선, 헤더 '평활도 분석 콘솔' 16px 700, 항목 padding 8/28, 활성 파랑 700, 그룹 사이 구분선, 아이콘 없음 |
   | 본문 | padding 20/40/40, 섹션 gap 20, 최대폭 없음 |
   | 페이지 헤더 | 브레드크럼(홈 제외, 루트 '현장', 마지막 비링크 보조색) → h1 24px/30px 700 → 우측 액션. primary **1개** |
   | 컨테이너 | 그림자 + 16px 라운드, 보더 없음. 헤더 padding 12/20 + 하단 1px, 제목 18px 700 + 카운터 `(n)` 보조색 |
   | 버튼 | 32px 알약, 2px 보더, 700, 아이콘 16px + gap 6. disabled는 `cs-disabled` |
   | 표 | 헤더 40px 700 상하 1px, 행 44px, 셀 padding 0/20, 첫 열 파랑 700 링크, 수치 우측 tabular mono |
   | 폼 | 라벨 14px 700, 설명 12px 보조색, 필드 gap 16, 입력 32px · 2px `#8c8c94` · 8px 라운드, 셀렉트 chevron |
   | 상태 | StatusIndicator 아이콘 16px + 색(적합 success / 경계 warning / 보수·재시공 error / 불가 na / 진행 보조색) |
   | 알림 | 12px 라운드, 2px 보더, 좌측 아이콘, padding 12/16 |
   | 히트맵 범례 | `GRADE_COLOR` 5색 그대로(화면 배지·분포 바만 시스템 색) |

   `t12/compare.md` 형식(첫 줄부터 이 헤더로 시작한다):
   ```markdown
   | 화면 | 항목 | 앱 | 아트보드 | 분류 | 조치 |
   |---|---|---|---|---|---|
   ```
   분류는 세 가지뿐: **토큰·간격**(→ 즉시 수정, 조치 열에 파일·클래스), **데이터**(아트보드 더미 데이터와 실 데이터의 차이 - 기록만), **의도된 차이**(스펙 §7: 페이지네이션 없음 → 건수 텍스트, 상단 바 검색·알림 없음, 네이티브 라디오·체크박스, 모노 Geist Mono, 로그인 화면 사이드 내비 없음 - 기록만).
5. **토큰·간격 차이는 그 자리에서 고친다** - 해당 파일을 편집하면 dev 서버가 다시 그리므로 탭 A를 `navigate`로 새로고침해 재확인하고 compare.md의 조치 열에 적는다. 구조가 다르면(컨테이너가 빠졌다, primary가 둘이다) 그 화면의 태스크가 미완이다 - 같은 규칙으로 고치되 그 태스크의 테스트가 계속 통과해야 한다.
6. Login은 맨 마지막: 사이드 내비 '로그아웃' → `/login` 도착 → 스크린샷·콘솔 확인(사이드 내비가 **없어야** 한다, 스펙 §5). 이후 Step 11에서 또 로그인이 필요하므로 여기서 끝낸다.

- [ ] **Step 10: 375px 세로 스택 확인(스펙 §9-4)** — 로그인 상태에서(Step 9-6 전에 하거나, 사용자에게 한 번 더 로그인을 요청) `resize_window preset="mobile"`(375×812, 모바일 에뮬레이션) 후 `/`와 `/scans/<scanId>`(완료 스캔)를 각각 `navigate` → `computer screenshot` → `javascript_tool`:

```js
({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, strip: !!document.querySelector('nav[aria-label="주 메뉴(모바일)"]') })
```
기대: `scrollWidth === clientWidth`(가로 스크롤 없음 = 세로 스택), `strip === true`(T1의 모바일 가로 메뉴 스트립), 스크린샷에서 상단 바 → 메뉴 스트립 → 본문이 위에서 아래로 쌓인다(2026-08-11 T1 "세로 기둥" 사고 재발 금지). 어긋나면 폭을 고정한 요소(`w-[…px]`, `grid-cols-4`에 `min-w`)를 찾아 `md:` 접두사 뒤로 옮기고 재확인한다. 끝나면 `resize_window preset="desktop"`으로 되돌린다.

- [ ] **Step 11: 스크린샷을 파일로 남긴다(스크래치패드)** — 패널 스크린샷은 대화 안에만 남으므로, 증적은 CDP(Chrome DevTools Protocol)로 파일에 쓴다. 의존성 0(Node 22 전역 `fetch`·`WebSocket`, 설치된 Chrome `C:/Program Files/Google/Chrome/Application/chrome.exe`). 로그인은 사용자가 그 Chrome 창에서 직접 한다.

`<scratchpad>/t12/targets.json` — 값은 Step 9에서 방문한 URL에서 복사한다(uuid). 재현 못 한 화면은 `null`.
```json
{
  "siteId": "",
  "locationId": "",
  "scanDoneId": "",
  "scanUnitConfirmId": null,
  "scanProcessingId": null,
  "reportId": null,
  "registrationId": null
}
```

`<scratchpad>/t12/shots.mjs`
```js
// shots.mjs - 화면 스크린샷을 파일로 남긴다(사용자 상시 지시: 화면 캡처 대조의 증적).
// 의존성 0: Node 22의 전역 fetch·WebSocket으로 CDP(Chrome DevTools Protocol)를 직접 쓴다.
// 로그인은 사용자가 headed Chrome 창에서 직접 한다 - 이 스크립트는 자격 증명을 만지지 않는다.
//
// 사용:
//   1) 전용 프로필로 Chrome을 디버그 포트에 띄운다(사용자 본 프로필은 건드리지 않는다):
//      "C:/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222 \
//        --user-data-dir="<scratchpad>/t12/chrome-profile" --no-first-run --window-size=1440,1000 \
//        http://localhost:3000/login
//   2) 그 창에서 사용자가 로그인한다(홈이 뜰 때까지).
//   3) node shots.mjs  ->  shots/<화면>.app.png · <화면>.artboard.png · <화면>.mobile.png · console.json · index.md
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots');
const APP = 'http://localhost:3000';
const ART = 'file:///D:/Projects/Flatness/docs/design/cloudscape';
const T = JSON.parse(readFileSync(join(HERE, 'targets.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// [화면 이름, 앱 경로(null이면 미재현 - 아트보드만 찍고 index.md에 적는다), 아트보드 파일명]
const SCREENS = [
  ['Main', '/', 'Main'],
  ['Upload', '/upload', 'Upload'],
  ['SiteNew', '/sites/new', 'SiteNew'],
  ['SiteDetail', `/sites/${T.siteId}`, 'SiteDetail'],
  ['ScanDone', `/scans/${T.scanDoneId}`, 'ScanDone'],
  ['ScanUnitConfirm', T.scanUnitConfirmId ? `/scans/${T.scanUnitConfirmId}` : null, 'ScanUnitConfirm'],
  ['ScanProcessing', T.scanProcessingId ? `/scans/${T.scanProcessingId}` : null, 'ScanProcessing'],
  ['Reports', '/reports', 'Reports'],
  ['ReportNew', `/reports/new?location=${T.locationId}`, 'ReportNew'],
  ['ReportDetail', T.reportId ? `/reports/${T.reportId}` : null, 'ReportDetail'],
  ['Settings', '/settings', 'Settings'],
  ['RegistrationNew', `/registrations/new?location=${T.locationId}`, 'RegistrationNew'],
  ['RegistrationDetail', T.registrationId ? `/registrations/${T.registrationId}` : null, 'RegistrationDetail'],
  ['Login', '/login', 'Login'], // 마지막: 로그인 상태에서 리다이렉트되면 index.md의 도착 URL로 드러난다
];
const MOBILE = new Set(['Main', 'ScanDone']); // 스펙 §9-4: 375px 세로 스택 확인 대상

async function connect() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
  if (!page) throw new Error('디버그 포트 9222에 페이지 탭이 없다 - 1)의 명령으로 Chrome을 띄웠는지 확인');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('CDP 연결 실패')); });
  let seq = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result ?? {});
    } else if (m.method) {
      for (const l of listeners) l(m);
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const once = (method, timeoutMs = 30000) => new Promise((res, rej) => {
    const t = setTimeout(() => { off(); rej(new Error(`timeout: ${method}`)); }, timeoutMs);
    const off = on((m) => { if (m.method === method) { clearTimeout(t); off(); res(m.params); } });
  });
  return { send, on, once, close: () => ws.close() };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const cdp = await connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  // 콘솔 오류 수집(아트보드는 support.js 404가 정상이라 제외)
  const errors = [];
  let current = '';
  cdp.on((m) => {
    if (!current || current.endsWith('.artboard')) return;
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push({ screen: current, kind: 'console.error', text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ') });
    } else if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push({ screen: current, kind: 'exception', text: `${d.text} ${d.exception?.description ?? ''}`.trim() });
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push({ screen: current, kind: 'log', text: m.params.entry.text, url: m.params.entry.url ?? '' });
    }
  });

  // 뷰포트를 먼저 정하고(md 분기점이 레이아웃 시점에 반영되도록) 이동 → 폰트 로드 → hydration 대기 → 전체 높이 캡처
  async function capture(name, url, { width, height, mobile }) {
    current = name;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await loaded;
    await cdp.send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true });
    await sleep(1500); // 클라이언트 hydration·Realtime 구독·useLinkStatus 안정화
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
    return result.value;
  }

  const rows = [];
  for (const [name, path, art] of SCREENS) {
    // 아트보드: 1440px 고정 프레임 - captureBeyondViewport로 프레임 높이(900~2240)만큼 전부 담는다
    await capture(`${name}.artboard`, `${ART}/${art}.dc.html`, { width: 1440, height: 900, mobile: false });
    if (!path) { rows.push(`| ${name} | (미재현) | ${name}.artboard.png | - |`); continue; }
    const landed = await capture(`${name}.app`, `${APP}${path}`, { width: 1440, height: 900, mobile: false });
    let mobileCell = '-';
    if (MOBILE.has(name)) {
      await capture(`${name}.mobile`, `${APP}${path}`, { width: 375, height: 812, mobile: true });
      const { result } = await cdp.send('Runtime.evaluate', {
        expression: '({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth })',
        returnByValue: true,
      });
      mobileCell = `${name}.mobile.png (scrollWidth ${result.value.sw} / clientWidth ${result.value.cw})`;
    }
    const redirected = landed.endsWith(path) ? '' : ` -> ${landed}`;
    rows.push(`| ${name} | ${name}.app.png (${path}${redirected}) | ${name}.artboard.png | ${mobileCell} |`);
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  cdp.close();

  writeFileSync(join(OUT, 'console.json'), JSON.stringify(errors, null, 2));
  const byScreen = errors.reduce((acc, e) => ((acc[e.screen] = (acc[e.screen] ?? 0) + 1), acc), {});
  writeFileSync(join(OUT, 'index.md'), [
    '| 화면 | 앱 | 아트보드 | 375px |', '|---|---|---|---|', ...rows, '',
    `콘솔 오류: ${errors.length}건 ${errors.length ? JSON.stringify(byScreen) : '(0 - 통과)'}`, '',
  ].join('\n'));
  console.log(`saved -> ${OUT}\nconsole errors: ${errors.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

실행 절차:
```bash
SP="D:/Codex/Temp/claude/D--Projects-Flatness/e18a6bd7-2852-4d1d-b26c-35941061ea63/scratchpad/t12"
"/c/Program Files/Google/Chrome/Application/chrome.exe" --remote-debugging-port=9222 \
  --user-data-dir="$SP/chrome-profile" --no-first-run --window-size=1440,1000 http://localhost:3000/login &
```
→ 사용자에게 "새로 뜬 Chrome 창에서 한 번 더 로그인해 주세요(스크린샷 파일 저장용 전용 프로필입니다). 홈이 뜨면 알려 주세요." → 답을 받은 뒤:
```bash
node "$SP/shots.mjs"          # saved -> .../t12/shots, console errors: 0
cat "$SP/shots/index.md"
```
`shots/index.md`의 도착 URL(리다이렉트 표시)·375px `scrollWidth == clientWidth`·콘솔 0건을 확인한다. 저장된 PNG는 Read로 열어 볼 수 있으니 Step 9에서 애매했던 항목은 여기서 다시 본다(`<이름>.app.png`와 `<이름>.artboard.png`를 나란히). 끝나면 Chrome 창을 닫는다. `chrome-profile/`에는 세션 쿠키가 남으므로 스크래치패드 밖으로 옮기지 않는다.

- [ ] **Step 12: 통과 확인(최종)** — Step 9~11에서 소스를 한 줄이라도 고쳤으면 `preview_stop`으로 dev 서버를 내리고 Step 8의 세 명령을 다시 돌린다: `cd dashboard && npx vitest run` 전체 PASS, `rm -rf .next && npx next build` exit 0, `npx tsc --noEmit -p .` 0 에러. 그리고 마지막으로 `grep -rnE "\b(zinc|amber|red|green|emerald|purple|blue)-[0-9]{2,3}\b" app components lib --include=*.tsx --include=*.ts` → **0건**(테스트 포함), `git status --porcelain`에 `.next`·`.env.local`·스크래치패드 파일이 없는지 확인한다.

- [ ] **Step 13: 커밋** — 스윕 표·대조 결과 요약을 본문에 남긴다(스크린샷 파일은 커밋하지 않는다). 본문의 수치·파일 목록은 Step 7 표·Step 8/12 출력·`compare.md`·`shots/index.md`에서 **실측값을 옮겨 적는다**.

```bash
git add dashboard/__tests__/palette-sweep.test.ts
git add -u dashboard/app dashboard/components dashboard/lib          # Step 4의 git rm 포함, 수정된 추적 파일 전부
git status --porcelain                                               # 위 목록 밖의 파일이 없어야 한다
git commit -F - <<'EOF'
refactor(dashboard): 잔재 스윕 · MetricCard/StatusDot 삭제 · 아트보드 14장 시각 대조

스윕: app/components/lib(테스트 포함) 옛 팔레트 grep 0건. 치환한 파일과 클래스:
- components/ui/spinner.tsx: T11에서 border-cs-divider border-t-cs-text로 완료 - 확인만(무변경)
- (Step 7 표의 "파일 -> 남은 클래스 -> 대체" 줄을 여기에 그대로 옮긴다)
삭제: components/ui/metric-card.tsx, status-dot.tsx (import 0건 확인 후 git rm) + 주석의 옛 이름 갱신
가드: __tests__/palette-sweep.test.ts - 옛 팔레트·삭제 파일 재유입을 파일:줄로 차단
tsc: 사전 존재 테스트 타입 오류 4건 수정(use-row-status.test 스텁 타입 3, registrations/[id]
page.test 픽스처 horizontal_sensitivity 1) - 동작 무변경. next build는 .next 초기화 후 exit 0.

검증: vitest 전체 PASS(파일 수·케이스 수 실측), tsc 0 에러, next build exit 0.

시각 대조(1440x900, docs/design/cloudscape/*.dc.html 대비, 로그인은 사용자가 직접):
- 14장 중 재현 N장 / 미재현 (ScanUnitConfirm·ScanProcessing·RegistrationDetail 등 - 사유)
- 즉시 수정한 토큰·간격 차이: (파일: 항목 - 옛 값 -> 새 값) 줄마다 하나
- 데이터 차이·의도된 차이(스펙 §7: 페이지네이션 없음, 상단 바 검색·알림 없음, 네이티브 라디오,
  Geist Mono, 로그인 사이드 내비 없음)는 compare.md에 기록
- 콘솔 오류 0 (read_console_messages + shots/console.json)
- 375px 홈·스캔 작업대: scrollWidth == clientWidth, 모바일 메뉴 스트립 표시, 세로 스택
스크린샷: 스크래치패드 t12/shots/ (앱·아트보드·375px PNG, 커밋 안 함)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---
