import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const { eqMock, updateMock, fromMock } = vi.hoisted(() => {
  // 함수 타입을 제네릭으로 준다(인자 이름만 적은 구현은 쓰지 않는 인자 경고가 난다)
  const eqMock = vi.fn<(col: string, val: string) => Promise<{ error: { message: string } | null }>>(async () => ({ error: null }));
  const updateMock = vi.fn<(payload: unknown) => { eq: typeof eqMock }>(() => ({ eq: eqMock }));
  const fromMock = vi.fn<(table: string) => { update: typeof updateMock }>(() => ({ update: updateMock }));
  return { eqMock, updateMock, fromMock };
});
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: fromMock }),
}));

import { VerdictPanel } from '../verdict-panel';
import { EYEBROW } from '../result-parts';
import { buttonClass } from '@/components/ui/button';
import { textareaClass } from '@/components/ui/form';
import { GRADE_CLASS } from '@/components/ui/grade';
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

/** KPI 카드의 글자(라벨 + 값 + 단위, 공백 제거). KpiCard 의 라벨 <p> 는 카드 루트의 직계 자식이다(Task 1 계약) */
const kpi = (label: string) => (screen.getByText(label).parentElement!.textContent ?? '').replace(/\s+/g, '');
const tokens = (el: Element) => el.className.split(/\s+/);

describe('VerdictPanel KPI (아트보드 ScanDone 90~111행)', () => {
  it('KPI 5장: 판정·최대 편차·95퍼센타일·판정 셀(유효/전체)·바닥 인식률', () => {
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    expect(kpi('판정')).toContain('보수');
    expect(kpi('최대 편차')).toContain('12.34mm');
    expect(kpi('95퍼센타일')).toContain('9.87mm');
    expect(kpi('판정 셀(유효/전체)')).toContain('36/40');
    expect(kpi('바닥 인식률')).toContain('88.5%');
  });

  it('판정 KPI 는 엔진 overall_verdict 그대로 KpiCard tone 으로 그린다: 등급 점 + 등급 색 이름(data-grade)', () => {
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    const v = screen.getByText('보수').closest('[data-grade]') as HTMLElement;
    expect(v).toHaveAttribute('data-grade', 'repair');
    expect(tokens(v)).toContain(GRADE_CLASS.repair.text);
    expect(v.querySelector('[data-grade="repair"]')).not.toBeNull();   // 등급 점(GradeDot)
  });

  // 변이: 판정 KPI 를 grade_counts 에서 가장 나쁜 등급으로 계산함(브라우저 판정 금지)
  it('판정 KPI 는 셀 등급에서 계산하지 않는다: 보수 셀이 있어도 overall_verdict 가 적합이면 적합', () => {
    render(<VerdictPanel analysis={{ ...analysis, overall_verdict: 'pass' } as AnalysisRow} stats={stats} />);
    expect(screen.getByText('적합').closest('[data-grade]')).toHaveAttribute('data-grade', 'pass');
    expect(screen.queryByText('보수')).toBeNull();
  });

  it('overall_verdict 가 없으면 "판정 없음"(muted, 등급 점·data-grade 없음)', () => {
    render(<VerdictPanel analysis={{ ...analysis, overall_verdict: null } as AnalysisRow} stats={stats} />);
    const none = screen.getByText('판정 없음');
    expect(tokens(none)).toContain('text-muted');
    expect(none.closest('[data-grade]')).toBeNull();
    expect(kpi('판정')).toBe('판정판정없음');
  });

  it('유효 셀이 없으면 최대 편차·95퍼센타일은 "-" 이고 단위를 붙이지 않는다', () => {
    render(<VerdictPanel analysis={analysis} stats={{ ...stats, value_max_mm: null, value_p95_mm: null }} />);
    expect(kpi('최대 편차')).toBe('최대편차-');
    expect(kpi('95퍼센타일')).toBe('95퍼센타일-');
  });
});

