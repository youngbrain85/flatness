# 보고서 소프트 삭제 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 보고서를 목록·상세에서 삭제할 수 있게 한다. 되돌릴 수 있도록 소프트 삭제로 한다.

**Architecture:** `reports.deleted_at` 컬럼을 추가하고 조회 두 곳에 `.is('deleted_at', null)` 필터를 건다. 삭제 버튼은 클라이언트 컴포넌트로, 확인 단계를 인라인 2단계로 둔다(브라우저 `confirm()` 대신 — 테스트 가능하고 문구를 발행본 여부에 따라 바꿀 수 있다). Storage의 PDF 파일은 지우지 않는다.

**Tech Stack:** Postgres(Supabase), Next.js 16 App Router, TypeScript, Vitest + Testing Library

## Global Constraints

- 이 스펙의 정본: `docs/superpowers/specs/2026-08-02-slope-analysis-design.md` §3.7·§7.6
- **사용자 대면 문자열에 U+2014(—) 금지.** 주석·문서는 관례상 허용. 문자를 셀 때는 **리터럴 글리프**로 검색하고, 검색 패턴이 실제로 매칭되는지 먼저 자기검증할 것(이 저장소에서 유니코드 이스케이프가 거짓 0건을 낸 전례가 있다)
- 주석·문서·UI 문자열은 한국어
- 대시보드는 **Next.js 16**이다. 훈련 데이터의 Next.js와 다르다. 코드를 쓰기 전에 `dashboard/node_modules/next/dist/docs/`의 해당 가이드를 읽을 것
- 마이그레이션은 **멱등**이어야 한다(재실행해도 실패하지 않음). 003~005와 같은 원칙: `add column if not exists`, `create type`은 예외 가드
- 기준선: dashboard 테스트 143 passed, lint 클린, build 성공. 작업 전후로 확인할 것
- 검증 명령: `cd dashboard && npm run test -- --run`, `npm run lint`, `npm run build`

---

## 파일 구조

| 파일 | 책임 |
|---|---|
| `supabase/migrations/006_report_soft_delete.sql` (신규) | `reports.deleted_at` 추가 + 발행본 트리거가 이를 막지 않음을 문서화 |
| `dashboard/lib/domain/types.ts` (수정) | `ReportRow`에 `deleted_at` 추가 |
| `dashboard/lib/domain/reports.ts` (수정) | 삭제 확인 문구 규칙 |
| `dashboard/components/report/report-delete-button.tsx` (신규) | 2단계 확인 + 소프트 삭제 실행 |
| `dashboard/app/reports/page.tsx` (수정) | 삭제된 보고서 제외 |
| `dashboard/app/reports/[id]/page.tsx` (수정) | 삭제된 보고서 제외 + 삭제 버튼 배치 |

---

### Task 1: 마이그레이션 006

**Files:**
- Create: `supabase/migrations/006_report_soft_delete.sql`

**Interfaces:**
- Produces: `reports.deleted_at timestamptz` (nullable). 이후 태스크의 조회 필터와 삭제 UPDATE가 이 컬럼을 쓴다.

**배경(구현자가 알아야 할 것):** `004_report_support.sql`의 `fn_reports_finalized_guard`는 `before update` 트리거로 발행본의 내용 변경을 막는다. 잠그는 컬럼은 `status`·`title`·`location_id`·`opinion_text`·`snapshot`·`pdf_path` 6개뿐이고 `gen_status`·`gen_error`는 일부러 열어 뒀다(잡 기계장치가 만지기 때문). **`deleted_at`도 이 목록에 없으므로 트리거를 고칠 필요가 없다** — 발행본의 소프트 삭제가 이미 통과한다. 다만 나중에 누가 이 목록에 `deleted_at`을 넣으면 발행본 삭제가 조용히 깨지므로, 그 사실을 마이그레이션 주석에 남긴다.

- [ ] **Step 1: 마이그레이션 파일을 만든다**

