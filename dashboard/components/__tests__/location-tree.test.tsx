import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LocationTree, type ScanWithCurrent } from '../location-tree';
import { buttonClass } from '@/components/ui/button';
import type { BuildingNode } from '@/lib/domain/tree';
import type { LocationRow } from '@/lib/domain/types';

const location = (id: string, name: string): LocationRow => ({
  id, site_id: 's1', building: 'A동', floor: '1층', floor_order: 1,
  room: '거실', name, memo: null, created_at: '', updated_at: '',
});

const tree = (loc: LocationRow): BuildingNode[] => [{
  building: 'A동',
  floors: [{ floor: '1층', floor_order: 1, rooms: [{ room: '거실', locations: [loc] }] }],
}];

const scan = (id: string, locationId: string, current?: ScanWithCurrent['current']): ScanWithCurrent => ({
  id, location_id: locationId, surface: 'floor', scanned_at: '2026-07-28',
  device: null, operator_id: null, operator_name_manual: null,
  selected_criteria_id: null, raw_file_path: null, original_filename: null,
  file_format: null, point_count: null, unit_scale: null, lineage: 'unknown',
  status: 'ready', height_view_path: null, deleted_at: null, created_at: '', updated_at: '',
  current,
});

// 리뷰 Important 3: overall_verdict가 null(판정불가)이거나 분석이 실패해도
// 미분석 스캔("분석 준비됨" 등)과 트리에서 구분되어야 한다.
describe('LocationTree (리뷰 Important 3: 판정불가·분석실패를 미분석과 구분)', () => {
  it('overall_verdict가 있으면 등급 배지를 표시한다', () => {
    const loc = location('l1', '측정1');
    const scansByLocation = new Map([['l1', [scan('c1', 'l1', { id: 'a1', status: 'done', overall_verdict: 'pass' })]]]);
    render(<LocationTree tree={tree(loc)} scansByLocation={scansByLocation} siteId="s1" />);
    expect(screen.getByText('적합')).toBeInTheDocument();
  });

  it('분석 status=done인데 overall_verdict가 null이면 "판정 불가" 배지를 표시한다', () => {
    const loc = location('l1', '측정1');
    const scansByLocation = new Map([['l1', [scan('c1', 'l1', { id: 'a1', status: 'done', overall_verdict: null })]]]);
    render(<LocationTree tree={tree(loc)} scansByLocation={scansByLocation} siteId="s1" />);
    expect(screen.getByText('판정 불가')).toBeInTheDocument();
  });

  it('분석 status=failed이면 "분석 실패" 배지를 표시한다', () => {
    const loc = location('l1', '측정1');
    const scansByLocation = new Map([['l1', [scan('c1', 'l1', { id: 'a1', status: 'failed', overall_verdict: null })]]]);
    render(<LocationTree tree={tree(loc)} scansByLocation={scansByLocation} siteId="s1" />);
    expect(screen.getByText('분석 실패')).toBeInTheDocument();
  });

  it('현재 분석이 없으면 기존처럼 스캔 상태 라벨을 표시한다', () => {
    const loc = location('l1', '측정1');
    const scansByLocation = new Map([['l1', [scan('c1', 'l1', undefined)]]]);
    render(<LocationTree tree={tree(loc)} scansByLocation={scansByLocation} siteId="s1" />);
    expect(screen.getByText('분석 준비됨')).toBeInTheDocument();
  });
});

