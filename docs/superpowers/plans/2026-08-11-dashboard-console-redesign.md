# 대시보드 계측 콘솔 리디자인 + 흐름 단순화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flatness 대시보드를 계측 콘솔 톤(사이드바·모노 수치·의미색 4종)으로 리디자인하고, 첫 PDF까지의 화면 이동을 12 → 5로 줄인다.

**Architecture:** 디자인 토큰(globals.css `@theme`) + `components/ui/` 프리미티브 6종을 먼저 깔고, 그 위에서 화면을 라우트 단위로 전환한다. 서버·DB·워커는 무변경 — 화면·링크·폼 로직만 바꾼다. `/scans/[id]`를 유일한 작업대로 통합하고 `/analyses/[id]`·`/scans/[id]/confirm-unit`은 서버 리다이렉트로 보존한다.

**Tech Stack:** Next.js(App Router, 이 저장소 전용 관례 — `dashboard/AGENTS.md`), Tailwind CSS v4(`@theme`), next/font/google, Supabase JS, Vitest + Testing Library.

## Global Constraints

- **스펙**: `docs/superpowers/specs/2026-08-11-dashboard-console-redesign-design.md`. 충돌 시 스펙이 이긴다.
- **이 Next.js는 관례가 다르다.** 코드 작성 전 `dashboard/node_modules/next/dist/docs/`에서 해당 기능 가이드를 읽는다(최소: fonts, redirecting, layouts-and-pages).
- **의미색 4종 외 컬러 금지**: 적합 green-600 / 주의 amber-500 / 재시공 red-600 / 미상 zinc-400 (의미색 배지는 배경 `-50`, 텍스트 `-700`). 기존 `blue-700` 클래스는 전부 제거 대상.
  **중립(zinc) 예외 명문화**: zinc-50은 흰 카드 위에서 식별 불가라 zinc 계열 배지는 `bg-zinc-100`/`text-zinc-600`, busy 점은 `zinc-500`을 쓴다 — 이것은 의미색이 아니라 중립 상태 표시다.
- **주 버튼**: `bg-zinc-900 hover:bg-zinc-700 text-white`. 보조 버튼: `border border-zinc-300 bg-white hover:bg-zinc-50`.
- **수치·일시·ID·단위는 `font-mono tabular-nums`**. 본문 Noto Sans KR, 모노 Geist Mono — 둘 다 next/font/google.
- **다크 모드 금지**(스펙 §2). 차트 라이브러리 추가 금지.
- **서버 스키마·워커 무변경.** Supabase 조회 추가는 허용.
- **기존 가드 로직 보존**: `app/scans/[id]/page.tsx`의 `provenNotImport`·`isImportUnknownOrTrue`·`showFirstFlatness`·`showSlopeButton/Section` 분기와 그 주석은 **문장 그대로 보존**한다. 이 분기들은 리뷰 사고(C1: Colab CSV에 analyze 잡이 걸려 전 셀이 조용히 '적합')를 막는 가드다. UI만 갈아끼운다.
- 코드 주석 한국어, 알고리즘·라이브러리 이름 영어. 커밋 메시지는 기존 저장소 관례(`feat(dashboard): …`).
- 각 태스크 완료 시 `cd dashboard && npx vitest run` 전체 통과 후 커밋.

## File Structure

```
dashboard/
  app/layout.tsx                     [T1 수정] 폰트 + 사이드바 레이아웃 골격
  app/globals.css                    [T1 수정] @theme 토큰
  components/sidebar.tsx             [T1 신규] 사이드바 (nav.tsx 대체)
  components/nav.tsx                 [T1 삭제]
  components/ui/status-dot.tsx       [T2 신규]
  components/ui/badge.tsx            [T2 신규]
  components/ui/metric-card.tsx      [T2 신규]
  components/ui/data-table.tsx       [T2 신규]
  components/ui/page-header.tsx      [T2 신규]
  components/ui/empty-state.tsx      [T2 신규]
  components/ui/__tests__/ui.test.tsx [T2 신규]
  lib/domain/summary.ts              [T3 수정] 처리 중 건수 집계
  app/page.tsx                       [T3 수정] 지표 스트립 + 현장 테이블
  components/site-card.tsx           [T3 삭제] (+ site-card.test.tsx 삭제)
  components/upload-form.tsx         [T4 수정] 단일 셀렉트 + 인라인 생성 + 프리필 수정
  app/upload/page.tsx                [T4 수정] 빈 상태 제거(폼 상시)
  app/scans/[id]/page.tsx            [T5 수정] 작업대 통합
  components/scan-step-strip.tsx     [T5 신규] 단계 스트립
  app/analyses/[id]/page.tsx         [T6 수정] redirect 전용으로 축소
  app/scans/[id]/confirm-unit/page.tsx [T6 수정] redirect 전용으로 축소
  app/reports/page.tsx               [T7 수정] 새 보고서 버튼 상시 + EmptyState
  app/reports/new/page.tsx           [T7 수정] location 없으면 선택 UI
  app/reports/[id]/page.tsx          [T7 수정] PageHeader 브레드크럼
  app/sites/[id]/page.tsx            [T8 수정] PageHeader + 토큰
  app/settings/page.tsx, app/login/page.tsx,
  app/registrations/*, app/sites/new/page.tsx [T8 수정] 토큰·브레드크럼 스윕
```

