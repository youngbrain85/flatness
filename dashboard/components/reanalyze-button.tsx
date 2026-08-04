// 스캔 상세: 분석을 시작/다시 시작하는 버튼(요구사항 C5 + 단계 C 구배 분석 시작).
//
// 엔진 개선·판정 기준 변경 후 이미 분석이 끝난 스캔을 다시 돌릴 방법이 없었다
// (기존에는 업로드 시에만 analyses 행이 생겼다). unit-confirm-form.tsx와 동일한
// 패턴(새 analyses 행 생성 -> fn_enqueue_job(...))을 재사용한다.
//
// 단계 C: kind를 받아 평활도/구배 양쪽에 쓰는 컴포넌트로 일반화했다. 구배는 지금까지
// 아무 화면에서도 시작할 방법이 없었으므로(업로드·단위확인 폼은 늘 평활도만 만든다),
// 이 버튼이 구배 분석의 "다시 분석"이자 "첫 분석 시작" 버튼을 겸한다
// (latestStatus가 undefined면 - 이 종류의 분석이 아직 한 번도 없었다는 뜻 - 진행 중이
// 아닌 것으로 보고 버튼을 활성 상태로 둔다).
//
// is_current 전환은 여기서 손대지 않는다: 새 행은 기본값 is_current=false로
// 들어가 analyses_current 부분 유니크(scan_id당 kind별 is_current=true 1개,
// 007_slope_analysis.sql:28-30 - (scan_id) 단독이던 001_schema.sql:177의 인덱스를
// (scan_id, kind)로 재정의했다)와 충돌하지 않고, 분석이 완료되면 워커의
// handle_analyze/handle_import -> _finalize -> db.set_current_analysis가 기존
// 현재 분석을 해제하고 새 분석을 현재로 세운다(worker/flatworker/jobs.py) -
// 대시보드가 중복으로 처리할 필요가 없다.
//
// 코드리뷰 Critical(C1): 잡 타입은 원본 결과의 출처(isImport)에 따라 분기해야
// 한다. 임포트 결과(외부 프로그램 CSV/JSON)를 'analyze'로 다시 돌리면
// scan.raw_file_path가 가리키는 임포트 원본 파일이 엔진의 일반 포인트클라우드
// 리더(engine/flatness/io/reader.py, .csv -> read_text_chunks)로 잘못 파싱된다 -
// 예: Colab 결과 CSV는 X,Y,Z 컬럼만 읽혀 실제 편차값인 Signed_Distance_mm이
// 통째로 무시되고, 함몰·돌출이 사라진 채 전 셀이 "적합"으로 재판정될 수 있다
// (리뷰어 실측: pass 24/borderline 12·worst 9.57mm -> pass 36/borderline 0·
// worst 0.00mm). 그 오답이 워커의 set_current_analysis로 그대로 정본이 되어
// "외부 결과" 배지(engine_version)까지 사라지므로 흔적 없이 조용히 틀린다.
// isImport(호출부가 isExternalImport로 계산해 전달, lib/domain/stats.ts)가
// true면 반드시 'import' 잡을 걸어 워커가 handle_import로 원본 CSV/JSON을
// 임포터를 통해 다시 읽게 한다. 구배(kind='slope')는 임포트 스캔에서 이 버튼
// 자체가 렌더되지 않으므로(app/scans/[id]/page.tsx) 사실상 평활도에서만 의미가 있다.
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { ANALYSIS_KIND_LABEL } from '@/lib/domain/labels';
import { isDirectionAwareCriteria } from '@/lib/domain/slope-direction';
import type { AnalysisKind, AnalysisStatus, CriteriaRow, SlopeThreshold, Surface } from '@/lib/domain/types';

interface Props {
  scanId: string;
  userId: string;
  surface: Surface;
  /** 이 버튼이 만들 분석의 종류. 버튼 문구·insert의 kind·기준 해석 방식을 모두 결정한다. */
  kind: AnalysisKind;
  /** kind==='flatness'일 때 호출부가 미리 해석해(scan.selected_criteria_id 등) 내려주는 기준.
   *  kind==='slope'이면 사용자가 아래 선택 UI에서 고른 기준을 쓰므로 쓰이지 않는다. */
  criteriaId?: string;
  /** kind==='slope'일 때 기준 후보 해석(fn_resolve_criteria)에 쓰는 현장 id. flatness에서는 쓰이지 않는다. */
  siteId?: string;
  /** 가장 최근 "같은 종류" 분석의 상태 — queued/processing이면 중복 실행을 막는다.
   *  이 종류의 분석이 아직 한 번도 없었다면 undefined(진행 중 아님으로 취급). */
  latestStatus?: AnalysisStatus;
  /** 코드리뷰 Critical(C1): true면 임포트 결과 스캔 — 'analyze' 대신 'import' 잡을 건다. */
  isImport: boolean;
}

