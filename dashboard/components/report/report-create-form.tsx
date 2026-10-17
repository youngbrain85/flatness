// 보고서 생성 (스펙 §7.6: 같은 측정위치의 분석 복수 선택 -> 종합의견 수정 -> 잡 등록)
// 다크 리스킨(Task 10, 아트보드 docs/design/dark/ReportNew.dc.html): 카드 하나(제목 · 포함할 분석 · 종합의견)
// + 카드 밖 오른쪽 주 버튼. 후보 줄은 "종류 · 표면 · 측정 시각(mono) · 판정 등급 배지".
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { FormField, checkClass, inputClass, textareaClass } from '@/components/ui/form';
import { GradeBadge } from '@/components/ui/grade';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { ANALYSIS_KIND_LABEL, GRADE_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import { buildDraftOpinion } from '@/lib/domain/reports';
import type { AnalysisKind, Grade, Surface } from '@/lib/domain/types';

export interface ReportCandidate {
  analysis_id: string;
  /** 단계 H: 후보 목록에서 평활도와 구배를 **문구로** 구별하기 위한 값. */
  kind: AnalysisKind;
  surface: Surface;
  scanned_at: string;
  /** 엔진이 낸 overall_verdict(없으면 'na'). 화면은 이 값으로 등급 배지 색을 고를 뿐 판정하지 않는다. */
  grade: Grade;
  summary: string | null;
  /**
   * 선택 불가 사유(한국어 문장). null이면 선택할 수 있다.
   * 화면에서 감추지 않고 사유를 그대로 보여준다 - 완료된 분석이 설명 없이
   * 사라지면 사용자가 원인을 알 수 없다. 판단 근거는 app/reports/new/page.tsx의
   * judgeBlockReason 주석.
   */
  blocked_reason: string | null;
}

/** 후보에 실린 종류를 제목 문구로. 실릴 수 있는 것만 세야 표지가 거짓이 되지 않는다. */
function kindTitleLabel(candidates: ReportCandidate[]): string {
  const usable = candidates.filter((c) => !c.blocked_reason);
  // 선택 가능한 후보가 하나도 없으면 남은 후보의 종류를 따른다. 여기서 '평활도'로
  // 되돌리면 화면에 있지도 않은 종류를 제목이 단언하게 된다.
  const source = usable.length > 0 ? usable : candidates;
  const kinds = [...new Set(source.map((c) => c.kind))].sort();
  return kinds.length > 0 ? kinds.map((k) => ANALYSIS_KIND_LABEL[k]).join('·') : '평활도';
}

/** 종합의견 초안의 항목 머리말. 같은 바닥에 평활도와 구배가 함께 실릴 수 있다. */
function opinionLabel(c: ReportCandidate): string {
  return `${ANALYSIS_KIND_LABEL[c.kind]} ${SURFACE_LABEL[c.surface]}`;
}

/** 종합의견 칸 높이: 초안 줄 수 + 2, 최소 8줄 최대 34줄. 아트보드 rows=34는 초안 문단 넷이 스크롤 없이 다
 *  보이는 높이다 - 짧은 초안에 34줄 빈칸을 두지 않고, 긴 초안은 34줄에서 멈추고 칸 안에서 스크롤한다. */
function opinionRows(text: string): number {
  return Math.min(34, Math.max(8, text.split('\n').length + 2));
}

export function ReportCreateForm({ locationId, locationLabel, candidates }: {
  locationId: string;
  locationLabel: string;
  candidates: ReportCandidate[];
}) {
  const router = useRouter();
  const kindLabel = kindTitleLabel(candidates);
  const [title, setTitle] = useState(`${locationLabel} ${kindLabel} 분석 보고서`);
  const [selected, setSelected] = useState<string[]>(
    candidates.filter((c) => !c.blocked_reason).map((c) => c.analysis_id),
  );
  const [opinion, setOpinion] = useState(
    buildDraftOpinion(candidates.filter((c) => !c.blocked_reason).map((c) => ({
      surfaceLabel: opinionLabel(c), text: c.summary,
    }))),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(analysisId: string) {
    // disabled 속성이 우회돼도(자동화·확장 프로그램) 선택되지 않게 여기서도 막는다
    if (candidates.find((c) => c.analysis_id === analysisId)?.blocked_reason) return;
    setSelected((prev) => (prev.includes(analysisId)
      ? prev.filter((id) => id !== analysisId)
      : [...prev, analysisId]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (selected.length === 0) {
      setError('보고서에 포함할 분석을 1개 이상 선택하세요.');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const { data: created, error: insertError } = await supabase
      .from('reports')
      .insert({
        location_id: locationId,
        title: title.trim() || `${kindLabel} 분석 보고서`,
        opinion_text: opinion.trim() || null,
        created_by: auth?.user?.id ?? null,
      })
      .select('id')
      .single();
    if (insertError || !created) {
      setBusy(false);
      setError(`보고서 생성에 실패했습니다: ${insertError?.message ?? '알 수 없는 오류'}`);
      return;
    }
    const reportId = (created as { id: string }).id;
    // 선택 순서를 그대로 배치 순서(sort_order)로 쓴다
    const links = selected.map((analysisId, index) => ({
      report_id: reportId, analysis_id: analysisId, sort_order: index,
    }));
    const { error: linkError } = await supabase.from('report_analyses').insert(links);
    if (linkError) {
      setBusy(false);
      setError(`포함 분석 저장에 실패했습니다: ${linkError.message}`);
      // 코드리뷰 Important(I3): 이 시점엔 이미 reports 행이 만들어졌다 - 폼에
      // 머무르게 하면 사용자가 재시도할 방법을 찾지 못한다(뒤로 가면 방금 만든
      // 보고서가 유실된 것처럼 보인다). 상세 화면으로 보내면 보고서가 존재한다는
      // 사실과 재생성 경로(I3 canRegenerate 수정)를 확인할 수 있다.
      router.push(`/reports/${reportId}`);
      return;
    }
    const enqueued = await enqueueJob(supabase, 'report', { report_id: reportId });
    if (!enqueued.ok) {
      setBusy(false);
      setError(enqueued.message);
      // 동일한 이유(I3): gen_status='queued'인 채로 잡 등록만 실패해도 상세
      // 화면의 재생성 버튼으로 복구할 수 있다.
      router.push(`/reports/${reportId}`);
      return;
    }
    router.push(`/reports/${reportId}`);
  }

  // 제출 버튼이 같은 <form> 안에 있어야 하므로 폼이 카드를 감싼다. 주 버튼은 카드 밖 오른쪽(아트보드).
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <Container>
        <div className="flex flex-col gap-[22px]">
          <FormField label="보고서 제목" htmlFor="report-title">
            <input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)}
              className={inputClass} />
          </FormField>

          <div role="group" aria-labelledby="report-candidates-label" aria-describedby="report-candidates-help"
            className="flex flex-col gap-2">
            <p id="report-candidates-label" className="text-sm font-semibold">포함할 분석</p>
            <p id="report-candidates-help" className="text-[13px] text-muted">
              같은 측정위치의 완료된 최신 분석만 후보로 표시됩니다(평활도와 구배, 바닥과 벽면을 함께 묶을 수 있습니다).
            </p>
            <div className="mt-1 flex flex-col overflow-hidden rounded-control border border-line-2 bg-ground">
              {candidates.map((c) => {
                const blocked = !!c.blocked_reason;
                const whyId = `report-candidate-why-${c.analysis_id}`;
                return (
                  <div key={c.analysis_id}
                    className={`flex flex-col border-b border-line px-4 last:border-b-0${blocked ? ' gap-2 pb-4 pt-1.5' : ''}`}>
                    <label className={`flex items-center gap-3 text-sm ${blocked ? 'min-h-11 cursor-not-allowed text-dim' : 'min-h-12 cursor-pointer py-1.5'}`}>
                      <input type="checkbox" className={checkClass} checked={selected.includes(c.analysis_id)}
                        disabled={blocked} aria-describedby={blocked ? whyId : undefined}
                        onChange={() => toggle(c.analysis_id)} />
                      {/* 종류는 **문구로** 앞세운다. 색만으로 구별하지 않는다(스펙 §7.2) - 등급 배지도 글자를 함께 쓴다.
                          막힌 줄은 등급 색 대신 중립 배지(지금 넣을 수 없는 판정이 눈에 띄지 않게). */}
                      <span className="min-w-0">
                        {ANALYSIS_KIND_LABEL[c.kind]} · {SURFACE_LABEL[c.surface]} ·{' '}
                        <span className={`font-mono text-[13px]${blocked ? '' : ' text-ink-2'}`}>{c.scanned_at}</span>
                        {' '}· 판정{' '}
                        {blocked ? <Badge tone="neutral">{GRADE_LABEL[c.grade]}</Badge> : <GradeBadge grade={c.grade} />}
                      </span>
                    </label>
                    {blocked && <div id={whyId}><Alert type="warning">{c.blocked_reason}</Alert></div>}
                  </div>
                );
              })}
            </div>
          </div>

          <FormField label="종합의견" htmlFor="report-opinion"
            description="비워 두면 분석별 자동 의견이 그대로 보고서에 실립니다. 스크리닝 한계 문구는 항상 자동 포함됩니다.">
            <textarea id="report-opinion" rows={opinionRows(opinion)} value={opinion}
              onChange={(e) => setOpinion(e.target.value)} className={textareaClass} />
          </FormField>

          {error && <Alert type="error">{error}</Alert>}
        </div>
      </Container>

      <div className="flex flex-wrap justify-end gap-3">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? '생성 요청 중...' : '보고서 생성'}
        </Button>
      </div>
    </form>
  );
}
