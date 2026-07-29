// 보고서 생성 (스펙 §7.6: 같은 측정위치의 분석 복수 선택 -> 종합의견 수정 -> 잡 등록)
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { SURFACE_LABEL } from '@/lib/domain/labels';
import { buildDraftOpinion } from '@/lib/domain/reports';
import type { Surface } from '@/lib/domain/types';

export interface ReportCandidate {
  analysis_id: string;
  surface: Surface;
  scanned_at: string;
  verdict_label: string;
  summary: string | null;
}

export function ReportCreateForm({ locationId, locationLabel, candidates }: {
  locationId: string;
  locationLabel: string;
  candidates: ReportCandidate[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(`${locationLabel} 평활도 분석 보고서`);
  const [selected, setSelected] = useState<string[]>(candidates.map((c) => c.analysis_id));
  const [opinion, setOpinion] = useState(
    buildDraftOpinion(candidates.map((c) => ({
      surfaceLabel: SURFACE_LABEL[c.surface], text: c.summary,
    }))),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(analysisId: string) {
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
        title: title.trim() || '평활도 분석 보고서',
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
      return;
    }
    const enqueued = await enqueueJob(supabase, 'report', { report_id: reportId });
    if (!enqueued.ok) {
      setBusy(false);
      setError(enqueued.message);
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
          같은 측정위치의 완료된 최신 분석만 후보로 표시됩니다(바닥과 벽면을 함께 묶을 수 있습니다).
        </p>
        <ul className="mt-2 space-y-1">
          {candidates.map((c) => (
            <li key={c.analysis_id} className="rounded border p-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={selected.includes(c.analysis_id)}
                  onChange={() => toggle(c.analysis_id)} />
                <span>{SURFACE_LABEL[c.surface]} · {c.scanned_at} · 판정 {c.verdict_label}</span>
              </label>
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
