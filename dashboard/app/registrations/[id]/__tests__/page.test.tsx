// 정합 화면 서버 배선 (단계 F Task 5)
//
// Next.js 16 + Vitest는 async 서버 컴포넌트 render()를 지원하지 않는다 - 관례대로
// @/lib/supabase/server를 모킹하고 페이지 함수를 await 해 반환 트리와 쿼리 배선을 본다.
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND'); },
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));

import { createClient } from '@/lib/supabase/server';
import RegistrationPage, { statusTone } from '../page';
import { RegistrationWorkbench } from '@/components/registration/registration-workbench';
import { PageHeader } from '@/components/ui/page-header';
import type { RegistrationRow, RegistrationStatus, ScanRow } from '@/lib/domain/types';

function scan(id: string, over: Partial<ScanRow> = {}): ScanRow {
  return {
    id, location_id: 'l1', surface: 'floor', scanned_at: '2026-08-01', device: null,
    operator_id: null, operator_name_manual: null, selected_criteria_id: null,
    raw_file_path: null, original_filename: `${id}.ply`, file_format: 'ply', point_count: 1,
    unit_scale: 1, lineage: 'raw', status: 'ready',
    height_view_path: `artifacts/scans/OTHER-${id}/hv.png`,
    deleted_at: null, created_at: '', updated_at: '', ...over,
  } as ScanRow;
}

// D8 브리프 Step 2: 현장 › 현장명 › 측정위치 3단계 브레드크럼을 위해 원본 스캔의
// location_id로 locations·sites를 추가 조회한다 - 스텁이 없는 테이블 접근은 throw로
// 즉시 드러나므로 여기서도 채운다.
const LOCATION = {
  id: 'l1', site_id: 's1', building: '본관', floor: '1층', floor_order: 1, room: '로비',
  name: '로비', memo: null, created_at: '', updated_at: '',
};
const SITE = { id: 's1', name: '본관 현장', address: null, memo: null, created_at: '', updated_at: '' };

const REG: RegistrationRow = {
  id: 'r1', source_scan_ids: ['scanA', 'scanB'], correspondences: [], transform: null,
  rmse_mm: null, iterations: null, overlap_ratio: null, status: 'awaiting_points',
  error_text: null, result_scan_id: null, created_by: null, created_at: '', updated_at: '',
};

function chain(result: { data: unknown; error: null }, spy?: (m: string, ...a: unknown[]) => void) {
  const obj: Record<string, unknown> = {
    select: (...a: unknown[]) => { spy?.('select', ...a); return obj; },
    eq: (...a: unknown[]) => { spy?.('eq', ...a); return obj; },
    in: (...a: unknown[]) => { spy?.('in', ...a); return obj; },
    is: (...a: unknown[]) => { spy?.('is', ...a); return obj; },
    order: (...a: unknown[]) => { spy?.('order', ...a); return obj; },
    maybeSingle: async () => result,
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return obj;
}

/** 반환된 엘리먼트 트리에서 특정 컴포넌트를 찾는다. */
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

/** 트리의 문자열 자식을 모은다(JSON.stringify는 컴포넌트 참조가 순환이라 못 쓴다). */
function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (!node || typeof node !== 'object') return '';
  return textOf((node as ReactElement & { props?: { children?: unknown } }).props?.children);
}

function mount(o: {
  registration?: RegistrationRow | null;
  scans?: ScanRow[];
  scansSpy?: (m: string, ...a: unknown[]) => void;
} = {}) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'registrations') {
        return chain({ data: o.registration === undefined ? REG : o.registration, error: null });
      }
      if (table === 'scans') {
        return chain({ data: o.scans ?? [scan('scanA'), scan('scanB')], error: null }, o.scansSpy);
      }
      if (table === 'locations') return chain({ data: LOCATION, error: null });
      if (table === 'sites') return chain({ data: SITE, error: null });
      // 설계 결정 F10: jobs는 RLS 정책이 0개라 대시보드가 못 읽는다.
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  } as never);
  return RegistrationPage({ params: Promise.resolve({ id: 'r1' }) });
}

