// 보고서 도메인 규칙 (스펙 §7.6). 발행 가능 조건은 004의 finalized 트리거와 동일하게 둔다.
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

// 종합의견 초안: 분석별 의견(user_summary ?? auto_summary)을 표면 라벨과 함께 결합
export function buildDraftOpinion(
  items: { surfaceLabel: string; text: string | null }[],
): string {
  return items
    .filter((i) => i.text && i.text.trim())
    .map((i) => `[${i.surfaceLabel}] ${i.text!.trim()}`)
    .join('\n\n');
}
