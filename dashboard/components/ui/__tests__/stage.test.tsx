// 검정 스테이지: stage 바탕 + line-2 + 12px + overflow hidden, 최소 높이 320px(스펙 §6·§7).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Stage } from '../stage';

const cls = (el: Element | null | undefined) => (el?.getAttribute('class') ?? '').split(/\s+/);

describe('Stage', () => {
  it('기본: 검정 바탕 + line-2 테두리 + 12px + overflow hidden + relative, 최소 높이 320px, 비율 없음, 격자 없음', () => {
    render(<Stage><canvas aria-label="히트맵" /></Stage>);
    const box = screen.getByLabelText('히트맵').parentElement!;
    expect(box).toHaveAttribute('data-stage');
    expect(cls(box)).toEqual(expect.arrayContaining([
      'relative', 'overflow-hidden', 'bg-stage', 'border', 'border-line-2', 'rounded-card', 'min-h-80',
    ]));
    expect(box.className).not.toMatch(/aspect-|drafting-grid/);
  });
  it.each([
    ['2/1', 'aspect-[2/1]'],
    ['4/3', 'aspect-[4/3]'],
  ] as ['2/1' | '4/3', string][])('aspect=%s → %s', (aspect, klass) => {
    const { container } = render(<Stage aspect={aspect}>x</Stage>);
    expect(cls(container.firstElementChild)).toContain(klass);
  });
  it('minHeight={440} → 440px(아트보드 ScanDone·ScanDeviation)', () => {
    const { container } = render(<Stage minHeight={440}>x</Stage>);
    const c = cls(container.firstElementChild);
    expect(c).toContain('min-h-[440px]');
    expect(c).not.toContain('min-h-80');
  });
  it('className 을 덧붙인다(이미지 스테이지의 p-4 등)', () => {
    const { container } = render(<Stage className="p-4">x</Stage>);
    expect(cls(container.firstElementChild)).toContain('p-4');
  });
  it('toolbar: 아래에 surface 도구 줄을 붙이고 스테이지는 위 모서리만 둥글다', () => {
    render(<Stage toolbar={<button type="button">등각</button>}><canvas aria-label="3D" /></Stage>);
    const stage = screen.getByLabelText('3D').parentElement!;
    expect(cls(stage)).toContain('rounded-t-card');
    expect(cls(stage)).not.toContain('rounded-card');
    const bar = screen.getByRole('button', { name: '등각' }).parentElement!;
    expect(cls(bar)).toEqual(expect.arrayContaining(['bg-surface', 'border-t-0', 'border-line-2', 'rounded-b-card', 'min-h-11']));
    expect(stage.nextElementSibling).toBe(bar);
  });
});
