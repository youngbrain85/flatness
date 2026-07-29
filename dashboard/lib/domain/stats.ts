// stats.json 소비 규칙 (stats-schema.md §3: coverage 3중 의미)
import type { Stats, StatsMeta } from './types';

export function coverageLabel(stats: Stats): string {
  const isImport = stats.meta.source !== undefined;
  if (!isImport && stats.meta.surface === 'floor') return '바닥 인식률';
  return '셀 유효율';
}

// 외부(임포트) 결과 배지 판별: engine_version 태그 또는 meta.source (stats-schema.md §2)
export function isExternalImport(engineVersion: string | null, meta?: StatsMeta): boolean {
  if (engineVersion === 'external-colab-v1') return true;
  return meta?.source !== undefined;
}
