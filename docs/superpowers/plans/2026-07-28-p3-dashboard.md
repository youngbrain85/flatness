# P3 대시보드(Next.js) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로그인, 현장·측정위치 관리, 스캔 업로드·단위 확인, 분석 진행 상태(Realtime), 결과 화면(C안), 설정까지 이어지는 Next.js 대시보드를 데모 0원 구성(로컬 dev + Supabase Free)으로 구축한다.

**Architecture:** Next.js App Router가 UI 전체와 로컬 파일 입출력을 담당한다. 메타데이터·판정 결과는 Supabase(anon key + RLS)로 직접 읽고 쓰며, 잡 등록은 `fn_enqueue_job` RPC로만 한다(jobs 테이블은 클라이언트 완전 불가시). 스캔 원본·분석 산출물은 로컬 `data/` 디렉터리에 있고, DB에는 버킷-상대 규약 문자열만 저장되므로 대시보드의 route handler(`/api/data/...`, `/api/upload`)가 자신의 `DATA_DIR`에 결합해 서빙·저장한다. 사진만 Supabase Storage(photos 버킷, signed URL)를 쓴다.

**Tech Stack:** Next.js 15(App Router, TypeScript) + Tailwind CSS + @supabase/supabase-js + @supabase/ssr. 테스트는 vitest + @testing-library/react(jsdom). 차트·게이지·3D 라이브러리 금지(히트맵은 Canvas 직접 렌더, 3D는 워커 생성 preview3d.png 정적 표시).

**Spec:** `docs/superpowers/specs/2026-07-27-flatness-dashboard-design.md` §3.3(데모 0원)·§6(스키마·경로 규약)·§7 화면 1~5·7 (화면 6 보고서는 P4). 데이터 계약 정본: `docs/contracts/stats-schema.md`. DB 정본: `supabase/migrations/001_schema.sql`·`002_functions_seed.sql`(P2 산출물, P2 머지 후 메인에 존재).

## Global Constraints

- **데모 0원**: Next.js 로컬 dev(`npm run dev`, localhost:3000)만. Vercel 등 배포 금지(정식 단계로 이연). Supabase Free의 **anon key만** 클라이언트에 사용, service_role 키는 dashboard/ 어디에도 두지 않는다
- **프로젝트 위치**: 저장소 루트 `dashboard/` 디렉터리. 모든 npm 명령은 `dashboard/`에서 실행
- **경로 계약**: DB의 `scans.raw_file_path`·`analyses.artifacts_dir`·`photos.file_path`에는 버킷-상대 규약 문자열만 저장(`raw-scans/{site_id}/{scan_id}/raw.{ext}`, `artifacts/{analysis_id}`, `photos/{photo_id}.{ext}`). 로컬 파일은 `/api/data/[...path]` route가 서버 env `DATA_DIR`(기본 `../data`)에 결합해 서빙한다. 클라이언트가 OS 경로를 만들거나 보지 않는다
- **산출물 정본**(stats-schema.md §6): stats.json·cells.json·results.csv·heatmap.png(바닥/임포트)·heatmap_wall{n}.png(벽, 스킵 벽은 결번)·preview3d.png(±_zoom, 바닥만). **viewer.bin·histogram.png는 존재하지 않는다** — 인터랙티브 3D는 백로그, 3D 표시는 preview3d.png 정적 이미지
- **jobs 테이블 접근 금지**: 등록은 `supabase.rpc('fn_enqueue_job', {p_type, p_payload})`만. 중복 엔큐는 PostgREST 409(error.code `'23505'`)로 돌아오므로 UI에서 안내 처리 필수. 진행 상태는 `analyses.status`·`scans.status`를 Supabase Realtime 구독(+5초 보조 폴링)으로 추적
- **fn_resolve_criteria는 대체(override) 시맨틱**: 현장 활성 기준이 1개라도 있으면 그 표면의 전역 기준은 반환 목록에 아예 나오지 않는다. UI는 반환 목록을 그대로 후보로 쓰고 `is_default` 행을 기본 선택한다(목록 정렬: is_default desc, name)
- **profiles 자동 생성 트리거 없음**: 첫 로그인 후 `insert (id, display_name)`은 대시보드 책임(컬럼 grant가 이 2개로 제한됨). display_name만 수정 가능. is_admin 승격 UI 없음(SQL Editor 전용)
- **DB 스키마 정합**: 컬럼명은 001_schema.sql 그대로 사용 — 표면 컬럼은 `surface`(타입명이 `surface_type`), 계보 컬럼은 `lineage`, 산출물 컬럼은 `artifacts_dir` 단일 컬럼. enum 값·RPC 시그니처(`fn_enqueue_job(p_type job_type, p_payload jsonb)`, `fn_resolve_criteria(p_site_id uuid, p_surface surface_type)`)도 그대로
- **언어**: 문서·주석·UI 문자열 전부 한국어. UI 문자열과 사용자 대면 출력에 U+2014(—) 금지
- **테스트**: vitest + @testing-library/react(jsdom), 자격증명 불필요(모든 Supabase 호출은 스텁). 실 Supabase·워커 연동은 Task 8의 수동 검증 체크리스트(사용자 자격증명 셋업 후). E2E(Playwright)는 백로그
- **환경**: Windows 10, Node 22, npm 10. 워커(`worker/`, DATA_DIR 기본 `../data`)와 같은 `data/` 디렉터리를 공유한다
- 각 태스크는 실패 테스트 → 구현 → 통과 → 커밋. 커밋 트레일러: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **YAGNI**: 기준 CRUD는 목록·활성 토글까지만(생성·버전 개정은 SQL Editor 안내), 보고서 발행은 P4, 사용자 관리 UI 없음, 회원가입 화면 없음(계정은 Supabase 대시보드 Auth에서 생성)

## 파일 구조 개요

```
dashboard/
  app/
    layout.tsx  page.tsx(홈)  globals.css
    login/page.tsx  login/login-form.tsx
    sites/new/page.tsx  sites/[id]/page.tsx
    upload/page.tsx
    scans/[id]/page.tsx  scans/[id]/confirm-unit/page.tsx
    analyses/[id]/page.tsx
    settings/page.tsx
    api/data/[...path]/route.ts   # 로컬 data/ 서빙 (GET)
    api/upload/route.ts           # 스캔 원본 저장 (POST)
  components/   # nav, site-card, location-tree, upload-form, verdict-panel, heatmap-view ...
  lib/
    supabase/client.ts  server.ts  middleware.ts
    auth/ensure-profile.ts
    domain/types.ts  labels.ts  paths.ts  stats.ts  cells.ts  jobs.ts  tree.ts  summary.ts
    photos/paths.ts  upload.ts
    upload/validate.ts
    server/data-files.ts  disk-usage.ts
    viz/heatmap.ts
    hooks/use-row-status.ts
  middleware.ts  vitest.config.ts  vitest.setup.ts  .env.example
supabase/migrations/003_dashboard_support.sql   # photos 버킷 + Realtime publication
docs/SUPABASE_SETUP.md                          # 003 실행 단계 추가(Modify)
```

각 태스크는 위 구조의 수직 슬라이스 하나를 완성한다. 테스트 파일은 소스 옆 `__tests__/` 디렉터리(예: `lib/domain/__tests__/labels.test.ts`).

---

### Task 1: 프로젝트 스캐폴드 + Supabase 연동 + 로그인·프로필 부트스트랩

**Files:**
- Create: `dashboard/` (create-next-app 스캐폴드 일체), `dashboard/vitest.config.ts`, `dashboard/vitest.setup.ts`, `dashboard/.env.example`, `dashboard/lib/supabase/client.ts`, `dashboard/lib/supabase/server.ts`, `dashboard/lib/supabase/middleware.ts`, `dashboard/middleware.ts`, `dashboard/lib/auth/ensure-profile.ts`, `dashboard/app/login/page.tsx`, `dashboard/app/login/login-form.tsx`, `dashboard/components/nav.tsx`, `dashboard/components/logout-button.tsx`
- Modify: `dashboard/app/layout.tsx`, `dashboard/app/page.tsx`, `dashboard/package.json`(scripts)
- Test: `dashboard/lib/auth/__tests__/ensure-profile.test.ts`, `dashboard/app/login/__tests__/login-form.test.tsx`

**Interfaces:**
- Consumes: Supabase `profiles` 테이블(001: `id uuid PK`, `display_name text not null`; authenticated는 `insert (id, display_name)`·`update (display_name)`만 grant됨), Supabase Auth 이메일 로그인
- Produces (이후 전 태스크가 사용):
  - `createClient(): SupabaseClient` — `lib/supabase/client.ts`(브라우저용)
  - `createClient(): Promise<SupabaseClient>` — `lib/supabase/server.ts`(서버 컴포넌트·route handler용, async)
  - `ensureProfile(supabase: SupabaseClient, user: {id: string; email?: string | null}): Promise<ProfileRow>` — `lib/auth/ensure-profile.ts`. `ProfileRow = {id: string; display_name: string}`
  - `<Nav />` 서버 컴포넌트(로그인 사용자 이메일 + 홈/업로드/설정 링크 + 로그아웃)
  - vitest 실행 환경(`npm run test`), 경로 별칭 `@/*`

- [ ] **Step 1: 스캐폴드 생성**

저장소 루트(`D:\Projects\Flatness`)에서:

```bash
npx create-next-app@latest dashboard --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm
```

(프롬프트가 추가로 나오면 전부 기본값. Turbopack 여부는 무엇을 선택해도 무방)

```bash
cd dashboard
npm install @supabase/supabase-js @supabase/ssr
npm install -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom
```

`package.json`의 scripts에 추가: `"test": "vitest run", "test:watch": "vitest"`

- [ ] **Step 2: vitest 설정**

```ts
// dashboard/vitest.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true, // testing-library 자동 cleanup(afterEach)에 필요
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/__tests__/**/*.test.{ts,tsx}'],
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
```

```ts
// dashboard/vitest.setup.ts
import '@testing-library/jest-dom/vitest';
```

```
# dashboard/.env.example  (.env.local로 복사해 값 채움. .env.local은 커밋 금지)
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon(public) key. docs/SUPABASE_SETUP.md 4단계에서 기록해 둔 값>
# 로컬 data 루트(서버 전용). 워커의 DATA_DIR과 같은 디렉터리를 가리켜야 한다
DATA_DIR=../data
```

주의: create-next-app이 만든 `.gitignore`가 `.env*` 전체를 무시하는 템플릿이면
`.env.example`이 커밋되지 않는다. 그 경우 `.gitignore`에 `!.env.example` 라인을 추가한다.

- [ ] **Step 3: 실패하는 테스트 작성**

```ts
// dashboard/lib/auth/__tests__/ensure-profile.test.ts
import { describe, expect, it } from 'vitest';
import { ensureProfile } from '../ensure-profile';

// profiles 조회/삽입 체인만 흉내내는 최소 스텁
function stub(existing: { id: string; display_name: string } | null) {
  const calls: { inserted?: Record<string, unknown> } = {};
  const client = {
    from() {
      return {
        select() {
          return { eq() { return { maybeSingle: async () => ({ data: existing, error: null }) }; } };
        },
        insert(row: Record<string, unknown>) {
          calls.inserted = row;
          return {
            select() {
              return { single: async () => ({ data: { id: row.id, display_name: row.display_name }, error: null }) };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe('ensureProfile', () => {
  it('기존 프로필이 있으면 그대로 반환하고 insert하지 않는다', async () => {
    const { client, calls } = stub({ id: 'u1', display_name: '홍길동' });
    const p = await ensureProfile(client as never, { id: 'u1', email: 'a@b.c' });
    expect(p.display_name).toBe('홍길동');
    expect(calls.inserted).toBeUndefined();
  });

  it('프로필이 없으면 이메일 앞부분을 display_name으로 insert한다(id, display_name 2컬럼만)', async () => {
    const { client, calls } = stub(null);
    const p = await ensureProfile(client as never, { id: 'u2', email: 'young@x.com' });
    expect(calls.inserted).toEqual({ id: 'u2', display_name: 'young' });
    expect(p.display_name).toBe('young');
  });

  it('이메일이 없으면 "사용자"를 기본 이름으로 쓴다', async () => {
    const { client, calls } = stub(null);
    await ensureProfile(client as never, { id: 'u3', email: null });
    expect(calls.inserted).toEqual({ id: 'u3', display_name: '사용자' });
  });
});
```

```tsx
// dashboard/app/login/__tests__/login-form.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

import { LoginForm } from '../login-form';

describe('LoginForm', () => {
  it('이메일·비밀번호 입력과 로그인 버튼을 렌더한다', () => {
    render(<LoginForm />);
    expect(screen.getByLabelText('이메일')).toBeInTheDocument();
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: 실패 확인**

Run: `npm run test` (dashboard/)
Expected: FAIL — `ensure-profile`·`login-form` 모듈 없음

- [ ] **Step 5: 구현**

```ts
// dashboard/lib/supabase/client.ts - 브라우저(클라이언트 컴포넌트)용
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

```ts
// dashboard/lib/supabase/server.ts - 서버 컴포넌트·route handler용
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // 서버 컴포넌트에서 호출: 쿠키 쓰기 불가. 세션 갱신은 미들웨어가 담당하므로 무시
          }
        },
      },
    },
  );
}
```

```ts
// dashboard/lib/supabase/middleware.ts - 세션 갱신 + 미로그인 리다이렉트
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user && !request.nextUrl.pathname.startsWith('/login')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return supabaseResponse;
}
```

```ts
// dashboard/middleware.ts
import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

// /api/*는 제외 - route handler가 각자 401 JSON으로 인증을 처리한다(리다이렉트는 fetch를 깨뜨림)
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
```

```ts
// dashboard/lib/auth/ensure-profile.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProfileRow { id: string; display_name: string; }

// profiles 자동 생성 트리거가 없으므로(P2 확정) 첫 로그인 시 대시보드가 직접 만든다.
// authenticated의 insert grant는 (id, display_name) 2컬럼뿐 - 다른 컬럼을 넣으면 권한 오류가 난다.
export async function ensureProfile(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null },
): Promise<ProfileRow> {
  const { data: existing } = await supabase
    .from('profiles').select('id, display_name').eq('id', user.id).maybeSingle();
  if (existing) return existing as ProfileRow;
  const displayName = (user.email ?? '').split('@')[0] || '사용자';
  const { data, error } = await supabase
    .from('profiles').insert({ id: user.id, display_name: displayName })
    .select('id, display_name').single();
  if (error) throw error;
  return data as ProfileRow;
}
```

```tsx
// dashboard/app/login/login-form.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ensureProfile } from '@/lib/auth/ensure-profile';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError || !data.user) {
      setError('로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.');
      setBusy(false);
      return;
    }
    try {
      await ensureProfile(supabase, data.user);
    } catch {
      // 프로필 생성 실패가 로그인 자체를 막지는 않는다(설정 화면 저장 시 재시도 가능)
    }
    router.push('/');
    router.refresh();
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
        className="w-full rounded bg-slate-800 py-2 text-white disabled:opacity-50">
        로그인
      </button>
      <p className="text-xs text-slate-500">
        계정은 관리자가 Supabase 대시보드(Authentication)에서 생성합니다.
      </p>
    </form>
  );
}
```

```tsx
// dashboard/app/login/page.tsx
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="w-full max-w-sm rounded-lg border bg-white p-8 shadow-sm">
        <h1 className="mb-6 text-xl font-bold">평활도 분석 대시보드</h1>
        <LoginForm />
      </div>
    </main>
  );
}
```

```tsx
// dashboard/components/logout-button.tsx
'use client';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function LogoutButton() {
  const router = useRouter();
  async function onClick() {
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  }
  return (
    <button onClick={onClick} className="text-sm text-slate-500 hover:text-slate-800">로그아웃</button>
  );
}
```

```tsx
// dashboard/components/nav.tsx - 서버 컴포넌트
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from './logout-button';

export async function Nav() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="font-bold">평활도 대시보드</Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="hover:underline">현장</Link>
          <Link href="/upload" className="hover:underline">업로드</Link>
          <Link href="/settings" className="hover:underline">설정</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
          {user && <span>{user.email}</span>}
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
```

`app/layout.tsx`는 스캐폴드 산출물에서 lang을 `ko`로 바꾸고 `<Nav />`를 body 상단에 넣는다:

```tsx
// dashboard/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { Nav } from '@/components/nav';

export const metadata: Metadata = {
  title: '평활도 분석 대시보드',
  description: '현장 바닥·벽면 평활도 스크리닝 결과 대시보드',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-slate-50 text-slate-900">
        <Nav />
        {children}
      </body>
    </html>
  );
}
```

`app/page.tsx`는 임시 홈(Task 4에서 전면 교체):

```tsx
// dashboard/app/page.tsx
export default function HomePage() {
  return <main className="mx-auto max-w-6xl p-6">로그인되었습니다. 현장 목록은 준비 중입니다.</main>;
}
```

주의: `<Nav />`는 로그인 페이지에도 렌더되지만 user가 null이면 이메일만 비어 보인다(데모 허용). 로그인 페이지는 자체 `<main>`을 쓰므로 시각적 문제 없음.

- [ ] **Step 6: 통과 확인**

Run: `npm run test`
Expected: PASS (ensure-profile 3건 + login-form 1건)

Run: `npm run build`
Expected: 빌드 성공 (env 미설정이어도 빌드는 통과해야 한다. `NEXT_PUBLIC_*`가 없으면 미들웨어가 런타임에 죽으므로 빌드 검증만 하고, 런타임 확인은 Task 8)

- [ ] **Step 7: Commit**

```bash
git add dashboard
git commit -m "feat(dashboard): 스캐폴드 + Supabase 연동 + 로그인·프로필 부트스트랩"
```

---
### Task 2: 도메인 계약 모듈 (타입·표시 매핑·경로 결합·데이터 변환)

**Files:**
- Create: `dashboard/lib/domain/types.ts`, `dashboard/lib/domain/labels.ts`, `dashboard/lib/domain/paths.ts`, `dashboard/lib/domain/stats.ts`, `dashboard/lib/domain/cells.ts`, `dashboard/lib/domain/jobs.ts`
- Test: `dashboard/lib/domain/__tests__/labels.test.ts`, `dashboard/lib/domain/__tests__/paths.test.ts`, `dashboard/lib/domain/__tests__/stats.test.ts`, `dashboard/lib/domain/__tests__/cells.test.ts`, `dashboard/lib/domain/__tests__/jobs.test.ts`

