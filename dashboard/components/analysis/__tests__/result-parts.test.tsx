import { describe, expect, it } from 'vitest';
import { CARD, EYEBROW, NOTE, resultMeta } from '../result-parts';

describe('resultMeta (결과 머리의 일시 · 엔진)', () => {
  it('created_at 앞 16자(T 를 공백으로) · 엔진 버전, 버전이 없으면 -', () => {
    expect(resultMeta('2026-10-04T15:49:12.345+00:00', 'p4-0.5.0')).toBe('2026-10-04 15:49 · 엔진 p4-0.5.0');
    expect(resultMeta('2026-07-29', null)).toBe('2026-07-29 · 엔진 -');
  });
});

// 아트보드 ScanDone 의 카드·눈썹 라벨·보조 문단 값(스펙 §8: dim 은 11px 눈썹 라벨에만)
describe('결과 구획 글자·카드 토큰', () => {
  it('카드는 surface + line-2 + 12px, 눈썹 라벨은 mono 11px dim, 보조 문단은 13px muted', () => {
    for (const t of ['rounded-card', 'border', 'border-line-2', 'bg-surface']) expect(CARD.split(' ')).toContain(t);
    expect(EYEBROW).toBe('font-mono text-[11px] tracking-[0.08em] text-dim');
    expect(NOTE.split(' ')).toEqual(expect.arrayContaining(['text-[13px]', 'text-muted']));
  });
});
