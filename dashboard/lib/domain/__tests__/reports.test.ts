import { describe, expect, it } from 'vitest';
import { buildDraftOpinion, canFinalize, canRegenerate, reportPdfRelPath } from '../reports';

describe('reportPdfRelPath', () => {
  it('버킷-상대 규약 문자열을 만든다', () => {
    expect(reportPdfRelPath('r1')).toBe('reports/r1/report.pdf');
  });
});

describe('canFinalize (004 트리거 조건과 동일)', () => {
  it('draft + 생성 완료 + PDF 존재일 때만 발행 가능하다', () => {
    expect(canFinalize({ status: 'draft', gen_status: 'done', pdf_path: 'reports/r1/report.pdf' })).toBe(true);
  });
  it('PDF가 없으면 발행할 수 없다', () => {
    expect(canFinalize({ status: 'draft', gen_status: 'done', pdf_path: null })).toBe(false);
  });
  it('생성이 끝나지 않았으면 발행할 수 없다', () => {
    expect(canFinalize({ status: 'draft', gen_status: 'processing', pdf_path: null })).toBe(false);
  });
  it('이미 발행된 보고서는 다시 발행할 수 없다', () => {
    expect(canFinalize({ status: 'finalized', gen_status: 'done', pdf_path: 'reports/r1/report.pdf' })).toBe(false);
  });
});

describe('canRegenerate', () => {
  it('대기·진행 중이면 재생성 요청을 막는다(중복 엔큐 방지)', () => {
    expect(canRegenerate({ status: 'draft', gen_status: 'queued' })).toBe(false);
    expect(canRegenerate({ status: 'draft', gen_status: 'processing' })).toBe(false);
  });
  it('실패·완료 상태의 draft는 재생성할 수 있다', () => {
    expect(canRegenerate({ status: 'draft', gen_status: 'failed' })).toBe(true);
    expect(canRegenerate({ status: 'draft', gen_status: 'done' })).toBe(true);
  });
  it('발행본은 재생성할 수 없다', () => {
    expect(canRegenerate({ status: 'finalized', gen_status: 'done' })).toBe(false);
  });
});

describe('buildDraftOpinion', () => {
  it('표면 라벨을 붙여 분석별 의견을 이어 붙인다', () => {
    const text = buildDraftOpinion([
      { surfaceLabel: '바닥', text: '적합 구간이 대부분입니다.' },
      { surfaceLabel: '벽면', text: null },
      { surfaceLabel: '벽면', text: '  경계 구간 3개  ' },
    ]);
    expect(text).toBe('[바닥] 적합 구간이 대부분입니다.\n\n[벽면] 경계 구간 3개');
  });
});