---

### Task 1: 디자인 토큰 + 폰트 + 사이드바 레이아웃

**Files:**
- Modify: `dashboard/app/globals.css`, `dashboard/app/layout.tsx`
- Create: `dashboard/components/sidebar.tsx`
- Delete: `dashboard/components/nav.tsx`
- Test: 기존 `dashboard/app/__tests__/page.test.tsx`가 계속 통과해야 함 (Nav 참조가 있으면 갱신)

**Interfaces:**
- Produces: `<Sidebar />` (서버 컴포넌트, props 없음) — 이후 태스크의 모든 화면이 이 레이아웃 안에서 렌더된다. 본문 래퍼는 `layout.tsx`가 제공하는 `<div className="flex-1 min-w-0">` 안의 `{children}`.

- [ ] **Step 1: Next.js 가이드 확인** — `dashboard/node_modules/next/dist/docs/`에서 fonts 문서를 읽고 `next/font/google` 사용법이 아래 코드와 일치하는지 확인. 다르면 문서를 따르고 커밋 메시지에 그 사실을 적는다.

- [ ] **Step 2: globals.css 교체**

```css
@import "tailwindcss";

:root {
  --background: #fafafa; /* zinc-50 */
  --foreground: #18181b; /* zinc-900 */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-noto-sans-kr);
  --font-mono: var(--font-geist-mono);
}

/* 리뷰 Important 4(이력 보존): unlayered 다크모드 규칙은 Tailwind v4 @layer보다
   항상 우선해 판독 불가를 만들었던 사고가 있다 - 다크모드 규칙을 다시 넣지 않는다. */
```

- [ ] **Step 3: layout.tsx 교체**

```tsx
import type { Metadata } from 'next';
import { Noto_Sans_KR, Geist_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '@/components/sidebar';

const notoSansKr = Noto_Sans_KR({ subsets: ['latin'], variable: '--font-noto-sans-kr' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Flatness — 평활도 분석 콘솔',
  description: '현장 바닥·벽면 평활도 스크리닝 결과 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className={`${notoSansKr.variable} ${geistMono.variable} min-h-screen bg-zinc-50 font-sans text-zinc-900 antialiased`}>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: sidebar.tsx 작성** — 서버 컴포넌트 + 활성 표시용 클라이언트 섬. 두 파일로 나눈다.

`components/sidebar.tsx` (서버 — 사용자 이메일 조회, nav.tsx의 로직 이관):

```tsx
// 사이드바 (서버 컴포넌트) - 활성 표시는 클라이언트 섬 SidebarNav가 담당
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from './logout-button';
import { SidebarNav } from './sidebar-nav';

