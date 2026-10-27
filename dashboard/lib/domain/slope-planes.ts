// 다면 기준평면(구배 분석) - 평면 개수 입력 해석과 stats.planes 방어.
//
// 개수 상한은 워커(worker/flatworker/slope.py MAX_PLANES)와 같다. 화면이 먼저 막지만 워커도 같은 범위로 거부한다.
import type { SlopePlanesSummary } from './types';

export const MAX_PLANES = 20;

/** 입력칸 글자 -> 평면 개수. 빈칸은 null(다면 분석 안 함), 1~MAX_PLANES 정수가 아니면 'invalid'. */
export function parsePlaneCount(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return 'invalid';
  const n = Number(t);
  return n >= 1 && n <= MAX_PLANES ? n : 'invalid';
}

/** stats.planes 가 화면에 그릴 수 있는 형태인지(jsonb 는 무결성을 보장하지 않는다). 없거나 깨졌으면 false. */
export function hasPlanes(planes: unknown): planes is SlopePlanesSummary {
  if (!planes || typeof planes !== 'object') return false;
  const p = planes as Record<string, unknown>;
  return typeof p.requested === 'number' && typeof p.found === 'number' && Array.isArray(p.items)
    && p.items.every((it) => !!it && typeof it === 'object'
      && typeof (it as Record<string, unknown>).plane_id === 'number'
      && typeof (it as Record<string, unknown>).grade === 'string');
}
