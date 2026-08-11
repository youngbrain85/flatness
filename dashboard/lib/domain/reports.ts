// 보고서 도메인 규칙 (스펙 §7.6). 발행 가능 조건은 004의 finalized 트리거와 동일하게 둔다.
import { REPORT_GEN_STATUS_LABEL, REPORT_STATUS_LABEL } from './labels';
import type { ReportGenStatus, ReportStatus } from './types';

// 경로 계약: DB에는 버킷-상대 문자열만 (스펙 §6.3)
export function reportPdfRelPath(reportId: string): string {
  return `reports/${reportId}/report.pdf`;
}

export function canFinalize(report: {
  status: ReportStatus; gen_status: ReportGenStatus; pdf_path: string | null;
}): boolean {
  return report.status === 'draft' && report.gen_status === 'done' && !!report.pdf_path;
}

// 코드리뷰 Important(I3): 'queued'를 재생성 불가로 두면, 생성 폼에서 링크 insert나
// 잡 enqueue가 실패해 gen_status가 'queued'에 멈춘 보고서는 재시도 버튼조차 없는
// 영구 데드엔드가 된다. 진행 중(processing)만 막으면 충분하다 - queued에서 다시
// 누르면 잡이 실제로 대기 중일 때는 jobs_dedup 부분 유니크(23505)에 걸리고
// enqueueJob이 이를 안내 문구로 바꿔주므로(dashboard/lib/domain/jobs.ts) 중복
// 엔큐 걱정은 없다.
export function canRegenerate(report: {
  status: ReportStatus; gen_status: ReportGenStatus;
}): boolean {
  return report.status === 'draft' && report.gen_status !== 'processing';
}

// D7: 보고서 목록(Badge)·상세(StatusDot)가 같은 판단을 재사용한다. tone은 두 컴포넌트
// tone 타입의 교집합만 쓴다(BadgeTone엔 'busy'가, StatusDot tone엔 'neutral'이 없다) -
// 이러면 어느 쪽에 꽂아도 어댑터 없이 그대로 유효한 값이 된다. TONE 정의(badge.tsx)에서
// unknown과 neutral은 완전히 같은 색이라 진행 중·미발행 초안 둘 다 unknown으로 묶어도
// 시각적 손실이 없다 - 구분은 라벨 문구가 한다.
export function reportStatusBadge(report: { status: ReportStatus; gen_status: ReportGenStatus }): {
  tone: 'pass' | 'fail' | 'unknown'; label: string;
} {
  // report-progress.tsx와 같은 전제: 발행본은 재생성이 불가능해 gen_status가 다시
  // 갱신되지 않는 잔재 정보다. 여기서도 finalized를 먼저 걸러 그 잔재를 무시한다.
  if (report.status === 'finalized') return { tone: 'pass', label: REPORT_STATUS_LABEL.finalized };
  if (report.gen_status === 'failed') return { tone: 'fail', label: REPORT_GEN_STATUS_LABEL.failed };
  if (report.gen_status === 'done') return { tone: 'unknown', label: REPORT_STATUS_LABEL.draft };
  return { tone: 'unknown', label: REPORT_GEN_STATUS_LABEL[report.gen_status] };
}

// 종합의견 초안: 분석별 의견(user_summary ?? auto_summary)을 표면 라벨과 함께 결합
export function buildDraftOpinion(
  items: { surfaceLabel: string; text: string | null }[],
): string {
  return items
    .filter((i) => i.text && i.text.trim())
    .map((i) => `[${i.surfaceLabel}] ${i.text!.trim()}`)
    .join('\n\n');
}

// 삭제 확인 문구. 발행본과 초안을 구분하는 이유: 발행본은 대외에 제출됐을 수
// 있는 기록이고 스냅샷·복사된 자산으로 원본과 무관하게 재현되도록 만든 것이라,
// 초안과 같은 무게로 지우게 하면 안 된다. 소프트 삭제라 되돌릴 수는 있지만
// 화면에서는 사라지므로 그 사실을 알린다.
export function deleteConfirmText(report: { status: ReportStatus }): string {
  return report.status === 'finalized'
    ? '이미 발행된 보고서입니다. 삭제하면 목록과 상세에서 사라집니다. 삭제할까요?'
    : '이 보고서를 삭제할까요? 목록과 상세에서 사라집니다.';
}