// 다크 C안(T5, 아트보드 SiteDetail): 판정은 등급 색 점 + 글자(data-grade), 판정이 없을 때는
// StatusIndicator(data-status). 상태는 클래스가 아니라 의미 속성으로 읽는다.
describe('LocationTree 다크 C안 (T5)', () => {
  const loc = location('l1', '측정1');

  const gradeCases: [string, string, NonNullable<ScanWithCurrent['current']>][] = [
    ['적합', 'pass', { id: 'a1', status: 'done', overall_verdict: 'pass' }],
    ['경계', 'borderline', { id: 'a1', status: 'done', overall_verdict: 'borderline' }],
    ['보수', 'repair', { id: 'a1', status: 'done', overall_verdict: 'repair' }],
    ['재시공', 'rework', { id: 'a1', status: 'done', overall_verdict: 'rework' }],
    ['판정 불가', 'na', { id: 'a1', status: 'done', overall_verdict: null }],
  ];
  it.each(gradeCases)('"%s" 판정은 등급 점 + 글자(data-grade=%s)로 그린다', (label, grade, current) => {
    render(<LocationTree tree={tree(loc)} scansByLocation={new Map([['l1', [scan('c1', 'l1', current)]]])} siteId="s1" />);
    const mark = screen.getByText(label).closest('[data-grade]');
    expect(mark?.getAttribute('data-grade')).toBe(grade);
    // 8px 등급 색 점도 같은 등급을 단다(글자만 남고 점이 빠지면 색으로 읽던 표시가 사라진다)
    expect(mark?.querySelector(`[data-grade="${grade}"]`)).not.toBeNull();
  });

  // 최종 리뷰 Important 2: 미분석 스캔의 상태 표시를 스캔 상세와 공유한다. 아트보드가 진행 중(속 빈
  // 고리)으로 그리는 '업로드됨'·'분석 준비됨'만 in-progress로 남는다.
  const statusCases: [ScanWithCurrent['status'], string, string][] = [
    ['ready', '분석 준비됨', 'in-progress'],
    ['uploaded', '업로드됨', 'in-progress'],
    ['failed', '실패', 'error'],
    ['archived', '보관됨', 'pending'],
    ['awaiting_unit_confirm', '단위 확인 대기', 'pending'],
  ];
  it.each(statusCases)('미분석 스캔 상태 %s("%s")는 data-status=%s로 그린다', (status, label, expected) => {
    const scansByLocation = new Map([['l1', [{ ...scan('c1', 'l1', undefined), status }]]]);
    render(<LocationTree tree={tree(loc)} scansByLocation={scansByLocation} siteId="s1" />);
    expect(screen.getByText(label).closest('[data-status]')?.getAttribute('data-status')).toBe(expected);
  });

  it('분석 실패는 data-status=error다', () => {
    render(<LocationTree tree={tree(loc)}
      scansByLocation={new Map([['l1', [scan('c1', 'l1', { id: 'a1', status: 'failed', overall_verdict: null })]]])}
      siteId="s1" />);
    expect(screen.getByText('분석 실패').closest('[data-status]')?.getAttribute('data-status')).toBe('error');
  });

  // 분기 순서는 verdict → done → failed → 스캔 상태로 고정이다. 판정이 있으면 분석 status가 failed여도
  // 등급이 이긴다(failed를 앞세우면 이미 나온 판정이 '분석 실패'로 덮인다).
  it('판정이 있으면 현재 분석 status가 failed여도 등급을 그린다(판정이 먼저)', () => {
    render(<LocationTree tree={tree(loc)}
      scansByLocation={new Map([['l1', [scan('c1', 'l1', { id: 'a1', status: 'failed', overall_verdict: 'rework' })]]])}
      siteId="s1" />);
    expect(screen.getByText('재시공').closest('[data-grade]')?.getAttribute('data-grade')).toBe('rework');
    expect(screen.queryByText('분석 실패')).toBeNull();
  });

  // 아직 도는 분석(queued·processing)에는 판정이 없다. done인데 판정이 없는 '판정 불가'로 오인시키지 않고
  // 미분석 스캔처럼 스캔 상태를 그린다.
  it.each(['queued', 'processing'] as const)('현재 분석이 %s이면 판정 불가가 아니라 스캔 상태를 그린다', (status) => {
    render(<LocationTree tree={tree(loc)}
      scansByLocation={new Map([['l1', [scan('c1', 'l1', { id: 'a1', status, overall_verdict: null })]]])}
      siteId="s1" />);
    expect(screen.queryByText('판정 불가')).toBeNull();
    expect(screen.getByText('분석 준비됨').closest('[data-status]')?.getAttribute('data-status')).toBe('in-progress');
  });

  it('소제목 위계: 동 h2 › 층 h3 › 공간 h4(측정위치 탭의 h1 아래)', () => {
    render(<LocationTree tree={tree(loc)} scansByLocation={new Map()} siteId="s1" />);
    expect(screen.getByRole('heading', { level: 2, name: 'A동' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: '1층' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 4, name: '거실' })).toBeInTheDocument();
    // 동 구역은 자기 제목(h2)으로 이름 붙은 region 이다(아트보드 aria-labelledby)
    expect(screen.getByRole('region', { name: 'A동' })).toBeInTheDocument();
  });

  it('빈 동·층·공간 이름은 "(… 미지정)"으로 보인다', () => {
    const bare = { ...location('l1', '측정1'), building: '', floor: '', room: '' };
    render(<LocationTree
      tree={[{ building: '', floors: [{ floor: '', floor_order: 0, rooms: [{ room: '', locations: [bare] }] }] }]}
      scansByLocation={new Map()} siteId="s1" />);
    expect(screen.getByText('(동 미지정)')).toBeInTheDocument();
    expect(screen.getByText('(층 미지정)')).toBeInTheDocument();
    expect(screen.getByText('(공간 미지정)')).toBeInTheDocument();
  });

  it('측정위치 카드는 id="loc-<위치 id>" 닻이고 ground 바탕 · line-2 · 12px 카드다', () => {
    const { container } = render(<LocationTree tree={tree(loc)} scansByLocation={new Map()} siteId="s1" />);
    const card = container.querySelector('#loc-l1');
    expect(card?.tagName).toBe('LI');
    expect(card).toHaveTextContent('측정1');
    expect(card?.className).toContain('bg-ground');
    expect(card?.className).toContain('border-line-2');
    expect(card?.className).toContain('rounded-card');
  });

  it('카드 줄 동작: 스캔 정합·보고서는 글자 링크, 스캔 업로드는 현장 안 업로드로 가는 보조 버튼', () => {
    const { container } = render(<LocationTree tree={tree(loc)} scansByLocation={new Map()} siteId="s1" />);
    const card = within(container.querySelector('#loc-l1') as HTMLElement);
    expect(card.getByRole('link', { name: '스캔 정합' })).toHaveAttribute('href', '/registrations/new?location=l1');
    expect(card.getByRole('link', { name: '보고서' })).toHaveAttribute('href', '/sites/s1/reports?location=l1');
    const upload = card.getByRole('link', { name: '스캔 업로드' });
    expect(upload).toHaveAttribute('href', '/sites/s1/upload?location=l1');
    expect(upload.className).toContain(buttonClass('normal'));
    expect(upload.querySelector('[data-icon="upload"]')).not.toBeNull();
  });

  it('스캔 줄: 일시(mono) · 표면(muted) · 판정 · 꺾쇠, 줄 전체가 /scans/[id] 링크', () => {
    const scansByLocation = new Map([['l1', [scan('c1', 'l1', { id: 'a1', status: 'done', overall_verdict: 'borderline' })]]]);
    render(<LocationTree tree={tree(loc)} scansByLocation={scansByLocation} siteId="s1" />);
    const row = screen.getByRole('link', { name: /2026-07-28/ });
    expect(row).toHaveAttribute('href', '/scans/c1');
    expect(screen.getByText('2026-07-28').className).toContain('font-mono');
    expect(screen.getByText('· 바닥').className).toContain('text-muted');
    expect(row.querySelector('[data-icon="chevron-right"]')).not.toBeNull();
    expect(row.closest('li')).toHaveClass('border-t', 'border-line');
  });

  it('측정위치가 없으면 안내 문구를 그린다', () => {
    render(<LocationTree tree={[]} scansByLocation={new Map()} siteId="s1" />);
    expect(screen.getByText('측정위치가 없습니다. 아래에서 추가하세요.').className).toContain('text-muted');
  });
});