export async function Sidebar() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex">
      <Link href="/" className="border-b border-zinc-200 px-4 py-4 font-mono text-sm font-semibold tracking-tight">
        FLATNESS<span className="text-zinc-400"> console</span>
      </Link>
      <SidebarNav />
      <div className="mt-auto border-t border-zinc-200 px-4 py-3 text-xs text-zinc-500">
        {user && <p className="mb-2 truncate font-mono">{user.email}</p>}
        <LogoutButton />
      </div>
    </aside>
  );
}
```

`components/sidebar-nav.tsx` (클라이언트 — usePathname 활성 표시 + 모바일 드로어):

```tsx
'use client';
// 데스크톱 메뉴 + 모바일 상단 바/드로어. 활성 판정은 pathname prefix.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const MENU = [
  { href: '/', label: '현장', match: (p: string) => p === '/' || p.startsWith('/sites') || p.startsWith('/scans') || p.startsWith('/registrations') },
  { href: '/reports', label: '보고서', match: (p: string) => p.startsWith('/reports') },
  { href: '/upload', label: '업로드', match: (p: string) => p.startsWith('/upload') },
  { href: '/settings', label: '설정', match: (p: string) => p.startsWith('/settings') },
];

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 p-2 text-sm">
      {MENU.map((m) => {
        const active = m.match(pathname);
        return (
          <Link key={m.href} href={m.href}
            className={`rounded-md border-l-2 px-3 py-1.5 ${active
              ? 'border-zinc-900 bg-zinc-100 font-medium text-zinc-900'
              : 'border-transparent text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'}`}>
            {m.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

모바일: `layout.tsx`의 `<div className="flex-1 min-w-0">` 위에 모바일 전용 상단 바를 넣는다. 사이드바 컴포넌트 안에서 `md:hidden` 상단 바 + `useState` 드로어로 구현해도 된다 — 단 서버/클라이언트 경계를 지킬 것(이메일 조회는 서버, 토글은 클라이언트). 최소 구현: 상단 바에 로고 + 4개 메뉴 가로 나열(햄버거 없이)로 시작해도 스펙 §4를 만족한다(375px에서 4개 메뉴가 들어간다).

- [ ] **Step 5: nav.tsx 삭제 + 참조 정리** — `git grep -n "components/nav"` 로 참조를 찾아 전부 Sidebar로 교체 후 `git rm dashboard/components/nav.tsx`.

- [ ] **Step 6: 테스트 실행** — `cd dashboard && npx vitest run`. 기존 테스트가 Nav를 임포트하면 Sidebar 기준으로 갱신. Expected: 전체 PASS.

- [ ] **Step 7: 빌드 확인** — `cd dashboard && npx next build` (폰트 페치 포함). Expected: exit 0.

- [ ] **Step 8: Commit** — `git commit -m "feat(dashboard): 계측 콘솔 토큰 + 사이드바 레이아웃"`

### Task 2: UI 프리미티브 6종

**Files:**
- Create: `dashboard/components/ui/status-dot.tsx`, `badge.tsx`, `metric-card.tsx`, `data-table.tsx`, `page-header.tsx`, `empty-state.tsx`
- Test: `dashboard/components/ui/__tests__/ui.test.tsx`

**Interfaces:**
- Produces (이후 모든 태스크가 사용):
  - `StatusDot({ tone, label }: { tone: 'pass'|'warn'|'fail'|'unknown'|'busy'; label: string })`
  - `Badge({ tone, children }: { tone: 'pass'|'warn'|'fail'|'unknown'|'neutral'; children: ReactNode })`
  - `MetricCard({ label, value, unit, children }: { label: string; value: string|number; unit?: string; children?: ReactNode })` — children은 미니 분포바 슬롯
  - `VerdictBar({ counts }: { counts: { pass: number; warn: number; fail: number } })` — metric-card.tsx 안에 함께 export
  - `DataTable`은 컴포넌트가 아니라 **클래스 프리셋 상수** `tableClass = { table, thead, th, thNum, td, tdNum, row }` (data-table.tsx에서 export) — 기존 화면들이 시맨틱 `<table>`을 유지하도록
  - `PageHeader({ crumbs, title, actions }: { crumbs?: { href?: string; label: string }[]; title: ReactNode; actions?: ReactNode })`
  - `EmptyState({ message, actionHref, actionLabel }: { message: string; actionHref: string; actionLabel: string })` — **행동 버튼이 필수 prop**(막다른 화면 금지 규칙의 구현)

- [ ] **Step 1: 실패하는 테스트 작성** (`components/ui/__tests__/ui.test.tsx`)

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusDot } from '../status-dot';
import { Badge } from '../badge';
import { MetricCard, VerdictBar } from '../metric-card';
import { PageHeader } from '../page-header';
import { EmptyState } from '../empty-state';

describe('ui primitives', () => {
  it('StatusDot: 의미색 4종 + busy가 라벨과 함께 렌더된다', () => {
    render(<StatusDot tone="pass" label="적합" />);
    expect(screen.getByText('적합')).toBeInTheDocument();
  });
  it('Badge: tone별 클래스가 배경 -50 / 텍스트 -700 규칙을 따른다', () => {
    render(<Badge tone="fail">재시공</Badge>);
    const el = screen.getByText('재시공');
    expect(el.className).toContain('bg-red-50');
    expect(el.className).toContain('text-red-700');
  });
  it('MetricCard: 수치가 모노스페이스로, 단위가 분리 렌더된다', () => {
    render(<MetricCard label="스캔" value={12} unit="건" />);
    expect(screen.getByText('12').className).toContain('font-mono');
    expect(screen.getByText('건')).toBeInTheDocument();
  });
  it('VerdictBar: 합계 0이면 비어 있음 표시, 아니면 세그먼트 3개', () => {
    const { container, rerender } = render(<VerdictBar counts={{ pass: 0, warn: 0, fail: 0 }} />);
    expect(container.textContent).toContain('판정 없음');
    rerender(<VerdictBar counts={{ pass: 2, warn: 1, fail: 1 }} />);
    expect(container.querySelectorAll('[data-seg]').length).toBe(3);
  });
  it('PageHeader: 브레드크럼 링크와 제목이 렌더된다', () => {
    render(<PageHeader crumbs={[{ href: '/', label: '현장' }, { label: '101동' }]} title="스캔 상세" />);
    expect(screen.getByRole('link', { name: '현장' })).toHaveAttribute('href', '/');
    expect(screen.getByText('스캔 상세')).toBeInTheDocument();
  });
  it('EmptyState: 행동 버튼이 항상 있다', () => {
    render(<EmptyState message="보고서가 없습니다" actionHref="/reports/new" actionLabel="새 보고서" />);
    expect(screen.getByRole('link', { name: '새 보고서' })).toHaveAttribute('href', '/reports/new');
  });
});
```

- [ ] **Step 2: 실행해 실패 확인** — `npx vitest run components/ui`. Expected: 모듈 없음 FAIL.

- [ ] **Step 3: 구현.** 색 매핑은 한 곳에만 둔다(`badge.tsx`에서 export해 status-dot이 재사용):

```tsx
// badge.tsx
export const TONE = {
  pass:    { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-600' },
  warn:    { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  fail:    { bg: 'bg-red-50',   text: 'text-red-700',   dot: 'bg-red-600' },
  unknown: { bg: 'bg-zinc-100', text: 'text-zinc-600',  dot: 'bg-zinc-400' },
  neutral: { bg: 'bg-zinc-100', text: 'text-zinc-600',  dot: 'bg-zinc-400' },
  busy:    { bg: 'bg-zinc-100', text: 'text-zinc-600',  dot: 'bg-zinc-500' },
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  const t = TONE[tone];
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${t.bg} ${t.text}`}>{children}</span>;
}
```

```tsx
// status-dot.tsx
import { TONE } from './badge';
export function StatusDot({ tone, label }: { tone: 'pass'|'warn'|'fail'|'unknown'|'busy'; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span aria-hidden className={`h-2 w-2 rounded-full ${TONE[tone].dot}`} />
      {label}
    </span>
  );
}
```

```tsx
// metric-card.tsx
export function MetricCard({ label, value, unit, children }: {
  label: string; value: string | number; unit?: string; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="font-mono text-xl tabular-nums">{value}</span>
        {unit && <span className="text-xs text-zinc-500">{unit}</span>}
      </p>
      {children}
    </div>
  );
}

export function VerdictBar({ counts }: { counts: { pass: number; warn: number; fail: number } }) {
  const total = counts.pass + counts.warn + counts.fail;
  if (total === 0) return <p className="mt-2 text-xs text-zinc-400">판정 없음</p>;
  // 색은 TONE(badge.tsx)이 유일한 정의처다 - 여기서 리터럴로 재정의하지 않는다
  const seg = [
    { n: counts.pass, cls: TONE.pass.dot },
    { n: counts.warn, cls: TONE.warn.dot },
    { n: counts.fail, cls: TONE.fail.dot },
  ];
  return (
    <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-zinc-100">
      {seg.filter((s) => s.n > 0).map((s, i) => (
        <div key={i} data-seg className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} />
      ))}
    </div>
  );
}
```

```tsx
// data-table.tsx - 클래스 프리셋. 수치 열은 thNum/tdNum(우측 정렬 + 모노).
export const tableClass = {
  table: 'w-full border-collapse text-sm',
  thead: 'border-b border-zinc-200 text-left text-xs text-zinc-500',
  th: 'px-3 py-2 font-normal',
  thNum: 'px-3 py-2 text-right font-normal',
  td: 'px-3 py-2',
  tdNum: 'px-3 py-2 text-right font-mono tabular-nums',
  row: 'border-b border-zinc-100 hover:bg-zinc-50',
} as const;
```

```tsx
// page-header.tsx
import Link from 'next/link';
export function PageHeader({ crumbs, title, actions }: {
  crumbs?: { href?: string; label: string }[]; title: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      {crumbs && crumbs.length > 0 && (
        <nav className="mb-1 flex items-center gap-1 text-xs text-zinc-500">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden>›</span>}
              {c.href ? <Link href={c.href} className="hover:text-zinc-900 hover:underline">{c.label}</Link> : <span>{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{title}</h1>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
```

```tsx
// empty-state.tsx - 행동 버튼 필수(막다른 화면 금지)
import Link from 'next/link';
export function EmptyState({ message, actionHref, actionLabel }: {
  message: string; actionHref: string; actionLabel: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-zinc-300 bg-white p-8 text-center">
      <p className="text-sm text-zinc-600">{message}</p>
      <Link href={actionHref}
        className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700">
        {actionLabel}
      </Link>
    </div>
  );
}
```

- [ ] **Step 4: 테스트 통과 확인** — `npx vitest run components/ui`. Expected: 6 PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): UI 프리미티브 6종 (StatusDot·Badge·MetricCard·tableClass·PageHeader·EmptyState)"`

### Task 3: 홈 개편 — 지표 스트립 + 현장 테이블

**Files:**
- Modify: `dashboard/lib/domain/summary.ts`, `dashboard/app/page.tsx`
- Delete: `dashboard/components/site-card.tsx`, `dashboard/components/__tests__/site-card.test.tsx`
- Test: `dashboard/lib/domain/__tests__/summary.test.ts`(있으면 확장, 없으면 신규), `dashboard/app/__tests__/page.test.tsx` 갱신

**Interfaces:**
- Consumes: T2의 `MetricCard`·`VerdictBar`·`tableClass`·`EmptyState`.
- Produces: `buildSiteSummaries`에 **처리 중 집계** 추가 — 기존 반환 형태를 유지하고, 별도 함수 `countInProgress(analyses: { status: AnalysisStatus }[]): number`를 export (status가 `'queued' | 'processing'`인 것의 수).

- [ ] **Step 1: summary 테스트 추가** — 기존 summary 테스트 파일 위치를 `ls dashboard/lib/domain/__tests__/`로 확인 후 추가:

```ts
import { describe, expect, it } from 'vitest';
import { countInProgress } from '../summary';

describe('countInProgress', () => {
  it('queued·processing만 센다', () => {
    expect(countInProgress([
      { status: 'queued' }, { status: 'processing' }, { status: 'done' }, { status: 'failed' },
    ])).toBe(2);
  });
  it('빈 배열은 0', () => { expect(countInProgress([])).toBe(0); });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/domain`. Expected: `countInProgress` 없음 FAIL.
- [ ] **Step 3: 구현** — `summary.ts`에 추가:

```ts
// 처리 중(큐 대기·실행 중) 분석 건수 - 홈 지표 스트립용
export function countInProgress(analyses: { status: AnalysisStatus }[]): number {
  return analyses.filter((a) => a.status === 'queued' || a.status === 'processing').length;
}
```

주의: 홈 쿼리는 현재 `.eq('kind', 'flatness')`로 좁혀져 있다(page.tsx 주석 — 구배가 섞이면 판정 집계 2배). **판정 집계는 그 쿼리를 유지**하고, 처리 중 집계용으로는 kind 무필터의 상태 전용 별도 쿼리를 추가한다: `supabase.from('analyses').select('status').in('status', ['queued','processing']).is('deleted_at', null)`.

- [ ] **Step 4: page.tsx 개편** — 구조:

```tsx
<main className="p-6">
  <PageHeader title="현장" actions={
    <Link href="/sites/new" className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700">새 현장</Link>
  } />
  <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
    <MetricCard label="현장" value={summaries.length} unit="곳" />
    <MetricCard label="스캔" value={totalScans} unit="건" />
    <MetricCard label="처리 중" value={inProgress} unit="건" />
    <MetricCard label="판정 분포" value={verdictTotal} unit="건">
      <VerdictBar counts={verdictCounts} />
    </MetricCard>
  </div>
  {/* 현장 테이블: 이름 | 측정위치 | 스캔 | 최근 측정일(모노) | 판정 분포(VerdictBar) */}
</main>
```

테이블 행 전체 클릭은 첫 셀의 `<Link>` + `row` hover로 구현(중첩 a 태그 금지). `verdictCounts`는 기존 `buildSiteSummaries` 결과의 현장별 집계를 합산한다(집계 필드명은 summary.ts를 읽고 그대로 사용). 빈 상태: 기존 3단계 안내 카드(1.현장 등록 → 2.측정위치 → 3.업로드)의 **문구는 유지**하되, 버튼은 T4 이후 흐름에 맞춰 `EmptyState(message="아직 등록된 현장이 없습니다. 업로드 화면에서 현장 생성까지 한 번에 할 수 있습니다.", actionHref="/upload", actionLabel="스캔 업로드로 시작")`로 교체.

- [ ] **Step 5: page.test.tsx 갱신** — site-card 대신 테이블 렌더를 검증(현장명이 링크로 렌더, `처리 중` 카드 존재). site-card.tsx와 그 테스트 삭제.
- [ ] **Step 6: 전체 테스트** — `npx vitest run`. Expected: PASS.
- [ ] **Step 7: Commit** — `git commit -m "feat(dashboard): 홈 지표 스트립 + 현장 밀도 테이블"`

### Task 4: 업로드 셀프서비스

**Files:**
- Modify: `dashboard/components/upload-form.tsx`, `dashboard/app/upload/page.tsx`
- Test: `dashboard/components/__tests__/upload-form.test.tsx` 확장

**Interfaces:**
- Consumes: 기존 `new-site-form.tsx`·`new-location-form.tsx`의 insert 패턴(파일을 읽고 같은 테이블·컬럼으로 insert). T2 프리미티브.
- Produces: `/upload?location=[id]` 단독 진입도 프리필되는 폼. 이후 태스크(T5·T7)가 이 쿼리 형태로 링크를 건다.

- [ ] **Step 1: 실패하는 테스트 추가** (upload-form.test.tsx의 기존 mock 패턴을 그대로 따른다 — 파일 상단 mock 구성을 먼저 읽을 것):

```tsx
it('location 프리필만 있어도 해당 현장이 함께 선택된다', () => {
  render(<UploadForm sites={sites} locations={locations} presetLocationId={locations[0].id} />);
  const sel = screen.getByLabelText('측정위치') as HTMLSelectElement;
  expect(sel.value).toBe(locations[0].id);
});
it('새 측정위치 인라인 폼을 열 수 있다', () => {
  render(<UploadForm sites={sites} locations={locations} />);
  fireEvent.click(screen.getByRole('button', { name: '+ 새 측정위치' }));
  expect(screen.getByLabelText('현장 선택 또는 새 현장명')).toBeInTheDocument();
});
```

(prop 이름이 현재 코드와 다르면 현재 코드의 prop 규약에 맞춰 테스트를 조정하되, 검증 대상 행동 두 가지 — location 단독 프리필, 인라인 생성 — 는 유지한다.)

- [ ] **Step 2: 실패 확인** — `npx vitest run components/__tests__/upload-form`. Expected: FAIL.
- [ ] **Step 3: 폼 개편 구현.**
  - 현장 셀렉트 + 측정위치 셀렉트 2개 → **`<optgroup label={site.name}>`로 묶인 단일 측정위치 셀렉트 1개.**
  - **프리필 버그 수정**: `?location=`만 와도 `locations.find(l => l.id === preset)?.site_id`로 site를 역산해 선택 상태를 만든다. 기존 버그(현장 선택 시 `setLocationId('')`로 프리필 파기)는 단일 셀렉트 전환으로 자연 소멸 — 회귀 테스트가 Step 1의 첫 테스트다.
  - **인라인 생성**: 셀렉트 아래 "+ 새 측정위치" 토글 버튼 → 미니 폼(현장: 기존 현장 셀렉트 또는 "새 현장명" 입력 / 동·층·공간·이름 입력) → 저장 시 (필요하면 sites insert →) locations insert → 새 location을 목록에 추가하고 선택 상태로. insert 컬럼은 `new-site-form.tsx`·`new-location-form.tsx`와 동일하게.
  - `app/upload/page.tsx`: 측정위치 0개일 때의 안내 박스 분기와 `sites[0]` 하드코딩 제거 — 폼을 항상 렌더.
  - 스타일: T2 토큰(주 버튼 zinc-900, 입력 `border-zinc-300 rounded-md`).
- [ ] **Step 4: 테스트 통과** — `npx vitest run`. Expected: PASS (기존 upload-form 테스트 포함 — 이중 셀렉트를 전제한 기존 테스트는 단일 셀렉트 규약으로 갱신).
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): 업로드 셀프서비스 - 단일 셀렉트 + 인라인 현장·위치 생성 + 프리필 수정"`

### Task 5: 스캔 작업대 통합

**Files:**
- Modify: `dashboard/app/scans/[id]/page.tsx`
- Create: `dashboard/components/scan-step-strip.tsx`
- Test: 신규 `dashboard/components/__tests__/scan-step-strip.test.tsx`

**Interfaces:**
- Consumes: 기존 `AnalysisResult`(components/analysis/), `SlopeResult`, `unit-confirm-form.tsx`, `AnalysisProgress`, `ScanStatusWatcher`, T2 프리미티브. `app/analyses/[id]/page.tsx`가 결과 렌더에 쓰는 데이터 조회 방식(그 파일을 읽고 이관).
- Produces: `/scans/[id]?analysis=[analysisId]` — 과거 분석 선택 렌더. T6의 리다이렉트가 이 규약을 쓴다.

- [ ] **Step 1: scan-step-strip 테스트 작성**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScanStepStrip } from '../scan-step-strip';

describe('ScanStepStrip', () => {
  it.each([
    ['uploaded', '사전 검사'],
    ['awaiting_unit_confirm', '단위 확정'],
    ['ready', '분석'],
  ] as const)('상태 %s에서 현재 단계 %s가 강조된다', (status, label) => {
    render(<ScanStepStrip status={status} hasDoneAnalysis={false} />);
    expect(screen.getByText(label).className).toContain('text-zinc-900');
  });
  it('완료 분석이 있으면 마지막 단계가 완료 표시된다', () => {
    render(<ScanStepStrip status="ready" hasDoneAnalysis />);
    expect(screen.getByText('완료')).toBeInTheDocument();
  });
  it('failed는 실패 톤으로 표시된다', () => {
    render(<ScanStepStrip status="failed" hasDoneAnalysis={false} />);
    expect(screen.getByText('사전 검사').className).toContain('text-red-700');
  });
});
```

- [ ] **Step 2: 실패 확인** — Expected: 모듈 없음 FAIL.
- [ ] **Step 3: ScanStepStrip 구현** — 단계: 업로드 → 사전 검사 → 단위 확정 → 분석 → 완료. props `{ status: ScanRow['status']; hasDoneAnalysis: boolean }`. 현재 단계 `text-zinc-900 font-medium`, 지난 단계 `text-zinc-400`, 미래 단계 `text-zinc-300`, failed는 해당 단계 `text-red-700`. 구분자 `›`, 전체 `font-mono text-xs`.
- [ ] **Step 4: 테스트 통과 확인.**
- [ ] **Step 5: scans/[id]/page.tsx 통합.** 순서와 원칙:
  1. `searchParams`에서 `analysis`를 받는다(`{ params, searchParams }: { params: Promise<{id:string}>; searchParams: Promise<{ analysis?: string }> }`).
  2. `PageHeader`: crumbs = [{href:'/', label:'현장'}, {href:`/sites/${loc.site_id}`, label: 현장명 — sites를 함께 조회}, {label: 측정위치 라벨}], title = `스캔 · ${SURFACE_LABEL[s.surface]} · ${s.scanned_at}`(일시는 `font-mono`), actions = **"이 위치의 보고서 생성"** 링크(`/reports/new?location=${s.location_id}`, 주 버튼) — 단 완료된 분석이 1개 이상일 때만.
  3. `<ScanStepStrip status={s.status} hasDoneAnalysis={!!doneFlatness || slopeAnalyses.some(a => a.status==='done')} />`
  4. **단위 확정 인라인**: `s.status === 'awaiting_unit_confirm'`이면 confirm-unit 화면으로 링크하는 대신, 그 화면이 렌더하던 것(높이 뷰 이미지 + `UnitConfirmForm`)을 섹션으로 렌더한다. `app/scans/[id]/confirm-unit/page.tsx`를 읽고 데이터 조회·props를 그대로 이관한다. `UnitConfirmForm`의 제출 후 `router.push('/scans/[id]')`는 같은 화면이므로 `router.refresh()`로 바꾼다(unit-confirm-form.tsx 수정 — 되돌리기·실패 처리 로직은 그대로).
  5. **결과 인라인**: 선택된 분석(기본 = 최신 done, `?analysis=`가 있으면 그 id)을 `app/analyses/[id]/page.tsx`가 하던 방식대로 렌더한다 — 그 파일을 읽고 `AnalysisResult`/`SlopeResult` 호출부와 데이터 조회를 이 페이지로 옮긴다. 미완료 선택 시 `AnalysisProgress`만(이미 있음).
  6. 이력 목록의 `href={`/analyses/${a.id}`}`를 `href={`/scans/${id}?analysis=${a.id}`}`로 교체.
  7. **가드 보존**: Global Constraints의 가드 목록(주석 포함)을 그대로 유지. `blue-700` 버튼 2곳만 토큰으로 교체.
  8. 상태 안내(`uploaded` 대기, `failed`)를 T2 토큰으로 재스타일하고, `failed`에는 `/upload?site=${loc.site_id}&location=${s.location_id}` "다시 업로드" 링크를 추가.
- [ ] **Step 6: 전체 테스트 + 수동 스모크** — `npx vitest run` PASS. dev server에서 스캔 상세 1건 열어 콘솔 오류 0 확인(데이터가 있으면).
- [ ] **Step 7: Commit** — `git commit -m "feat(dashboard): 스캔 작업대 통합 - 단계 스트립 + 단위확정·결과 인라인 + 보고서 원클릭"`

### Task 6: 리다이렉트 — 기존 URL 보존

**Files:**
- Modify: `dashboard/app/analyses/[id]/page.tsx`, `dashboard/app/scans/[id]/confirm-unit/page.tsx`
- Test: `dashboard/app/__tests__/redirects.test.tsx` 신규

**Interfaces:**
- Consumes: T5의 `?analysis=` 규약.

- [ ] **Step 1: 실패하는 테스트** — 페이지 함수가 `redirect()`를 호출하는지 검증. next/navigation의 `redirect`는 throw하므로 mock:

```tsx
import { describe, expect, it, vi } from 'vitest';

const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); });
vi.mock('next/navigation', () => ({ redirect: redirectMock, notFound: vi.fn(() => { throw new Error('NOTFOUND'); }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'a1', scan_id: 's1' } }) }) }) }),
  }),
}));

