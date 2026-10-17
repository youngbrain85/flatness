// StatusGrid(측정위치별 판정 격자, 아트보드 DashStatus): 제목·범례, 동 카드 → 층 줄 → 타일,
// 타일 전체 링크·판정 글자와 색(data-grade)·상태 점(data-status)·날짜, "…외 n곳 · 측정위치 전체 보기", 빈 격자.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StatusGrid } from '../status-grid';
import { GRADE_CLASS } from '@/components/ui/grade';
import type { DashBuilding, DashTile } from '@/lib/domain/site-dashboard';

const tile = (locationId: string, over: Partial<DashTile> = {}): DashTile => ({
  locationId, label: locationId, href: `/scans/c-${locationId}`, scanCount: 1, grade: null, gradeScanDate: null,
  latestScanDate: '2026-09-03', state: { type: 'success', label: '분석 완료' }, ...over,
});

// 아트보드 DashStatus의 격자를 옮긴 픽스처
const BUILDINGS: DashBuilding[] = [
  {
    building: '101동',
    floors: [
      {
        floor: '5층',
        tiles: [
          tile('l501', { label: '501호 · 거실', scanCount: 3, grade: 'pass', latestScanDate: '2026-08-28' }),
          tile('l502', { label: '502호 · 거실', state: { type: 'in-progress', label: '업로드됨' } }),
        ],
      },
      { floor: '3층', tiles: [tile('l301', { label: '301호 · 거실', scanCount: 4, grade: 'borderline' })] },
    ],
  },
  {
    building: '102동',
    floors: [{
      floor: '3층',
      tiles: [tile('l2301', {
        label: '301호 · 거실', scanCount: 2, grade: 'pass', gradeScanDate: '2026-08-29',
        state: { type: 'in-progress', label: '분석 중' },
      })],
    }],
  },
];

function renderGrid(over: Partial<Parameters<typeof StatusGrid>[0]> = {}) {
  return render(<StatusGrid siteId="s1" buildings={BUILDINGS} locationCount={14} hiddenCount={0} {...over} />);
}

describe('StatusGrid 머리', () => {
  it('제목은 "측정위치별 판정 (현장 측정위치 수)"이다', () => {
    renderGrid();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('측정위치별 판정 (14)');
  });

  it('범례: 최근 판정(적합 · 경계 · 보수 · 재시공 · 판정 불가 · 미분석)과 새 스캔(처리 중)', () => {
    renderGrid();
    const grades = within(screen.getByRole('list', { name: '최근 판정 범례' })).getAllByRole('listitem');
    expect(grades.map((li) => li.textContent)).toEqual(['적합', '경계', '보수', '재시공', '판정 불가', '미분석']);
    const scans = within(screen.getByRole('list', { name: '스캔 상태 범례' })).getAllByRole('listitem');
    expect(scans.map((li) => li.textContent)).toEqual(['처리 중']);
  });
});

