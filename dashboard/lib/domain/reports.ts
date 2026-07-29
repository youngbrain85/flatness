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

// 대기·진행 중 재생성은 jobs_dedup 부분 유니크에 걸려 409가 되므로 버튼 자체를 감춘다
export function canRegenerate(report: {
  status: ReportStatus; gen_status: ReportGenStatus;
}): boolean {
  return report.status === 'draft'
    && report.gen_status !== 'queued' && report.gen_status !== 'processing';
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
