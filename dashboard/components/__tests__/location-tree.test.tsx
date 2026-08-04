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