```sql
-- =============================================================================
-- 마이그레이션 006 - 보고서 소프트 삭제
-- 선행: 001~005.
--
-- scans·analyses가 이미 deleted_at 소프트 삭제 관례를 쓴다. 보고서만 없어서
-- 삭제 기능을 붙일 수 없었다. 하드 삭제를 택하지 않은 이유: 발행본은 발주처에
-- 제출됐을 수 있는 기록이라 되돌릴 수 없게 만드는 것이 위험하다.
--
-- 004의 fn_reports_finalized_guard(before update)는 발행본의 내용 컬럼
-- (status·title·location_id·opinion_text·snapshot·pdf_path)만 잠근다.
-- deleted_at은 그 목록에 없으므로 발행본의 소프트 삭제가 통과한다 - 의도된
-- 동작이다. **이 트리거의 잠금 목록에 deleted_at을 추가하지 말 것.** 추가하면
-- 발행본을 삭제할 수 없게 되고, 화면에는 42501 오류만 뜬다.
--
-- Storage의 PDF 파일은 지우지 않는다(백로그 티켓 58과 동일 정책 - 참조 없는
-- 객체는 정리 잡으로 일괄 처리한다).
--
-- 멱등성: add column if not exists.
-- =============================================================================
alter table reports add column if not exists deleted_at timestamptz;
```

인덱스는 만들지 않는다. 이 시스템의 보고서는 수십 건 규모이고 목록 쿼리에
`limit 50`이 걸려 있어 인덱스가 없어도 차이가 없다. 실제로 느려지면 그때 측정하고
넣는다.

- [ ] **Step 2: 멱등성을 확인한다**

이 저장소에는 SQL을 실행하는 테스트가 없다(워커 테스트는 FakeDB만 쓴다). 대신
파일이 기존 마이그레이션의 멱등 관례를 지키는지 확인한다.

Run:
```bash
grep -cE "^alter table .* if not exists" supabase/migrations/006_report_soft_delete.sql
```
Expected: `1` (SQL 절 1건. 재실행해도 실패하지 않는다)

**주석이 아니라 SQL 절만 센다.** 단순히 `grep -c "if not exists"`로 세면 멱등성을
설명하는 주석까지 잡혀 숫자가 어긋나고, 그러면 구현자가 검증을 맞추려고 주석을
고치게 된다 — 검증이 산출물을 왜곡하는 방향으로 작동한다.

- [ ] **Step 3: 커밋**

```bash
git add supabase/migrations/006_report_soft_delete.sql
git commit -m "feat(db): 마이그레이션 006 - reports.deleted_at 소프트 삭제 컬럼"
```

---

### Task 2: 타입과 도메인 규칙

