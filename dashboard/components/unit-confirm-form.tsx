// 스펙 §7.4 단위 확인 화면.
// P2 확정: precheck는 단위 후보를 저장할 컬럼이 없어 후보·근거 표시는 백로그 -
// 사용자가 파일의 좌표 단위를 직접 선택해 확정한다.
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import type { ScanRow } from '@/lib/domain/types';
import { UNIT_OPTIONS } from '@/lib/upload/validate';

export function UnitConfirmForm({ scan, userId }: { scan: ScanRow; userId: string }) {
  const router = useRouter();
  const [unitScale, setUnitScale] = useState<number>(1.0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!scan.selected_criteria_id) {
      setError('적용 기준이 지정되지 않은 스캔입니다. 업로드를 다시 진행하세요.');
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // 1) 단위 확정 + ready 승격 (P2 확정: 확정은 UI 책임 - 워커 재경유 없이 직접 갱신)
    const { error: updErr } = await supabase.from('scans')
      .update({ unit_scale: unitScale, status: 'ready' }).eq('id', scan.id);
    if (updErr) { setError(updErr.message); setBusy(false); return; }

    // 이 지점 이후로 실패하면 위 1)을 반드시 되돌려야 한다. status='ready'인데 분석 행이
    // 없는 스캔은 scans/[id] 화면의 어느 분기에도 걸리지 않는다 - awaiting_unit_confirm도
    // uploaded도 failed도 아니고, latest가 없어 분석 섹션이 통째로 사라진다. 목록에도
    // "분석 준비됨"이라는 정상 뱃지로만 보여서 재시도 링크도 오류 표시도 없이 조용히
    // 죽는다. status를 되돌리면 단위 확인 링크가 다시 나타나 사용자가 재시도할 수 있다.
    async function failAndRevert(message: string) {
      const { error: revErr } = await supabase.from('scans')
        .update({ unit_scale: null, status: 'awaiting_unit_confirm' }).eq('id', scan.id);
      setError(revErr
        ? `${message} 스캔 상태를 되돌리지 못했습니다. 이 스캔은 분석이 등록되지 않은 채 "분석 준비됨"으로 남아 있으니 관리자에게 알리세요.`
        : message);
      setBusy(false);
    }

    // 2) 분석 행 생성 -> 분석 잡 등록 (스펙 §3.2.③: 단위 확정 시 분석 잡 자동 등록)
    // kind를 명시적으로 지정한다(단계 C). DB 기본값('flatness')에 기대면 나중에
    // 기본값이 바뀔 때 이 화면의 의미가 조용히 바뀐다 - 단위 확인 화면은 항상
    // 평활도 첫 분석만 만든다(구배는 스캔 상세의 별도 버튼으로 시작한다).
    const { data: analysis, error: aErr } = await supabase.from('analyses').insert({
      scan_id: scan.id, surface: scan.surface, criteria_id: scan.selected_criteria_id,
      kind: 'flatness', status: 'queued', created_by: userId,
    }).select('id').single();
    if (aErr || !analysis) { await failAndRevert(aErr?.message ?? '분석 등록 실패'); return; }
    const r = await enqueueJob(supabase, 'analyze', { analysis_id: analysis.id });
    if (!r.ok) {
      // reanalyze-button.tsx의 I1과 같은 처방: 엔큐가 실패했으면 방금 만든 analyses
      // 행을 되돌린다. 그대로 두면 status='queued'인 고아 행이 남아 scans/[id]의
      // latest가 이 행이 되고 inProgress가 영구 true로 고정된다. 워커의
      // reap_stuck_jobs는 jobs 테이블만 보는데 여기선 잡 자체가 없으므로 자동 복구도
      // 안 된다. soft delete면 상세 조회가 이미 .is('deleted_at', null)로 거른다.
      await supabase.from('analyses')
        .update({ deleted_at: new Date().toISOString() }).eq('id', analysis.id);
      // 409(중복 엔큐) 등 실패 안내를 사용자가 읽을 수 있게 화면에 남는다
      await failAndRevert(r.message);
      return;
    }
    // push만 한다. 뒤에 router.refresh()를 붙이면 refresh가 "현재 라우트"를 다시
    // 렌더하면서 진행 중이던 이동을 취소한다(로그인 화면에서 실제로 재현된 결함).
    // scans/[id]는 force-dynamic이고 동적 페이지의 클라이언트 캐시 staleTime
    // 기본값은 0초(캐시 안 함)라, push만으로도 항상 서버에서 새로 받아온다.
    router.push(`/scans/${scan.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-md space-y-4">
      <p className="rounded bg-slate-100 p-3 text-sm">
        <span className="font-medium">{scan.original_filename ?? '(파일명 없음)'}</span>
        <span className="block text-xs text-slate-500">
          파일 좌표의 길이 단위를 확정해야 분석을 시작할 수 있습니다. 단위가 틀리면
          결과 전체가 왜곡되므로 스캔 앱의 내보내기 설정을 확인하세요.
        </span>
      </p>
      <div className="space-y-1">
        {UNIT_OPTIONS.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <input type="radio" checked={unitScale === o.value} onChange={() => setUnitScale(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={busy}
        className="rounded bg-slate-800 px-4 py-2 text-white disabled:opacity-50">
        단위 확정 후 분석 시작
      </button>
    </form>
  );
}
