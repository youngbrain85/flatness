// 등급 <-> Badge tone(components/ui/badge.tsx) 매핑표.
// D8 브리프 Step 1: 화면 배지는 인라인 hex 대신 이 표로 Badge tone을 얻는다.
// GRADE_COLOR(labels.ts)는 PDF 표시 매핑의 정본으로 남는다(worker/tests/test_report_labels.py 가 파싱한다).
// 화면 캔버스(lib/viz/heatmap.ts)는 그 hex 가 아니라 lib/domain/palette.ts 의 SCREEN_GRADE_COLOR 를 쓴다.
//
// 매핑 근거: app/page.tsx의 toBarCounts가 이미 쓰는 3버킷 규칙과 같다(D3에서 확립,
// 리뷰 승인) - 경계는 아직 적합 범위라 warn, 보수·재시공은 조치가 필요해 fail로
// 묶는다. na(판정 불가)는 home 화면의 <Badge tone="unknown"> 선례를 따른다.
import type { Grade, SlopeGrade } from './types';

export const GRADE_TONE: Record<Grade, 'pass' | 'warn' | 'fail' | 'unknown'> = {
  pass: 'pass',
  borderline: 'warn',
  repair: 'fail',
  rework: 'fail',
  na: 'unknown',
};

// T7(Cloudscape): 구배 5등급(SlopeGrade, 한글 문자열)도 같은 3버킷 규칙으로 접는다.
// SLOPE_GRADE_COLOR(lib/domain/slope-heatmap.ts, 엔진 PNG와 같은 hex)는 엔진 PNG 색의 기록이다. 다크 C안의
// 구배 화면은 캔버스가 SCREEN_SLOPE_GRADE_COLOR, 범례·막대·표의 점이 SLOPE_GRADE_TO_GRADE + GRADE_CLASS 를 쓴다.
export const SLOPE_GRADE_TONE: Record<SlopeGrade, 'pass' | 'warn' | 'fail' | 'unknown'> = {
  적합: 'pass',
  경계: 'warn',
  보수: 'fail',
  재시공: 'fail',
  판정불가: 'unknown',
};

// 다크 C안(스펙 §3): 화면은 3묶음 톤이 아니라 등급 색 다섯을 그대로 쓴다. 구배 등급(엔진 한글 문자열)을
// 평활도 등급 키로 이어 화면 등급 색(GRADE_CLASS·SCREEN_GRADE_COLOR)을 같이 쓰게 하는 표다.
// 등급을 계산하는 표가 아니다 - 엔진이 낸 문자열의 이름만 바꾼다.
export const SLOPE_GRADE_TO_GRADE: Record<SlopeGrade, Grade> = {
  적합: 'pass',
  경계: 'borderline',
  보수: 'repair',
  재시공: 'rework',
  판정불가: 'na',
};