describe('StatusGrid 동 → 층 → 타일', () => {
  it('동마다 h3 카드, 층마다 h4 줄을 픽스처 순서대로 그린다', () => {
    renderGrid();
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['101동', '102동']);
    const b101 = screen.getByRole('region', { name: '101동' });
    expect(within(b101).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['5층', '3층']);
  });

  it('판정 타일: 전체가 링크, data-grade, 등급 글자는 등급 색, 스캔 수, 상태 점과 최근 스캔 날짜', () => {
    renderGrid();
    const link = screen.getByRole('link', { name: /501호 · 거실/ });
    expect(link).toHaveAttribute('href', '/scans/c-l501');
    expect(link).toHaveAttribute('data-grade', 'pass');
    const verdict = within(link).getByText('적합');
    expect(verdict.className).toContain(GRADE_CLASS.pass.text);
    expect(within(link).getByText('스캔 3')).toBeInTheDocument();
    expect(within(link).getByText('분석 완료')).toHaveAttribute('data-status', 'success');
    expect(within(link).getByText('2026-08-28')).toBeInTheDocument();
  });

  it('미분석 타일은 data-grade="none"과 "미분석" 글자, 처리 중 상태는 고리(in-progress)다', () => {
    renderGrid();
    const link = screen.getByRole('link', { name: /502호 · 거실/ });
    expect(link).toHaveAttribute('data-grade', 'none');
    expect(within(link).getByText('미분석')).toBeInTheDocument();
    expect(within(link).getByText('업로드됨')).toHaveAttribute('data-status', 'in-progress');
  });

  it('타일 위 막대는 판정 글자와 같은 등급 색이고, 미분석은 dim 테두리의 빈 막대다', () => {
    renderGrid();
    const barOf = (link: HTMLElement) => link.firstElementChild as HTMLElement;
    const pass = screen.getByRole('link', { name: /501호 · 거실/ });
    expect(barOf(pass).className).toContain(GRADE_CLASS.pass.bg);
    const borderline = within(screen.getByRole('region', { name: '101동' })).getByRole('link', { name: /301호 · 거실/ });
    expect(barOf(borderline).className).toContain(GRADE_CLASS.borderline.bg);
    const none = screen.getByRole('link', { name: /502호 · 거실/ });
    expect(barOf(none).className).toContain('border-dim');
    expect(barOf(none).className).not.toMatch(/bg-grade-/);
  });

  it('판정이 앞선 스캔에서 나왔으면 "<날짜> 스캔"을 판정 옆에 쓴다', () => {
    renderGrid();
    const b102 = screen.getByRole('region', { name: '102동' });
    const link = within(b102).getByRole('link');
    expect(within(link).getByText('2026-08-29 스캔')).toBeInTheDocument();
    expect(within(link).getByText('분석 중')).toHaveAttribute('data-status', 'in-progress');
  });

  it('스캔이 없는 타일은 측정위치 탭의 그 줄로 가고 날짜를 쓰지 않는다', () => {
    renderGrid({
      buildings: [{
        building: '', floors: [{ floor: '', tiles: [tile('l9', {
          label: '거실', href: '/sites/s1/locations#loc-l9', scanCount: 0, latestScanDate: null,
          state: { type: 'pending', label: '스캔 없음' },
        })] }],
      }],
    });
    const link = screen.getByRole('link', { name: /거실/ });
    expect(link).toHaveAttribute('href', '/sites/s1/locations#loc-l9');
    expect(link.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // 동·층 이름이 비어 있으면 미지정으로 쓴다(측정위치 트리와 같은 말)
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('(동 미지정)');
    expect(screen.getByRole('heading', { level: 4 }).textContent).toBe('(층 미지정)');
  });
});

describe('StatusGrid 아래 줄과 빈 격자', () => {
  it('상한을 넘었으면 "…외 n곳"과 "측정위치 전체 보기"(측정위치 탭)를 둔다', () => {
    renderGrid({ hiddenCount: 8 });
    expect(screen.getByText('…외 8곳')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '측정위치 전체 보기' })).toHaveAttribute('href', '/sites/s1/locations');
  });

  it('다 올렸으면 "…외"는 없고 "측정위치 전체 보기"만 둔다', () => {
    renderGrid();
    expect(screen.queryByText(/^…외/)).toBeNull();
    expect(screen.getByRole('link', { name: '측정위치 전체 보기' })).toBeInTheDocument();
  });

  it('측정위치가 없으면 안내와 "측정위치 등록"(측정위치 탭) 링크만 둔다', () => {
    renderGrid({ buildings: [], locationCount: 0 });
    expect(screen.getByText('등록된 측정위치가 없습니다.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '측정위치 등록' })).toHaveAttribute('href', '/sites/s1/locations');
    expect(screen.queryByRole('link', { name: '측정위치 전체 보기' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('측정위치별 판정 (0)');
  });
});
