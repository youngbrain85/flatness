// stats.json 소비 규칙 (stats-schema.md §3: coverage 3중 의미)
import type { SlopeStats, Stats, StatsMeta } from './types';

/** 구배 분석 stats인지 내용으로 판별한다.
 *
 * analyses/[id]는 .eq('id', id)뿐이라 URL 직접 접근을 쿼리 필터로 막을 수 없다.
 * 엔진이 이미 최상위에 format 판별자를 넣고(pipeline.py), 평활도 build_stats에는
 * 이 키가 없으므로 kind 컬럼 없이도 안전하게 갈린다. */
export function isSlopeStats(stats: unknown): stats is SlopeStats {
  return !!stats && typeof stats === 'object'
    && (stats as { format?: string }).format === 'slope-stats-v1';
}

export function coverageLabel(stats: Stats): string {
  const isImport = stats.meta.source !== undefined;
  if (!isImport && stats.meta.surface === 'floor') return '바닥 인식률';
  return '셀 유효율';
}

// 외부(임포트) 결과 배지 판별: engine_version 태그 또는 meta.source (stats-schema.md §2)
//
// 코드리뷰 Minor(M2): 'external-json-v1'(JSON 임포트, engine/flatness/importer/
// json_import.py)도 인식해야 한다. meta.source 경로는 이미 두 임포트 모두를
// 잡아내지만(§2 표 — CSV/JSON 공통으로 source 키가 존재), meta가 비어 있는
// 레코드(예: analyses.stats가 아직 없거나 일부만 채워진 과거 데이터)에서는
// engine_version 태그가 유일한 판별 근거라 두 값을 모두 하드코딩해야 한다.
// 코드리뷰 Critical(C1)이 이 헬퍼에 의존하므로(재분석 시 analyze/import 잡 분기)
// 여기서 놓치면 JSON 임포트 결과가 "외부 결과"로 인식되지 못해 재분석이 다시
// analyze로 잘못 걸릴 수 있다.
export function isExternalImport(engineVersion: string | null, meta?: StatsMeta): boolean {
  if (engineVersion === 'external-colab-v1' || engineVersion === 'external-json-v1') return true;
  return meta?.source !== undefined;
}
