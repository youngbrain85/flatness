// 표시 매핑 정본 (stats-schema.md 부록 A, 스펙 §9)
import type {
  AnalysisKind, AnalysisStatus, Grade, Lineage, RegistrationStatus, ReportGenStatus, ReportStatus,
  ScanStatus, Surface,
} from './types';

export const ANALYSIS_KIND_LABEL: Record<AnalysisKind, string> = {
  flatness: '평활도', slope: '구배',
};

export const GRADE_LABEL: Record<Grade, string> = {
  pass: '적합', borderline: '경계', repair: '보수', rework: '재시공', na: '판정 불가',
};

export const GRADE_COLOR: Record<Grade, string> = {
  pass: '#2e7d32', borderline: '#f9ab00', repair: '#e8710a', rework: '#c5221f', na: '#9e9e9e',
};

export const SCAN_STATUS_LABEL: Record<ScanStatus, string> = {
  uploaded: '업로드됨', awaiting_unit_confirm: '단위 확인 대기',
  ready: '분석 준비됨', archived: '보관됨', failed: '실패',
};

export const ANALYSIS_STATUS_LABEL: Record<AnalysisStatus, string> = {
  queued: '분석 대기 중', processing: '분석 중', done: '완료', failed: '실패',
};

export const SURFACE_LABEL: Record<Surface, string> = { floor: '바닥', wall: '벽면' };

// registered는 단계 F의 정합 병합 스캔이다(설계 결정 F9). 워커 report/labels.py와
// 등가여야 하며(worker/tests/test_report_labels.py가 이 파일을 파싱해 대조한다)
// 업로드 화면의 선택지에는 넣지 않는다 - 시스템이 만드는 값이다.
export const LINEAGE_LABEL: Record<Lineage, string> = {
  raw: '원시 점군', fused_mesh: '융합 메시', unknown: '모름', registered: '정합 병합',
};

// registration_status enum(007_slope_analysis.sql). 정합 진행 상태는 반드시 이
// 테이블에서 읽는다 - jobs는 RLS 정책이 0개라 대시보드가 못 읽는다(설계 결정 F10).
export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  awaiting_points: '대응점 지정 대기', queued: '정합 대기 중', processing: '정합 중',
  done: '정합 완료', failed: '정합 실패',
};

export const ZONE_STATUS_LABEL: Record<'ok' | 'ghost' | 'furniture', string> = {
  ok: '정상', ghost: '유령층(제외)', furniture: '가구 추정(제외)',
};

// warnings 코드 사전 (stats-schema.md §5)
const WARNING_LABEL: Record<string, string> = {
  ghost_layer_rescan:
    '이중 표면(유령층) 서브셀이 감지되어 일부가 판정에서 제외되었습니다. 재스캔을 권장합니다.',
  ghost_zone_excluded: '이중 표면 비율이 높은 구역 전체가 판정에서 제외되었습니다.',
  furniture_excluded: '가구 상판으로 추정되는 구역이 판정에서 제외되었습니다.',
  low_coverage: '바닥 인식률이 70% 미만입니다. 스캔 범위·가림을 확인하세요.',
  reduced_span:
    '공간 제약으로 기준 스팬보다 짧은 직선자 길이를 사용해 허용치와 불확도를 선형 환산했습니다.',
  uncertainty_swallows_repair:
    '측정 불확도가 보수 구간을 잠식합니다(경계 구간이 보수 구간을 흡수). 보수 판정이 나오지 않을 수 있습니다.',
  uncertainty_swallows_pass:
    '측정 불확도가 허용치보다 커서 적합 판정이 나올 수 없습니다(기준 또는 불확도 재검토 필요).',
  plumbness_relative_to_z: '수직도는 스캔 좌표계 z축 기준 상대 지표입니다(중력 보정 아님).',
  fused_mesh_smoothed:
    '융합 메시는 스캐너 앱이 표면을 매끄럽게 다듬은 데이터라 실제 요철보다 양호한 결과가 나올 수 있습니다. 가능하면 원시 점군으로 다시 내보내 분석하세요.',
  heatmap_render_failed:
    '판정 히트맵 이미지 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.',
  preview3d_render_failed:
    '3D 프리뷰 이미지 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.',
  deviation_render_failed:
    '정밀 편차맵 이미지 생성에 실패했습니다. 판정 수치·등급에는 영향이 없습니다.',
};

export function warningLabel(code: string): string {
  if (WARNING_LABEL[code]) return WARNING_LABEL[code];
  const m = code.match(/^wall_(\d+)_skipped$/); // 개방 패턴 (stats-schema.md §5)
  if (m) return `${m[1]}번 벽 후보가 유효 데이터 부족 또는 처리 오류로 판정에서 제외되었습니다.`;
  return code; // 미지 코드는 원문 노출(숨기는 것보다 안전)
}

export const REPORT_STATUS_LABEL: Record<ReportStatus, string> = {
  draft: '작성 중', finalized: '발행됨',
};

export const REPORT_GEN_STATUS_LABEL: Record<ReportGenStatus, string> = {
  queued: 'PDF 생성 대기 중', processing: 'PDF 생성 중', done: '생성 완료', failed: '생성 실패',
};

export function fmtMm(v: number | null): string {
  return v === null ? '-' : v.toFixed(2);
}
