// 단계 E 리뷰 7: 이 페이지에는 테스트가 아예 없어서, 높이 뷰가 실제로 쓰는 페이지
// 폭(max-w-6xl)과 안내 문단이 무방비였다. max-w-md로 되돌리면 그림이 폼 폭으로
// 쪼그라들어 축 눈금을 못 읽는데(이 화면의 존재 이유가 무너진다) 아무도 못 잡는다.
//
// Next.js 공식 문서가 "Vitest는 async 서버 컴포넌트 렌더링을 지원하지 않는다"고
// 명시하므로, render()로 DOM까지 그리지 않고 await로 얻은 React 엘리먼트 트리를
// 재귀 탐색한다(app/scans/[id]/__tests__/page.test.tsx와 동일 패턴).
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/server';
import ConfirmUnitPage from '../page';
import { UnitConfirmForm } from '@/components/unit-confirm-form';
import type { ScanRow } from '@/lib/domain/types';

function findAll(node: unknown, type: unknown, acc: { props: Record<string, unknown> }[] = []) {
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, type, acc)); return acc; }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) acc.push(el as { props: Record<string, unknown> });
  findAll(el.props?.children, type, acc);
  return acc;
}

function collectText(node: unknown, acc: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') { acc.push(String(node)); return acc; }
  if (node == null || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach((n) => collectText(n, acc)); return acc; }
  collectText((node as { props?: { children?: unknown } }).props?.children, acc);
  return acc;
}

const scan = {
  id: 'sc1', location_id: 'l1', surface: 'floor', scanned_at: '2026-08-04', device: null,
  operator_id: null, operator_name_manual: null, selected_criteria_id: 'cr1',
  raw_file_path: 'raw-scans/s1/sc1/raw.ply', original_filename: 'room.ply', file_format: 'ply',
  point_count: 600000, unit_scale: null, lineage: 'raw', status: 'awaiting_unit_confirm',
  height_view_path: 'artifacts/scans/OTHER-DIR/hv-2026.png',
  deleted_at: null, created_at: '', updated_at: '',
} as ScanRow;

function stubSupabase(row: ScanRow | null) {
  const obj: Record<string, unknown> = {
    select: () => obj, eq: () => obj,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => {
      if (table === 'scans') return obj;
      throw new Error(`예상치 못한 테이블: ${table}`);
    },
  };
}

describe('ConfirmUnitPage (단계 E)', () => {
  it('페이지 폭을 max-w-6xl로 유지한다(높이 뷰 2열 배치가 쓰는 폭이다)', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase(scan) as never);

    const el = await ConfirmUnitPage({ params: Promise.resolve({ id: 'sc1' }) });
    const main = el as { type: string; props: { className: string } };

    expect(main.type).toBe('main');
    expect(main.props.className).toContain('max-w-6xl');
    expect(main.props.className).not.toContain('max-w-md');
  });

  it('스캔 행을 통째로 폼에 넘긴다(height_view_path 포함)', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase(scan) as never);

    const el = await ConfirmUnitPage({ params: Promise.resolve({ id: 'sc1' }) });
    const forms = findAll(el, UnitConfirmForm);

    expect(forms).toHaveLength(1);
    expect((forms[0].props.scan as ScanRow).height_view_path)
      .toBe('artifacts/scans/OTHER-DIR/hv-2026.png');
    expect(forms[0].props.userId).toBe('u1');
  });

  it('그림 유무 양쪽을 포괄하는 안내 문단을 보여준다', async () => {
    vi.mocked(createClient).mockResolvedValue(stubSupabase(scan) as never);

    const el = await ConfirmUnitPage({ params: Promise.resolve({ id: 'sc1' }) });
    const text = collectText(el).join('');

    // 그림이 있을 때: 축 눈금으로 판단 / 없을 때: 파일명·내보내기 설정으로 판단
    expect(text).toContain('축 눈금');
    expect(text).toContain('내보내기 설정');
  });
});