describe('구 URL 리다이렉트', () => {
  it('/analyses/[id] -> /scans/[scanId]?analysis=[id]', async () => {
    const Page = (await import('../../analyses/[id]/page')).default;
    await expect(Page({ params: Promise.resolve({ id: 'a1' }) })).rejects.toThrow('REDIRECT:/scans/s1?analysis=a1');
  });
  it('/scans/[id]/confirm-unit -> /scans/[id]', async () => {
    const Page = (await import('../../scans/[id]/confirm-unit/page')).default;
    await expect(Page({ params: Promise.resolve({ id: 's1' }) })).rejects.toThrow('REDIRECT:/scans/s1');
  });
});
```

(mock 체인이 실제 쿼리 체인과 다르면 실제 페이지 코드의 체인에 맞춰 mock을 보강한다.)

- [ ] **Step 2: 실패 확인** — 현재 페이지들은 렌더를 시도하므로 FAIL.
- [ ] **Step 3: 구현** — `analyses/[id]/page.tsx`: analyses에서 `scan_id`만 조회 → 없으면 `notFound()`, 있으면 `redirect(\`/scans/${scan_id}?analysis=${id}\`)`. `confirm-unit/page.tsx`: `redirect(\`/scans/${id}\`)` 한 줄. 두 파일의 기존 렌더 코드는 삭제(T5가 이관 완료했을 때만 — T5 선행 필수).
- [ ] **Step 4: 통과 확인 + 전체 테스트.**
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): 구 분석·단위확정 URL을 스캔 작업대로 리다이렉트"`

