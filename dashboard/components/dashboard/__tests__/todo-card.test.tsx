// TodoCard(할 일 카드, 아트보드 DashStatus): 줄 순서는 받은 그대로(buildSiteDashboard가 정한다),
// 줄마다 상태 점 · 측정위치(또는 보고서 제목) · 표면 · 날짜 · "열기"(읽을 이름), 빈 문구.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TodoCard } from '../todo-card';
import type { DashTodo } from '@/lib/domain/site-dashboard';

const TODOS: DashTodo[] = [
  {
    kind: 'awaiting_unit', key: 'awaiting_unit:a1', type: 'pending', label: '단위 확인 대기',
    title: '101동 · 5층 · 502호 · 거실', detail: '바닥', date: '2026-09-02', href: '/scans/a1',
    ariaLabel: '101동 5층 502호 거실 스캔 열기',
  },
  {
    kind: 'report_failed', key: 'report_failed:rf', type: 'error', label: '생성 실패',
    title: '101동 301호 평활도 보고서', detail: '101동 · 3층 · 301호 · 거실', date: '2026-08-30',
    href: '/reports/rf', ariaLabel: '101동 301호 평활도 보고서 열기',
  },
  {
    kind: 'analysis_processing', key: 'analysis_processing:q1', type: 'in-progress', label: '분석 중',
    title: '101동 · 3층 · 301호 · 거실', detail: '벽면', date: '2026-08-29', href: '/scans/q1',
    ariaLabel: '101동 3층 301호 거실 스캔 열기',
  },
];

describe('TodoCard', () => {
  it('제목 "할 일"에 줄 수를 붙이고, 줄은 받은 순서대로 그린다', () => {
    const { container } = render(<TodoCard todos={TODOS} noScanAttention={false} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/할 일\s*\(3\)/);
    expect([...container.querySelectorAll('[data-todo]')].map((li) => li.getAttribute('data-todo')))
      .toEqual(['awaiting_unit', 'report_failed', 'analysis_processing']);
  });

  it('줄: 상태 점과 글자 · 측정위치 · "표면 · 날짜" · 읽을 이름이 붙은 "열기" 링크', () => {
    const { container } = render(<TodoCard todos={TODOS} noScanAttention={false} />);
    const first = container.querySelector('[data-todo="awaiting_unit"]') as HTMLElement;
    expect(within(first).getByText('단위 확인 대기')).toHaveAttribute('data-status', 'pending');
    expect(within(first).getByText('101동 · 5층 · 502호 · 거실')).toBeInTheDocument();
    expect(first.textContent).toContain('바닥 · 2026-09-02');
    const open = within(first).getByRole('link', { name: '101동 5층 502호 거실 스캔 열기' });
    expect(open).toHaveAttribute('href', '/scans/a1');
    expect(open.textContent).toBe('열기');
    expect(screen.getByRole('link', { name: '101동 301호 평활도 보고서 열기' })).toHaveAttribute('href', '/reports/rf');
    expect(screen.getByText('생성 실패')).toHaveAttribute('data-status', 'error');
    expect(screen.getByText('분석 중')).toHaveAttribute('data-status', 'in-progress');
  });

  it('실패·단위 확인 대기가 없으면 줄 아래에 아트보드의 안내 문구를 둔다', () => {
    render(<TodoCard todos={[TODOS[2]]} noScanAttention />);
    expect(screen.getByText('실패하거나 단위 확인을 기다리는 스캔은 없습니다.')).toBeInTheDocument();
  });

  it('실패·단위 확인 대기가 있으면 안내 문구를 두지 않는다', () => {
    render(<TodoCard todos={TODOS} noScanAttention={false} />);
    expect(screen.queryByText('실패하거나 단위 확인을 기다리는 스캔은 없습니다.')).toBeNull();
  });

  it('할 일이 없으면 목록 없이 (0)과 안내 문구만 둔다', () => {
    render(<TodoCard todos={[]} noScanAttention />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(/할 일\s*\(0\)/);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('실패하거나 단위 확인을 기다리는 스캔은 없습니다.')).toBeInTheDocument();
  });
});

// Task 12 휴대폰 점검: 할 일 줄의 측정위치·보고서 제목도 띄어쓰기 없는 긴 이름이면 칸 안에서 줄바꿈한다
describe('TodoCard 긴 이름', () => {
  it('제목·상세 글자는 overflow-wrap:anywhere 다', () => {
    const t = { ...TODOS[1], title: 'NorthEastWingBuilding101Extension/Floor03Mezzanine 평활도 보고서', detail: 'NorthEastWingBuilding101Extension · Floor03Mezzanine' };
    const { container } = render(<TodoCard todos={[t]} noScanAttention={false} />);
    expect(screen.getByText(t.title).className.split(' ')).toContain('[overflow-wrap:anywhere]');
    const detail = [...container.querySelectorAll('span')].find((el) => (el.textContent ?? '').startsWith(t.detail));
    expect(detail?.className.split(' ')).toContain('[overflow-wrap:anywhere]');
  });
});

// 최종 리뷰: Tailwind preflight 가 목록에 list-style: none 을 걸면 Safari VoiceOver 가 ul 을 목록으로 읽지 않는다.
// 그래서 ul 에 role="list" 를 직접 단다(jsdom 은 암묵 역할로 list 를 주므로 getByRole 이 아니라 속성을 본다).
describe('TodoCard 목록 의미 (Safari VoiceOver)', () => {
  it('할 일 목록 ul 은 role="list" 를 직접 단다', () => {
    const { container } = render(<TodoCard todos={TODOS} noScanAttention={false} />);
    const lists = [...container.querySelectorAll('ul')];
    expect(lists).toHaveLength(1);
    for (const ul of lists) expect(ul).toHaveAttribute('role', 'list');
  });
});