export function ReanalyzeButton({
  scanId, userId, surface, kind, criteriaId, siteId, latestStatus, isImport,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inProgress = latestStatus === 'queued' || latestStatus === 'processing';

  // 코드리뷰(4차) N1(★★ Blocker): 예전에는 클릭 시점에 fn_resolve_criteria를
  // 불러 rows[0](= is_default 기준)을 무조건 썼다. 007 시드에서 is_default인
  // 구배 기준은 slope-indoor-level 하나뿐인데 그 기준은 방향 비대상
  // (design_pct=0, dir_pass_deg=180)이라, 대시보드 어디에도 다른 기준을 고를
  // 방법이 없어 배수구 클릭 -> slope_judge 잡으로 이어지는 단계 D 전체 경로가
  // UI로 영원히 도달 불가능했다(리뷰 실측 - 기본 기준으로는 클릭 안내조차
  // 안 뜬다). upload-form.tsx가 평활도 기준을 고르는 패턴(마운트 시 후보를
  // 불러와 라디오로 고르게 하고 is_default를 기본 선택으로 둠)을 그대로
  // 따른다 - 기본 선택은 유지하되 사용자가 바꿀 수 있게 한다.
  const [slopeCriteria, setSlopeCriteria] = useState<CriteriaRow[]>([]);
  const [slopeCriteriaId, setSlopeCriteriaId] = useState('');
  const [criteriaLoadError, setCriteriaLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'slope' || !siteId) return;
    let cancelled = false;
    (async () => {
      // 코드리뷰 I3와 같은 이유로 try/catch를 둔다 - rpc() 자체가 reject하면
      // (네트워크 오류 등) unhandled rejection으로 조용히 죽고 버튼은 "후보
      // 로딩 중"으로 영원히 멈춘다.
      try {
        const { data, error: err } = await createClient().rpc('fn_resolve_criteria', {
          p_site_id: siteId, p_surface: 'floor', p_kind: 'slope',
        });
        if (cancelled) return;
        const rows = (data ?? []) as CriteriaRow[];
        if (err || rows.length === 0) {
          // 코드리뷰(5차) Minor-1: err일 때도 rows.length===0(마이그레이션 007
          // 미적용/시드 없음)과 똑같이 "007 확인하세요"만 보여주면 err.message가
          // 버려진다 - 권한 오류·PostgREST 스키마 캐시 문제 등 007과 무관한
          // 원인일 때 운영자가 멀쩡한 마이그레이션을 뒤지게 된다. 아래 catch
          // 블록과 같은 형태로 원인을 덧붙인다.
          setCriteriaLoadError(
            err
              ? `구배 판정 기준을 불러오지 못했습니다: ${err.message}`
              : '구배 판정 기준을 찾을 수 없습니다. 마이그레이션 007이 적용됐는지 확인하세요.',
          );
          return;
        }
        setSlopeCriteria(rows);
        setSlopeCriteriaId(rows.find((c) => c.is_default)?.id ?? rows[0].id); // 기본 선택 = is_default
      } catch (e) {
        if (!cancelled) {
          const detail = e instanceof Error ? e.message : String(e);
          setCriteriaLoadError(`구배 판정 기준을 불러오는 중 오류가 발생했습니다: ${detail}`);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [kind, siteId]);

  async function onClick() {
    setBusy(true);
    setError(null);
    const supabase = createClient();

    // 0) 구배는 마운트 시점에 이미 후보를 불러와 사용자가 고른 값을 쓴다
    // (컨트롤러 보강 확정 1 + N1 수정). scans.selected_criteria_id는 kind
    // 개념이 없는 단일 컬럼이라 그대로 쓰면 평활도 기준이 실려 워커가
    // KeyError로 죽는다.
    let resolvedCriteriaId = criteriaId;
    if (kind === 'slope') {
      if (!slopeCriteriaId) {
        setBusy(false);
        setError(criteriaLoadError ?? '적용 기준을 확인할 수 없습니다.');
        return;
      }
      resolvedCriteriaId = slopeCriteriaId;
    }
    if (!resolvedCriteriaId) {
      setBusy(false);
      setError('적용 기준을 확인할 수 없습니다.');
      return;
    }

    // 1) 새 분석 행 생성(kind를 명시한다 - DB 기본값에 기대면 나중에 기본값이
    // 바뀔 때 조용히 의미가 바뀐다)
    const { data: analysis, error: insErr } = await supabase.from('analyses').insert({
      scan_id: scanId, surface, kind, criteria_id: resolvedCriteriaId, status: 'queued', created_by: userId,
    }).select('id').single();
    if (insErr || !analysis) {
      setBusy(false);
      setError(insErr?.message ?? '분석 등록 실패');
      return;
    }
    // 2) 분석 잡 등록(중복 엔큐 409는 기존 isDuplicateJobError 안내 재사용).
    // C1: isImport에 따라 'analyze'/'import'를 분기한다(주석 상단 참고).
    const r = await enqueueJob(supabase, isImport ? 'import' : 'analyze', { analysis_id: analysis.id });
    if (!r.ok) {
      // 코드리뷰 Important(I1): 엔큐 실패 시 방금 만든 analyses 행을 되돌린다.
      // 그대로 두면 status='queued'인 고아 행이 남아 scans/[id]/page.tsx의
      // latest가 이 행이 되고 inProgress가 영구 true로 고정돼 버튼이 다시는
      // 활성화되지 않는다(워커의 reap_stuck_jobs는 jobs 테이블만 보므로, 애초에
      // 잡이 없는 이 상황은 복구할 수 없다). soft delete로 지우면 상세 조회가
      // 이미 .is('deleted_at', null)로 거르므로 화면에서 깔끔히 사라진다.
      await supabase.from('analyses').update({ deleted_at: new Date().toISOString() }).eq('id', analysis.id);
      setBusy(false);
      setError(r.message);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  const label = `${ANALYSIS_KIND_LABEL[kind]} 분석`;
  return (
    <div className="flex flex-col items-end gap-1">
      {/* N1: 구배 기준 선택 - upload-form.tsx의 "적용 기준" 라디오 목록과 같은 패턴.
          thresholds[0].use(옥상 슬래브(노출방수) / 욕실·화장실 바닥 / 주차장 바닥 /
          실내 평바닥 등, 007_slope_analysis.sql:118-133)를 보여준다. */}
      {kind === 'slope' && slopeCriteria.length > 0 && (
        <div className="w-full max-w-xs rounded border bg-white p-2 text-xs">
          <p className="mb-1 font-medium text-slate-600">적용 기준</p>
          <div className="space-y-1">
            {slopeCriteria.map((c) => {
              // CriteriaRow.thresholds는 컴파일 타임에는 평활도 Threshold[]지만
              // kind='slope' 행의 실제 jsonb 내용은 SlopeThreshold다(런타임
              // 형태가 다르다 - slope-result.tsx의 stats 캐스팅과 같은 사정).
              const t = c.thresholds?.[0] as unknown as SlopeThreshold | undefined;
              const aware = isDirectionAwareCriteria(t ?? null);
              return (
                <label key={c.id} className="flex items-start gap-1.5">
                  <input type="radio" name={`slope-criteria-${scanId}`} checked={slopeCriteriaId === c.id}
                    onChange={() => setSlopeCriteriaId(c.id)} disabled={busy || inProgress}
                    className="mt-0.5" />
                  <span>
                    {t?.use ?? c.name}
                    {c.is_default && <em className="ml-1 not-italic text-blue-700">(기본)</em>}
                    {!aware && <em className="ml-1 not-italic text-slate-400">- 방향 판정 안 함</em>}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      {kind === 'slope' && criteriaLoadError && (
        <p className="max-w-xs text-xs text-red-600">{criteriaLoadError}</p>
      )}
      <button type="button" onClick={onClick}
        disabled={busy || inProgress || (kind === 'slope' && !slopeCriteriaId)}
        title={inProgress ? '이미 진행 중인 분석이 끝난 뒤 다시 시도하세요.' : undefined}
        className="rounded border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50">
        {busy ? '요청 중...' : label}
      </button>
      {inProgress && (
        <p className="text-xs text-slate-500">진행 중인 분석이 끝난 뒤 다시 시도하세요.</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