**Interfaces:**
- Consumes: `docs/contracts/stats-schema.md`(stats.json·cells.json 계약, 부록 A 색상표), 001_schema.sql의 enum 값
- Produces (Task 3~7 전부가 사용 — 이름을 바꾸지 말 것):
  - `types.ts`: `Surface`, `Grade`, `Verdict`, `ScanStatus`, `AnalysisStatus`, `Lineage`, `SiteRow`, `LocationRow`, `CriteriaRow`, `Threshold`, `ScanRow`, `AnalysisRow`, `PhotoRow`, `Stats`, `StatsMeta`, `Worst`, `AppliedCriteria`, `ZoneInfo`, `WallInfo`, `WallFrame`, `CellRow`
  - `labels.ts`: `GRADE_LABEL`, `GRADE_COLOR`, `SCAN_STATUS_LABEL`, `ANALYSIS_STATUS_LABEL`, `SURFACE_LABEL`, `LINEAGE_LABEL`, `ZONE_STATUS_LABEL`, `warningLabel(code: string): string`, `fmtMm(v: number | null): string`
  - `paths.ts`: `dataUrl(relPath: string): string`, `artifactUrl(artifactsDir: string, filename: string): string`, `rawScanRelPath(siteId: string, scanId: string, ext: string): string`
  - `stats.ts`: `coverageLabel(stats: Stats): string`, `isExternalImport(engineVersion: string | null, meta?: StatsMeta): boolean`
  - `cells.ts`: `ZoneStats`, `computeZoneStats(cells: CellRow[]): ZoneStats[]`
  - `jobs.ts`: `JobType`, `isDuplicateJobError(error: {code?: string} | null | undefined): boolean`, `DUPLICATE_JOB_MESSAGE`, `enqueueJob(supabase, type, payload): Promise<{ok: true} | {ok: false; message: string}>`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// dashboard/lib/domain/__tests__/labels.test.ts
import { describe, expect, it } from 'vitest';
import { GRADE_COLOR, GRADE_LABEL, fmtMm, warningLabel } from '../labels';

describe('등급 라벨·색상 (stats-schema.md 부록 A와 1:1)', () => {
  it('5등급 한국어 라벨', () => {
    expect(GRADE_LABEL).toEqual({
      pass: '적합', borderline: '경계', repair: '보수', rework: '재시공', na: '판정 불가',
    });
  });
  it('히트맵 5색 hex', () => {
    expect(GRADE_COLOR).toEqual({
      pass: '#2e7d32', borderline: '#f9ab00', repair: '#e8710a', rework: '#c5221f', na: '#9e9e9e',
    });
  });
});

describe('warningLabel', () => {
  it('고정 코드는 한국어 문구로 변환한다', () => {
    expect(warningLabel('low_coverage')).toContain('70%');
    expect(warningLabel('uncertainty_swallows_repair')).toContain('보수 구간');
    expect(warningLabel('plumbness_relative_to_z')).toContain('z축');
  });
  it('wall_{i}_skipped 개방 패턴을 매칭한다', () => {
    expect(warningLabel('wall_3_skipped')).toContain('3번 벽');
  });
  it('모르는 코드는 원문 그대로 반환한다(누락보다 노출이 안전)', () => {
    expect(warningLabel('future_code')).toBe('future_code');
  });
});

describe('fmtMm', () => {
  it('null은 하이픈, 수치는 소수 2자리', () => {
    expect(fmtMm(null)).toBe('-');
    expect(fmtMm(7.125)).toBe('7.13');
  });
});
```

```ts
// dashboard/lib/domain/__tests__/paths.test.ts
import { describe, expect, it } from 'vitest';
import { artifactUrl, dataUrl, rawScanRelPath } from '../paths';

describe('경로 결합 (버킷-상대 규약 문자열 -> /api/data URL)', () => {
  it('상대 규약 문자열을 서빙 URL로 바꾼다', () => {
    expect(dataUrl('artifacts/a1/stats.json')).toBe('/api/data/artifacts/a1/stats.json');
  });
  it('선행 슬래시를 정규화한다', () => {
    expect(dataUrl('/artifacts/a1/heatmap.png')).toBe('/api/data/artifacts/a1/heatmap.png');
  });
  it('세그먼트를 URL 인코딩한다', () => {
    expect(dataUrl('artifacts/a 1/x.png')).toBe('/api/data/artifacts/a%201/x.png');
  });
  it('artifactUrl은 artifacts_dir + 파일명 결합', () => {
    expect(artifactUrl('artifacts/a1', 'cells.json')).toBe('/api/data/artifacts/a1/cells.json');
  });
  it('rawScanRelPath는 스펙 §6.3 규약 그대로', () => {
    expect(rawScanRelPath('s1', 'c1', 'ply')).toBe('raw-scans/s1/c1/raw.ply');
  });
});
```

```ts
// dashboard/lib/domain/__tests__/stats.test.ts
import { describe, expect, it } from 'vitest';
import { coverageLabel, isExternalImport } from '../stats';
import type { Stats } from '../types';

function minimalStats(meta: Record<string, unknown>): Stats {
  return {
    n_cells: 0, n_valid: 0,
    grade_counts: { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 },
    grade_pct: { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 },
    value_max_mm: null, value_min_mm: null, value_mean_mm: null, value_p95_mm: null,
    worst: null, coverage_pct: 0, reduced_span_cells: 0,
    applied_criteria: { name: 'x', source: 'y', span_m: 3, pass_mm: 7, rework_mm: 21, u_mm: 5 },
    warnings: [], zones: [], auto_summary: '',
    meta: { file: 'f', n_points: 0, ...meta } as Stats['meta'],
  };
}

describe('coverage_pct 3중 의미 분기 (stats-schema.md §3)', () => {
  it('floor(LiDAR)는 바닥 인식률', () => {
    expect(coverageLabel(minimalStats({ surface: 'floor' }))).toBe('바닥 인식률');
  });
  it('wall은 셀 유효율', () => {
    expect(coverageLabel(minimalStats({ surface: 'wall' }))).toBe('셀 유효율');
  });
  it('임포트(meta.source 존재)는 surface가 floor여도 셀 유효율', () => {
    expect(coverageLabel(minimalStats({ surface: 'floor', source: 'colab-import' }))).toBe('셀 유효율');
  });
});

describe('isExternalImport', () => {
  it('engine_version external-colab-v1 이면 외부 결과', () => {
    expect(isExternalImport('external-colab-v1')).toBe(true);
  });
  it('meta.source가 있으면 외부 결과', () => {
    expect(isExternalImport('p1d-0.4.0', { file: 'f', n_points: 1, source: 'colab-import' })).toBe(true);
  });
  it('LiDAR 원본은 외부 결과 아님', () => {
    expect(isExternalImport('p1d-0.4.0', { file: 'f', n_points: 1 })).toBe(false);
  });
});
```

```ts
// dashboard/lib/domain/__tests__/cells.test.ts
import { describe, expect, it } from 'vitest';
import { computeZoneStats } from '../cells';
import type { CellRow } from '../types';

function cell(over: Partial<CellRow>): CellRow {
  return {
    ix: 0, iy: 0, center_x: 0, center_y: 0, value_mm: null, span_used_m: 0,
    occupancy: 1, grade: 'na', worst_x: null, worst_y: null, zone_id: null, ...over,
  };
}

describe('computeZoneStats (구역별 결과표 집계 - 스펙 §5.1.7 구역별 max/min/mean·초과 셀)', () => {
  it('zone_id별로 max/min/mean/보수 이상 셀을 집계한다', () => {
    const cells = [
      cell({ zone_id: 1, value_mm: 4.0, grade: 'pass' }),
      cell({ zone_id: 1, value_mm: 10.0, grade: 'repair' }),
      cell({ zone_id: 1, value_mm: 25.0, grade: 'rework' }),
      cell({ zone_id: 1, value_mm: null, grade: 'na' }),
      cell({ zone_id: 2, value_mm: 1.0, grade: 'pass' }),
    ];
    const zs = computeZoneStats(cells);
    expect(zs).toHaveLength(2);
    const z1 = zs[0];
    expect(z1.zone_id).toBe(1);
    expect(z1.n_cells).toBe(4);
    expect(z1.n_valid).toBe(3);
    expect(z1.max_mm).toBe(25);
    expect(z1.min_mm).toBe(4);
    expect(z1.mean_mm).toBe(13);
    expect(z1.over_cells).toBe(2); // 보수 이상(repair+rework)
    expect(z1.over_pct).toBe(50);
    expect(z1.grade_counts.na).toBe(1);
  });
  it('zone_id null(임포트)은 단일 그룹으로 맨 뒤에 온다', () => {
    const zs = computeZoneStats([
      cell({ zone_id: null, value_mm: 2, grade: 'pass' }),
      cell({ zone_id: 1, value_mm: 3, grade: 'pass' }),
    ]);
    expect(zs.map((z) => z.zone_id)).toEqual([1, null]);
  });
  it('빈 배열은 빈 결과', () => {
    expect(computeZoneStats([])).toEqual([]);
  });
});
```

```ts
// dashboard/lib/domain/__tests__/jobs.test.ts
import { describe, expect, it } from 'vitest';
import { DUPLICATE_JOB_MESSAGE, enqueueJob, isDuplicateJobError } from '../jobs';