// Task 12 휴대폰 점검: 띄어쓰기 없는 긴 측정위치 이름이 390 에서 카드를 뚫었다(가로 스크롤 434/390).
// 동·층·공간 제목과 측정위치 이름은 칸 안에서 줄바꿈한다.
describe('LocationTree 긴 이름 줄바꿈', () => {
  it('동(h2)·층(h3)·공간(h4) 제목과 측정위치 이름은 overflow-wrap:anywhere 다', () => {
    const loc: LocationRow = { ...location('lx', 'LivingRoomNorthWestCornerPanelZoneA12'),
      building: 'NorthEastWingBuilding101Extension', floor: 'Floor03Mezzanine', room: 'Penthouse3301SouthTerrace' };
    const longTree: BuildingNode[] = [{
      building: loc.building,
      floors: [{ floor: loc.floor, floor_order: 3, rooms: [{ room: loc.room, locations: [loc] }] }],
    }];
    render(<LocationTree tree={longTree} scansByLocation={new Map()} siteId="s1" />);
    for (const level of [2, 3, 4] as const) {
      expect(screen.getByRole('heading', { level }).className.split(' ')).toContain('[overflow-wrap:anywhere]');
    }
    expect(screen.getByText('LivingRoomNorthWestCornerPanelZoneA12').className.split(' '))
      .toEqual(expect.arrayContaining(['min-w-0', '[overflow-wrap:anywhere]']));
  });
});
