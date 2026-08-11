// GRADE_COLOR(labels.ts, PDF·캔버스가 쓰는 hex) <-> Badge tone(components/ui/badge.tsx) 매핑표.
// D8 브리프 Step 1: 화면 배지는 인라인 hex 대신 이 표로 Badge tone을 얻는다.
// GRADE_COLOR 자체는 삭제하지 않는다 - PDF 렌더러·히트맵 캔버스(lib/viz/heatmap.ts,
// components/analysis/heatmap-view.tsx 등)는 여전히 그 hex를 직접 쓴다.
//
// 매핑 근거: app/page.tsx의 toBarCounts가 이미 쓰는 3버킷 규칙과 같다(D3에서 확립,
// 리뷰 승인) - 경계는 아직 적합 범위라 warn, 보수·재시공은 조치가 필요해 fail로
// 묶는다. na(판정 불가)는 home 화면의 <Badge tone="unknown"> 선례를 따른다.
import type { Grade } from './types';

export const GRADE_TONE: Record<Grade, 'pass' | 'warn' | 'fail' | 'unknown'> = {
  pass: 'pass',
  borderline: 'warn',
  repair: 'fail',
  rework: 'fail',
  na: 'unknown',
};