describe('중복 엔큐 409 처리 (jobs_dedup 부분 유니크 -> PostgREST 23505)', () => {
  it('code 23505만 중복으로 판정한다', () => {
    expect(isDuplicateJobError({ code: '23505' })).toBe(true);
    expect(isDuplicateJobError({ code: '42501' })).toBe(false);
    expect(isDuplicateJobError(null)).toBe(false);
  });
  it('enqueueJob은 중복이면 안내 메시지를 돌려준다', async () => {
    const supabase = { rpc: async () => ({ error: { code: '23505', message: 'dup' } }) };
    const r = await enqueueJob(supabase as never, 'analyze', { analysis_id: 'a1' });
    expect(r).toEqual({ ok: false, message: DUPLICATE_JOB_MESSAGE });
  });
  it('성공이면 ok', async () => {
    const calls: unknown[] = [];
    const supabase = {
      rpc: async (fn: string, args: unknown) => { calls.push([fn, args]); return { error: null }; },
    };
    const r = await enqueueJob(supabase as never, 'precheck', { scan_id: 's1' });
    expect(r).toEqual({ ok: true });
    expect(calls[0]).toEqual(['fn_enqueue_job', { p_type: 'precheck', p_payload: { scan_id: 's1' } }]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test`
Expected: FAIL — domain 모듈 없음

- [ ] **Step 3: 구현**

```ts
// dashboard/lib/domain/types.ts - DB 행(001_schema.sql)과 stats.json(docs/contracts/stats-schema.md) 타입 정본
export type Surface = 'floor' | 'wall';
export type Grade = 'pass' | 'borderline' | 'repair' | 'rework' | 'na';
export type Verdict = 'pass' | 'borderline' | 'repair' | 'rework';
export type ScanStatus = 'uploaded' | 'awaiting_unit_confirm' | 'ready' | 'archived' | 'failed';
export type AnalysisStatus = 'queued' | 'processing' | 'done' | 'failed';
export type Lineage = 'raw' | 'fused_mesh' | 'unknown';

export interface SiteRow {
  id: string; name: string; address: string | null; memo: string | null;
  created_at: string; updated_at: string;
}

export interface LocationRow {
  id: string; site_id: string; building: string; floor: string; floor_order: number;
  room: string; name: string; memo: string | null; created_at: string; updated_at: string;
}

export interface Threshold {
  span_m: number | null; metric: 'flatness' | 'plumbness';
  pass_mm: number; rework_mm: number; note?: string;
}

export interface CriteriaRow {
  id: string; site_id: string | null; surface: Surface; name: string; source_text: string;
  thresholds: Threshold[]; is_default: boolean; is_active: boolean; version: number;
  supersedes_id: string | null; created_at: string;
}

export interface ScanRow {
  id: string; location_id: string; surface: Surface; scanned_at: string;
  device: string | null; operator_id: string | null; operator_name_manual: string | null;
  selected_criteria_id: string | null; raw_file_path: string | null;
  original_filename: string | null; file_format: string | null; point_count: number | null;
  unit_scale: number | null; lineage: Lineage; status: ScanStatus;
  deleted_at: string | null; created_at: string; updated_at: string;
}

export interface AnalysisRow {
  id: string; scan_id: string; surface: Surface; criteria_id: string;
  applied_criteria: AppliedCriteria | null; params: Record<string, unknown>;
  engine_version: string | null; status: AnalysisStatus; stats: Stats | null;
  coverage_pct: number | null; overall_verdict: Verdict | null; warnings: string[];
  artifacts_dir: string | null; auto_summary: string | null; user_summary: string | null;
  is_current: boolean; deleted_at: string | null; created_at: string; created_by: string | null;
}

export interface PhotoRow {
  id: string; scan_id: string | null; location_id: string | null; site_id: string | null;
  file_path: string; caption: string | null; taken_at: string | null; created_at: string;
}

// ---- stats.json (docs/contracts/stats-schema.md §1~§2) ----
export interface Worst {
  value_mm: number; cell_ix: number; cell_iy: number;
  point_x: number; point_y: number; zone_id: number | null;
}

export interface AppliedCriteria {
  name: string; source: string; span_m: number | null;
  pass_mm: number; rework_mm: number; u_mm: number;
}

export interface ZoneInfo {
  zone_id: number; level_m: number; area_m2: number;
  status: 'ok' | 'ghost' | 'furniture';
  plane_abc: [number, number, number] | null;
}

export interface WallFrame {
  p0: [number, number]; direction: [number, number]; normal: [number, number];
  u_min: number; u_max: number; z_min: number; z_max: number;
}

export interface WallInfo {
  wall_id: number; n_cells: number; height_m: number; length_m: number;
  plumbness_mm: number; plumb_grade: Verdict;
  plane_abc: [number, number, number]; frame: WallFrame;
}

export interface StatsMeta {
  file: string; n_points: number;
  engine_version?: string; surface?: Surface; source?: string;
  scale_to_m?: number; bbox_min?: [number, number, number];
  subcell_m?: number; cell_m?: number;
}

export interface Stats {
  n_cells: number; n_valid: number;
  grade_counts: Record<Grade, number>; grade_pct: Record<Grade, number>;
  value_max_mm: number | null; value_min_mm: number | null;
  value_mean_mm: number | null; value_p95_mm: number | null;
  worst: Worst | null; coverage_pct: number; reduced_span_cells: number;
  applied_criteria: AppliedCriteria; warnings: string[]; zones: ZoneInfo[];
  meta: StatsMeta; auto_summary: string;
  preview3d_paths?: string[]; // floor만
  walls?: WallInfo[];         // wall만
}

// cells.json 행 (stats-schema.md §6)
export interface CellRow {
  ix: number; iy: number; center_x: number; center_y: number;
  value_mm: number | null; span_used_m: number; occupancy: number; grade: Grade;
  worst_x: number | null; worst_y: number | null; zone_id: number | null;
}
```

```ts
// dashboard/lib/domain/labels.ts - 표시 매핑 정본 (stats-schema.md 부록 A, 스펙 §9)
import type { AnalysisStatus, Grade, Lineage, ScanStatus, Surface } from './types';

export const GRADE_LABEL: Record<Grade, string> = {
  pass: '적합', borderline: '경계', repair: '보수', rework: '재시공', na: '판정 불가',
};

export const GRADE_COLOR: Record<Grade, string> = {
  pass: '#2e7d32', borderline: '#f9ab00', repair: '#e8710a', rework: '#c5221f', na: '#9e9e9e',
};

export const SCAN_STATUS_LABEL: Record<ScanStatus, string> = {
  uploaded: '업로드됨', awaiting_unit_confirm: '단위 확인 대기',
  ready: '분석 준비됨', archived: '보관됨', failed: '실패',
};

export const ANALYSIS_STATUS_LABEL: Record<AnalysisStatus, string> = {
  queued: '분석 대기 중', processing: '분석 중', done: '완료', failed: '실패',
};

export const SURFACE_LABEL: Record<Surface, string> = { floor: '바닥', wall: '벽면' };

export const LINEAGE_LABEL: Record<Lineage, string> = {
  raw: '원시 점군', fused_mesh: '융합 메시', unknown: '모름',
};

export const ZONE_STATUS_LABEL: Record<'ok' | 'ghost' | 'furniture', string> = {
  ok: '정상', ghost: '유령층(제외)', furniture: '가구 추정(제외)',
};

// warnings 코드 사전 (stats-schema.md §5)
const WARNING_LABEL: Record<string, string> = {
  ghost_layer_rescan:
    '이중 표면(유령층) 서브셀이 감지되어 일부가 판정에서 제외되었습니다. 재스캔을 권장합니다.',
  ghost_zone_excluded: '이중 표면 비율이 높은 구역 전체가 판정에서 제외되었습니다.',
  furniture_excluded: '가구 상판으로 추정되는 구역이 판정에서 제외되었습니다.',
  low_coverage: '바닥 인식률이 70% 미만입니다. 스캔 범위·가림을 확인하세요.',
  reduced_span:
    '공간 제약으로 기준 스팬보다 짧은 직선자 길이를 사용해 허용치와 불확도를 선형 환산했습니다.',
  uncertainty_swallows_repair:
    '측정 불확도가 보수 구간을 잠식합니다(경계 구간이 보수 구간을 흡수). 보수 판정이 나오지 않을 수 있습니다.',
  plumbness_relative_to_z: '수직도는 스캔 좌표계 z축 기준 상대 지표입니다(중력 보정 아님).',
};

export function warningLabel(code: string): string {
  if (WARNING_LABEL[code]) return WARNING_LABEL[code];
  const m = code.match(/^wall_(\d+)_skipped$/); // 개방 패턴 (stats-schema.md §5)
  if (m) return `${m[1]}번 벽 후보가 유효 데이터 부족 또는 처리 오류로 판정에서 제외되었습니다.`;
  return code; // 미지 코드는 원문 노출(숨기는 것보다 안전)
}

export function fmtMm(v: number | null): string {
  return v === null ? '-' : v.toFixed(2);
}
```

```ts
// dashboard/lib/domain/paths.ts - 경로 계약(P2 최종 리뷰 확정): DB에는 버킷-상대 규약 문자열만,
// 소비자(대시보드)는 /api/data route를 통해 자신의 DATA_DIR에 결합한다
export function dataUrl(relPath: string): string {
  const clean = relPath.replace(/^\/+/, '');
  return '/api/data/' + clean.split('/').map(encodeURIComponent).join('/');
}

export function artifactUrl(artifactsDir: string, filename: string): string {
  return dataUrl(`${artifactsDir}/${filename}`);
}

// 스펙 §6.3 규약: raw-scans/{site_id}/{scan_id}/raw.{ext}
export function rawScanRelPath(siteId: string, scanId: string, ext: string): string {
  return `raw-scans/${siteId}/${scanId}/raw.${ext}`;
}
```

```ts
// dashboard/lib/domain/stats.ts - stats.json 소비 규칙 (stats-schema.md §3: coverage 3중 의미)
import type { Stats, StatsMeta } from './types';

export function coverageLabel(stats: Stats): string {
  const isImport = stats.meta.source !== undefined;
  if (!isImport && stats.meta.surface === 'floor') return '바닥 인식률';
  return '셀 유효율';
}

// 외부(임포트) 결과 배지 판별: engine_version 태그 또는 meta.source (stats-schema.md §2)
export function isExternalImport(engineVersion: string | null, meta?: StatsMeta): boolean {
  if (engineVersion === 'external-colab-v1') return true;
  return meta?.source !== undefined;
}
```

```ts
// dashboard/lib/domain/cells.ts - cells.json -> 구역별 결과표 집계 (스펙 §5.1.7·§7.5 결과표)
// stats.json의 수치는 전체 합산뿐이므로 구역(벽)별 max/min/mean은 셀에서 재집계한다.
// '기준 초과'는 보수 이상(repair+rework)으로 정의한다(경계는 재확인 대상이지 초과 확정이 아님).
import type { CellRow, Grade } from './types';

export interface ZoneStats {
  zone_id: number | null;
  n_cells: number; n_valid: number;
  max_mm: number | null; min_mm: number | null; mean_mm: number | null;
  over_cells: number; over_pct: number;
  grade_counts: Record<Grade, number>;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round1 = (v: number) => Math.round(v * 10) / 10;

export function computeZoneStats(cells: CellRow[]): ZoneStats[] {
  const byZone = new Map<number | null, CellRow[]>();
  for (const c of cells) {
    const arr = byZone.get(c.zone_id) ?? [];
    arr.push(c);
    byZone.set(c.zone_id, arr);
  }
  const result: ZoneStats[] = [];
  for (const [zoneId, zc] of byZone) {
    const vals = zc.map((c) => c.value_mm).filter((v): v is number => v !== null);
    const gc: Record<Grade, number> = { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 };
    for (const c of zc) gc[c.grade] += 1;
    const over = gc.repair + gc.rework;
    result.push({
      zone_id: zoneId,
      n_cells: zc.length,
      n_valid: vals.length,
      max_mm: vals.length ? round2(Math.max(...vals)) : null,
      min_mm: vals.length ? round2(Math.min(...vals)) : null,
      mean_mm: vals.length ? round2(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
      over_cells: over,
      over_pct: zc.length ? round1((over / zc.length) * 100) : 0,
      grade_counts: gc,
    });
  }
  // zone_id 오름차순, null(임포트)은 맨 뒤
  return result.sort((a, b) => (a.zone_id ?? Number.MAX_SAFE_INTEGER) - (b.zone_id ?? Number.MAX_SAFE_INTEGER));
}
```

```ts
// dashboard/lib/domain/jobs.ts - 잡 등록은 fn_enqueue_job RPC로만 (jobs 테이블 직접 접근 금지)
import type { SupabaseClient } from '@supabase/supabase-js';

export type JobType = 'precheck' | 'analyze' | 'import' | 'report';

// jobs_dedup 부분 유니크 위반은 PostgREST가 409 + Postgres 코드 23505로 돌려준다
export function isDuplicateJobError(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}

export const DUPLICATE_JOB_MESSAGE =
  '이미 같은 대상의 작업이 대기 중이거나 실행 중입니다. 잠시 후 상태를 확인하세요.';

export async function enqueueJob(
  supabase: SupabaseClient,
  type: JobType,
  payload: Record<string, string>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.rpc('fn_enqueue_job', { p_type: type, p_payload: payload });
  if (!error) return { ok: true };
  if (isDuplicateJobError(error)) return { ok: false, message: DUPLICATE_JOB_MESSAGE };
  return { ok: false, message: `작업 등록에 실패했습니다: ${error.message}` };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test`
Expected: PASS (Task 1 포함 전체)

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib/domain
git commit -m "feat(dashboard): 도메인 계약 모듈(타입·표시 매핑·경로 결합·잡 등록)"
```

---

### Task 3: 마이그레이션 003(photos 버킷·Realtime) + 로컬 data 서빙 route + 사진 모듈

**Files:**
- Create: `supabase/migrations/003_dashboard_support.sql`, `dashboard/lib/server/data-files.ts`, `dashboard/app/api/data/[...path]/route.ts`, `dashboard/lib/photos/paths.ts`, `dashboard/lib/photos/upload.ts`, `dashboard/components/photo-gallery.tsx`, `dashboard/components/photo-uploader.tsx`
- Modify: `docs/SUPABASE_SETUP.md`(003 실행 단계 추가)
- Test: `dashboard/lib/server/__tests__/data-files.test.ts`, `dashboard/lib/photos/__tests__/paths.test.ts`, `dashboard/lib/photos/__tests__/upload.test.ts`

**Interfaces:**
- Consumes: Task 1 `lib/supabase/server.ts`의 `createClient`, Task 2 `PhotoRow`
- Produces:
  - `resolveDataPath(dataDir: string, segments: string[]): string | null` — 화이트리스트 루트(raw-scans/artifacts/reports) + 경로 탈출 차단. null이면 거부
  - `contentTypeFor(p: string): string`
  - `GET /api/data/[...path]` — 로그인 필수(401 JSON), DATA_DIR 결합 파일 서빙(404 JSON)
  - `photoFilePath(photoId: string, filename: string): string | null` — DB 저장용 규약 문자열 `photos/{id}.{ext}`(jpg/jpeg/png/webp만), `photoStorageKey(filePath: string): string` — Storage 버킷 내 키(접두 `photos/` 제거)
  - `PhotoRef = {site_id: string} | {location_id: string} | {scan_id: string}`
  - `uploadPhoto(supabase, file: File, target: PhotoRef, caption?: string): Promise<PhotoRow>`
  - `photoUrl(supabase, filePath: string): Promise<string | null>` — signed URL(1시간)
  - `<PhotoGallery photos={PhotoRow[]} />`(signed URL 로드 + 캡션 그리드), `<PhotoUploader target={PhotoRef} onUploaded={() => void} />` — Task 4(현장 사진)·Task 6(스캔 사진)이 사용

- [ ] **Step 1: 마이그레이션 003 작성**

```sql
-- =============================================================================
-- 마이그레이션 003 - P3 대시보드 지원
-- 선행: 001_schema.sql, 002_functions_seed.sql
-- 내용: (1) photos 전용 private Storage 버킷 + RLS (스펙 §6.3: 데모에서 사진만
--        Supabase Storage, signed URL로 접근)
--       (2) Realtime publication에 scans·analyses 추가 (스펙 §3.2.⑤: 진행 상태를
--        Realtime으로 반영 - P2 확정: jobs는 클라이언트 완전 불가시이므로
--        analyses.status·scans.status 변화를 구독한다)
-- =============================================================================

-- (1) photos 버킷(private) - 파일당 10MB 제한(사진 용도, Free 한도 보호)
insert into storage.buckets (id, name, public, file_size_limit)
values ('photos', 'photos', false, 10485760)
on conflict (id) do nothing;

-- storage.objects RLS: 로그인 사용자는 photos 버킷만 읽기/쓰기 가능
create policy photos_all_auth on storage.objects for all to authenticated
  using (bucket_id = 'photos') with check (bucket_id = 'photos');

-- (2) Realtime publication (이미 추가된 경우 무시)
do $$ begin
  alter publication supabase_realtime add table public.scans;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.analyses;
exception when duplicate_object then null; end $$;
```

`docs/SUPABASE_SETUP.md`의 "2. 마이그레이션 실행" 절에 3번 항목을 추가한다:

```markdown
3. (P3 대시보드 사용 시) `supabase/migrations/003_dashboard_support.sql` 전체 내용을
   붙여넣고 **Run**. 사진용 `photos` 버킷과 Realtime 구독 설정이 만들어진다.
   검증: 좌측 메뉴 **Storage**에 `photos` 버킷이 보이면 정상.
```

같은 문서 마지막 "참고" 절 위에 대시보드 환경변수 안내 한 단락을 추가한다:

```markdown
## 6. 대시보드(P3) 연결

`dashboard/.env.example`을 `dashboard/.env.local`로 복사하고 4단계의 **Project URL**과
**anon(public) key**를 채운다(service_role 키는 절대 넣지 않는다). `DATA_DIR`은 워커의
`DATA_DIR`과 같은 디렉터리(기본 `../data`)를 가리켜야 대시보드가 워커 산출물을 읽는다.
실행: `cd dashboard && npm install && npm run dev` 후 http://localhost:3000
```

- [ ] **Step 2: 실패하는 테스트 작성**

```ts
// dashboard/lib/server/__tests__/data-files.test.ts
import { describe, expect, it } from 'vitest';
import path from 'path';
import { contentTypeFor, resolveDataPath } from '../data-files';

const DATA = path.resolve('testdata');

describe('resolveDataPath (경로 탈출 차단)', () => {
  it('허용 루트의 정상 경로는 DATA_DIR 아래 절대경로로 결합한다', () => {
    const abs = resolveDataPath(DATA, ['artifacts', 'a1', 'stats.json']);
    expect(abs).toBe(path.join(DATA, 'artifacts', 'a1', 'stats.json'));
  });
  it('허용 루트(raw-scans/artifacts/reports) 밖은 거부한다', () => {
    expect(resolveDataPath(DATA, ['etc', 'passwd'])).toBeNull();
    expect(resolveDataPath(DATA, ['artifacts'])).toBeNull(); // 루트 단독(파일 아님)도 거부
  });
  it('.. 세그먼트·백슬래시·빈 세그먼트를 거부한다', () => {
    expect(resolveDataPath(DATA, ['artifacts', '..', '..', 'secret.txt'])).toBeNull();
    expect(resolveDataPath(DATA, ['artifacts', 'a\\b', 'x.png'])).toBeNull();
    expect(resolveDataPath(DATA, ['artifacts', '', 'x.png'])).toBeNull();
  });
});

describe('contentTypeFor', () => {
  it('확장자별 content-type', () => {
    expect(contentTypeFor('a.png')).toBe('image/png');
    expect(contentTypeFor('a.json')).toBe('application/json');
    expect(contentTypeFor('a.csv')).toBe('text/csv; charset=utf-8');
    expect(contentTypeFor('a.bin')).toBe('application/octet-stream');
  });
});
```

```ts
// dashboard/lib/photos/__tests__/paths.test.ts
import { describe, expect, it } from 'vitest';
import { photoFilePath, photoStorageKey } from '../paths';

describe('사진 경로 규약 (스펙 §6.3: photos/{photo_id}.{ext})', () => {
  it('허용 확장자는 규약 문자열을 만든다(소문자화)', () => {
    expect(photoFilePath('p1', 'IMG_001.JPG')).toBe('photos/p1.jpg');
    expect(photoFilePath('p1', 'a.png')).toBe('photos/p1.png');
  });
  it('허용 외 확장자는 null', () => {
    expect(photoFilePath('p1', 'a.exe')).toBeNull();
    expect(photoFilePath('p1', 'noext')).toBeNull();
  });
  it('storageKey는 접두 photos/를 제거한 버킷 내 키', () => {
    expect(photoStorageKey('photos/p1.jpg')).toBe('p1.jpg');
  });
});
```

```ts
// dashboard/lib/photos/__tests__/upload.test.ts
import { describe, expect, it } from 'vitest';
import { uploadPhoto } from '../upload';

function stubSupabase() {
  const calls: { storageKey?: string; inserted?: Record<string, unknown> } = {};
  const supabase = {
    storage: {
      from: (bucket: string) => ({
        upload: async (key: string) => {
          calls.storageKey = `${bucket}/${key}`;
          return { error: null };
        },
      }),
    },
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        calls.inserted = row;
        return { select: () => ({ single: async () => ({ data: row, error: null }) }) };
      },
    }),
  };
  return { supabase, calls };
}

describe('uploadPhoto', () => {
  it('Storage 업로드 후 photos 행을 참조 1개와 함께 insert한다', async () => {
    const { supabase, calls } = stubSupabase();
    const file = new File(['x'], 'field.jpg', { type: 'image/jpeg' });
    const row = await uploadPhoto(supabase as never, file, { scan_id: 's1' }, '벽면 근접');
    expect(calls.storageKey).toMatch(/^photos\/[0-9a-f-]+\.jpg$/);
    expect(calls.inserted?.scan_id).toBe('s1');
    expect(calls.inserted?.caption).toBe('벽면 근접');
    expect(String(calls.inserted?.file_path)).toMatch(/^photos\/[0-9a-f-]+\.jpg$/);
    expect(row.file_path).toBe(calls.inserted?.file_path);
  });
  it('지원하지 않는 형식은 예외', async () => {
    const { supabase } = stubSupabase();
    const file = new File(['x'], 'a.exe');
    await expect(uploadPhoto(supabase as never, file, { site_id: 's1' })).rejects.toThrow('지원하지 않는');
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npm run test`
Expected: FAIL — data-files·photos 모듈 없음

- [ ] **Step 4: 구현**

```ts
// dashboard/lib/server/data-files.ts - 서버 전용: DATA_DIR 결합·경로 탈출 차단
import path from 'path';

const ALLOWED_ROOTS = ['raw-scans', 'artifacts', 'reports'];

export function resolveDataPath(dataDir: string, segments: string[]): string | null {
  if (segments.length < 2) return null; // 루트 디렉터리 자체는 서빙하지 않는다
  if (!ALLOWED_ROOTS.includes(segments[0])) return null;
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\'))) return null;
  const base = path.resolve(dataDir);
  const abs = path.resolve(base, ...segments);
  if (!abs.startsWith(base + path.sep)) return null; // 방어선 2중화
  return abs;
}

export function contentTypeFor(p: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.pdf': 'application/pdf',
  };
  return map[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
}
```

```ts
// dashboard/app/api/data/[...path]/route.ts - 로컬 data/ 서빙 (데모: 스펙 §6.3
// "raw-scans/artifacts/reports는 로컬 data/ 디렉터리 ... 로컬 대시보드가 서빙")
import { promises as fs } from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { contentTypeFor, resolveDataPath } from '@/lib/server/data-files';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const { path: segments } = await params;
  const abs = resolveDataPath(process.env.DATA_DIR ?? '../data', segments);
  if (!abs) return NextResponse.json({ error: '잘못된 경로입니다' }, { status: 400 });
  try {
    const buf = await fs.readFile(abs);
    return new NextResponse(buf, {
      headers: { 'content-type': contentTypeFor(abs), 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ error: '파일을 찾을 수 없습니다' }, { status: 404 });
  }
}
```

```ts
// dashboard/lib/photos/paths.ts
const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'webp'];

// DB(photos.file_path) 저장용 규약 문자열: photos/{photo_id}.{ext} (스펙 §6.3)
export function photoFilePath(photoId: string, filename: string): string | null {
  const parts = filename.split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop()!.toLowerCase();
  if (!PHOTO_EXTS.includes(ext)) return null;
  return `photos/${photoId}.${ext}`;
}

// Storage 버킷('photos') 내 객체 키: 규약 문자열에서 버킷 접두를 제거
export function photoStorageKey(filePath: string): string {
  return filePath.replace(/^photos\//, '');
}
```

```ts
// dashboard/lib/photos/upload.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PhotoRow } from '@/lib/domain/types';
import { photoFilePath, photoStorageKey } from './paths';

export type PhotoRef = { site_id: string } | { location_id: string } | { scan_id: string };

export async function uploadPhoto(
  supabase: SupabaseClient,
  file: File,
  target: PhotoRef,
  caption?: string,
): Promise<PhotoRow> {
  const id = crypto.randomUUID();
  const filePath = photoFilePath(id, file.name);
  if (!filePath) throw new Error('지원하지 않는 이미지 형식입니다 (jpg/jpeg/png/webp)');
  const { error: upErr } = await supabase.storage.from('photos').upload(photoStorageKey(filePath), file);
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from('photos')
    .insert({ id, file_path: filePath, caption: caption ?? null, ...target })
    .select()
    .single();
  if (error) throw error;
  return data as PhotoRow;
}

export async function photoUrl(supabase: SupabaseClient, filePath: string): Promise<string | null> {
  const { data } = await supabase.storage.from('photos').createSignedUrl(photoStorageKey(filePath), 3600);
  return data?.signedUrl ?? null;
}
```

```tsx
// dashboard/components/photo-gallery.tsx
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

  if (photos.length === 0) return <p className="text-sm text-slate-500">등록된 사진이 없습니다.</p>;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {photos.map((p) => (
        <figure key={p.id} className="rounded border bg-white p-1">
          {urls[p.id] ? (
            // signed URL은 외부 호스트라 next/image 대신 img 사용(데모)
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls[p.id]} alt={p.caption ?? '현장 사진'} className="h-32 w-full rounded object-cover" />
          ) : (
            <div className="h-32 w-full animate-pulse rounded bg-slate-100" />
          )}
          {p.caption && <figcaption className="p-1 text-xs text-slate-600">{p.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}
```

```tsx
// dashboard/components/photo-uploader.tsx
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { uploadPhoto, type PhotoRef } from '@/lib/photos/upload';

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

  return (
    <div className="flex items-center gap-2 text-sm">
      <input type="text" placeholder="사진 설명(선택)" value={caption}
        onChange={(e) => setCaption(e.target.value)} className="rounded border px-2 py-1" />
      <label className="cursor-pointer rounded border bg-white px-3 py-1 hover:bg-slate-50">
        {busy ? '업로드 중...' : '사진 추가'}
        <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={onChange} disabled={busy} />
      </label>
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}
```

- [ ] **Step 5: 통과 확인**

Run: `npm run test`
Expected: PASS (전체)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/003_dashboard_support.sql docs/SUPABASE_SETUP.md dashboard
git commit -m "feat(dashboard): 마이그레이션 003(photos 버킷·Realtime) + data 서빙 route + 사진 모듈"
```

---
### Task 4: 홈(현장 목록)과 현장 상세(위치 트리·사진)

**Files:**
- Create: `dashboard/lib/domain/summary.ts`, `dashboard/lib/domain/tree.ts`, `dashboard/lib/server/disk-usage.ts`, `dashboard/components/site-card.tsx`, `dashboard/components/supabase-error.tsx`, `dashboard/components/location-tree.tsx`, `dashboard/components/new-site-form.tsx`, `dashboard/components/new-location-form.tsx`, `dashboard/components/refresh-on-upload.tsx`, `dashboard/app/sites/new/page.tsx`, `dashboard/app/sites/[id]/page.tsx`
- Modify: `dashboard/app/page.tsx`(임시 홈 전면 교체)
- Test: `dashboard/lib/domain/__tests__/summary.test.ts`, `dashboard/lib/domain/__tests__/tree.test.ts`, `dashboard/lib/server/__tests__/disk-usage.test.ts`, `dashboard/components/__tests__/site-card.test.tsx`

**Interfaces:**
- Consumes: Task 1 `createClient`(server), Task 2 타입·라벨, Task 3 `PhotoGallery`·`PhotoUploader`
- Produces:
  - `SiteSummary = {site: SiteRow; locationCount: number; lastScannedAt: string | null; verdictCounts: Record<Verdict, number>}` 및 `buildSiteSummaries(sites, locations, scans, currentAnalyses): SiteSummary[]` — scans는 `{id, scanned_at, location_id}` 최소형, currentAnalyses는 `{scan_id, overall_verdict}` 최소형
  - `BuildingNode = {building: string; floors: {floor: string; floor_order: number; rooms: {room: string; locations: LocationRow[]}[]}[]}` 및 `buildLocationTree(locations: LocationRow[]): BuildingNode[]`
  - `dirSizeBytes(dir: string): Promise<number>`(없는 디렉터리는 0), `fmtBytes(n: number): string`
  - `/sites/[id]` 페이지 — Task 5의 업로드 링크(`/upload?site={id}`), 스캔 링크(`/scans/{id}`)를 생성

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// dashboard/lib/domain/__tests__/summary.test.ts
import { describe, expect, it } from 'vitest';
import { buildSiteSummaries } from '../summary';
import type { SiteRow } from '../types';

const site = (id: string, name: string): SiteRow =>
  ({ id, name, address: null, memo: null, created_at: '', updated_at: '' });

describe('buildSiteSummaries (홈 카드: 최근 측정일·측정위치 수·판정 분포)', () => {
  it('현장별로 위치 수·최근 측정일·현재 분석 판정 분포를 집계한다', () => {
    const sites = [site('s1', '현장A'), site('s2', '현장B')];
    const locations = [
      { id: 'l1', site_id: 's1' }, { id: 'l2', site_id: 's1' }, { id: 'l3', site_id: 's2' },
    ];
    const scans = [
      { id: 'c1', scanned_at: '2026-07-01', location_id: 'l1' },
      { id: 'c2', scanned_at: '2026-07-20', location_id: 'l2' },
      { id: 'c3', scanned_at: '2026-06-15', location_id: 'l3' },
    ];
    const analyses = [
      { scan_id: 'c1', overall_verdict: 'pass' as const },
      { scan_id: 'c2', overall_verdict: 'repair' as const },
      { scan_id: 'c3', overall_verdict: null },
    ];
    const [a, b] = buildSiteSummaries(sites, locations, scans, analyses);
    expect(a.locationCount).toBe(2);
    expect(a.lastScannedAt).toBe('2026-07-20');
    expect(a.verdictCounts).toEqual({ pass: 1, borderline: 0, repair: 1, rework: 0 });
    expect(b.lastScannedAt).toBe('2026-06-15');
    expect(b.verdictCounts).toEqual({ pass: 0, borderline: 0, repair: 0, rework: 0 });
  });
  it('스캔이 없는 현장은 lastScannedAt null', () => {
    const [a] = buildSiteSummaries([site('s1', 'A')], [], [], []);
    expect(a.lastScannedAt).toBeNull();
    expect(a.locationCount).toBe(0);
  });
});
```

```ts
// dashboard/lib/domain/__tests__/tree.test.ts
import { describe, expect, it } from 'vitest';
import { buildLocationTree } from '../tree';
import type { LocationRow } from '../types';

const loc = (over: Partial<LocationRow>): LocationRow => ({
  id: 'x', site_id: 's1', building: '', floor: '', floor_order: 0, room: '', name: '',
  memo: null, created_at: '', updated_at: '', ...over,
});

describe('buildLocationTree (동 > 층(floor_order 내림차순) > 공간 > 측정위치)', () => {
  it('동/층/공간으로 그룹핑하고 층은 floor_order 내림차순 정렬한다', () => {
    const tree = buildLocationTree([
      loc({ id: 'a', building: '101동', floor: '1F', floor_order: 1, room: '거실', name: 'P1' }),
      loc({ id: 'b', building: '101동', floor: '2F', floor_order: 2, room: '침실', name: 'P1' }),
      loc({ id: 'c', building: '101동', floor: '1F', floor_order: 1, room: '거실', name: 'P2' }),
      loc({ id: 'd', building: '102동', floor: '1F', floor_order: 1, room: '주방', name: 'P1' }),
    ]);
    expect(tree.map((b) => b.building)).toEqual(['101동', '102동']);
    expect(tree[0].floors.map((f) => f.floor)).toEqual(['2F', '1F']); // 높은 층 먼저
    const f1 = tree[0].floors[1];
    expect(f1.rooms[0].room).toBe('거실');
    expect(f1.rooms[0].locations.map((l) => l.name)).toEqual(['P1', 'P2']);
  });
  it('빈 입력은 빈 트리', () => {
    expect(buildLocationTree([])).toEqual([]);
  });
});
```

```ts
// dashboard/lib/server/__tests__/disk-usage.test.ts
import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { dirSizeBytes, fmtBytes } from '../disk-usage';

describe('dirSizeBytes / fmtBytes (홈 저장 용량 표시 - 스펙 §3.3)', () => {
  it('하위 디렉터리 포함 파일 크기를 합산한다', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'du-'));
    await fs.writeFile(path.join(dir, 'a.txt'), 'abcd');
    await fs.mkdir(path.join(dir, 'sub'));
    await fs.writeFile(path.join(dir, 'sub', 'b.txt'), 'ef');
    expect(await dirSizeBytes(dir)).toBe(6);
  });
  it('없는 디렉터리는 0', async () => {
    expect(await dirSizeBytes(path.join(os.tmpdir(), 'du-none-없음'))).toBe(0);
  });
  it('fmtBytes는 사람이 읽는 단위', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1536)).toBe('1.5 KB');
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(fmtBytes(2.5 * 1024 * 1024 * 1024)).toBe('2.5 GB');
  });
});
```

```tsx
// dashboard/components/__tests__/site-card.test.tsx
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test`
Expected: FAIL — summary·tree·disk-usage·site-card 없음

- [ ] **Step 3: 구현**

```ts
// dashboard/lib/domain/summary.ts
import type { SiteRow, Verdict } from './types';

export interface SiteSummary {
  site: SiteRow;
  locationCount: number;
  lastScannedAt: string | null;
  verdictCounts: Record<Verdict, number>;
}

export function buildSiteSummaries(
  sites: SiteRow[],
  locations: { id: string; site_id: string }[],
  scans: { id: string; scanned_at: string; location_id: string }[],
  currentAnalyses: { scan_id: string; overall_verdict: Verdict | null }[],
): SiteSummary[] {
  const siteOfLocation = new Map(locations.map((l) => [l.id, l.site_id]));
  const siteOfScan = new Map(
    scans.map((s) => [s.id, siteOfLocation.get(s.location_id)]).filter(([, v]) => v) as [string, string][],
  );
  return sites.map((site) => {
    const locCount = locations.filter((l) => l.site_id === site.id).length;
    const siteScans = scans.filter((s) => siteOfLocation.get(s.location_id) === site.id);
    const lastScannedAt = siteScans.length
      ? siteScans.map((s) => s.scanned_at).sort().at(-1)! : null;
    const verdictCounts: Record<Verdict, number> = { pass: 0, borderline: 0, repair: 0, rework: 0 };
    for (const a of currentAnalyses) {
      if (siteOfScan.get(a.scan_id) === site.id && a.overall_verdict) {
        verdictCounts[a.overall_verdict] += 1;
      }
    }
    return { site, locationCount: locCount, lastScannedAt, verdictCounts };
  });
}
```

```ts
// dashboard/lib/domain/tree.ts
import type { LocationRow } from './types';

export interface RoomNode { room: string; locations: LocationRow[]; }
export interface FloorNode { floor: string; floor_order: number; rooms: RoomNode[]; }
export interface BuildingNode { building: string; floors: FloorNode[]; }

export function buildLocationTree(locations: LocationRow[]): BuildingNode[] {
  const buildings = new Map<string, Map<string, { floor_order: number; rooms: Map<string, LocationRow[]> }>>();
  for (const l of locations) {
    const b = buildings.get(l.building) ?? new Map();
    buildings.set(l.building, b);
    const f = b.get(l.floor) ?? { floor_order: l.floor_order, rooms: new Map<string, LocationRow[]>() };
    b.set(l.floor, f);
    const r = f.rooms.get(l.room) ?? [];
    r.push(l);
    f.rooms.set(l.room, r);
  }
  return [...buildings.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ko'))
    .map(([building, floors]) => ({
      building,
      floors: [...floors.entries()]
        .sort(([, a], [, b]) => b.floor_order - a.floor_order) // 높은 층 먼저
        .map(([floor, f]) => ({
          floor,
          floor_order: f.floor_order,
          rooms: [...f.rooms.entries()]
            .sort(([a], [b]) => a.localeCompare(b, 'ko'))
            .map(([room, locs]) => ({
              room,
              locations: locs.sort((a, b) => a.name.localeCompare(b.name, 'ko')),
            })),
        })),
    }));
}
```

```ts
// dashboard/lib/server/disk-usage.ts - 홈 카드 저장 용량(로컬 data/) 표시용
import { promises as fs } from 'fs';
import path from 'path';

export async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // 디렉터리 없음(아직 업로드 전) = 0
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSizeBytes(p);
    else if (e.isFile()) total += (await fs.stat(p)).size;
  }
  return total;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}
```

```tsx
// dashboard/components/site-card.tsx
import Link from 'next/link';
import { GRADE_COLOR, GRADE_LABEL } from '@/lib/domain/labels';
import type { SiteSummary } from '@/lib/domain/summary';
import type { Verdict } from '@/lib/domain/types';

const VERDICTS: Verdict[] = ['pass', 'borderline', 'repair', 'rework'];

export function SiteCard({ summary }: { summary: SiteSummary }) {
  const { site, locationCount, lastScannedAt, verdictCounts } = summary;
  return (
    <Link href={`/sites/${site.id}`}
      className="block rounded-lg border bg-white p-4 shadow-sm hover:border-slate-400">
      <h2 className="font-semibold">{site.name}</h2>
      {site.address && <p className="text-sm text-slate-500">{site.address}</p>}
      <p className="mt-2 text-sm text-slate-600">
        측정위치 {locationCount} · 최근 측정 {lastScannedAt ?? '없음'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        {VERDICTS.map((v) => (
          <span key={v} className="rounded px-2 py-0.5 text-white"
            style={{ backgroundColor: GRADE_COLOR[v], opacity: verdictCounts[v] ? 1 : 0.3 }}>
            {GRADE_LABEL[v]} {verdictCounts[v]}
          </span>
        ))}
      </div>
    </Link>
  );
}
```

```tsx
// dashboard/components/supabase-error.tsx - Free 일시정지 안내 (스펙 §3.3)
export function SupabaseErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-semibold">Supabase 연결에 실패했습니다</p>
      <p className="mt-1 text-slate-700">
        Free 프로젝트는 7일 미사용 시 일시정지됩니다. Supabase 대시보드에서 프로젝트를
        Restore(재개)한 뒤 새로고침하세요. 그 밖의 원인이면 .env.local의 URL·anon key를 확인하세요.
      </p>
      <p className="mt-1 text-xs text-slate-500">상세: {message}</p>
    </div>
  );
}
```

```tsx
// dashboard/app/page.tsx - 홈(현장 목록) 전면 교체
import Link from 'next/link';
import path from 'path';
import { createClient } from '@/lib/supabase/server';
import { buildSiteSummaries } from '@/lib/domain/summary';
import { dirSizeBytes, fmtBytes } from '@/lib/server/disk-usage';
import { SiteCard } from '@/components/site-card';
import { SupabaseErrorNotice } from '@/components/supabase-error';
import type { SiteRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createClient();
  const [sitesRes, locationsRes, scansRes, analysesRes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    supabase.from('locations').select('id, site_id'),
    supabase.from('scans').select('id, scanned_at, location_id').is('deleted_at', null),
    supabase.from('analyses').select('scan_id, overall_verdict')
      .eq('is_current', true).is('deleted_at', null),
  ]);
  const firstError = sitesRes.error ?? locationsRes.error ?? scansRes.error ?? analysesRes.error;
  if (firstError) {
    return <main className="mx-auto max-w-6xl p-6"><SupabaseErrorNotice message={firstError.message} /></main>;
  }
  const summaries = buildSiteSummaries(
    (sitesRes.data ?? []) as SiteRow[],
    locationsRes.data ?? [],
    scansRes.data ?? [],
    (analysesRes.data ?? []) as { scan_id: string; overall_verdict: Verdict | null }[],
  );
  const dataDir = path.resolve(process.env.DATA_DIR ?? '../data');
  const usage = await dirSizeBytes(dataDir);
  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">현장 목록</h1>
        <div className="flex items-center gap-4 text-sm text-slate-500">
          <span>로컬 저장 용량: {fmtBytes(usage)}</span>
          <Link href="/sites/new" className="rounded bg-slate-800 px-3 py-1.5 text-white">새 현장</Link>
        </div>
      </div>
      {summaries.length === 0 ? (
        <p className="text-slate-500">현장이 없습니다. 새 현장을 등록하세요.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {summaries.map((s) => <SiteCard key={s.site.id} summary={s} />)}
        </div>
      )}
    </main>
  );
}
```

```tsx
// dashboard/components/new-site-form.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

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
    router.push(`/sites/${data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-3">
      <div>
        <label htmlFor="name" className="block text-sm font-medium">현장명 (필수)</label>
        <input id="name" required value={name} onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="address" className="block text-sm font-medium">주소</label>
        <input id="address" value={address} onChange={(e) => setAddress(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      <div>
        <label htmlFor="memo" className="block text-sm font-medium">메모</label>
        <textarea id="memo" value={memo} onChange={(e) => setMemo(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" rows={3} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="rounded bg-slate-800 px-4 py-2 text-white">현장 등록</button>
    </form>
  );
}
```

```tsx
// dashboard/app/sites/new/page.tsx
import { NewSiteForm } from '@/components/new-site-form';

export default function NewSitePage() {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-bold">새 현장 등록</h1>
      <NewSiteForm />
    </main>
  );
}
```

```tsx
// dashboard/components/new-location-form.tsx - 입력 trim 정규화는 앱 레벨 책임(001 주석)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

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

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2 text-sm">
      {([
        ['building', '동', false], ['floor', '층', false], ['floorOrder', '층 순서(정수)', false],
        ['room', '공간', false], ['name', '측정위치', true],
      ] as const).map(([key, label, required]) => (
        <div key={key}>
          <label htmlFor={`loc-${key}`} className="block text-xs text-slate-500">{label}</label>
          <input id={`loc-${key}`} required={required} value={form[key]} onChange={set(key)}
            className="w-28 rounded border px-2 py-1" />
        </div>
      ))}
      <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-white">위치 추가</button>
      {error && <p className="w-full text-red-600">{error}</p>}
    </form>
  );
}
```

```tsx
// dashboard/components/location-tree.tsx
import Link from 'next/link';
import type { BuildingNode } from '@/lib/domain/tree';
import type { AnalysisStatus, ScanRow, Verdict } from '@/lib/domain/types';
import { GRADE_COLOR, GRADE_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';

export interface ScanWithCurrent extends ScanRow {
  current?: { id: string; status: AnalysisStatus; overall_verdict: Verdict | null };
}

export function LocationTree({ tree, scansByLocation, siteId }: {
  tree: BuildingNode[];
  scansByLocation: Map<string, ScanWithCurrent[]>;
  siteId: string;
}) {
  if (tree.length === 0) return <p className="text-sm text-slate-500">측정위치가 없습니다. 아래에서 추가하세요.</p>;
  return (
    <div className="space-y-4">
      {tree.map((b) => (
        <section key={b.building}>
          <h3 className="font-semibold">{b.building || '(동 미지정)'}</h3>
          {b.floors.map((f) => (
            <div key={f.floor} className="ml-4 mt-1">
              <h4 className="text-sm font-medium text-slate-600">{f.floor || '(층 미지정)'}</h4>
              {f.rooms.map((r) => (
                <div key={r.room} className="ml-4 mt-1">
                  <h5 className="text-sm text-slate-500">{r.room || '(공간 미지정)'}</h5>
                  <ul className="ml-4 space-y-1">
                    {r.locations.map((l) => (
                      <li key={l.id} className="rounded border bg-white p-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{l.name}</span>
                          <Link href={`/upload?site=${siteId}&location=${l.id}`}
                            className="text-xs text-blue-700 hover:underline">스캔 업로드</Link>
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {(scansByLocation.get(l.id) ?? []).map((s) => (
                            <li key={s.id}>
                              <Link href={`/scans/${s.id}`} className="flex items-center gap-2 hover:underline">
                                <span>{s.scanned_at} · {SURFACE_LABEL[s.surface]}</span>
                                {s.current?.overall_verdict ? (
                                  <span className="rounded px-1.5 text-xs text-white"
                                    style={{ backgroundColor: GRADE_COLOR[s.current.overall_verdict] }}>
                                    {GRADE_LABEL[s.current.overall_verdict]}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-500">{SCAN_STATUS_LABEL[s.status]}</span>
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
          ))}
        </section>
      ))}
    </div>
  );
}
```

```tsx
// dashboard/app/sites/[id]/page.tsx - 현장 상세 (스펙 §7.3: 트리 + 측정 이력 + 현장 사진)
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { buildLocationTree } from '@/lib/domain/tree';
import { LocationTree, type ScanWithCurrent } from '@/components/location-tree';
import { NewLocationForm } from '@/components/new-location-form';
import { PhotoGallery } from '@/components/photo-gallery';
import { RefreshOnUpload } from '@/components/refresh-on-upload';
import type { AnalysisStatus, LocationRow, PhotoRow, ScanRow, SiteRow, Verdict } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: site } = await supabase.from('sites').select('*').eq('id', id).maybeSingle();
  if (!site) notFound();
  const [locationsRes, photosRes] = await Promise.all([
    supabase.from('locations').select('*').eq('site_id', id),
    supabase.from('photos').select('*').eq('site_id', id).order('created_at', { ascending: false }),
  ]);
  const locations = (locationsRes.data ?? []) as LocationRow[];
  const locationIds = locations.map((l) => l.id);
  const { data: scans } = locationIds.length
    ? await supabase.from('scans').select('*').in('location_id', locationIds)
        .is('deleted_at', null).order('scanned_at', { ascending: false })
    : { data: [] as ScanRow[] };
  const scanIds = (scans ?? []).map((s) => s.id);
  const { data: currents } = scanIds.length
    ? await supabase.from('analyses').select('id, scan_id, status, overall_verdict')
        .in('scan_id', scanIds).eq('is_current', true).is('deleted_at', null)
    : { data: [] };
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
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-bold">{(site as SiteRow).name}</h1>
        {(site as SiteRow).address && <p className="text-sm text-slate-500">{(site as SiteRow).address}</p>}
      </div>
      <section>
        <h2 className="mb-2 font-semibold">측정위치</h2>
        <LocationTree tree={buildLocationTree(locations)} scansByLocation={scansByLocation} siteId={id} />
        <div className="mt-3 rounded border bg-white p-3">
          <NewLocationForm siteId={id} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">현장 사진</h2>
        <RefreshOnUpload target={{ site_id: id }} />
        <div className="mt-2">
          <PhotoGallery photos={(photosRes.data ?? []) as PhotoRow[]} />
        </div>
      </section>
    </main>
  );
}
```

```tsx
// dashboard/components/refresh-on-upload.tsx - PhotoUploader + 업로드 후 서버 데이터 새로고침
'use client';
import { useRouter } from 'next/navigation';
import { PhotoUploader } from './photo-uploader';
import type { PhotoRef } from '@/lib/photos/upload';

export function RefreshOnUpload({ target }: { target: PhotoRef }) {
  const router = useRouter();
  return <PhotoUploader target={target} onUploaded={() => router.refresh()} />;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test`
Expected: PASS (전체). 이어서 `npm run build` 성공 확인

- [ ] **Step 5: Commit**

```bash
git add dashboard
git commit -m "feat(dashboard): 홈 현장 목록 + 현장 상세(위치 트리·사진·용량 표시)"
```

---

### Task 5: 스캔 업로드 · 단위 확인 · 진행 상태(Realtime) · 기존 결과 임포트

**Files:**
- Create: `dashboard/lib/upload/validate.ts`, `dashboard/app/api/upload/route.ts`, `dashboard/components/upload-form.tsx`, `dashboard/app/upload/page.tsx`, `dashboard/lib/hooks/use-row-status.ts`, `dashboard/components/unit-confirm-form.tsx`, `dashboard/app/scans/[id]/confirm-unit/page.tsx`, `dashboard/components/analysis-progress.tsx`, `dashboard/app/scans/[id]/page.tsx`
- Test: `dashboard/lib/upload/__tests__/validate.test.ts`, `dashboard/components/__tests__/unit-confirm-form.test.tsx`

**Interfaces:**
- Consumes: Task 2 `rawScanRelPath`·`enqueueJob`·타입·라벨, Task 3 `resolveDataPath`는 쓰지 않음(업로드 경로는 서버가 UUID 검증 후 직접 규약 생성), Task 1 `createClient`
- Consumes(DB): `scans` insert/update(컬럼: location_id, surface, scanned_at, device, operator_id, operator_name_manual, selected_criteria_id, raw_file_path, original_filename, file_format, unit_scale, lineage, status), `analyses` insert(scan_id, surface, criteria_id, status, created_by), RPC `fn_resolve_criteria(p_site_id, p_surface)`, `fn_enqueue_job`
- Produces:
  - `SCAN_EXTS`(ply/las/laz/xyz/txt/csv/pts), `validateScanFile(filename: string): {ext: string} | null`, `UNIT_OPTIONS: {value: number; label: string}[]`(m=1, cm=0.01, mm=0.001)
  - `POST /api/upload` — FormData `{file, site_id, scan_id}` -> `{rel_path, size}` (401/400 JSON)
  - `useRowStatus<T extends string>(table: 'scans' | 'analyses', id: string, initial: T): T` — Realtime UPDATE 구독 + 5초 보조 폴링(done/failed 등 종결 상태 전달 후에도 무해하게 동작)
  - `/upload` 화면(스캔 업로드 + '기존 결과 가져오기' 모드), `/scans/[id]`(스캔 상세·진행 상태), `/scans/[id]/confirm-unit`(단위 확정)

**업로드 흐름(스캔 모드)** — 컴포넌트가 이 순서를 정확히 따른다:
1. `scans` insert(파일 경로 없이, status 'uploaded') -> `id` 획득
2. `POST /api/upload`(file, site_id, scan_id) -> 서버가 `data/raw-scans/{site_id}/{scan_id}/raw.{ext}`에 저장, `rel_path` 반환
3. `scans` update: `raw_file_path = rel_path`
4. `enqueueJob('precheck', {scan_id})` — 워커가 unit_scale 미확정이면 status를 'awaiting_unit_confirm'으로 바꾼다(P2 handle_precheck)
5. `/scans/{id}`로 이동

**임포트 모드(스펙 §5.4)**: surface는 floor 고정(P2 handle_import가 floor만 허용), CSV만. `scans` insert 시 `unit_scale: 1.0`(임포트 CSV는 단위 확인 불필요: Signed_Distance_mm가 이미 mm) -> 파일 업로드 -> raw_file_path update와 함께 `status: 'ready'` -> `analyses` insert(status 'queued') -> `enqueueJob('import', {analysis_id})` -> `/scans/{id}`.

**단위 확정 흐름**: `/scans/[id]/confirm-unit`에서 단위 선택 -> `scans` update `{unit_scale, status: 'ready'}` -> `analyses` insert(scan_id, surface: scan.surface, criteria_id: scan.selected_criteria_id, status 'queued', created_by) -> `enqueueJob('analyze', {analysis_id})` -> `/scans/{id}`. selected_criteria_id가 null이면 확정 불가(업로드 화면에서 항상 선택되므로 방어적 안내만).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// dashboard/lib/upload/__tests__/validate.test.ts
import { describe, expect, it } from 'vitest';
import { UNIT_OPTIONS, validateScanFile } from '../validate';

describe('validateScanFile (스펙 §5.1.1 런치 포맷)', () => {
  it('지원 확장자 7종을 허용한다(대소문자 무시)', () => {
    for (const ext of ['ply', 'las', 'laz', 'xyz', 'txt', 'csv', 'pts']) {
      expect(validateScanFile(`scan.${ext}`)).toEqual({ ext });
    }
    expect(validateScanFile('SCAN.PLY')).toEqual({ ext: 'ply' });
  });
  it('E57 등 미지원 확장자·확장자 없음은 거부', () => {
    expect(validateScanFile('scan.e57')).toBeNull();
    expect(validateScanFile('scan')).toBeNull();
  });
});

describe('UNIT_OPTIONS', () => {
  it('m/cm/mm 배율', () => {
    expect(UNIT_OPTIONS.map((o) => o.value)).toEqual([1.0, 0.01, 0.001]);
  });
});
```

```tsx
// dashboard/components/__tests__/unit-confirm-form.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

import { UnitConfirmForm } from '../unit-confirm-form';
import type { ScanRow } from '@/lib/domain/types';

const scan = {
  id: 'c1', location_id: 'l1', surface: 'floor', scanned_at: '2026-07-28',
  device: null, operator_id: null, operator_name_manual: null,
  selected_criteria_id: 'cr1', raw_file_path: 'raw-scans/s1/c1/raw.ply',
  original_filename: 'room.ply', file_format: 'ply', point_count: null,
  unit_scale: null, lineage: 'raw', status: 'awaiting_unit_confirm',
  deleted_at: null, created_at: '', updated_at: '',
} as ScanRow;

describe('UnitConfirmForm', () => {
  it('단위 3종 라디오와 확정 버튼, 원본 파일명을 렌더한다', () => {
    render(<UnitConfirmForm scan={scan} userId="u1" />);
    expect(screen.getByText(/room\.ply/)).toBeInTheDocument();
    expect(screen.getByLabelText(/m\(미터\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/cm/)).toBeInTheDocument();
    expect(screen.getByLabelText(/mm/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '단위 확정 후 분석 시작' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// dashboard/lib/upload/validate.ts
export const SCAN_EXTS = ['ply', 'las', 'laz', 'xyz', 'txt', 'csv', 'pts'] as const;

export function validateScanFile(filename: string): { ext: string } | null {
  const parts = filename.split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop()!.toLowerCase();
  return (SCAN_EXTS as readonly string[]).includes(ext) ? { ext } : null;
}

// 단위 확정 배율(스펙 §5.1.1): 파일 좌표 -> m 변환 계수 (scans.unit_scale)
export const UNIT_OPTIONS = [
  { value: 1.0, label: 'm(미터)' },
  { value: 0.01, label: 'cm(센티미터)' },
  { value: 0.001, label: 'mm(밀리미터)' },
];
```

```ts
// dashboard/app/api/upload/route.ts - 스캔 원본을 로컬 data/에 규약대로 저장
// (스펙 §3.2.①: 데모에서 TUS 없이 로컬 대시보드 서버가 raw-scans/에 저장)
import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rawScanRelPath } from '@/lib/domain/paths';
import { validateScanFile } from '@/lib/upload/validate';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  const siteId = form.get('site_id');
  const scanId = form.get('scan_id');
  if (!(file instanceof File) || typeof siteId !== 'string' || typeof scanId !== 'string') {
    return NextResponse.json({ error: '필수 항목 누락(file, site_id, scan_id)' }, { status: 400 });
  }
  // 경로 성분은 UUID만 허용 - 사용자 입력 경로를 파일 시스템에 쓰지 않는다
  if (!UUID_RE.test(siteId) || !UUID_RE.test(scanId)) {
    return NextResponse.json({ error: 'site_id/scan_id는 UUID여야 합니다' }, { status: 400 });
  }
  const v = validateScanFile(file.name);
  if (!v) {
    return NextResponse.json({ error: '지원 포맷: ply, las, laz, xyz, txt, csv, pts' }, { status: 400 });
  }
  const rel = rawScanRelPath(siteId, scanId, v.ext);
  const abs = path.join(path.resolve(process.env.DATA_DIR ?? '../data'), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(abs, buf);
  return NextResponse.json({ rel_path: rel, size: buf.length });
}
```

```ts
// dashboard/lib/hooks/use-row-status.ts - 진행 상태 추적 (P2 확정: jobs 불가시,
// analyses.status/scans.status를 Realtime 구독. 구독 유실 대비 5초 보조 폴링 병행)
'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useRowStatus<T extends string>(
  table: 'scans' | 'analyses',
  id: string,
  initial: T,
): T {
  const [status, setStatus] = useState<T>(initial);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`${table}-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table, filter: `id=eq.${id}` },
        (payload) => setStatus((payload.new as { status: T }).status),
      )
      .subscribe();
    const timer = setInterval(async () => {
      const { data } = await supabase.from(table).select('status').eq('id', id).maybeSingle();
      if (data) setStatus(data.status as T);
    }, 5000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [table, id]);

  return status;
}
```

```tsx
// dashboard/components/upload-form.tsx - 스펙 §7.4 업로드 화면 (+ §5.4 임포트 모드)
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { LINEAGE_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import type { CriteriaRow, Lineage, LocationRow, SiteRow, Surface } from '@/lib/domain/types';
import { validateScanFile } from '@/lib/upload/validate';

interface Props {
  sites: SiteRow[];
  locations: LocationRow[];
  userId: string;
  initialSiteId?: string;
  initialLocationId?: string;
}

export function UploadForm({ sites, locations, userId, initialSiteId, initialLocationId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'scan' | 'import'>('scan');
  const [siteId, setSiteId] = useState(initialSiteId ?? '');
  const [locationId, setLocationId] = useState(initialLocationId ?? '');
  const [surface, setSurface] = useState<Surface>('floor');
  const [criteria, setCriteria] = useState<CriteriaRow[]>([]);
  const [criteriaId, setCriteriaId] = useState('');
  const [scannedAt, setScannedAt] = useState(new Date().toISOString().slice(0, 10));
  const [device, setDevice] = useState('');
  const [operatorManual, setOperatorManual] = useState('');
  const [lineage, setLineage] = useState<Lineage>('unknown');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const effectiveSurface: Surface = mode === 'import' ? 'floor' : surface;
  const siteLocations = locations.filter((l) => l.site_id === siteId);

  // 적용 기준 후보: fn_resolve_criteria는 대체(override) 시맨틱 - 현장 기준이 있으면
  // 전역 기준은 목록에 아예 나오지 않는다. 반환 목록을 그대로 후보로 쓴다.
  useEffect(() => {
    if (!siteId) { setCriteria([]); setCriteriaId(''); return; }
    let cancelled = false;
    (async () => {
      const { data, error: err } = await createClient().rpc('fn_resolve_criteria', {
        p_site_id: siteId, p_surface: effectiveSurface,
      });
      if (cancelled) return;
      if (err || !data) { setCriteria([]); setCriteriaId(''); return; }
      const rows = data as CriteriaRow[];
      setCriteria(rows);
      setCriteriaId(rows.find((c) => c.is_default)?.id ?? rows[0]?.id ?? '');
    })();
    return () => { cancelled = true; };
  }, [siteId, effectiveSurface]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!file) { setError('파일을 선택하세요.'); return; }
    if (!locationId) { setError('측정위치를 선택하세요.'); return; }
    if (!criteriaId) { setError('적용 기준을 선택하세요.'); return; }
    const v = validateScanFile(file.name);
    if (!v) { setError('지원 포맷: ply, las, laz, xyz, txt, csv, pts'); return; }
    if (mode === 'import' && v.ext !== 'csv') { setError('기존 결과 가져오기는 CSV 파일만 지원합니다.'); return; }
    setBusy(true);
    const supabase = createClient();
    try {
      // 1) scans insert
      const { data: scan, error: insErr } = await supabase.from('scans').insert({
        location_id: locationId,
        surface: effectiveSurface,
        scanned_at: scannedAt,
        device: device.trim() || null,
        operator_id: userId,
        operator_name_manual: operatorManual.trim() || null,
        selected_criteria_id: criteriaId,
        original_filename: file.name,
        file_format: v.ext,
        lineage: mode === 'import' ? 'unknown' : lineage,
        status: 'uploaded',
        ...(mode === 'import' ? { unit_scale: 1.0 } : {}),
      }).select('id').single();
      if (insErr || !scan) throw new Error(insErr?.message ?? '스캔 등록 실패');

      // 2) 파일 저장 (로컬 data/raw-scans 규약 - 서버 route가 경로 생성)
      const fd = new FormData();
      fd.set('file', file);
      fd.set('site_id', siteId);
      fd.set('scan_id', scan.id);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? '파일 업로드 실패');

      // 3) raw_file_path 반영 (버킷-상대 규약 문자열)
      const { error: updErr } = await supabase.from('scans')
        .update({ raw_file_path: body.rel_path, ...(mode === 'import' ? { status: 'ready' } : {}) })
        .eq('id', scan.id);
      if (updErr) throw new Error(updErr.message);

      // 4) 잡 등록
      if (mode === 'import') {
        const { data: analysis, error: aErr } = await supabase.from('analyses').insert({
          scan_id: scan.id, surface: 'floor', criteria_id: criteriaId,
          status: 'queued', created_by: userId,
        }).select('id').single();
        if (aErr || !analysis) throw new Error(aErr?.message ?? '분석 등록 실패');
        const r = await enqueueJob(supabase, 'import', { analysis_id: analysis.id });
        if (!r.ok) { setError(r.message); }
      } else {
        const r = await enqueueJob(supabase, 'precheck', { scan_id: scan.id });
        if (!r.ok) { setError(r.message); }
      }
      router.push(`/scans/${scan.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드에 실패했습니다');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'scan'} onChange={() => setMode('scan')} />
          스캔 분석
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" checked={mode === 'import'} onChange={() => setMode('import')} />
          기존 결과 가져오기(Colab CSV)
        </label>
      </div>
      {mode === 'import' && (
        <p className="rounded bg-slate-100 p-2 text-xs text-slate-600">
          기존 Colab 노트북 결과 CSV(X, Y, Signed_Distance_mm 컬럼 필수)를 등록합니다.
          바닥 결과만 지원하며, 결과 화면에 &quot;외부 결과&quot; 배지가 표시됩니다.
        </p>
      )}
      <div>
        <label htmlFor="site" className="block text-sm font-medium">현장</label>
        <select id="site" required value={siteId}
          onChange={(e) => { setSiteId(e.target.value); setLocationId(''); }}
          className="mt-1 w-full rounded border px-3 py-2">
          <option value="">선택...</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="location" className="block text-sm font-medium">측정위치</label>
        <select id="location" required value={locationId} onChange={(e) => setLocationId(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2">
          <option value="">선택...</option>
          {siteLocations.map((l) => (
            <option key={l.id} value={l.id}>
              {[l.building, l.floor, l.room, l.name].filter(Boolean).join(' / ')}
            </option>
          ))}
        </select>
      </div>
      {mode === 'scan' && (
        <div className="flex gap-4 text-sm">
          <span className="font-medium">표면 유형:</span>
          {(['floor', 'wall'] as const).map((s) => (
            <label key={s} className="flex items-center gap-1">
              <input type="radio" checked={surface === s} onChange={() => setSurface(s)} />
              {SURFACE_LABEL[s]}
            </label>
          ))}
        </div>
      )}
      <div>
        <span className="block text-sm font-medium">적용 기준</span>
        <div className="mt-1 space-y-1 rounded border bg-white p-2 text-sm">
          {criteria.length === 0 && <p className="text-slate-500">현장을 먼저 선택하세요.</p>}
          {criteria.map((c) => (
            <label key={c.id} className="flex items-start gap-2">
              <input type="radio" checked={criteriaId === c.id} onChange={() => setCriteriaId(c.id)} />
              <span>
                {c.name}{c.is_default && <em className="ml-1 text-xs text-blue-700">(기본)</em>}
                {c.site_id && <em className="ml-1 text-xs text-emerald-700">(현장 기준)</em>}
                <span className="block text-xs text-slate-500">{c.source_text}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-4">
        <div>
          <label htmlFor="scanned-at" className="block text-sm font-medium">측정일자</label>
          <input id="scanned-at" type="date" required value={scannedAt}
            onChange={(e) => setScannedAt(e.target.value)} className="mt-1 rounded border px-3 py-2" />
        </div>
        <div className="flex-1">
          <label htmlFor="device" className="block text-sm font-medium">장비</label>
          <input id="device" value={device} onChange={(e) => setDevice(e.target.value)}
            placeholder="예: iPhone 15 Pro + 3d Scanner App" className="mt-1 w-full rounded border px-3 py-2" />
        </div>
      </div>
      <div>
        <label htmlFor="operator" className="block text-sm font-medium">담당자 이름(직접 입력, 비우면 로그인 사용자)</label>
        <input id="operator" value={operatorManual} onChange={(e) => setOperatorManual(e.target.value)}
          className="mt-1 w-full rounded border px-3 py-2" />
      </div>
      {mode === 'scan' && (
        <div className="text-sm">
          <span className="font-medium">데이터 계보:</span>
          <div className="mt-1 flex gap-4">
            {(['raw', 'fused_mesh', 'unknown'] as const).map((l) => (
              <label key={l} className="flex items-center gap-1">
                <input type="radio" checked={lineage === l} onChange={() => setLineage(l)} />
                {LINEAGE_LABEL[l]}
              </label>
            ))}
          </div>
          {lineage === 'fused_mesh' && (
            <p className="mt-1 text-xs text-amber-700">
              융합 메시는 앱이 스무딩한 데이터라 실제보다 양호하게 나올 수 있습니다. 결과에 경고가 표시됩니다.
            </p>
          )}
        </div>
      )}
      <div>
        <label htmlFor="file" className="block text-sm font-medium">
          {mode === 'import' ? '결과 CSV 파일' : '스캔 파일 (ply/las/laz/xyz/txt/csv/pts)'}
        </label>
        <input id="file" type="file" required onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="mt-1 w-full text-sm" />
        <p className="mt-1 text-xs text-slate-500">
          파일은 로컬 서버의 data/raw-scans/ 아래에 저장됩니다(Supabase를 거치지 않음).
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50">
        {busy ? '업로드 중...' : mode === 'import' ? '가져오기 시작' : '업로드 후 사전 검사'}
      </button>
    </form>
  );
}
```

```tsx
// dashboard/app/upload/page.tsx
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UploadForm } from '@/components/upload-form';
import type { LocationRow, SiteRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function UploadPage({ searchParams }: {
  searchParams: Promise<{ site?: string; location?: string }>;
}) {
  const { site, location } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const [sitesRes, locationsRes] = await Promise.all([
    supabase.from('sites').select('*').order('name'),
    supabase.from('locations').select('*'),
  ]);
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-bold">스캔 업로드</h1>
      <UploadForm
        sites={(sitesRes.data ?? []) as SiteRow[]}
        locations={(locationsRes.data ?? []) as LocationRow[]}
        userId={user.id}
        initialSiteId={site}
        initialLocationId={location}
      />
    </main>
  );
}
```

```tsx
// dashboard/components/unit-confirm-form.tsx - 스펙 §7.4 단위 확인 화면.
// P2 확정: precheck는 단위 후보를 저장할 컬럼이 없어 후보·근거 표시는 백로그 -
// 사용자가 파일의 좌표 단위를 직접 선택해 확정한다.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import type { ScanRow } from '@/lib/domain/types';
import { UNIT_OPTIONS } from '@/lib/upload/validate';

export function UnitConfirmForm({ scan, userId }: { scan: ScanRow; userId: string }) {
  const router = useRouter();
  const [unitScale, setUnitScale] = useState<number>(1.0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scan.selected_criteria_id) {
      setError('적용 기준이 지정되지 않은 스캔입니다. 업로드를 다시 진행하세요.');
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // 1) 단위 확정 + ready 승격 (P2 확정: 확정은 UI 책임 - 워커 재경유 없이 직접 갱신)
    const { error: updErr } = await supabase.from('scans')
      .update({ unit_scale: unitScale, status: 'ready' }).eq('id', scan.id);
    if (updErr) { setError(updErr.message); setBusy(false); return; }
    // 2) 분석 행 생성 -> 분석 잡 등록 (스펙 §3.2.③: 단위 확정 시 분석 잡 자동 등록)
    const { data: analysis, error: aErr } = await supabase.from('analyses').insert({
      scan_id: scan.id, surface: scan.surface, criteria_id: scan.selected_criteria_id,
      status: 'queued', created_by: userId,
    }).select('id').single();
    if (aErr || !analysis) { setError(aErr?.message ?? '분석 등록 실패'); setBusy(false); return; }
    const r = await enqueueJob(supabase, 'analyze', { analysis_id: analysis.id });
    if (!r.ok) {
      // 409(중복 엔큐) 등 실패 안내를 사용자가 읽을 수 있게 화면에 남는다
      setError(r.message);
      setBusy(false);
      return;
    }
    router.push(`/scans/${scan.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <p className="rounded bg-slate-100 p-3 text-sm">
        <span className="font-medium">{scan.original_filename ?? '(파일명 없음)'}</span>
        <span className="block text-xs text-slate-500">
          파일 좌표의 길이 단위를 확정해야 분석을 시작할 수 있습니다. 단위가 틀리면
          결과 전체가 왜곡되므로 스캔 앱의 내보내기 설정을 확인하세요.
        </span>
      </p>
      <div className="space-y-1">
        {UNIT_OPTIONS.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={unitScale === o.value} onChange={() => setUnitScale(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50">
        단위 확정 후 분석 시작
      </button>
    </form>
  );
}
```

```tsx
// dashboard/app/scans/[id]/confirm-unit/page.tsx
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { UnitConfirmForm } from '@/components/unit-confirm-form';
import type { ScanRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ConfirmUnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: scan } = await supabase.from('scans').select('*').eq('id', id).maybeSingle();
  if (!scan) notFound();
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="mb-4 text-xl font-bold">단위 확인</h1>
      <UnitConfirmForm scan={scan as ScanRow} userId={user.id} />
    </main>
  );
}
```

```tsx
// dashboard/components/analysis-progress.tsx - Realtime 진행 상태 (스펙 §3.2.⑤)
'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useRowStatus } from '@/lib/hooks/use-row-status';
import { ANALYSIS_STATUS_LABEL } from '@/lib/domain/labels';
import type { AnalysisStatus } from '@/lib/domain/types';

export function AnalysisProgress({ analysisId, initialStatus }: {
  analysisId: string;
  initialStatus: AnalysisStatus;
}) {
  const router = useRouter();
  const status = useRowStatus('analyses', analysisId, initialStatus);

  useEffect(() => {
    if (status === 'done') router.refresh(); // 완료되면 서버 데이터(판정 배지 등) 갱신
  }, [status, router]);

  if (status === 'done') {
    return (
      <Link href={`/analyses/${analysisId}`}
        className="inline-block rounded bg-emerald-700 px-3 py-1.5 text-sm text-white">
        분석 완료 - 결과 보기
      </Link>
    );
  }
  if (status === 'failed') {
    return (
      <div className="rounded border border-red-300 bg-red-50 p-3 text-sm">
        <p className="font-medium text-red-700">분석에 실패했습니다.</p>
        <p className="mt-1 text-xs text-slate-600">
          지원 포맷(ply/las/laz/xyz/txt/csv/pts)·인코딩·단위 설정을 확인하세요. 상세 원인은
          워커 실행 창의 로그에 남습니다. 3회 자동 재시도 후에도 실패한 상태입니다.
        </p>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-sm text-slate-600">
      <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-600" />
      {ANALYSIS_STATUS_LABEL[status]}... (워커가 처리 중입니다. 이 화면은 자동 갱신됩니다)
    </p>
  );
}
```

```tsx
// dashboard/app/scans/[id]/page.tsx - 스캔 상세: 메타데이터 + 상태별 다음 행동
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnalysisProgress } from '@/components/analysis-progress';
import { GRADE_COLOR, GRADE_LABEL, LINEAGE_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import type { AnalysisRow, LocationRow, ScanRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: scan } = await supabase.from('scans').select('*').eq('id', id).maybeSingle();
  if (!scan) notFound();
  const s = scan as ScanRow;
  const [locRes, analysesRes] = await Promise.all([
    supabase.from('locations').select('*').eq('id', s.location_id).maybeSingle(),
    supabase.from('analyses').select('*').eq('scan_id', id).is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ]);
  const loc = locRes.data as LocationRow | null;
  const analyses = (analysesRes.data ?? []) as AnalysisRow[];
  const latest = analyses[0];
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <h1 className="text-xl font-bold">
        스캔 상세 · {SURFACE_LABEL[s.surface]} · {s.scanned_at}
      </h1>
      <dl className="grid max-w-xl grid-cols-2 gap-x-4 gap-y-1 rounded border bg-white p-4 text-sm">
        <dt className="text-slate-500">측정위치</dt>
        <dd>{loc ? [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ') : '-'}</dd>
        <dt className="text-slate-500">원본 파일</dt><dd>{s.original_filename ?? '-'}</dd>
        <dt className="text-slate-500">장비</dt><dd>{s.device ?? '-'}</dd>
        <dt className="text-slate-500">데이터 계보</dt><dd>{LINEAGE_LABEL[s.lineage]}</dd>
        <dt className="text-slate-500">상태</dt><dd>{SCAN_STATUS_LABEL[s.status]}</dd>
        <dt className="text-slate-500">단위 배율</dt><dd>{s.unit_scale ?? '미확정'}</dd>
      </dl>
      {s.status === 'awaiting_unit_confirm' && (
        <Link href={`/scans/${id}/confirm-unit`}
          className="inline-block rounded bg-blue-700 px-3 py-1.5 text-sm text-white">
          단위 확인하고 분석 시작
        </Link>
      )}
      {s.status === 'uploaded' && (
        <p className="text-sm text-slate-600">
          사전 검사 대기 중입니다. 워커가 실행 중인지 확인하세요(python -m flatworker).
          이 화면을 새로고침하면 상태가 갱신됩니다.
        </p>
      )}
      {latest && (
        <section className="space-y-2">
          <h2 className="font-semibold">분석</h2>
          <AnalysisProgress analysisId={latest.id} initialStatus={latest.status} />
          {analyses.length > 1 && (
            <ul className="text-sm text-slate-600">
              {analyses.slice(1).map((a) => (
                <li key={a.id}>
                  <Link href={`/analyses/${a.id}`} className="hover:underline">
                    이전 분석 {a.created_at.slice(0, 16).replace('T', ' ')}
                    {a.overall_verdict && (
                      <span className="ml-1 rounded px-1.5 text-xs text-white"
                        style={{ backgroundColor: GRADE_COLOR[a.overall_verdict] }}>
                        {GRADE_LABEL[a.overall_verdict]}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test`
Expected: PASS (전체). `npm run build` 성공 확인

- [ ] **Step 5: Commit**

```bash
git add dashboard
git commit -m "feat(dashboard): 업로드·단위 확인·Realtime 진행 상태·기존 결과 임포트"
```

---
### Task 6: 분석 결과 화면 (C안: 좌측 시각화 탭 + 우측 판정 패널 + 하단 결과표)

**Files:**
- Create: `dashboard/lib/viz/heatmap.ts`, `dashboard/components/analysis/heatmap-view.tsx`, `dashboard/components/analysis/verdict-panel.tsx`, `dashboard/components/analysis/result-table.tsx`, `dashboard/components/analysis/analysis-result.tsx`, `dashboard/app/analyses/[id]/page.tsx`
- Test: `dashboard/lib/viz/__tests__/heatmap.test.ts`, `dashboard/components/analysis/__tests__/verdict-panel.test.tsx`, `dashboard/components/analysis/__tests__/result-table.test.tsx`

**Interfaces:**
- Consumes: Task 2 전체(`Stats`·`CellRow`·`computeZoneStats`·`coverageLabel`·`isExternalImport`·`warningLabel`·`fmtMm`·`GRADE_*`·`ZONE_STATUS_LABEL`·`artifactUrl`), Task 3 `PhotoGallery`·`RefreshOnUpload`(Task 4), Task 5 `/scans/{id}` 링크
- Consumes(데이터): `analyses` 행(stats jsonb 포함 — 워커가 저장하므로 stats.json 재fetch 불필요), `cells.json`은 `artifactUrl(analysis.artifacts_dir, 'cells.json')`로 fetch, 3D는 `stats.preview3d_paths`의 파일명을 `artifactUrl`로 표시
- Produces:
  - `lib/viz/heatmap.ts`: `GridGeometry = {minIx, minIy, cols, rows}`, `gridGeometry(cells): GridGeometry | null`, `cellPxFor(geom, maxW, maxH): number`, `cellRect(geom, cell, cellPx): {x, y, w, h}`, `cellAt(geom, cells, cellPx, px, py): CellRow | null`, `drawHeatmap(ctx, cells, geom, cellPx): void`
  - `<VerdictPanel analysis={AnalysisRow} stats={Stats} />`(종합 판정·수치·기준·경고·종합의견 편집), `<ResultTable stats={Stats} cells={CellRow[]} />`, `<HeatmapView surface={Surface} cells={CellRow[]} walls={WallInfo[] | undefined} zones={ZoneInfo[]} />`, `<AnalysisResult analysis={AnalysisRow} scan={ScanRow} photos={PhotoRow[]} />`

**레이아웃(C안 확정)**: `lg` 이상에서 좌측 2/3(시각화 탭: 히트맵 / 3D 프리뷰 / 현장 사진) + 우측 1/3 고정 판정 패널(`sticky top-4`), 그 아래 전체 폭 결과표. 셀 클릭 시 히트맵 아래에 셀 상세(판정값·사용 스팬·점유율·최악 지점 좌표·구역) 표시. 벽면은 벽 선택 버튼(walls[]의 wall_id, 결번 허용)으로 벽별 히트맵 전환. 수평도(레벨) 섹션은 stats 계약에 지표가 없어 데모 제외(백로그).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// dashboard/lib/viz/__tests__/heatmap.test.ts
import { describe, expect, it } from 'vitest';
import { cellAt, cellPxFor, cellRect, gridGeometry } from '../heatmap';
import type { CellRow } from '@/lib/domain/types';

const cell = (ix: number, iy: number, over: Partial<CellRow> = {}): CellRow => ({
  ix, iy, center_x: ix + 0.5, center_y: iy + 0.5, value_mm: 1, span_used_m: 3,
  occupancy: 1, grade: 'pass', worst_x: null, worst_y: null, zone_id: 1, ...over,
});

describe('gridGeometry', () => {
  it('셀 인덱스 범위에서 격자 크기를 구한다(음수 인덱스 허용)', () => {
    const g = gridGeometry([cell(-1, 2), cell(3, 5)]);
    expect(g).toEqual({ minIx: -1, minIy: 2, cols: 5, rows: 4 });
  });
  it('빈 배열은 null', () => {
    expect(gridGeometry([])).toBeNull();
  });
});

describe('cellRect (iy는 위로 증가 -> 캔버스 y축 반전)', () => {
  it('최소 iy 셀이 캔버스 맨 아래 행에 온다', () => {
    const g = gridGeometry([cell(0, 0), cell(1, 2)])!; // rows=3
    expect(cellRect(g, cell(0, 0), 10)).toEqual({ x: 0, y: 20, w: 10, h: 10 });
    expect(cellRect(g, cell(1, 2), 10)).toEqual({ x: 10, y: 0, w: 10, h: 10 });
  });
});

describe('cellAt (클릭 좌표 -> 셀 역매핑, cellRect와 왕복 일치)', () => {
  it('셀 중앙 픽셀을 클릭하면 그 셀을 돌려준다', () => {
    const cells = [cell(0, 0), cell(1, 2)];
    const g = gridGeometry(cells)!;
    const r = cellRect(g, cells[1], 10);
    expect(cellAt(g, cells, 10, r.x + 5, r.y + 5)).toBe(cells[1]);
  });
  it('셀이 없는 자리(구멍)는 null', () => {
    const cells = [cell(0, 0), cell(1, 2)];
    const g = gridGeometry(cells)!;
    expect(cellAt(g, cells, 10, 15, 15)).toBeNull(); // (1,1) 자리는 비어 있음
  });
});

describe('cellPxFor', () => {
  it('격자가 최대 크기 안에 들어가는 정수 픽셀, 최소 4px', () => {
    const g = { minIx: 0, minIy: 0, cols: 10, rows: 5 };
    expect(cellPxFor(g, 600, 400)).toBe(60);
    expect(cellPxFor(g, 20, 400)).toBe(4); // 너무 작아도 최소 4
  });
});
```

```tsx
// dashboard/components/analysis/__tests__/verdict-panel.test.tsx
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
  deleted_at: null, created_at: '2026-07-28T00:00:00Z', created_by: null,
} as AnalysisRow;

describe('VerdictPanel (C안 우측 고정 패널)', () => {
  it('종합 판정 배지·핵심 수치·기준·경고·종합의견을 렌더한다', () => {
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    expect(screen.getByText('보수')).toBeInTheDocument();          // 종합 판정
    expect(screen.getByText('12.34')).toBeInTheDocument();          // 최대 편차
    expect(screen.getByText(/바닥 인식률/)).toBeInTheDocument();    // coverage 라벨 분기
    expect(screen.getByText(/88.5/)).toBeInTheDocument();
    expect(screen.getByText('floor-kcs-exposed')).toBeInTheDocument();
    expect(screen.getByText(/70% 미만/)).toBeInTheDocument();       // warning 한국어
    expect(screen.getByText(/축소 스팬 적용 셀 6/)).toBeInTheDocument();
    expect(screen.getByText(/스크리닝/)).toBeInTheDocument();       // auto_summary
    expect(screen.getByLabelText('종합의견(사용자 수정)')).toBeInTheDocument();
  });
  it('임포트 결과면 외부 결과 배지를 보여준다', () => {
    const imp = {
      ...analysis, engine_version: 'external-colab-v1',
      stats: { ...stats, meta: { ...stats.meta, source: 'colab-import' } },
    } as AnalysisRow;
    render(<VerdictPanel analysis={imp} stats={imp.stats!} />);
    expect(screen.getByText('외부 결과')).toBeInTheDocument();
  });
});
```

```tsx
// dashboard/components/analysis/__tests__/result-table.test.tsx
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

describe('ResultTable (하단 구간별 결과표 - 스펙 §5.1.7 필드와 동일 컬럼)', () => {
  it('floor: 구역별 행에 레벨·면적·상태·집계를 렌더한다', () => {
    const stats: Stats = {
      ...base,
      zones: [{ zone_id: 1, level_m: 0.002, area_m2: 12.5, status: 'ok', plane_abc: [0, 0, 0] }],
      meta: { file: 'f', n_points: 1, surface: 'floor' },
    };
    render(<ResultTable stats={stats} cells={[cell(1, 10, 'repair'), cell(1, 1, 'pass')]} />);
    expect(screen.getByText('구역 1')).toBeInTheDocument();
    expect(screen.getByText('정상')).toBeInTheDocument();
    expect(screen.getByText('12.5')).toBeInTheDocument();  // 면적
    expect(screen.getByText('10.00')).toBeInTheDocument(); // 최대
    expect(screen.getByText(/1 \(50%\)/)).toBeInTheDocument(); // 보수 이상 셀(비율)
  });
  it('wall: 벽별 행에 수직도·수직도 등급을 렌더한다', () => {
    const stats: Stats = {
      ...base, zones: [],
      walls: [{
        wall_id: 1, n_cells: 2, height_m: 2.4, length_m: 5.1, plumbness_mm: 8.5,
        plumb_grade: 'pass',
        plane_abc: [0, 0, 0],
        frame: { p0: [0, 0], direction: [1, 0], normal: [0, 1], u_min: 0, u_max: 5.1, z_min: 0, z_max: 2.4 },
      }],
      meta: { file: 'f', n_points: 1, surface: 'wall' },
    };
    render(<ResultTable stats={stats} cells={[cell(1, 3, 'pass'), cell(1, 5, 'pass')]} />);
    expect(screen.getByText('벽 1')).toBeInTheDocument();
    expect(screen.getByText('8.50')).toBeInTheDocument(); // 수직도 mm
    expect(screen.getAllByText('적합').length).toBeGreaterThan(0); // plumb_grade
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// dashboard/lib/viz/heatmap.ts - cells.json을 판정 5색으로 Canvas 렌더 (외부 라이브러리 금지)
import { GRADE_COLOR } from '@/lib/domain/labels';
import type { CellRow } from '@/lib/domain/types';

export interface GridGeometry { minIx: number; minIy: number; cols: number; rows: number; }

export function gridGeometry(cells: CellRow[]): GridGeometry | null {
  if (cells.length === 0) return null;
  let minIx = Infinity, maxIx = -Infinity, minIy = Infinity, maxIy = -Infinity;
  for (const c of cells) {
    if (c.ix < minIx) minIx = c.ix;
    if (c.ix > maxIx) maxIx = c.ix;
    if (c.iy < minIy) minIy = c.iy;
    if (c.iy > maxIy) maxIy = c.iy;
  }
  return { minIx, minIy, cols: maxIx - minIx + 1, rows: maxIy - minIy + 1 };
}

export function cellPxFor(geom: GridGeometry, maxW: number, maxH: number): number {
  return Math.max(4, Math.floor(Math.min(maxW / geom.cols, maxH / geom.rows)));
}

// iy는 실좌표에서 위로 증가하므로 캔버스(아래로 증가)에서는 행을 뒤집는다
export function cellRect(geom: GridGeometry, cell: CellRow, cellPx: number) {
  return {
    x: (cell.ix - geom.minIx) * cellPx,
    y: (geom.rows - 1 - (cell.iy - geom.minIy)) * cellPx,
    w: cellPx,
    h: cellPx,
  };
}

export function cellAt(
  geom: GridGeometry, cells: CellRow[], cellPx: number, px: number, py: number,
): CellRow | null {
  const ix = Math.floor(px / cellPx) + geom.minIx;
  const iy = geom.rows - 1 - Math.floor(py / cellPx) + geom.minIy;
  return cells.find((c) => c.ix === ix && c.iy === iy) ?? null;
}

export function drawHeatmap(
  ctx: CanvasRenderingContext2D, cells: CellRow[], geom: GridGeometry, cellPx: number,
): void {
  ctx.clearRect(0, 0, geom.cols * cellPx, geom.rows * cellPx);
  for (const c of cells) {
    const r = cellRect(geom, c, cellPx);
    ctx.fillStyle = GRADE_COLOR[c.grade];
    ctx.fillRect(r.x, r.y, Math.max(1, r.w - 1), Math.max(1, r.h - 1)); // 1px 셀 경계
  }
}
```

```tsx
// dashboard/components/analysis/heatmap-view.tsx - 히트맵 탭(셀 클릭 상세 포함)
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cellAt, cellPxFor, drawHeatmap, gridGeometry } from '@/lib/viz/heatmap';
import { GRADE_COLOR, GRADE_LABEL, ZONE_STATUS_LABEL, fmtMm } from '@/lib/domain/labels';
import type { CellRow, Grade, Stats, Surface, WallInfo } from '@/lib/domain/types';

const LEGEND: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];

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
    const rect = e.currentTarget.getBoundingClientRect();
    setSelected(cellAt(geom, shown, cellPx, e.clientX - rect.left, e.clientY - rect.top));
  }

  const zoneOf = (zoneId: number | null) => zones.find((z) => z.zone_id === zoneId);

  return (
    <div className="space-y-3">
      {surface === 'wall' && (walls?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {walls!.map((w) => (
            <button key={w.wall_id} onClick={() => { setWallId(w.wall_id); setSelected(null); }}
              className={`rounded border px-3 py-1 ${wallId === w.wall_id ? 'bg-slate-800 text-white' : 'bg-white'}`}>
              벽 {w.wall_id} ({w.length_m}m x {w.height_m}m)
            </button>
          ))}
        </div>
      )}
      {geom ? (
        <canvas ref={canvasRef} onClick={onClick} className="max-w-full cursor-crosshair rounded border bg-white" />
      ) : (
        <p className="text-sm text-slate-500">표시할 셀 데이터가 없습니다.</p>
      )}
      <div className="flex flex-wrap gap-3 text-xs">
        {LEGEND.map((g) => (
          <span key={g} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: GRADE_COLOR[g] }} />
            {GRADE_LABEL[g]}
          </span>
        ))}
      </div>
      {selected && (
        <dl className="grid max-w-md grid-cols-2 gap-x-4 gap-y-1 rounded border bg-white p-3 text-sm">
          <dt className="text-slate-500">판정</dt>
          <dd>
            <span className="rounded px-1.5 text-xs text-white"
              style={{ backgroundColor: GRADE_COLOR[selected.grade] }}>
              {GRADE_LABEL[selected.grade]}
            </span>
          </dd>
          <dt className="text-slate-500">직선자 값</dt><dd>{fmtMm(selected.value_mm)} mm</dd>
          <dt className="text-slate-500">사용 스팬</dt><dd>{selected.span_used_m} m</dd>
          <dt className="text-slate-500">셀 점유율</dt><dd>{Math.round(selected.occupancy * 100)}%</dd>
          <dt className="text-slate-500">최악 지점</dt>
          <dd>{selected.worst_x !== null ? `(${selected.worst_x}, ${selected.worst_y})` : '-'}</dd>
          <dt className="text-slate-500">{surface === 'wall' ? '벽' : '구역'}</dt>
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

```tsx
// dashboard/components/analysis/verdict-panel.tsx - C안 우측 고정 판정 패널
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { GRADE_COLOR, GRADE_LABEL, fmtMm, warningLabel } from '@/lib/domain/labels';
import { coverageLabel, isExternalImport } from '@/lib/domain/stats';
import type { AnalysisRow, Grade, Stats } from '@/lib/domain/types';

const BAR_ORDER: Grade[] = ['pass', 'borderline', 'repair', 'rework', 'na'];

export function VerdictPanel({ analysis, stats }: { analysis: AnalysisRow; stats: Stats }) {
  const [summary, setSummary] = useState(analysis.user_summary ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const external = isExternalImport(analysis.engine_version, stats.meta);

  async function saveSummary() {
    const { error } = await createClient().from('analyses')
      .update({ user_summary: summary || null }).eq('id', analysis.id);
    setSaved(error ? `저장 실패: ${error.message}` : '저장되었습니다');
  }

  return (
    <aside className="space-y-4 rounded-lg border bg-white p-4">
      <div className="flex items-center gap-2">
        {analysis.overall_verdict ? (
          <span className="rounded px-3 py-1 text-lg font-bold text-white"
            style={{ backgroundColor: GRADE_COLOR[analysis.overall_verdict] }}>
            {GRADE_LABEL[analysis.overall_verdict]}
          </span>
        ) : (
          <span className="rounded bg-slate-400 px-3 py-1 text-lg font-bold text-white">판정 없음</span>
        )}
        {external && (
          <span className="rounded border border-purple-400 px-2 py-0.5 text-xs text-purple-700">외부 결과</span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">최대 편차(mm)</dt><dd className="font-medium">{fmtMm(stats.value_max_mm)}</dd>
        <dt className="text-slate-500">최소(mm)</dt><dd>{fmtMm(stats.value_min_mm)}</dd>
        <dt className="text-slate-500">평균(mm)</dt><dd>{fmtMm(stats.value_mean_mm)}</dd>
        <dt className="text-slate-500">95퍼센타일(mm)</dt><dd>{fmtMm(stats.value_p95_mm)}</dd>
        <dt className="text-slate-500">판정 셀(유효/전체)</dt><dd>{stats.n_valid} / {stats.n_cells}</dd>
        <dt className="text-slate-500">{coverageLabel(stats)}</dt><dd>{stats.coverage_pct}%</dd>
      </dl>
      {stats.reduced_span_cells > 0 && (
        <p className="text-xs text-slate-600">축소 스팬 적용 셀 {stats.reduced_span_cells}개 (허용치 선형 환산)</p>
      )}

      <div>
        <h3 className="text-sm font-semibold">등급 분포</h3>
        <div className="mt-1 flex h-3 overflow-hidden rounded">
          {BAR_ORDER.map((g) => (
            <div key={g} style={{
              backgroundColor: GRADE_COLOR[g],
              width: `${stats.n_cells ? (stats.grade_counts[g] / stats.n_cells) * 100 : 0}%`,
            }} />
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-600">
          {BAR_ORDER.map((g) => `${GRADE_LABEL[g]} ${stats.grade_counts[g]}`).join(' · ')}
        </p>
      </div>

      <div>
        <h3 className="text-sm font-semibold">적용 기준</h3>
        <p className="text-sm">{stats.applied_criteria.name}</p>
        <p className="text-xs text-slate-500">{stats.applied_criteria.source}</p>
        <p className="text-xs text-slate-600">
          {stats.applied_criteria.span_m !== null
            ? `${stats.applied_criteria.span_m}m당 허용 ${stats.applied_criteria.pass_mm}mm / 재시공 ${stats.applied_criteria.rework_mm}mm`
            : `수직도 허용 ${stats.applied_criteria.pass_mm}mm / 재시공 ${stats.applied_criteria.rework_mm}mm`}
          {' · '}불확도 U={stats.applied_criteria.u_mm}mm
        </p>
      </div>

      {stats.warnings.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">경고</h3>
          <ul className="mt-1 space-y-1">
            {stats.warnings.map((w) => (
              <li key={w} className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">
                {warningLabel(w)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">종합의견</h3>
        <p className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700">
          {analysis.auto_summary ?? stats.auto_summary}
        </p>
        <label htmlFor="user-summary" className="mt-2 block text-xs font-medium">종합의견(사용자 수정)</label>
        <textarea id="user-summary" rows={4} value={summary}
          onChange={(e) => setSummary(e.target.value)}
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
          placeholder="자동 의견에 덧붙일 해석·조치 계획을 적습니다. 보고서(P4)에 함께 실립니다." />
        <div className="mt-1 flex items-center gap-2">
          <button onClick={saveSummary} className="rounded bg-slate-800 px-3 py-1 text-sm text-white">저장</button>
          {saved && <span className="text-xs text-slate-500">{saved}</span>}
        </div>
      </div>
    </aside>
  );
}
```

```tsx
// dashboard/components/analysis/result-table.tsx - 하단 구간별 결과표
// 구역(벽)별 max/min/mean·보수 이상 셀은 cells.json에서 재집계(computeZoneStats)
import { computeZoneStats } from '@/lib/domain/cells';
import { GRADE_COLOR, GRADE_LABEL, ZONE_STATUS_LABEL, fmtMm } from '@/lib/domain/labels';
import type { CellRow, Stats } from '@/lib/domain/types';

export function ResultTable({ stats, cells }: { stats: Stats; cells: CellRow[] }) {
  const zoneStats = computeZoneStats(cells);
  const isWall = stats.meta.surface === 'wall';
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-100 text-left text-xs text-slate-600">
          <tr>
            <th className="p-2">{isWall ? '벽' : '구역'}</th>
            {!isWall && <th className="p-2">상태</th>}
            {!isWall && <th className="p-2">레벨(m)</th>}
            {!isWall && <th className="p-2">면적(m²)</th>}
            {isWall && <th className="p-2">크기(m)</th>}
            {isWall && <th className="p-2">수직도(mm)</th>}
            {isWall && <th className="p-2">수직도 판정</th>}
            <th className="p-2">셀(유효/전체)</th>
            <th className="p-2">최대(mm)</th>
            <th className="p-2">최소(mm)</th>
            <th className="p-2">평균(mm)</th>
            <th className="p-2">보수 이상 셀(비율)</th>
          </tr>
        </thead>
        <tbody>
          {zoneStats.map((z) => {
            const zone = stats.zones.find((zi) => zi.zone_id === z.zone_id);
            const wall = stats.walls?.find((w) => w.wall_id === z.zone_id);
            return (
              <tr key={String(z.zone_id)} className="border-t">
                <td className="p-2 font-medium">
                  {z.zone_id === null ? '전체' : isWall ? `벽 ${z.zone_id}` : `구역 ${z.zone_id}`}
                </td>
                {!isWall && <td className="p-2">{zone ? ZONE_STATUS_LABEL[zone.status] : '-'}</td>}
                {!isWall && <td className="p-2">{zone ? zone.level_m : '-'}</td>}
                {!isWall && <td className="p-2">{zone ? zone.area_m2 : '-'}</td>}
                {isWall && <td className="p-2">{wall ? `${wall.length_m} x ${wall.height_m}` : '-'}</td>}
                {isWall && <td className="p-2">{wall ? fmtMm(wall.plumbness_mm) : '-'}</td>}
                {isWall && (
                  <td className="p-2">
                    {wall && (
                      <span className="rounded px-1.5 text-xs text-white"
                        style={{ backgroundColor: GRADE_COLOR[wall.plumb_grade] }}>
                        {GRADE_LABEL[wall.plumb_grade]}
                      </span>
                    )}
                  </td>
                )}
                <td className="p-2">{z.n_valid} / {z.n_cells}</td>
                <td className="p-2">{fmtMm(z.max_mm)}</td>
                <td className="p-2">{fmtMm(z.min_mm)}</td>
                <td className="p-2">{fmtMm(z.mean_mm)}</td>
                <td className="p-2">{z.over_cells} ({z.over_pct}%)</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

```tsx
// dashboard/components/analysis/analysis-result.tsx - C안 전체 골격
'use client';
import { useEffect, useState } from 'react';
import { artifactUrl } from '@/lib/domain/paths';
import type { AnalysisRow, CellRow, PhotoRow, ScanRow, Stats } from '@/lib/domain/types';
import { HeatmapView } from './heatmap-view';
import { VerdictPanel } from './verdict-panel';
import { ResultTable } from './result-table';
import { PhotoGallery } from '@/components/photo-gallery';
import { RefreshOnUpload } from '@/components/refresh-on-upload';

type Tab = 'heatmap' | 'preview3d' | 'photos';

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
    if (!analysis.artifacts_dir) { setCellsError('산출물 경로가 없습니다'); return; }
    let cancelled = false;
    (async () => {
      const res = await fetch(artifactUrl(analysis.artifacts_dir!, 'cells.json'));
      if (!res.ok) {
        if (!cancelled) setCellsError('셀 데이터를 불러오지 못했습니다. 워커 PC의 data/ 디렉터리와 DATA_DIR 설정을 확인하세요.');
        return;
      }
      const data = (await res.json()) as CellRow[];
      if (!cancelled) setCells(data);
    })();
    return () => { cancelled = true; };
  }, [analysis.artifacts_dir]);

  const preview3d = (stats.preview3d_paths ?? []).filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="mb-2 flex gap-2 text-sm">
            {([['heatmap', '히트맵'], ['preview3d', '3D 프리뷰'], ['photos', '현장 사진']] as const)
              .map(([key, label]) => (
                <button key={key} onClick={() => setTab(key)}
                  className={`rounded border px-3 py-1 ${tab === key ? 'bg-slate-800 text-white' : 'bg-white'}`}>
                  {label}
                </button>
              ))}
          </div>
          {tab === 'heatmap' && (
            cells ? (
              <HeatmapView surface={analysis.surface} cells={cells} walls={stats.walls} zones={stats.zones} />
            ) : (
              <p className="text-sm text-slate-500">{cellsError ?? '셀 데이터 로딩 중...'}</p>
            )
          )}
          {tab === 'preview3d' && (
            preview3d.length > 0 ? (
              <div className="space-y-3">
                {preview3d.map((name) => (
                  // 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={name} src={artifactUrl(analysis.artifacts_dir!, name)} alt={`3D 프리뷰 ${name}`}
                    className="max-w-full rounded border bg-white" />
                ))}
                <p className="text-xs text-slate-500">
                  워커가 생성한 정적 3D 프리뷰입니다(회전·줌 가능한 뷰어는 정식 단계 백로그).
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                3D 프리뷰가 없습니다{analysis.surface === 'wall' ? ' (벽면 분석은 3D 프리뷰를 생성하지 않습니다)' : ''}.
              </p>
            )
          )}
          {tab === 'photos' && (
            <div className="space-y-2">
              <RefreshOnUpload target={{ scan_id: scan.id }} />
              <PhotoGallery photos={photos} />
            </div>
          )}
        </section>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <VerdictPanel analysis={analysis} stats={stats} />
        </div>
      </div>
      <section>
        <h2 className="mb-2 font-semibold">구간별 결과표</h2>
        {cells ? <ResultTable stats={stats} cells={cells} /> :
          <p className="text-sm text-slate-500">{cellsError ?? '셀 데이터 로딩 중...'}</p>}
      </section>
    </div>
  );
}
```

```tsx
// dashboard/app/analyses/[id]/page.tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AnalysisResult } from '@/components/analysis/analysis-result';
import { ANALYSIS_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import type { AnalysisRow, LocationRow, PhotoRow, ScanRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: analysis } = await supabase.from('analyses').select('*').eq('id', id).maybeSingle();
  if (!analysis) notFound();
  const a = analysis as AnalysisRow;
  const { data: scan } = await supabase.from('scans').select('*').eq('id', a.scan_id).maybeSingle();
  if (!scan) notFound();
  const s = scan as ScanRow;
  const [locRes, photosRes] = await Promise.all([
    supabase.from('locations').select('*').eq('id', s.location_id).maybeSingle(),
    supabase.from('photos').select('*').eq('scan_id', s.id).order('created_at', { ascending: false }),
  ]);
  const loc = locRes.data as LocationRow | null;

  if (a.status !== 'done' || !a.stats) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <p className="text-sm text-slate-600">
          이 분석은 아직 완료되지 않았습니다 (상태: {ANALYSIS_STATUS_LABEL[a.status]}).{' '}
          <Link href={`/scans/${s.id}`} className="text-blue-700 hover:underline">스캔 상세에서 진행 상태 보기</Link>
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-bold">
          분석 결과 · {SURFACE_LABEL[a.surface]} · {s.scanned_at}
        </h1>
        <p className="text-sm text-slate-500">
          {loc ? [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ') : ''}
          {' · '}엔진 {a.engine_version ?? '-'}
          {' · '}<Link href={`/scans/${s.id}`} className="text-blue-700 hover:underline">스캔 상세</Link>
        </p>
      </div>
      <AnalysisResult analysis={a} scan={s} photos={(photosRes.data ?? []) as PhotoRow[]} />
    </main>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test`
Expected: PASS (전체). `npm run build` 성공 확인

- [ ] **Step 5: Commit**

```bash
git add dashboard
git commit -m "feat(dashboard): 분석 결과 화면 C안(히트맵 캔버스·판정 패널·결과표·3D 프리뷰·사진)"
```

---

### Task 7: 설정 화면 (기준 목록·활성 토글, 측정 불확도 U, 프로필)

**Files:**
- Create: `dashboard/lib/domain/criteria.ts`, `dashboard/components/settings/criteria-list.tsx`, `dashboard/components/settings/profile-form.tsx`, `dashboard/components/settings/uncertainty-form.tsx`, `dashboard/app/settings/page.tsx`
- Test: `dashboard/lib/domain/__tests__/criteria.test.ts`, `dashboard/components/settings/__tests__/criteria-list.test.tsx`

**Interfaces:**
- Consumes: Task 2 `CriteriaRow`·`Threshold`·`SURFACE_LABEL`, Task 1 `createClient`·`ensureProfile`
- Consumes(DB): `criteria` select/update(is_active — RLS: 전역 행은 admin만, 현장 행은 전원), `app_settings` key `uncertainty_mm`(value `{"floor": 5.0, "wall": 8.0}` — 002 시드. 수정은 admin만), `profiles` update(display_name만 grant됨)
- Produces:
  - `thresholdSummary(t: Threshold): string` — 예: `3m당 허용 7mm / 재시공 21mm`, plumbness는 `수직도 허용 25mm / 재시공 75mm`
  - `groupCriteria(rows: CriteriaRow[]): {global: CriteriaRow[]; bySite: Map<string, CriteriaRow[]>}`

**YAGNI 확정**: 기준 생성·버전 개정·현장별 재정의 생성 UI는 만들지 않는다(SQL Editor 안내 문구로 대체). is_default 변경 UI도 만들지 않는다(표시만). U 수정 폼은 두되 admin이 아니면 RLS 거부 메시지를 안내한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// dashboard/lib/domain/__tests__/criteria.test.ts
import { describe, expect, it } from 'vitest';
import { groupCriteria, thresholdSummary } from '../criteria';
import type { CriteriaRow } from '../types';

const crit = (over: Partial<CriteriaRow>): CriteriaRow => ({
  id: 'c', site_id: null, surface: 'floor', name: 'n', source_text: 's',
  thresholds: [{ span_m: 3, metric: 'flatness', pass_mm: 7, rework_mm: 21 }],
  is_default: false, is_active: true, version: 1, supersedes_id: null, created_at: '', ...over,
});

describe('thresholdSummary', () => {
  it('flatness: 스팬당 허용/재시공', () => {
    expect(thresholdSummary({ span_m: 3, metric: 'flatness', pass_mm: 7, rework_mm: 21 }))
      .toBe('3m당 허용 7mm / 재시공 21mm');
  });
  it('plumbness(span null): 수직도 표기', () => {
    expect(thresholdSummary({ span_m: null, metric: 'plumbness', pass_mm: 25, rework_mm: 75 }))
      .toBe('수직도 허용 25mm / 재시공 75mm');
  });
});

describe('groupCriteria (전역/현장 분리)', () => {
  it('site_id null은 global, 나머지는 site별 Map', () => {
    const rows = [crit({ id: 'g1' }), crit({ id: 's1a', site_id: 's1' }), crit({ id: 's1b', site_id: 's1' })];
    const g = groupCriteria(rows);
    expect(g.global.map((c) => c.id)).toEqual(['g1']);
    expect(g.bySite.get('s1')!.map((c) => c.id)).toEqual(['s1a', 's1b']);
  });
});
```

```tsx
// dashboard/components/settings/__tests__/criteria-list.test.tsx
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
```

- [ ] **Step 2: 실패 확인**

Run: `npm run test`
Expected: FAIL

- [ ] **Step 3: 구현**

```ts
// dashboard/lib/domain/criteria.ts
import type { CriteriaRow, Threshold } from './types';

export function thresholdSummary(t: Threshold): string {
  if (t.metric === 'plumbness' || t.span_m === null) {
    return `수직도 허용 ${t.pass_mm}mm / 재시공 ${t.rework_mm}mm`;
  }
  return `${t.span_m}m당 허용 ${t.pass_mm}mm / 재시공 ${t.rework_mm}mm`;
}

export function groupCriteria(rows: CriteriaRow[]): {
  global: CriteriaRow[];
  bySite: Map<string, CriteriaRow[]>;
} {
  const global: CriteriaRow[] = [];
  const bySite = new Map<string, CriteriaRow[]>();
  for (const r of rows) {
    if (r.site_id === null) { global.push(r); continue; }
    const arr = bySite.get(r.site_id) ?? [];
    arr.push(r);
    bySite.set(r.site_id, arr);
  }
  return { global, bySite };
}
```

```tsx
// dashboard/components/settings/criteria-list.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { groupCriteria, thresholdSummary } from '@/lib/domain/criteria';
import { SURFACE_LABEL } from '@/lib/domain/labels';
import type { CriteriaRow } from '@/lib/domain/types';

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
    <li className="flex items-start justify-between gap-3 border-t p-2 first:border-t-0">
      <div>
        <p className="text-sm font-medium">
          {c.name}
          {c.is_default && <span className="ml-2 rounded bg-blue-100 px-1.5 text-xs text-blue-800">기본</span>}
          <span className="ml-2 text-xs text-slate-500">{SURFACE_LABEL[c.surface]} · v{c.version}</span>
        </p>
        <p className="text-xs text-slate-500">{c.source_text}</p>
        <p className="text-xs text-slate-600">{c.thresholds.map(thresholdSummary).join(' · ')}</p>
      </div>
      <label className="flex shrink-0 items-center gap-1 text-xs">
        <input type="checkbox" checked={active} onChange={toggle} aria-label={`${c.name} 활성`} />
        활성
      </label>
    </li>
  );
}

export function CriteriaList({ criteria, siteNames }: {
  criteria: CriteriaRow[];
  siteNames: Map<string, string>;
}) {
  const [error, setError] = useState<string | null>(null);
  const { global, bySite } = groupCriteria(criteria);
  return (
    <div className="space-y-4">
      {error && <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <section>
        <h3 className="mb-1 text-sm font-semibold">전역 기본 기준</h3>
        <ul className="rounded border bg-white">
          {global.map((c) => <Row key={c.id} c={c} onError={setError} />)}
        </ul>
      </section>
      {[...bySite.entries()].map(([siteId, rows]) => (
        <section key={siteId}>
          <h3 className="mb-1 text-sm font-semibold">현장 기준: {siteNames.get(siteId) ?? siteId}</h3>
          <ul className="rounded border bg-white">
            {rows.map((c) => <Row key={c.id} c={c} onError={setError} />)}
          </ul>
        </section>
      ))}
      <p className="text-xs text-slate-500">
        기준 신설·버전 개정·현장별 재정의 추가는 데모 범위 밖입니다. Supabase SQL Editor에서
        criteria 테이블에 직접 추가하세요(부분 유니크 제약: 활성 행 기준 (surface, name) 유일).
      </p>
    </div>
  );
}
```

```tsx
// dashboard/components/settings/profile-form.tsx
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function ProfileForm({ userId, initialName }: { userId: string; initialName: string }) {
  const [name, setName] = useState(initialName);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    // grant: authenticated는 display_name 컬럼만 update 가능 (001)
    const { error } = await createClient().from('profiles')
      .update({ display_name: name.trim() }).eq('id', userId);
    setMsg(error ? `저장 실패: ${error.message}` : '저장되었습니다');
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2">
      <div>
        <label htmlFor="display-name" className="block text-sm font-medium">표시 이름</label>
        <input id="display-name" required value={name} onChange={(e) => setName(e.target.value)}
          className="mt-1 rounded border px-3 py-2" />
      </div>
      <button type="submit" className="rounded bg-slate-800 px-3 py-2 text-sm text-white">저장</button>
      {msg && <span className="pb-2 text-xs text-slate-500">{msg}</span>}
    </form>
  );
}
```

```tsx
// dashboard/components/settings/uncertainty-form.tsx - U 값 (스펙 §4.2: app_settings,
// 분석 시점에 스냅샷되므로 수정해도 과거 분석은 불변. 수정 권한은 admin RLS)
'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

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
    // RLS 무음 거부 주의(criteria와 동일): 0행 갱신을 실패로 판정
    const { data, error } = await createClient().from('app_settings')
      .update({ value }).eq('key', 'uncertainty_mm').select('key');
    setMsg(error || !data || data.length === 0
      ? '수정에 실패했습니다. 측정 불확도는 관리자만 수정할 수 있습니다.'
      : '저장되었습니다 (이후 분석부터 적용)');
  }

  return (
    <form onSubmit={onSubmit} className="flex items-end gap-2 text-sm">
      <div>
        <label htmlFor="u-floor" className="block font-medium">바닥 U(mm)</label>
        <input id="u-floor" value={floor} onChange={(e) => setFloor(e.target.value)}
          className="mt-1 w-24 rounded border px-2 py-1" />
      </div>
      <div>
        <label htmlFor="u-wall" className="block font-medium">벽면 U(mm)</label>
        <input id="u-wall" value={wall} onChange={(e) => setWall(e.target.value)}
          className="mt-1 w-24 rounded border px-2 py-1" />
      </div>
      <button type="submit" className="rounded bg-slate-800 px-3 py-1.5 text-white">저장</button>
      {msg && <span className="pb-1.5 text-xs text-slate-500">{msg}</span>}
    </form>
  );
}
```

```tsx
// dashboard/app/settings/page.tsx - 스펙 §7.7
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ensureProfile } from '@/lib/auth/ensure-profile';
import { CriteriaList } from '@/components/settings/criteria-list';
import { ProfileForm } from '@/components/settings/profile-form';
import { UncertaintyForm } from '@/components/settings/uncertainty-form';
import type { CriteriaRow } from '@/lib/domain/types';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
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
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <h1 className="text-xl font-bold">설정</h1>
      <section>
        <h2 className="mb-2 font-semibold">프로필</h2>
        <ProfileForm userId={user.id} initialName={profile.display_name} />
      </section>
      <section>
        <h2 className="mb-2 font-semibold">측정 불확도 U</h2>
        <p className="mb-2 text-xs text-slate-500">
          판정식의 경계 구간 폭을 결정합니다. 분석 시점 값이 결과에 스냅샷되므로 수정해도
          과거 분석·보고서는 바뀌지 않습니다. P5 반복 스캔 재현성 시험 후 갱신 예정.
        </p>
        <UncertaintyForm initial={u} />
      </section>
      <section>
        <h2 className="mb-2 font-semibold">판정 기준</h2>
        <CriteriaList criteria={(criteriaRes.data ?? []) as CriteriaRow[]} siteNames={siteNames} />
      </section>
    </main>
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm run test`
Expected: PASS (전체). `npm run build` 성공 확인

- [ ] **Step 5: Commit**

```bash
git add dashboard
git commit -m "feat(dashboard): 설정 화면(기준 목록·활성 토글, 측정 불확도, 프로필)"
```

---

### Task 8: 통합 검증 · 실행 문서 · 마무리

**Files:**
- Create: `dashboard/README.md`
- Modify: 없음(검증 결과에 따른 수정만)

- [ ] **Step 1: README 작성**

`dashboard/README.md`에 다음 내용을 전부 포함:

1. **개요**: 무엇인지 한 단락(스크리닝 도구 포지셔닝 포함: 공식 검측 대체 아님)
2. **사전 준비**: Supabase 프로젝트 + 마이그레이션 001/002/003 실행(`docs/SUPABASE_SETUP.md` 링크), 테스트 계정 생성 방법(Supabase 대시보드 > Authentication > Add user > 이메일/비밀번호, Auto Confirm 체크), 워커 실행(`worker/README.md` 링크)
3. **환경변수**: `.env.example` 복사·항목 설명(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, DATA_DIR — 워커 DATA_DIR과 동일 디렉터리 필수)
4. **실행**: `npm install`, `npm run dev`(http://localhost:3000), `npm run test`, `npm run build`
5. **데모 시나리오**(수동 검증 절차 그대로): 로그인 -> 새 현장 -> 측정위치 추가 -> 스캔 업로드(합성 PLY 생성 명령 포함, 아래) -> 단위 확인(m 선택) -> 분석 진행 표시 -> 결과 화면(히트맵 셀 클릭, 판정 패널, 결과표) -> 사진 업로드 -> 설정 확인
6. **합성 테스트 파일 생성**(엔진 픽스처 재사용, 저장소 루트에서):

```bash
python -c "import importlib.util, pathlib; p = pathlib.Path('engine/tests/fixtures/synthetic.py'); spec = importlib.util.spec_from_file_location('syn', p); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); pts = m.add_bump(m.flat_floor(size=(6.0, 6.0), spacing=0.02), (2.0, 2.0), 0.3, -0.010); m.write_binary_ply(pts, pathlib.Path('demo_floor.ply')); print('demo_floor.ply 생성(6x6m, 함몰 10mm)')"
```

7. **알려진 데모 제약**: 인터랙티브 3D·수평도 섹션·기준 CRUD·보고서(P4)·E2E는 백로그, 분석 실패 상세 사유는 워커 로그 확인

- [ ] **Step 2: 전체 스위트·빌드·린트 실행**

Run (dashboard/): `npm run test`
Expected: 전 태스크 테스트 PASS (개수와 함께 출력 기록)

Run: `npm run build`
Expected: 성공

Run: `npm run lint`
Expected: 오류 0 (경고는 기록만)

- [ ] **Step 3: UI 문자열 U+2014 금지 확인**

Run (Git Bash, dashboard/): `grep -rn $'—' app components lib || echo "U+2014 없음"`
Expected: `U+2014 없음` (검출되면 해당 문자열을 하이픈이나 가운뎃점으로 수정)

- [ ] **Step 4: 실 연동 수동 검증 (사용자 자격증명 필요 — 가능한 경우에만)**

`.env.local`이 준비되어 있으면 README 5번 데모 시나리오를 브라우저에서 실제 수행하고
각 단계 화면 캡처로 대조한다(사용자 상시 지시: 검증 시 화면 캡처 대조 포함). 자격증명이
없으면 이 단계는 "사용자 셋업 후 수행"으로 보고서에 명시하고 넘어간다 — 완료 주장 금지.

체크리스트(캡처 대상): 로그인 성공 / 현장 카드 요약 / 위치 트리 / 업로드 폼 기준 후보
(is_default 기본 선택) / 단위 확인 / 진행 상태 자동 갱신(워커 실행 상태에서) / 결과 화면
C안 3분할 / 히트맵 셀 클릭 상세 / 사진 업로드·표시 / 설정 3섹션

중복 엔큐 409 처리 참고: UI 흐름은 매번 새 scan/analysis id로 잡을 등록하므로 정상
사용에서는 409가 나기 어렵다(방어 코드). UI 매핑은 jobs.test.ts의 23505 단위 테스트로
검증하고, DB 레벨은 SQL Editor에서 동일 payload로 `fn_enqueue_job`을 2회 실행해 두 번째가
duplicate key 오류를 내는지로 확인한다(선택).

- [ ] **Step 5: Commit**

```bash
git add dashboard/README.md
git commit -m "docs(dashboard): 실행 가이드·데모 시나리오·검증 체크리스트"
```

---

## 태스크 간 의존성 요약

- Task 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 순차 실행이 기본(각 태스크가 앞 태스크의 인터페이스를 소비)
- Task 4와 Task 5는 Task 3까지 완료되면 이론상 병렬 가능하지만, Task 4가 만드는 `/scans/{id}` 링크 대상 페이지를 Task 5가 만들므로 순차를 권장
- 마이그레이션 003(Task 3)은 실 Supabase에 적용되어야 Realtime·사진이 동작한다 — 코드 구현·테스트는 적용 없이 가능(Task 8에서 실 검증)

## 백로그 (이 계획에서 의도적으로 제외 — P4/P5 또는 정식 단계)

- 보고서 생성 화면(스펙 §7.6)·PDF(P4)
- 인터랙티브 3D 뷰어(Three.js viewer.bin — 엔진 산출물 자체가 백로그)
- 수평도(레벨) 접힘 섹션 — stats.json 계약에 지표 부재
- 셀 클릭 프로파일 상세(단면 그래프) — 엔진이 프로파일 미출력
- 단위 후보·근거 표시(precheck 결과 저장 컬럼 부재), TUS 재개 가능 업로드
- 기준 신설·버전 개정·is_default 변경 UI, 사용자 관리, E2E(Playwright)
- 스캔·분석 soft delete UI와 Storage 정리 잡 enqueue



