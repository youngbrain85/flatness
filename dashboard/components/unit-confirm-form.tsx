// 스펙 §7.4 단위 확인 화면.
// P2 확정: precheck는 단위 "후보"(detect_units의 판별 결과)를 저장할 컬럼이 없어
// 후보·근거 문구 표시는 여전히 백로그다 - 단계 E에서도 그 컬럼은 생기지 않았다.
// 대신 precheck가 높이 뷰 PNG를 남기므로(scans.height_view_path, 010) 사용자가
// 그 그림의 축 눈금과 실제 공간 크기를 견주어 단위를 직접 확정한다.
'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { enqueueJob } from '@/lib/domain/jobs';
import { dataUrl } from '@/lib/domain/paths';
import type { ScanRow } from '@/lib/domain/types';
import { UNIT_OPTIONS } from '@/lib/upload/validate';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormField, checkClass } from '@/components/ui/form';
import { Icon } from '@/components/ui/icons';

export function UnitConfirmForm({ scan, userId }: { scan: ScanRow; userId: string }) {
  const router = useRouter();
  const [unitScale, setUnitScale] = useState<number>(1.0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 경로가 남아 있어도 그림을 못 받을 수 있다: /api/data는 서명 URL 302를 거치므로
  // 객체가 나중에 지워졌으면 404다. null 검사만으로는 이 경우를 못 잡아 깨진 이미지
  // 아이콘만 남고, 사용자는 "원래 없는 것"인지 "지금 못 불러온 것"인지 구별하지 못한다.
  const [viewFailed, setViewFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // ★ onError 하나만으로는 부족하다(실측으로 확인: 401을 주고 실제 브라우저에서
  // 띄웠더니 하이드레이션까지 끝났는데도 폴백이 안 뜨고 깨진 이미지 아이콘만 남았다).
  // 이 화면은 서버 렌더된 HTML에 <img>가 이미 들어 있어, 브라우저가 그 요청을
  // 하이드레이션(=React가 onError를 붙이는 시점)보다 먼저 끝낸다. 그 사이에 지나간
  // error 이벤트는 React가 받지 못하고 영영 사라진다. 그래서 마운트 직후 이미지의
  // 최종 상태를 직접 확인한다: complete인데 naturalWidth가 0이면 깨진 이미지다.
  // (onError는 하이드레이션 이후에 실패하는 경우를 위해 그대로 둔다.)
  useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth === 0) setViewFailed(true);
  }, []);

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
    // D5(스캔 작업대 통합): 이 폼은 스캔 상세(/scans/[id]) 안에 인라인으로 렌더된다 -
    // 제출 성공 후 갈 곳이 "지금 이 화면"이다. 같은 라우트로 push하면 히스토리만
    // 한 칸 쌓이고(뒤로 가기가 확정 전 화면으로 돌아가는 착시), 서버 데이터 갱신은
    // refresh가 정확히 그 일을 한다. 옛 동작(별도 confirm-unit 화면에서 push로 이동)
    // 시절의 "push 직후 refresh는 이동을 취소한다"는 결함은 이동 자체가 사라지면서
    // 함께 사라졌다. 실패 경로에서는 부르지 않는다 - 오류 문구를 그린 클라이언트
    // 상태 위로 서버 렌더가 덮이면 재시도 안내가 사라진다.
    router.refresh();
  }

  const form = (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* 아트보드(ScanUnitConfirm) 우열: info Alert(파일명 mono 700 + 12px 설명) → 라디오 → primary. */}
      <Alert type="info" title={<span className="font-mono">{scan.original_filename ?? '(파일명 없음)'}</span>}>
        <p className="text-xs leading-4 text-cs-text-secondary">
          파일 좌표의 길이 단위를 확정해야 분석을 시작할 수 있습니다. 단위가 틀리면
          결과 전체가 왜곡되므로 스캔 앱의 내보내기 설정을 확인하세요.
        </p>
      </Alert>
      <FormField label="파일 좌표 단위">
        <div className="flex flex-col gap-2">
          {UNIT_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="unit-scale" className={checkClass}
                checked={unitScale === o.value} onChange={() => setUnitScale(o.value)} />
              {o.label}
            </label>
          ))}
        </div>
      </FormField>
      {error && <p className="text-sm text-cs-error">{error}</p>}
      <div className="flex">
        <Button type="submit" variant="primary" disabled={busy}>
          <Icon name="check-circle" />
          단위 확정 후 분석 시작
        </Button>
      </div>
    </form>
  );

  // 높이 뷰가 없는 스캔은 지금까지와 완전히 같은 화면을 본다 - 이 경로가 죽으면
  // 기존 스캔 전부가 단위를 확정하지 못한다. 값이 비는 진짜 이유는 두 가지다:
  // (1) precheck를 돈 적이 없는 기존 스캔(임포트 등), (2) 렌더·업로드가 실패한 경우.
  // "점이 성기면 워커가 건너뛴다"는 더 이상 사실이 아니다 - Task 2 리뷰에서 그 스킵
  // 분기가 제거됐다. 전부-NaN 그림이어도 축 눈금은 진짜 bbox 값으로 찍혀(mm 파일이면
  // 0~8000) 단위 질문의 답이 나오기 때문이다. 그래서 성긴 스캔은 이제 "그림 없음"이
  // 아니라 "거의 빈 그림 + 빨간 경고"로 온다(아래 안내가 색이 아니라 눈금을 가리키는
  // 이유이기도 하다).
  //
  // truthy 검사인 이유(방어가 아니라 의도): null뿐 아니라 undefined와 ''도 함께
  // 걸러야 한다. 010_scan_height_view.sql을 아직 적용하지 않은 DB에서는 select('*')에
  // 이 컬럼 자체가 없어 undefined로 온다 - 즉 대시보드를 010보다 먼저 배포해도 이
  // 화면은 살아 있다(워커와 정반대라 배포 순서 위험이 한쪽으로 준다). === null로
  // 좁히면 그 성질이 조용히 사라진다.
  if (!scan.height_view_path) return form;

  // 그림이 단위 판단의 근거이므로 폼보다 넓게 잡는다 - 아래 3fr:2fr 격자가 그 비율이다
  // (라디오 3개짜리 폼을 늘릴 이유가 없다). Cloudscape 재스킨으로 폼의 max-w-md와
  // 페이지의 max-w-6xl이 함께 사라졌으므로, 남는 폭은 전부 그림 열이 가져간다.
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <section className="flex flex-col gap-2">
        {/* 리뷰 6: PNG 안에 matplotlib가 같은 제목("높이 뷰 (평면도)")을 이미 구워
            넣는다. 눈에 보이는 h2를 그대로 두면 한 화면에 제목이 두 번 뜬다. 제목
            자체를 지우는 대신 sr-only로 돌린 이유는 접근성이다: 스크린리더는 PNG
            안의 글자를 읽지 못하므로, 제목을 지우면 이 영역이 heading 없는 익명
            블록이 되어 건너뛰기 탐색에서 사라진다. 보이는 라벨 역할은 아래
            "원본 크기로 열기" 링크와 설명 문단이 대신한다. */}
        <h2 className="sr-only">높이 뷰 (평면도)</h2>
        {viewFailed ? (
          <Alert type="warning">
            높이 뷰를 불러오지 못했습니다. 그림 없이도 단위는 확정할 수 있습니다.
            파일명과 스캔 앱의 내보내기 설정을 확인해 단위를 고르세요.
          </Alert>
        ) : (
          <>
            {/* 리뷰 3: 좁은 화면에서 그림은 원본의 22.6%까지 줄어 축 눈금 숫자가
                뭉개진다(실측). 축 눈금을 읽는 것이 이 화면의 전부이므로 원본을 새 탭
                으로 여는 길이 반드시 있어야 한다 - "데스크톱 전용"으로 선언하는 대신
                모든 뷰포트에서 통하는 링크 하나로 푼다. 그림과 라벨을 한 링크로 묶어
                (그림 클릭 = 라벨 클릭) 링크가 둘로 갈라지지 않게 했다. */}
            <a href={dataUrl(scan.height_view_path)} target="_blank" rel="noopener noreferrer"
              className="group block">
              {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
                  (components/analysis/slope-result.tsx와 같은 판단) */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imgRef} src={dataUrl(scan.height_view_path)}
                alt="높이 뷰: 위에서 내려다본 점군의 상대 높이"
                onError={() => setViewFailed(true)}
                className="w-full rounded-lg border border-cs-divider bg-white" />
              <span className="mt-2 flex items-center justify-end gap-1 text-xs font-bold leading-4 text-cs-link group-hover:text-cs-link-hover group-hover:underline">
                원본 크기로 열기 (새 탭)
                <Icon name="external" size={14} />
              </span>
            </a>
            <p className="text-xs leading-4 text-cs-text-secondary">
              위에서 내려다본 점군의 상대 높이입니다. 축 눈금은 미터가 아니라
              <span className="font-bold text-cs-text"> 파일 단위</span>이므로, 눈금이 가리키는
              크기와 실제 공간 크기를 견주어 단위를 고르세요. 예를 들어 8m짜리 방인데
              눈금이 8000까지 간다면 mm입니다. 점이 성겨 색이 거의 없거나 &quot;유효
              데이터 없음&quot; 경고가 찍힌 그림이어도 축 눈금은 유효하니 눈금만 보고
              판단하면 됩니다.
            </p>
          </>
        )}
      </section>
      {form}
    </div>
  );
}