describe('RegistrationPage 배선', () => {
  it('registrations 행과 원본 스캔 두 개를 읽어 작업대에 넘긴다', async () => {
    const el = await mount();
    const wb = findByType(el, RegistrationWorkbench);

    expect(wb).not.toBeNull();
    const p = wb!.props as { registration: RegistrationRow; scanA: ScanRow; scanB: ScanRow };
    expect(p.registration.id).toBe('r1');
    expect(p.scanA.id).toBe('scanA');
    expect(p.scanB.id).toBe('scanB');
  });

  // ★ PostgREST의 .in()은 배열 순서를 보장하지 않는다. 순서를 다시 맞추지 않으면
  //   A와 B가 뒤바뀌어, 워커가 a를 source_scan_ids[0]로 해석하는 계약이 깨진다
  //   (대응점이 서로 반대 스캔에 붙어 정합이 통째로 틀린다 - 조용한 실패).
  it('.in()이 반대 순서로 돌려줘도 source_scan_ids 순서를 지킨다', async () => {
    const el = await mount({ scans: [scan('scanB'), scan('scanA')] });
    const p = findByType(el, RegistrationWorkbench)!.props as { scanA: ScanRow; scanB: ScanRow };

    expect(p.scanA.id).toBe('scanA');
    expect(p.scanB.id).toBe('scanB');
  });

  it('원본 스캔이 지워져 없으면 작업대 대신 한국어 안내를 낸다', async () => {
    // registrations.source_scan_ids는 배열이라 FK가 없다 - 죽은 id가 남는 것을
    // 007이 의도적으로 허용했고(이력 테이블), 화면이 그것을 견뎌야 한다.
    const el = await mount({ scans: [scan('scanA')] });

    expect(findByType(el, RegistrationWorkbench)).toBeNull();
    expect(textOf(el)).toContain('원본 스캔');
  });

  it('없는 정합 id는 notFound로 보낸다', async () => {
    await expect(mount({ registration: null })).rejects.toThrow('NOT_FOUND');
  });
});

// D8 브리프 Step 2: scans/[id]·reports/[id]와 같은 3단계 브레드크럼 규약
// (현장 홈 › 현장명 › 측정위치 라벨)을 이 화면에도 맞춘다.
describe('RegistrationPage 브레드크럼 (D8)', () => {
  it('원본 스캔의 위치로 현장 홈 › 현장명 › 측정위치 라벨을 PageHeader에 넘긴다', async () => {
    const el = await mount();
    const header = findByType(el, PageHeader);

    expect(header).not.toBeNull();
    const props = header!.props as { crumbs: { href?: string; label: string }[]; title: string };
    expect(props.crumbs).toEqual([
      { href: '/', label: '현장' },
      { href: '/sites/s1', label: '본관 현장' },
      { label: '본관 / 1층 / 로비 / 로비' },
    ]);
    expect(props.title).toBe('스캔 정합');
  });

  it('원본 스캔이 둘 다 없으면 현장 홈 크럼만 남긴다', async () => {
    const el = await mount({ scans: [] });
    const header = findByType(el, PageHeader);

    expect((header!.props as { crumbs: { href?: string; label: string }[] }).crumbs)
      .toEqual([{ href: '/', label: '현장' }]);
  });
});

// F2(픽스 라운드): 진행 상태 배지는 판정이 아니라 "진행이 어디까지 왔나"를
// 보여준다 - done만 pass, failed만 fail, 나머지(대응점 대기·정합 대기·정합 중)는
// 아직 결과가 없으니 unknown으로 접는다.
describe('statusTone (F2)', () => {
  it.each([
    ['done', 'pass'],
    ['failed', 'fail'],
    ['awaiting_points', 'unknown'],
    ['queued', 'unknown'],
    ['processing', 'unknown'],
  ] as const)('%s -> %s', (status, tone) => {
    expect(statusTone(status as RegistrationStatus)).toBe(tone);
  });
});
