// DashboardKpis(현장 요약 KPI 줄, 아트보드 DashStatus): KpiCard 다섯 장의 라벨·값·단위와
// 분석 완료 카드(2칸)의 분포 바·범례 배선을 본다. KpiCard 속 마크업은 T1 몫이라 props로 검증한다.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardKpis } from '../dashboard-kpis';
import { KpiCard } from '@/components/ui/kpi';
import { VerdictBar, VerdictLegend } from '@/components/ui/verdict-bar';
import type { DashKpi } from '@/lib/domain/site-dashboard';

// 엘리먼트 트리를 재귀 탐색해 특정 컴포넌트 타입이 쓰인 곳을 모두 모은다(props 전부를 따라간다)
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

// 아트보드 DashStatus의 값(측정위치 14 · 스캔 42 · 분석 완료 39(31 · 6 · 2) · 처리 중 3 · 보고서 4)
const KPI: DashKpi = {
  locationCount: 14, scanCount: 42, doneCount: 39, bar: { pass: 31, warn: 6, fail: 2 }, naCount: 0,
  inProgressCount: 3, reportCount: 4, lastScannedAt: '2026-09-03',
};

describe('DashboardKpis', () => {
  it('KpiCard 다섯 장: 측정위치(곳) · 스캔(건) · 분석 완료(건) · 처리 중(건) · 보고서(건)', () => {
    const cards = findAll(DashboardKpis({ kpi: KPI }), KpiCard);
    expect(cards.map((c) => [c.props.label, c.props.value, c.props.unit])).toEqual([
      ['측정위치', 14, '곳'], ['스캔', 42, '건'], ['분석 완료', 39, '건'], ['처리 중', 3, '건'], ['보고서', 4, '건'],
    ]);
  });

  it('분석 완료 카드만 두 칸(col-span-2)이고, 안에 같은 3묶음 값의 분포 바와 범례가 있다', () => {
    const cards = findAll(DashboardKpis({ kpi: KPI }), KpiCard);
    expect(cards.map((c) => c.props.className)).toEqual([undefined, undefined, 'col-span-2', undefined, undefined]);
    const done = cards[2];
    expect(findAll(done.props.children, VerdictBar).map((b) => b.props.counts)).toEqual([KPI.bar]);
    const [legend] = findAll(done.props.children, VerdictLegend);
    expect(legend.props.counts).toEqual(KPI.bar);
    // 판정 불가가 0이면 범례에 "불가" 항목을 넘기지 않는다
    expect(legend.props.na).toBeUndefined();
  });

  it('판정 불가가 있으면 범례에 na로 넘긴다(분포 바에는 들지 않는다)', () => {
    const cards = findAll(DashboardKpis({ kpi: { ...KPI, naCount: 2 } }), KpiCard);
    expect(findAll(cards[2].props.children, VerdictLegend)[0].props.na).toBe(2);
  });

  it('"현장 요약" 영역 안에서 분포 바를 새 묶음 이름으로 읽는다', () => {
    render(<DashboardKpis kpi={KPI} />);
    expect(screen.getByRole('region', { name: '현장 요약' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '적합 31, 경계 6, 보수·재시공 2' })).toBeInTheDocument();
  });

  it('판정이 하나도 없으면 읽을 그림 없이 "판정 없음"만 둔다', () => {
    render(<DashboardKpis kpi={{ ...KPI, doneCount: 0, bar: { pass: 0, warn: 0, fail: 0 } }} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('판정 없음')).toBeInTheDocument();
  });
});