**Files:**
- Modify: `dashboard/lib/domain/types.ts` (`ReportRow` 인터페이스)
- Modify: `dashboard/lib/domain/reports.ts`
- Test: `dashboard/lib/domain/__tests__/reports.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: Task 1의 `reports.deleted_at`
- Produces:
  - `ReportRow.deleted_at: string | null`
  - `deleteConfirmText(report: { status: ReportStatus }): string` — 확인 단계에 보여줄 문구

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`dashboard/lib/domain/__tests__/reports.test.ts` 파일 맨 아래에 추가한다. 파일 상단의 import 문에 `deleteConfirmText`를 더한다.

```ts
describe('deleteConfirmText', () => {
  it('초안은 되돌릴 수 있다고 안내한다', () => {
    const text = deleteConfirmText({ status: 'draft' });
    expect(text).toMatch(/삭제/);
    expect(text).not.toMatch(/발행/);
  });

  // 발행본은 발주처에 제출됐을 수 있는 기록이라 초안과 같은 문구로 지우게 하면 안 된다
  it('발행본은 발행된 기록임을 경고한다', () => {
    const text = deleteConfirmText({ status: 'finalized' });
    expect(text).toMatch(/발행/);
  });

  it('두 문구가 서로 다르다', () => {
    expect(deleteConfirmText({ status: 'draft' }))
      .not.toBe(deleteConfirmText({ status: 'finalized' }));
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd dashboard && npm run test -- --run lib/domain/__tests__/reports`
Expected: FAIL. `deleteConfirmText`가 없어 import 오류가 난다.

- [ ] **Step 3: 타입을 넓힌다**

`dashboard/lib/domain/types.ts`의 `ReportRow`에 `deleted_at`을 더한다.

```ts
export interface ReportRow {
  id: string; location_id: string; title: string; status: ReportStatus;
  snapshot: Record<string, unknown> | null; opinion_text: string | null;
  pdf_path: string | null; gen_status: ReportGenStatus; gen_error: string | null;
  deleted_at: string | null;
  created_by: string | null; created_at: string;
}
```

- [ ] **Step 4: 도메인 규칙을 구현한다**

`dashboard/lib/domain/reports.ts` 맨 아래에 추가한다.

```ts
// 삭제 확인 문구. 발행본과 초안을 구분하는 이유: 발행본은 발주처에 제출됐을 수
// 있는 기록이고 스냅샷·복사된 자산으로 원본과 무관하게 재현되도록 만든 것이라,
// 초안과 같은 무게로 지우게 하면 안 된다. 소프트 삭제라 되돌릴 수는 있지만
// 화면에서는 사라지므로 그 사실을 알린다.
export function deleteConfirmText(report: { status: ReportStatus }): string {
  return report.status === 'finalized'
    ? '이미 발행된 보고서입니다. 삭제하면 목록과 상세에서 사라집니다. 삭제할까요?'
    : '이 보고서를 삭제할까요? 목록과 상세에서 사라집니다.';
}
```

- [ ] **Step 5: 통과를 확인한다**

Run: `cd dashboard && npm run test -- --run lib/domain/__tests__/reports`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add dashboard/lib/domain/types.ts dashboard/lib/domain/reports.ts dashboard/lib/domain/__tests__/reports.test.ts
git commit -m "feat(dashboard): 보고서 삭제 확인 문구 규칙 + ReportRow.deleted_at"
```

---

### Task 3: 삭제 버튼 컴포넌트

**Files:**
- Create: `dashboard/components/report/report-delete-button.tsx`
- Test: `dashboard/components/report/__tests__/report-delete-button.test.tsx`

**Interfaces:**
- Consumes: Task 2의 `deleteConfirmText`
- Produces: `<ReportDeleteButton report={{ id: string; status: ReportStatus }} redirectTo?: string />`

**설계 결정(구현자가 알아야 할 것):**

브라우저 `confirm()`을 쓰지 않는다. 문구를 발행본 여부에 따라 바꿔야 하고, jsdom에서 `confirm`은 기본 구현이 없어 모킹에 의존하게 되며, 화면 스타일과도 어긋난다. 대신 **인라인 2단계**로 한다. 첫 클릭에서 확인 문구와 [삭제 확인]·[취소] 버튼이 그 자리에 나타난다.

**삭제 후 동작이 화면마다 다르므로 `redirectTo` prop으로 가른다.**

- **상세 화면**: 보고 있던 보고서가 사라지므로 목록으로 이동해야 한다 → `redirectTo="/reports"`
- **목록 화면**: 이미 목록에 있으므로 이동할 곳이 없다. 그 자리에서 다시 그리면 된다 → prop 없음 → `router.refresh()`

`redirectTo`가 있을 때 `router.push(redirectTo)` 뒤에 `router.refresh()`를 **붙이지 않는다.** refresh는 "현재 라우트"를 다시 렌더하는 API라 진행 중이던 이동을 취소한다(로그인 화면에서 실제로 재현된 결함, 커밋 112bed2). `/reports`는 `force-dynamic`이고 동적 페이지의 클라이언트 캐시 staleTime 기본값은 0초라 push만으로 항상 새로 받아온다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { ReportDeleteButton } from '../report-delete-button';

function stubSupabase(updateError: { message: string } | null, spy: (f: unknown) => void = () => {}) {
  return {
    from: (table: string) => {
      if (table !== 'reports') throw new Error(`예상치 못한 테이블: ${table}`);
      return {
        update: (fields: unknown) => {
          spy(fields);
          return { eq: async () => ({ error: updateError }) };
        },
      };
    },
  };
}

afterEach(() => { vi.clearAllMocks(); });

describe('ReportDeleteButton', () => {
  it('첫 클릭에는 지우지 않고 확인 단계를 보여준다', () => {
    const spy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(screen.getByText(/삭제할까요/)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  // 상세 화면: 보고 있던 보고서가 사라지므로 목록으로 이동한다
  it('redirectTo가 있으면 deleted_at을 채우고 그리로 이동한다', async () => {
    const spy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} redirectTo="/reports" />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/reports'));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
    // push 직후 refresh는 진행 중이던 이동을 취소한다(커밋 112bed2)
    expect(refreshMock).not.toHaveBeenCalled();
  });

  // 목록 화면: 이동할 곳이 없으므로 그 자리에서 다시 그린다
  it('redirectTo가 없으면 이동하지 않고 새로고침만 한다', async () => {
    const spy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String) }));
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('취소하면 지우지 않고 첫 상태로 돌아간다', () => {
    const spy = vi.fn();
    vi.mocked(createClient).mockReturnValue(stubSupabase(null, spy) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '삭제' })).toBeInTheDocument();
  });

  it('발행본은 발행된 기록임을 경고한다', () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase(null) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'finalized' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(screen.getByText(/발행/)).toBeInTheDocument();
  });

  it('삭제에 실패하면 사유를 남기고 이동하지 않는다', async () => {
    vi.mocked(createClient).mockReturnValue(stubSupabase({ message: '권한이 없습니다' }) as never);
    render(<ReportDeleteButton report={{ id: 'r1', status: 'draft' }} />);

    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제 확인' }));

    expect(await screen.findByText(/권한이 없습니다/)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `cd dashboard && npm run test -- --run components/report/__tests__/report-delete-button`
Expected: FAIL. `../report-delete-button` 모듈이 없다.

- [ ] **Step 3: 컴포넌트를 구현한다**

```tsx
// 보고서 삭제(소프트). 스펙 2026-08-02-slope-analysis-design.md §7.6
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { deleteConfirmText } from '@/lib/domain/reports';
import type { ReportStatus } from '@/lib/domain/types';

export function ReportDeleteButton({ report, redirectTo }: {
  report: { id: string; status: ReportStatus };
  // 상세 화면처럼 삭제 후 그 자리에 머물 수 없을 때 이동할 곳. 목록 화면은
  // 이동할 곳이 없으므로 넘기지 않는다(그 자리에서 다시 그린다).
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    // 하드 삭제가 아니라 deleted_at을 채운다. 발행본도 지울 수 있다 - 004의
    // finalized 트리거는 내용 컬럼만 잠그고 deleted_at은 열어 뒀다(006 주석 참고).
    const { error: updateError } = await createClient()
      .from('reports').update({ deleted_at: new Date().toISOString() }).eq('id', report.id);
    if (updateError) {
      setBusy(false);
      setError(updateError.message);
      return;
    }
    if (redirectTo) {
      // push만 한다. 뒤에 router.refresh()를 붙이면 refresh가 "현재 라우트"를 다시
      // 렌더하면서 진행 중이던 이동을 취소한다(커밋 112bed2에서 실제로 재현된 결함).
      router.push(redirectTo);
      return;
    }
    router.refresh();
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}
        className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50">
        삭제
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded border border-red-300 bg-red-50 p-3">
      <p className="text-sm text-red-800">{deleteConfirmText(report)}</p>
      <div className="flex gap-2">
        <button type="button" onClick={remove} disabled={busy}
          className="rounded bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50">
          삭제 확인
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={busy}
          className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">
          취소
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `cd dashboard && npm run test -- --run components/report/__tests__/report-delete-button`
Expected: 6 passed

- [ ] **Step 5: 커밋**

```bash
git add dashboard/components/report/report-delete-button.tsx dashboard/components/report/__tests__/report-delete-button.test.tsx
git commit -m "feat(dashboard): 보고서 삭제 버튼(2단계 확인 + 소프트 삭제)"
```

---

### Task 4: 목록·상세 배선

**Files:**
- Modify: `dashboard/app/reports/page.tsx:15-17`
- Modify: `dashboard/app/reports/[id]/page.tsx:18-20`

**Interfaces:**
- Consumes: Task 1의 `reports.deleted_at`, Task 3의 `<ReportDeleteButton />`

**주의:** 이 두 파일은 서버 컴포넌트다. 테스트 스위트에 서버 컴포넌트 렌더 테스트가 없으므로(기존 테스트는 클라이언트 컴포넌트와 도메인 함수만 다룬다) 이 태스크는 **빌드와 육안 확인**으로 검증한다. 없는 테스트를 지어내지 말 것.

- [ ] **Step 1: 목록에서 삭제된 보고서를 거른다**

`dashboard/app/reports/page.tsx`의 쿼리에 `.is('deleted_at', null)`을 더한다.

```tsx
  let query = supabase.from('reports')
    .select('id, location_id, title, status, pdf_path, gen_status, gen_error, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(50);
```

- [ ] **Step 2: 상세에서 삭제된 보고서를 404로 만든다**

`dashboard/app/reports/[id]/page.tsx`의 쿼리에 `.is('deleted_at', null)`을 더한다. 이미 `if (!report) notFound();`가 있으므로 삭제된 보고서는 자동으로 404가 된다.

```tsx
  const { data: report, error } = await supabase.from('reports')
    .select('id, location_id, title, status, opinion_text, pdf_path, gen_status, gen_error, created_at')
    .eq('id', id).is('deleted_at', null).maybeSingle();
```

- [ ] **Step 3: 상세에 삭제 버튼을 놓는다**

`dashboard/app/reports/[id]/page.tsx`의 import 블록(6행 `ReportActions` 다음 줄)에 추가한다.

```tsx
import { ReportDeleteButton } from '@/components/report/report-delete-button';
```

57행의 `<ReportActions ... />` 바로 아래에 놓는다. 결과는 이렇게 된다.

```tsx
      <ReportProgress reportId={r.id} initialStatus={r.gen_status} genError={r.gen_error} reportStatus={r.status} />
      <ReportActions report={{ id: r.id, status: r.status, gen_status: r.gen_status, pdf_path: r.pdf_path }} />
      <ReportDeleteButton report={{ id: r.id, status: r.status }} redirectTo="/reports" />
```

- [ ] **Step 4: 목록의 각 행에 삭제 버튼을 놓는다**

스펙 §7.6이 "목록과 상세 양쪽"을 요구한다. `dashboard/app/reports/page.tsx`의 import에 추가한다.

```tsx
import { ReportDeleteButton } from '@/components/report/report-delete-button';
```

목록 항목(`<li>`)의 구조를 제목·메타와 삭제 버튼이 좌우로 나뉘도록 바꾼다. 기존 `<li>` 블록 전체를 아래로 교체한다.

```tsx
            <li key={r.id} className="flex items-start justify-between gap-3 rounded border bg-white p-3 text-sm">
              <div>
                <Link href={`/reports/${r.id}`} className="font-medium hover:underline">{r.title}</Link>
                <p className="text-xs text-slate-500">
                  {labelOf.get(r.location_id) ?? ''} · {REPORT_STATUS_LABEL[r.status]}
                  {' · '}{REPORT_GEN_STATUS_LABEL[r.gen_status]} · {r.created_at.slice(0, 10)}
                </p>
              </div>
              {/* redirectTo를 넘기지 않는다 - 이미 목록이므로 이동할 곳이 없고,
                  삭제 후 router.refresh()로 그 자리에서 다시 그린다 */}
              <ReportDeleteButton report={{ id: r.id, status: r.status }} />
            </li>
```

- [ ] **Step 5: 빌드와 전체 스위트를 돌린다**

Run:
```bash
cd dashboard && npm run test -- --run
cd dashboard && npm run lint
cd dashboard && npm run build
```
Expected: 테스트 143 + 이번 신규분(도메인 3 + 컴포넌트 6 = 9) = **152 passed**, lint 출력 없음, build 성공

- [ ] **Step 6: 사용자 대면 문자열에 em-dash가 없는지 확인한다**

**리터럴 글리프로 검색한다.** 유니코드 이스케이프(`$'—'`)는 Git Bash에서 확장되지 않아 거짓 0건을 낸다.

Run:
```bash
git diff HEAD~3 | grep "^+" | grep -c "—"
```

**작업 중인 워크트리에서 실행한다.** 경로를 메인 저장소로 지정하면 이 브랜치의
변경이 아니라 엉뚱한 트리를 검사하게 된다.
Expected: `0`

패턴이 실제로 매칭되는지 먼저 확인하려면, em-dash가 있는 기존 파일에서 같은 검색이 0이 아닌 값을 내는지 봐라.

- [ ] **Step 7: 커밋**

```bash
git add dashboard/app/reports
git commit -m "feat(dashboard): 보고서 목록·상세에서 삭제된 보고서 제외 + 삭제 버튼 배치"
```

---

## 배포 후 사용자가 할 일

1. Supabase SQL Editor에서 `supabase/migrations/006_report_soft_delete.sql` 실행
2. 보고서 상세에서 삭제 버튼 확인. 초안 하나와 발행본 하나로 각각 시도해 확인 문구가 다른지 본다
3. 삭제한 보고서가 목록에서 사라지고, 그 상세 주소로 직접 들어가면 404가 되는지 확인

**주의:** 마이그레이션을 실행하기 전에 새 대시보드 코드가 배포되면, `.is('deleted_at', null)` 필터가 존재하지 않는 컬럼을 참조해 보고서 목록이 오류로 뜬다. **마이그레이션을 먼저 실행할 것.**