### Task 7: 보고서 흐름

**Files:**
- Modify: `dashboard/app/reports/page.tsx`, `dashboard/app/reports/new/page.tsx`, `dashboard/app/reports/[id]/page.tsx`
- Test: 기존 report 관련 테스트 확장(위치는 `git grep -l "reports" dashboard/**/__tests__`로 확인)

**Interfaces:**
- Consumes: T2 프리미티브, T4의 `/upload?location=` 규약.

- [ ] **Step 1: reports/new — location 없는 진입 지원.** `notFound()` 분기를 제거하고, `location` 파라미터가 없으면 측정위치 셀렉트(현장별 `<optgroup>`, T4와 같은 방식)를 먼저 렌더 → 선택 시 `router.push('/reports/new?location=' + id)` (서버 재조회로 후보 로드). 파라미터가 있으면 기존 동작 유지.
- [ ] **Step 2: reports 목록** — "새 보고서" 버튼을 파라미터 유무와 무관하게 상시 노출(`/reports/new` 또는 `/reports/new?location=`). 빈 목록은 `EmptyState(message="보고서가 없습니다.", actionHref="/reports/new", actionLabel="새 보고서 만들기")`. 목록 행을 `tableClass` 테이블로 전환(제목 | 측정위치 | 상태 Badge | 생성일 모노).
- [ ] **Step 3: reports/[id]** — `PageHeader` 브레드크럼(현장 › 측정위치 › 보고서 제목) + 상태를 `StatusDot`/`Badge`로, 버튼 토큰 교체. 기능(다운로드·재생성·발행·삭제) 무변경.
- [ ] **Step 4: 테스트** — reports/new의 "location 없으면 선택 UI" 경로 테스트 1건 추가(렌더에 셀렉트 존재). 전체 `npx vitest run` PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): 보고서 흐름 - 위치 선택 지원 + 새 보고서 상시 + 브레드크럼"`

