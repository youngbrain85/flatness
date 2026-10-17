// 정합 화면 서버 배선 (단계 F Task 5) + 현장 작업 공간(Task 9)
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
// perf-auth-roundtrips: 페이지는 supabase.auth.getUser() 대신 proxy가 검증해 실은
// x-flatness-user-* 요청 헤더를 읽는다(getRequestUser) - 실제 코드가 그대로 돈다.
vi.mock('next/headers', () => ({
  headers: async () => new Headers({
    'x-flatness-user-id': 'u1',
    'x-flatness-user-email': encodeURIComponent('u1@example.com'),
  }),
}));
vi.mock('@/components/shell/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/shell/entry-header', () => ({ EntryHeader: () => null }));

import { createClient } from '@/lib/supabase/server';
import RegistrationPage, { statusTone } from '../page';
import { RegistrationWorkbench } from '@/components/registration/registration-workbench';
import { EntryHeader } from '@/components/shell/entry-header';
import { SiteHeader } from '@/components/shell/site-header';
import { Alert } from '@/components/ui/alert';
import { LinkButton } from '@/components/ui/button';
import { MAIN_BG, PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { StatusIndicator } from '@/components/ui/status-indicator';
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

// 원본 스캔의 location_id로 locations·sites를 추가 조회한다 - 스텁이 없는 테이블 접근은
// throw로 즉시 드러나므로 여기서도 채운다.
const LOCATION = {
  id: 'l1', site_id: 's1', building: '본관', floor: '1층', floor_order: 1, room: '로비',
  name: '로비', memo: null, created_at: '', updated_at: '',
};
const SITE = { id: 's1', name: '본관 현장', address: null, memo: null, created_at: '', updated_at: '' };

const REG: RegistrationRow = {
  id: 'r1', source_scan_ids: ['scanA', 'scanB'], correspondences: [], transform: null,
  rmse_mm: null, iterations: null, overlap_ratio: null, horizontal_sensitivity: null,
  status: 'awaiting_points',
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
  const props = (node as ReactElement<{ title?: unknown; description?: unknown; children?: unknown }>).props;
  return [props?.title, props?.description, props?.children].map(textOf).join('');
}

function mount(o: {
  registration?: RegistrationRow | null;
  scans?: ScanRow[];
  scansSpy?: (m: string, ...a: unknown[]) => void;
} = {}) {
  vi.mocked(createClient).mockResolvedValue({
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
    expect((findByType(el, Alert)!.props as { type: string }).type).toBe('warning');
  });

  it('원본 스캔이 없어도 병합 스캔이 남아 있으면 그 링크를 LinkButton으로 낸다', async () => {
    const el = await mount({ registration: { ...REG, result_scan_id: 'merged-9' }, scans: [] });
    const link = findByType(el, LinkButton);
    expect(link).not.toBeNull();
    expect((link!.props as { href: string }).href).toBe('/scans/merged-9');
    expect(textOf(link)).toBe('이 정합이 만든 병합 스캔 열기');
  });

  it('없는 정합 id는 notFound로 보낸다', async () => {
    await expect(mount({ registration: null })).rejects.toThrow('NOT_FOUND');
  });
});

describe('RegistrationPage 현장 헤더·브레드크럼·본문 (Task 9, 스펙 §4.3)', () => {
  it('원본 스캔의 현장으로 현장 헤더를 그리고 계정 이메일을 넘긴다', async () => {
    const el = await mount();
    expect(findByType(el, SiteHeader)!.props).toEqual({ site: { id: 's1', name: '본관 현장' }, email: 'u1@example.com' });
    expect(findByType(el, EntryHeader)).toBeNull();
  });

  it('브레드크럼은 측정위치 / 측정위치 표기(" · ") / 스캔 정합', async () => {
    const el = await mount();
    const props = findByType(el, PageHeader)!.props as { crumbs: { href?: string; label: string }[]; title: unknown };
    expect(props.crumbs).toEqual([
      { href: '/sites/s1/locations', label: '측정위치' },
      { href: '/sites/s1/locations#loc-l1', label: '본관 · 1층 · 로비 · 로비' },
      { label: '스캔 정합' },
    ]);
    expect(textOf(props.title)).toContain('스캔 정합');
  });

  it('본문은 MAIN_BG <main> 안 PAGE_MAIN이다', async () => {
    const el = await mount();
    const main = findByType(el, 'main')!;
    expect((main.props as { className: string }).className).toBe(MAIN_BG);
    const body = (main.props as { children: ReactElement }).children;
    expect((body.props as { className: string }).className).toBe(PAGE_MAIN);
  });

  // 아트보드 RegistrationDetail: h1 '스캔 정합'과 진행 상태가 한 줄. 색·점은 statusTone(F2) → TONE_STATUS 매핑.
  it.each([
    ['awaiting_points', 'pending', '대응점 지정 대기'],
    ['done', 'success', '정합 완료'],
    ['failed', 'error', '정합 실패'],
  ] as const)('%s 상태를 PageHeader title 안 StatusIndicator(%s)로 그린다', async (status, type, label) => {
    const el = await mount({ registration: { ...REG, status } });
    const header = findByType(el, PageHeader)!.props as { title: ReactElement; description?: unknown };
    expect(header.description).toBeUndefined();
    const status_ = findByType(header.title, StatusIndicator);
    expect(status_).not.toBeNull();
    expect((status_!.props as { type: string }).type).toBe(type);
    expect((status_!.props as { children: string }).children).toBe(label);
  });

  it('원본 스캔이 둘 다 없으면 진입 헤더와 "현장 목록" 크럼으로 돌아갈 길만 남긴다', async () => {
    const el = await mount({ scans: [] });
    expect(findByType(el, SiteHeader)).toBeNull();
    expect(findByType(el, EntryHeader)!.props).toEqual({ email: 'u1@example.com' });
    expect((findByType(el, PageHeader)!.props as { crumbs: { href?: string; label: string }[] }).crumbs)
      .toEqual([{ href: '/', label: '현장 목록' }, { label: '스캔 정합' }]);
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
