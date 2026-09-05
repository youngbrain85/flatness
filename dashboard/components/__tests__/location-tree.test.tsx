import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LocationTree, type ScanWithCurrent } from '../location-tree';
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

// Cloudscape 재스킨(T4): 판정은 StatusIndicator(data-status)로, 측정위치는 카드로, 액션은
// 텍스트 링크 2개 + normal LinkButton '스캔 업로드'. 위 describe의 문구 단언은 그대로 유지한다.
describe('LocationTree (Cloudscape 재스킨: StatusIndicator + 카드 + 액션)', () => {
  const loc = location('l1', '측정1');

  const cases: [string, ScanWithCurrent['current'], string][] = [
    ['적합', { id: 'a1', status: 'done', overall_verdict: 'pass' }, 'success'],
    ['판정 불가', { id: 'a1', status: 'done', overall_verdict: null }, 'pending'],
    ['분석 실패', { id: 'a1', status: 'failed', overall_verdict: null }, 'error'],
    ['분석 준비됨', undefined, 'in-progress'],
  ];
  it.each(cases)('"%s" 판정은 data-status=%s StatusIndicator로 그린다', (label, current, status) => {
    const scansByLocation = new Map([['l1', [scan('c1', 'l1', current)]]]);
    render(<LocationTree tree={tree(loc)} scansByLocation={scansByLocation} siteId="s1" />);
    expect(screen.getByText(label).getAttribute('data-status')).toBe(status);
  });

  it('동(700) › 층(nav-text 700) › 공간(보조색) 소제목 아래 측정위치 카드(1px cs-divider, 8px 라운드)', () => {
    render(<LocationTree tree={tree(loc)} scansByLocation={new Map()} siteId="s1" />);
    expect(screen.getByText('A동').className).toContain('font-bold');
    expect(screen.getByText('1층').className).toContain('text-cs-nav-text');
    expect(screen.getByText('거실').className).toContain('text-cs-text-secondary');
    const name = screen.getByText('측정1');
    expect(name.className).toContain('font-bold');
    const card = name.closest('li');
    expect(card?.className).toContain('border-cs-divider');
    expect(card?.className).toContain('rounded-lg');
  });

  it('카드 액션: 스캔 정합·보고서는 텍스트 링크, 스캔 업로드는 normal LinkButton(upload 아이콘)', () => {
    const { container } = render(<LocationTree tree={tree(loc)} scansByLocation={new Map()} siteId="s1" />);
    expect(screen.getByRole('link', { name: '스캔 정합' })).toHaveAttribute('href', '/registrations/new?location=l1');
    expect(screen.getByRole('link', { name: '보고서' })).toHaveAttribute('href', '/reports?location=l1');
    const upload = screen.getByRole('link', { name: '스캔 업로드' });
    expect(upload).toHaveAttribute('href', '/upload?site=s1&location=l1');
    expect(upload.className).toContain('border-cs-link');
    expect(upload.className).toContain('rounded-full');
    expect(upload.className).not.toContain('bg-cs-link'); // normal(뷰의 primary는 '위치 추가')
    expect(container.querySelector('[data-icon="upload"]')).toBeInTheDocument();
  });

  it('스캔 행: 일시 mono(cs-link) · 표면(보조색) · 판정, 행 전체가 /scans/[id] 링크', () => {
    const scansByLocation = new Map([['l1', [scan('c1', 'l1', { id: 'a1', status: 'done', overall_verdict: 'borderline' })]]]);
    render(<LocationTree tree={tree(loc)} scansByLocation={scansByLocation} siteId="s1" />);
    expect(screen.getByRole('link', { name: /2026-07-28/ })).toHaveAttribute('href', '/scans/c1');
    const when = screen.getByText('2026-07-28');
    expect(when.className).toContain('font-mono');
    expect(when.className).toContain('text-cs-link');
    expect(screen.getByText('· 바닥').className).toContain('text-cs-text-secondary');
    expect(screen.getByText('경계').getAttribute('data-status')).toBe('warning');
  });

  it('측정위치가 없으면 보조색 안내 문구를 그린다', () => {
    render(<LocationTree tree={[]} scansByLocation={new Map()} siteId="s1" />);
    expect(screen.getByText('측정위치가 없습니다. 아래에서 추가하세요.').className).toContain('text-cs-text-secondary');
  });
});