describe('VerdictPanel 카드 (등급 분포·적용 기준 | 경고·고지)', () => {
  it('등급 분포: role=img 막대 안 5등급 세그먼트(GRADE_CLASS 바탕, 셀 비율 폭)와 개수 문장', () => {
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    expect(screen.getByText('등급 분포').className).toBe(EYEBROW);
    const bar = screen.getByRole('img', { name: '적합 30, 경계 4, 보수 2, 재시공 0, 판정 불가 4' });
    const segs = bar.querySelectorAll('[data-grade]');
    expect(Array.from(segs).map((s) => s.getAttribute('data-grade'))).toEqual(['pass', 'borderline', 'repair', 'rework', 'na']);
    expect(tokens(segs[0])).toContain(GRADE_CLASS.pass.bg);
    expect((segs[0] as HTMLElement).style.width).toBe('75%');   // 30/40
    expect((segs[2] as HTMLElement).style.width).toBe('5%');    // 2/40
    expect(screen.getByText('적합 30 · 경계 4 · 보수 2 · 재시공 0 · 판정 불가 4')).toBeInTheDocument();
  });

  it('적용 기준: 코드(mono), 출처 · 임계 · 불확도 한 줄, 축소 스팬 셀 수', () => {
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    expect(screen.getByText('floor-kcs-exposed').className).toContain('font-mono');
    expect(screen.getByText('KCS 14 20 10 표 3.7-1 (제물치장·얇은 마감) · 3m당 허용 7mm · 재시공 21mm · 불확도 U=5mm'))
      .toBeInTheDocument();
    expect(screen.getByText('축소 스팬 적용 셀 6개 (허용치 선형 환산)')).toBeInTheDocument();
  });

  it('수직도 기준(span_m 없음)은 "수직도 허용" 문장', () => {
    const plumb = { ...stats, applied_criteria: { ...stats.applied_criteria, span_m: null } };
    render(<VerdictPanel analysis={analysis} stats={plumb} />);
    expect(screen.getByText(/· 수직도 허용 7mm · 재시공 21mm · 불확도 U=5mm$/)).toBeInTheDocument();
  });

  it('경고는 warning Alert 안의 한국어 문구다(계보 경고 슬러그를 그대로 보이지 않는다), 같은 카드에 고지', () => {
    // 업로드 화면이 "결과에 경고가 표시됩니다"라고 약속한 그 화면이 여기다(flatworker/lineage.py 의 코드)
    const fused = { ...stats, warnings: ['low_coverage', 'fused_mesh_smoothed'] };
    const { container } = render(<VerdictPanel analysis={analysis} stats={fused} />);
    const alert = container.querySelector('[data-alert="warning"]') as HTMLElement;
    expect(alert.textContent).toContain('70% 미만');
    expect(alert.textContent).toContain('융합 메시는 스캐너 앱이');
    expect(screen.queryByText('fused_mesh_smoothed')).not.toBeInTheDocument();
    expect(screen.getByText(/모바일 LiDAR 기반 스크리닝이며 공식 검측\(실물 직선자·레벨 측량\)을 대체하지 않습니다/))
      .toBeInTheDocument();
  });

  it('경고가 없으면 Alert 없이 고지만 있다', () => {
    const { container } = render(<VerdictPanel analysis={analysis} stats={{ ...stats, warnings: [] }} />);
    expect(container.querySelector('[data-alert]')).toBeNull();
    expect(screen.getByText(/모바일 LiDAR 기반 스크리닝이며/)).toBeInTheDocument();
  });
});