### Task 8: 나머지 화면 토큰·브레드크럼 스윕

**Files:**
- Modify: `dashboard/app/sites/[id]/page.tsx`(+ `components/location-tree.tsx`), `app/sites/new/page.tsx`, `app/settings/page.tsx`, `app/login/page.tsx`, `app/registrations/new/page.tsx`, `app/registrations/[id]/page.tsx` 및 이들이 쓰는 컴포넌트의 스타일 클래스
- Test: 기존 테스트 전체 유지

- [ ] **Step 1: 색·버튼 스윕** — `git grep -n "blue-700\|blue-800\|slate-" dashboard/app dashboard/components`로 전수 목록을 만들고, 주 버튼→zinc-900, 텍스트 slate-*→zinc-* 동급, 판정·상태 표시는 T2 Badge/StatusDot으로 교체. **스코프는 Files 목록이 아니라 이 grep 전수 목록이다** — scans/[id]·reports/[id]·components/analysis/*·analysis-progress·reanalyze-button·unit-confirm-form·report/report-actions·report-progress 등 앞선 태스크가 남긴 파일도 포함한다(단 scans/[id]의 가드 조건·주석은 D5 제약대로 무변경, GRADE_COLOR hex 사용처는 보존). **GRADE_COLOR 인라인 스타일(판정 배지)은 의미색이므로 유지하되 가능하면 Badge tone 매핑으로 교체**(GRADE_COLOR ↔ tone 매핑표를 labels.ts 옆에 추가).
- [ ] **Step 2: 브레드크럼** — sites/[id](현장), registrations/*(현장 › 측정위치 › 정합), settings(설정), sites/new(현장 › 새 현장)에 PageHeader 적용.
- [ ] **Step 3: location-tree** — 스캔 행에 상태 Badge·일시 모노 적용, "스캔 업로드"·"보고서" 링크 버튼을 보조 버튼 토큰으로. 기능 무변경.
- [ ] **Step 4: 전체 테스트 + lint** — `npx vitest run` PASS, `npx eslint .` 오류 0(경고 허용).
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): 전 화면 토큰·브레드크럼 스윕"`

### Task 9: 통합 검증 (브라우저 실증)

**Files:** 없음(검증 전용) — 발견된 결함은 이 태스크 안에서 수정 커밋.

- [ ] **Step 1: 전체 테스트 + 빌드** — `cd dashboard && npx vitest run && npx next build`. Expected: PASS / exit 0.
- [ ] **Step 2: dev server 기동** — `.claude/launch.json`의 dashboard 항목(없으면 추가: `npm run dev`, port 3000)으로 preview_start. 로그인 후 화면별 스크린샷: 홈(빈/데이터), 업로드(인라인 생성 열림), 현장 상세, 스캔 작업대(대기·단위확정·완료 중 재현 가능한 상태), 보고서 목록·생성(위치 선택)·상세, 설정, 로그인. **콘솔 오류 0** (read_console_messages).
- [ ] **Step 3: 흐름 실증** — 첫 PDF까지 경로를 실제 클릭으로 밟아 **화면 이동 5회 이내**임을 기록(로그인 → 업로드(인라인 생성) → 스캔 작업대 → 보고서 생성 → 보고서 상세). 워커가 없는 로컬에선 분석 완료를 기다릴 수 없으므로, 이동 경로의 링크 존재(보고서 생성 버튼 등)를 확인하는 것으로 갈음하고 그 사실을 결과에 명시.
- [ ] **Step 4: 모바일 375px** — resize_window 후 홈·스캔 작업대 스크린샷, 메뉴 접근 가능 확인.
- [ ] **Step 5: 스크린샷을 스크래치패드에 저장하고 사용자 보고용으로 정리.**
- [ ] **Step 6: Commit(수정이 있었으면)** — `git commit -m "fix(dashboard): 통합 검증에서 발견된 결함 수정"`

## Self-Review 결과

- 스펙 §3(토큰)→T1·T2, §4(레이아웃)→T1, §5(컴포넌트)→T2, §6.1→T5·T6, §6.2→T4, §6.3→T5·T7, §6.4→T5·T7·T8, §6.5→T3, §7(검증)→T9, §8(주의)→Global Constraints. 커버 안 된 스펙 항목 없음.
- 타입 일관성: `TONE` 키(pass/warn/fail/unknown/neutral/busy)와 StatusDot tone 서브셋, `?analysis=` 규약(T5 정의·T6 소비), `/upload?location=` (T4 정의·T5/T7 소비) 일치 확인.
- 남긴 재량: 기존 테스트의 prop 규약이 계획과 다르면 **행동(프리필·인라인 생성·리다이렉트)을 보존하는 방향**으로 테스트를 조정한다고 명시(T4 Step 1, T6 Step 1).
