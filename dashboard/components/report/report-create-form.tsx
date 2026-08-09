// 보고서 생성 (스펙 §7.6: 같은 측정위치의 분석 복수 선택 -> 종합의견 수정 -> 잡 등록)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { ANALYSIS_KIND_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import { buildDraftOpinion } from '@/lib/domain/reports';
import type { AnalysisKind, Surface } from '@/lib/domain/types';

export interface ReportCandidate {
  analysis_id: string;
  /** 단계 H: 후보 목록에서 평활도와 구배를 **문구로** 구별하기 위한 값. */
  kind: AnalysisKind;
  surface: Surface;
  scanned_at: string;
  verdict_label: string;
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

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border bg-white p-4">
      <div>
        <label htmlFor="report-title" className="block text-sm font-medium">보고서 제목</label>
        <input id="report-title" value={title} onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full rounded border px-2 py-1 text-sm" />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">포함할 분석</legend>
        <p className="text-xs text-slate-500">
          같은 측정위치의 완료된 최신 분석만 후보로 표시됩니다(평활도와 구배, 바닥과 벽면을 함께 묶을 수 있습니다).
        </p>
        <ul className="mt-2 space-y-1">
          {candidates.map((c) => (
            <li key={c.analysis_id} className="rounded border p-2 text-sm">
              {/* 종류는 **문구로** 앞세운다. 색만으로 구별하지 않는다(스펙 §7.2). */}
              <label className={`flex items-center gap-2 ${c.blocked_reason ? 'text-slate-400' : ''}`}>
                <input type="checkbox" checked={selected.includes(c.analysis_id)}
                  disabled={!!c.blocked_reason}
                  onChange={() => toggle(c.analysis_id)} />
                <span>
                  {ANALYSIS_KIND_LABEL[c.kind]} · {SURFACE_LABEL[c.surface]} · {c.scanned_at} ·
                  {' '}판정 {c.verdict_label}
                </span>
              </label>
              {c.blocked_reason && (
                <p className="mt-1 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                  {c.blocked_reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      </fieldset>

      <div>
        <label htmlFor="report-opinion" className="block text-sm font-medium">종합의견</label>
        <p className="text-xs text-slate-500">
          비워 두면 분석별 자동 의견이 그대로 보고서에 실립니다. 스크리닝 한계 문구는 항상 자동 포함됩니다.
        </p>
        <textarea id="report-opinion" rows={8} value={opinion}
          onChange={(e) => setOpinion(e.target.value)}
          className="mt-1 w-full rounded border px-2 py-1 text-sm" />
      </div>

      {error && <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <button type="submit" disabled={busy}
        className="rounded bg-slate-800 px-4 py-2 text-sm text-white disabled:opacity-50">
        {busy ? '생성 요청 중...' : '보고서 생성'}
      </button>
    </form>
  );
}