describe('VerdictPanel 종합의견 카드', () => {
  it('자동 의견 원문(pre-wrap) + 사용자 수정 textarea(textareaClass, 5줄) + 저장(보조 버튼, 이 패널의 유일한 버튼)', () => {
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    expect(screen.getByText('종합의견').className).toBe(EYEBROW);
    expect(screen.getByText(/자동 종합의견 본문입니다/).className).toContain('whitespace-pre-wrap');
    const ta = screen.getByLabelText('종합의견(사용자 수정)');
    for (const t of textareaClass.split(/\s+/).filter(Boolean)) expect(tokens(ta)).toContain(t);
    expect(ta).toHaveAttribute('rows', '5');
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['저장']);
    for (const t of buttonClass('normal').split(/\s+/).filter(Boolean)) expect(tokens(buttons[0])).toContain(t);
  });

  it('저장하면 결과를 role=status 로 알린다(실패면 사유)', async () => {
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    fireEvent.change(screen.getByLabelText('종합의견(사용자 수정)'), { target: { value: '보수 계획 수립' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장되었습니다')).toHaveAttribute('role', 'status');
    expect(eqMock).toHaveBeenCalledWith('id', 'a1');

    eqMock.mockResolvedValueOnce({ error: { message: 'RLS' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    expect(await screen.findByText('저장 실패: RLS')).toHaveAttribute('role', 'status');
  });

  it('DOM 에 옛 팔레트·cs- 토큰이 없다', () => {
    const { container } = render(<VerdictPanel analysis={analysis} stats={stats} />);
    expect(container.innerHTML).not.toMatch(/zinc-|amber-|purple-|red-|green-/);
    expect(container.innerHTML).not.toMatch(/\bcs-/);
  });
});

// ---- 변이 실험이 드러낸 빈틈 ----
describe('VerdictPanel 보강', () => {
  it('저장은 analyses 의 이 분석 행에 user_summary 를 쓰고, 입력을 비우면 null 로 쓴다', async () => {
    fromMock.mockClear(); updateMock.mockClear(); eqMock.mockClear();
    render(<VerdictPanel analysis={analysis} stats={stats} />);
    fireEvent.change(screen.getByLabelText('종합의견(사용자 수정)'), { target: { value: '보수 계획 수립' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await screen.findByText('저장되었습니다');
    expect(fromMock).toHaveBeenLastCalledWith('analyses');
    expect(updateMock).toHaveBeenLastCalledWith({ user_summary: '보수 계획 수립' });
    expect(eqMock).toHaveBeenLastCalledWith('id', 'a1');

    fireEvent.change(screen.getByLabelText('종합의견(사용자 수정)'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledTimes(2));
    expect(updateMock).toHaveBeenLastCalledWith({ user_summary: null });
  });

  it('이미 저장된 사용자 의견이 있으면 입력칸에 채워서 시작한다', () => {
    render(<VerdictPanel analysis={{ ...analysis, user_summary: '기존 사용자 의견' } as AnalysisRow} stats={stats} />);
    expect(screen.getByLabelText('종합의견(사용자 수정)')).toHaveValue('기존 사용자 의견');
  });

  it('자동 종합의견은 분석 행(auto_summary)이 우선이고, 없으면 stats.auto_summary 로 떨어진다', () => {
    const { rerender } = render(
      <VerdictPanel analysis={{ ...analysis, auto_summary: '분석 행의 의견' } as AnalysisRow} stats={stats} />,
    );
    expect(screen.getByText('분석 행의 의견')).toBeInTheDocument();
    expect(screen.queryByText(/자동 종합의견 본문입니다/)).toBeNull();
    rerender(<VerdictPanel analysis={{ ...analysis, auto_summary: null } as AnalysisRow} stats={stats} />);
    expect(screen.getByText(/자동 종합의견 본문입니다/)).toBeInTheDocument();
  });

  it('인식률 KPI 이름은 바닥이면 "바닥 인식률", 벽면이면 "셀 유효율"이다', () => {
    const wall = { ...stats, meta: { ...stats.meta, surface: 'wall' as const } };
    render(<VerdictPanel analysis={analysis} stats={wall} />);
    expect(kpi('셀 유효율')).toContain('88.5%');
    expect(screen.queryByText('바닥 인식률')).toBeNull();
  });

  it('셀이 하나도 없으면(0칸) 등급 분포 막대 폭은 0% 다(NaN% 로 깨지지 않는다)', () => {
    const empty = {
      ...stats, n_cells: 0, n_valid: 0,
      grade_counts: { pass: 0, borderline: 0, repair: 0, rework: 0, na: 0 },
    };
    render(<VerdictPanel analysis={analysis} stats={empty} />);
    const bar = screen.getByRole('img', { name: '적합 0, 경계 0, 보수 0, 재시공 0, 판정 불가 0' });
    for (const seg of Array.from(bar.querySelectorAll('[data-grade]'))) {
      expect((seg as HTMLElement).style.width).toBe('0%');
    }
  });

  it('축소 스팬을 쓴 셀이 0개면 축소 스팬 안내를 그리지 않는다', () => {
    render(<VerdictPanel analysis={analysis} stats={{ ...stats, reduced_span_cells: 0 }} />);
    expect(screen.queryByText(/축소 스팬 적용 셀/)).toBeNull();
  });

  it('경고 상자와 스크리닝 고지는 같은 카드(오른쪽)에 있고, 등급 분포 카드와는 다른 카드다', () => {
    const { container } = render(<VerdictPanel analysis={analysis} stats={stats} />);
    const alert = container.querySelector('[data-alert="warning"]') as HTMLElement;
    const notice = screen.getByText(/모바일 LiDAR 기반 스크리닝이며/);
    expect(notice.parentElement).toBe(alert.parentElement);
    expect(alert.parentElement).not.toContainElement(screen.getByText('등급 분포'));
  });
});
