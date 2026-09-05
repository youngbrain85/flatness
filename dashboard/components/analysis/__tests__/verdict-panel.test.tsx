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
