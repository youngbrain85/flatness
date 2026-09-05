// 스캔 작업대(D5): 메타데이터 + 단계 스트립 + 상태별 다음 행동 + 단위 확정·분석 결과 인라인
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getRequestUser } from '@/lib/auth/request-user';
import { createClient } from '@/lib/supabase/server';
import { AnalysisProgress } from '@/components/analysis-progress';
import { AnalysisResult } from '@/components/analysis/analysis-result';
import { SlopeResult } from '@/components/analysis/slope-result';
import { ReanalyzeButton } from '@/components/reanalyze-button';
import { ScanStatusWatcher } from '@/components/scan-status-watcher';
import { SlopeAnalysisContainer } from '@/components/slope-analysis-container';
import { ScanStepStrip } from '@/components/scan-step-strip';
import { UnitConfirmForm } from '@/components/unit-confirm-form';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { LinkButton } from '@/components/ui/button';
import { Container } from '@/components/ui/container';
import { KeyValuePairs } from '@/components/ui/key-value';
import { PAGE_MAIN } from '@/components/ui/page';
import { PageHeader } from '@/components/ui/page-header';
import { SCAN_STATUS_TYPE, StatusIndicator } from '@/components/ui/status-indicator';
import {
  ANALYSIS_KIND_LABEL, ANALYSIS_STATUS_LABEL, GRADE_LABEL, LINEAGE_LABEL,
  SCAN_STATUS_LABEL, SURFACE_LABEL,
} from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { isExternalImport, isSlopeStats } from '@/lib/domain/stats';
import type { AnalysisRow, LocationRow, PhotoRow, ScanRow, SiteRow } from '@/lib/domain/types';

// 최종 리뷰 Important 2: 스캔 상태 → StatusIndicator 타입 표는 측정위치 트리와 공유해야
// 같은 스캔이 두 화면에서 같은 아이콘을 단다 - components/ui/status-indicator.tsx로 옮겼다.

// Realtime 감시가 필요한 진행 중 상태(리뷰 Important 2) — ready/archived/failed는
// 이미 종결됐거나(ready는 이 화면 자체에서 동기적으로 전이시킨 값) 더 이상 워커가
// 바꾸지 않는 상태라 구독 대상에서 제외한다.
const WATCHED_SCAN_STATUSES = new Set(['uploaded', 'awaiting_unit_confirm']);

export const dynamic = 'force-dynamic';

export default async function ScanPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ analysis?: string }>;
}) {
  const { id } = await params;
  const { analysis: selectedId } = await searchParams;
  const supabase = await createClient();
  // proxy가 검증한 헤더를 읽는다(Auth 왕복 0회) - 이 화면의 user는 `user &&` 게이트와
  // 폼 userId 전달에만 쓰므로 { id, email }로 충분하다.
  const user = await getRequestUser();
  const { data: scan } = await supabase.from('scans').select('*').eq('id', id).maybeSingle();
  if (!scan) notFound();
  const s = scan as ScanRow;
  const [locRes, analysesRes] = await Promise.all([
    supabase.from('locations').select('*').eq('id', s.location_id).maybeSingle(),
    supabase.from('analyses').select('*').eq('scan_id', id).is('deleted_at', null)
      .order('created_at', { ascending: false }),
  ]);
  const loc = locRes.data as LocationRow | null;
  const analyses = (analysesRes.data ?? []) as AnalysisRow[];

  // ★ 리뷰 I1(단계 F): 병합 스캔은 정합 성공 즉시 status='ready'로 만들어져 측정위치
  // 트리와 이 화면에 바로 나타난다. 그런데 여기서 정합 화면으로 돌아가는 길이 없으면,
  // 이 경로로 들어온 사용자는 겹쳐보기(RMSE가 원리적으로 못 보는 수평 어긋남을
  // 확인하는 유일한 수단)를 **찾을 방법이 없다.** lineage로 좁혀 질의하므로 일반
  // 스캔은 이 쿼리를 타지 않는다.
  const registrationRes = s.lineage === 'registered'
    ? await supabase.from('registrations').select('id').eq('result_scan_id', id).maybeSingle()
    : null;
  const registrationId = (registrationRes?.data as { id: string } | null | undefined)?.id ?? null;

  // 종류별로 완전히 갈라서 다룬다(컨트롤러 보강 확정 3·5). analyses[0] 하나로 화면
  // 전체를 지배하면 구배 분석을 한 번이라도 돌리는 순간 평활도의 진행 상태·결과
  // 링크·이전 이력이 화면에서 사라진다. 쿼리가 이미 created_at desc이므로 kind로
  // 필터링해도 각 배열 안의 최신순 정렬은 그대로 유지된다.
  const flatnessAnalyses = analyses.filter((a) => (a.kind ?? 'flatness') === 'flatness');
  const slopeAnalyses = analyses.filter((a) => a.kind === 'slope');
  const latestFlatness = flatnessAnalyses[0];
  const latestSlope = slopeAnalyses[0];

  // 임포트 결과(외부 프로그램 CSV/JSON)는 점 단위 편차 목록이지 점군이 아니라 구배
  // 분석을 걸 수 없다(컨트롤러 보강 확정 4). 평활도 재분석 버튼(kind='flatness')이
  // 참고할 isImport는 latestFlatness 기준을 유지한다 - 재분석 대상이 바로
  // latestFlatness이므로 "그 분석 자체가 임포트 결과인가"를 물어야 옳다(C1: 임포트
  // 결과를 'analyze' 잡으로 다시 돌리면 Colab 편차값이 무시된다).
  const isImport = latestFlatness
    ? isExternalImport(latestFlatness.engine_version, latestFlatness.stats?.meta)
    : false;
  // 리뷰 Important(재리뷰 I-new): 구배 "버튼 노출" 판별은 latestFlatness 하나만 보면
  // 안 된다. isExternalImport는 engine_version/stats.meta.source로 판별하는데 워커는
  // 이 값들을 잡이 성공 완료했을 때만 채운다(worker/flatworker/jobs.py) - 그래서
  // latestFlatness가 queued/processing/failed면 임포트 여부 자체를 알 수 없다.
  // 1차 수정(status==='done' 요구)은 이 오판은 막았지만, 그 대가로 "평활도를
  // 재분석하는 동안 이미 완료된 구배 결과·이력까지 화면에서 통째로 사라지는" 새
  // 회귀를 만들었다(확정 5 "두 분석은 서로 독립" 위반) - latestFlatness가 아직 done이
  // 아니라는 이유만으로 구배 섹션 전체를 가려버렸기 때문이다.
  //
  // 근본 수정: "임포트 여부 판별"과 "구배 섹션을 그릴지"를 분리한다.
  // - 임포트 판별은 flatnessAnalyses 전체에서 완료(done)된 분석을 아무거나 찾아 쓴다.
  //   완료된 평활도 분석이 하나라도 있으면 그 스캔이 LiDAR인지 임포트인지 이미 알 수
  //   있다(이후 재분석이 진행 중이어도 그 사실은 변하지 않는다). scans 테이블에는
  //   임포트 여부를 나타내는 영속 필드가 없다 - file_format은 'csv'가 스캔/임포트
  //   양쪽 확장자 목록에 걸쳐 있어 판별 불가(upload-form.tsx), lineage는 DB
  //   기본값이자 사용자가 스캔 모드에서도 고를 수 있는 값이라 마찬가지다. 완료된
  //   평활도 분석이 하나도 없으면(첫 분석이 아직 안 끝났거나 실패) 판별 불가로 보고
  //   구배 "버튼"만 숨긴다(받아들인 트레이드오프 - 첫 분석이 끝나면 곧바로 풀린다).
  const doneFlatness = flatnessAnalyses.find((a) => a.status === 'done');
  const isImportUnknownOrTrue = doneFlatness
    ? isExternalImport(doneFlatness.engine_version, doneFlatness.stats?.meta)
    : true;
  // - "섹션을 그릴지"는 버튼 노출과 별개다. 이미 완료된(또는 진행 중인) 구배 분석이
  //   있으면 그 결과는 무조건 보여준다 - latestFlatness가 무슨 상태이든 상관없다.
  const showSlopeButton = s.surface === 'floor' && !isImportUnknownOrTrue && !!loc;
  const showSlopeSection = !!latestSlope || showSlopeButton;

  // ★ 리뷰 Critical(단계 F 최종): status='ready'인데 평활도 analyses 행이 없는 스캔은
  // 지금까지 **분석을 시작할 방법이 아예 없었다.** 이 화면의 분석 진입점 셋이 전부
  // 이 상태를 비껴간다: 단위 확인 링크는 awaiting_unit_confirm 전용이고, 평활도
  // ReanalyzeButton은 latestFlatness(=기존 analyses 행)를 요구하며, 구배 버튼은 완료된
  // 평활도 분석(doneFlatness)을 요구한다. 그런데 측정위치 트리와 이 화면의 상태 칸은
  // SCAN_STATUS_LABEL.ready("분석 준비됨")를 달아 할 수 있다고 말한다 - 막다른 골목이다.
  //
  // 범위를 lineage==='registered'(병합 스캔)로 좁히지 않는다. 결함의 본질은 계보가
  // 아니라 **"ready인데 분석 행이 없다"는 상태 자체**이고, 이 저장소에는 그 상태에
  // 도달하는 경로가 둘 있다:
  //   (1) 정합 성공이 만드는 병합 스캔(worker의 _merged_scan_fields - ready·행 없음),
  //   (2) unit-confirm-form.tsx의 되돌리기까지 실패한 경우. 그 파일 주석(52-56행)이
  //       이미 이 막다른 골목을 그대로 적어 놓고 "관리자에게 알리세요"로 끝난다.
  // 계보로 좁히면 (1)만 고치고 (2)는 죽은 채로 남는다.
  //
  // 단위 확인 화면으로 보내지 않는 이유: 이 상태의 스캔은 unit_scale이 이미 확정돼
  // 있다(병합 점군은 1.0 = 미터, (2)는 확정 직후 실패한 것이다). confirm-unit은
  // "파일 좌표가 m·cm·mm 중 무엇인지 확정하는 단계"라 이미 미터인 점군에는 틀린
  // 안내이고, 거기서 mm를 고르면 멀쩡한 좌표가 1/1000로 망가진다.
  //
  // ★★ 재리뷰 Critical(C1-c): 여기서 isImport를 false로 **고정하면 안 된다.**
  // 1차 수정은 "임포트 스캔은 이 상태에 존재할 수 없다"고 단정했는데 틀렸다.
  // upload-form.tsx는 3)에서 status='ready'로 먼저 승격하고 4)에서야 analyses 행을
  // 만든다(102행 vs 125행). 그 사이에 탭이 닫히거나 연결이 끊기면 정리 코드가 아예
  // 실행되지 않고, discardScan조차 자신의 update 오류를 검사하지 않는다. 즉 임포트
  // 스캔도 "ready + 평활도 행 0개"로 남을 수 있다. 그 스캔에 isImport=false를 주면
  // Colab 결과 CSV에 'analyze' 잡이 걸려 Signed_Distance_mm이 통째로 무시되고 전 셀이
  // 조용히 "적합"이 된다(reanalyze-button.tsx 21-33행이 적어 둔 C1 사고 그대로).
  // 고치기 전에는 조용한 막다른 골목(안전)이었지만 그렇게 하면 조용한 오답이 된다.
  //
  // 판별자로 쓸 수 있는 것과 없는 것:
  //   - lineage: 못 쓴다. 임포트는 'unknown'인데 그 값은 DB 기본값이자 사용자가 스캔
  //     모드에서도 고를 수 있다(upload-form.tsx).
  //   - file_format/확장자: 단독으로는 못 쓴다. 워커의 _IMPORT_HANDLERS는 .csv/.json
  //     인데 SCAN_EXTS에도 'csv'가 있다(lib/upload/validate.ts) - csv는 양쪽이다.
  //   - height_view_path: **한 방향으로 확실하다.** 이 값은 handle_precheck만 채우고
  //     (worker/flatworker/jobs.py:155) 임포트는 precheck를 아예 돌지 않으므로,
  //     값이 있으면 임포트가 아니다. 다만 **병합 스캔도 precheck를 돌지 않아 이 값이
  //     없다**(handle_register는 이 필드를 건드리지 않는다) - 이것만 쓰면 병합 스캔이
  //     막힌다.
  //   - lineage==='registered': 시스템만 쓰는 값이고(types.ts) 워커가 만든 merged.ply라
  //     역시 임포트가 아니다.
  // 그래서 두 신호의 **합집합**을 쓴다. 둘 다 "임포트가 아님"을 한 방향으로 증명하는
  // 신호이고, 어느 쪽도 아니면 판별 불가다.
  //
  // 판별 불가일 때는 버튼을 숨긴다 - 이 파일이 구배 버튼에서 이미 쓰는 정책과 같다
  // (isImportUnknownOrTrue). 남는 사각은 "precheck는 돌았는데 높이 뷰 렌더가 실패해
  // height_view_path가 비었고, 게다가 단위 확정까지 실패한" 스캔뿐이다. 그 경우는
  // 고치기 전과 같은 막다른 골목으로 남는다 - 받아들인 트레이드오프다. 조용한
  // 오답보다 조용한 막다른 골목이 낫다.
  //
  // truthy 검사인 이유는 unit-confirm-form.tsx와 같다: 010을 아직 적용하지 않은 DB에서는
  // select('*')에 이 컬럼이 없어 undefined로 온다. `!== null`로 쓰면 그 DB의 모든
  // 스캔이 "임포트가 아님"으로 잘못 증명된다.
  const provenNotImport = s.lineage === 'registered' || !!s.height_view_path;
  const showFirstFlatness = s.status === 'ready' && !latestFlatness && provenNotImport;

  // D5: 단계 스트립·보고서 원클릭이 공유하는 "완료 분석 존재" 플래그. 두 종류를
  // 모두 집계한다 - 구배만 완료된 스캔도 보고서에 넣을 수 있다.
  const hasDoneAnalysis = !!doneFlatness || slopeAnalyses.some((a) => a.status === 'done');

  // D5 결과 인라인: 기본은 최신 완료 분석(stats까지 있어야 그릴 수 있다 -
  // app/analyses/[id]가 쓰던 `status !== 'done' || !stats` 가드와 같은 조건),
  // ?analysis=가 있으면 사용자가 고른 그 행이다. 고른 행이 미완료면 결과를 그리지
  // 않는다 - 최신 done으로 대체해 그리면 "이게 그 분석의 결과"라는 오해를 만든다
  // (진행 상태는 아래 섹션의 AnalysisProgress가 이미 보여준다).
  const selectedAnalysis = selectedId
    ? analyses.find((a) => a.id === selectedId) ?? null
    : analyses.find((a) => a.status === 'done' && !!a.stats) ?? null;
  const resultAnalysis =
    selectedAnalysis && selectedAnalysis.status === 'done' && selectedAnalysis.stats
      ? selectedAnalysis
      : null;

  // 리뷰 Important(F1): ?analysis=가 "이미 새 분석에 밀려난 과거 미완료/실패 분석"을
  // 가리키면(그 종류의 최신이 아니면) 아래 AnalysisProgress 섹션은 항상 latestFlatness/
  // latestSlope만 보여주므로 그 선택에 대해 화면에 아무것도 안 뜬다. 원본
  // app/analyses/[id]/page.tsx는 이 경우 "이 분석은 아직 완료되지 않았습니다"
  // 안내를 항상 보여줬다 - D5 이관 때 그 안내가 조용히 사라졌던 것을 여기서 복원한다.
  // 선택한 분석이 그 종류의 최신이면(=latestFlatness/latestSlope와 같으면) 아래
  // AnalysisProgress가 이미 같은 정보를 실시간으로 보여주므로 중복 안내를 만들지 않는다.
  const selectedKind = selectedAnalysis ? (selectedAnalysis.kind ?? 'flatness') : null;
  const latestOfSelectedKind = selectedKind === 'slope' ? latestSlope : latestFlatness;
  // 최종 리뷰 M4: "최신이 아니면"만으로는 못 잡는 사각이 있다 - done인데 stats가
  // 빈(레거시) 분석이 그 종류의 최신인 경우다. 그때는 latestOfSelectedKind.id ===
  // selectedAnalysis.id라 위 조건이 거짓이 되고, resultAnalysis도 status==='done' &&
  // stats 요구를 stats가 없어 못 채우니 거짓이다. 그 결과 AnalysisProgress(latest는
  // done이므로 "결과 보기" 링크만 그린다)도 resultAnalysis 섹션도 아무것도 못 그려서,
  // 사용자가 그 링크를 눌러 돌아오면 화면에 결과도 안내도 없이 조용히 비어버린다.
  //
  // AnalysisProgress가 이미 다루는 "미완료 최신"(대기/처리/실패)까지 이 안내로
  // 끌어오면 안 된다 - 그러면 F1 대조 테스트가 고정한 "최신 미완료는 중복 안내
  // 금지"를 깬다. 그래서 최신인 경우의 추가 조건은 status==='done' && !stats로
  // 좁힌다 - 그 종류의 최신 분석 자체가 "완료됐지만 보여줄 게 없는" 상태일 때만
  // 이 사각을 메운다.
  const staleSelectedAnalysis =
    selectedAnalysis && !resultAnalysis &&
    (latestOfSelectedKind?.id !== selectedAnalysis.id
      || (selectedAnalysis.status === 'done' && !selectedAnalysis.stats))
      ? selectedAnalysis
      : null;

  // D5: 브레드크럼의 현장명. loc이 없으면(위치가 지워진 레거시 데이터) 조회하지 않는다.
  const siteRes = loc
    ? await supabase.from('sites').select('*').eq('id', loc.site_id).maybeSingle()
    : null;
  const site = (siteRes?.data as SiteRow | null | undefined) ?? null;
  // 현장 사진은 평활도 결과(AnalysisResult)만 쓴다 - 그 화면을 그릴 때만 조회한다.
  const photosRes = resultAnalysis && !isSlopeStats(resultAnalysis.stats)
    ? await supabase.from('photos').select('*').eq('scan_id', s.id)
        .order('created_at', { ascending: false })
    : null;
  const photos = (photosRes?.data ?? []) as PhotoRow[];

  const locLabel = loc
    ? [loc.building, loc.floor, loc.room, loc.name].filter(Boolean).join(' / ')
    : '-';
  const crumbs = loc
    ? [
        { href: '/', label: '현장' },
        { href: `/sites/${loc.site_id}`, label: site?.name ?? '현장 상세' },
        { label: locLabel },
      ]
    : [{ href: '/', label: '현장' }];

  return (
    <main className={PAGE_MAIN}>
      <PageHeader
        crumbs={crumbs}
        title={<>스캔 · {SURFACE_LABEL[s.surface]} · <span className="font-mono text-[22px]">{s.scanned_at}</span></>}
        actions={hasDoneAnalysis ? (
          // 뷰당 primary 1개(Global Constraints·스펙 §4): 이 화면의 primary는 이 보고서 원클릭뿐이다.
          // 결과 패널(T7 VerdictPanel)의 '저장'은 normal - 아트보드·스펙 §6은 둘 다 채움으로 그리지만
          // §4 규칙을 따른다.
          <LinkButton href={`/reports/new?location=${s.location_id}`} variant="primary">
            이 위치의 보고서 생성
          </LinkButton>
        ) : undefined}
      />
      <ScanStepStrip status={s.status} hasDoneAnalysis={hasDoneAnalysis} />
      {/* 스펙 §7-8: '스캔 정보' 제목은 아트보드의 컨테이너 크롬 - 항목은 옛 dl과 같은 7개다. */}
      <Container title="스캔 정보">
        <KeyValuePairs columns={4} items={[
          { label: '측정위치', value: locLabel },
          { label: '원본 파일', value: <span className="font-mono text-[13px]">{s.original_filename ?? '-'}</span> },
          { label: '장비', value: s.device ?? '-' },
          { label: '데이터 계보', value: LINEAGE_LABEL[s.lineage] },
          // point_count는 001_schema.sql에 선언만 되고 비어 있다가 단계 E의
          // precheck 잡부터 채워진다(worker/flatworker/jobs.py). 그 전에 올라온
          // 스캔은 계속 null이므로 '-'로 둔다. 단위 확정의 근거는 아니다
          // (점 개수는 파일 단위가 m이든 mm이든 같다) - 스캔 규모를 가늠하는
          // 메타데이터로만 쓴다.
          {
            label: '점 개수',
            value: (
              <span className="font-mono text-[13px] tabular-nums">
                {s.point_count === null ? '-' : s.point_count.toLocaleString('ko-KR')}
              </span>
            ),
          },
          {
            label: '상태',
            value: <StatusIndicator type={SCAN_STATUS_TYPE[s.status]}>{SCAN_STATUS_LABEL[s.status]}</StatusIndicator>,
          },
          { label: '단위 배율', value: <span className="font-mono text-[13px] tabular-nums">{s.unit_scale ?? '미확정'}</span> },
        ]} />
      </Container>
      {s.lineage === 'registered' && (
        <Alert type="warning" title="두 스캔을 정합해 만든 병합 스캔입니다.">
          <p>
            분석하기 전에 정합이 실제로 맞았는지 확인하세요. 정합 RMSE는 수직 방향만
            보증하므로, 두 스캔이 수평으로 어긋나 있어도 수치는 정상으로 나옵니다.
            정합 화면의 겹쳐보기가 그 방향을 확인하는 유일한 수단입니다.
          </p>
          {registrationId ? (
            <LinkButton href={`/registrations/${registrationId}`} variant="normal" className="mt-3">
              정합 결과·겹쳐보기 확인
            </LinkButton>
          ) : (
            <p className="mt-1 text-cs-text-secondary">
              이 스캔을 만든 정합 이력을 찾지 못했습니다(이력이 삭제됐거나 아직 반영되지
              않았습니다). 겹쳐보기를 볼 수 없으므로 이 스캔의 분석 결과를 판단 근거로
              쓸 때 주의하세요.
            </p>
          )}
        </Alert>
      )}
      {WATCHED_SCAN_STATUSES.has(s.status) && (
        <ScanStatusWatcher scanId={id} initialStatus={s.status} />
      )}
      {s.status === 'awaiting_unit_confirm' && user && (
        // D5: 별도 confirm-unit 화면으로 링크하는 대신 그 화면이 렌더하던 것(높이 뷰
        // 이미지 + 단위 확정 폼 - 둘 다 UnitConfirmForm 안에 있다)을 여기 섹션으로
        // 렌더한다. 안내 문구는 app/scans/[id]/confirm-unit/page.tsx에서 그대로 옮겼다.
        <Container title="단위 확인">
          <div className="flex flex-col gap-4">
            <p className="text-cs-text-secondary">
              파일 좌표가 m·cm·mm 중 무엇인지 확정하는 단계입니다. 높이 뷰가 있으면 그
              축 눈금과 실제 공간 크기를 견주어 고르고, 없으면 파일명과 스캔 앱의 내보내기
              설정으로 판단하세요.
            </p>
            <UnitConfirmForm scan={s} userId={user.id} />
          </div>
        </Container>
      )}
      {s.status === 'uploaded' && (
        // E1: 옛 문구는 "워커가 실행 중인지 확인하세요(python -m flatworker)"였다.
        // 운영자 지시문이지 사용자 안내가 아니다 - 대시보드만 쓰는 사용자는 워커를
        // 실행할 수도 확인할 수도 없어서, 정상적인 대기를 장애로 오인한다. 단계 E부터
        // precheck가 높이 뷰까지 렌더하므로 대기 시간 자체도 눈에 띄게 길어졌다.
        <Alert type="info">
          사전 검사 대기 중입니다. 파일 크기에 따라 수십 초 걸릴 수 있습니다.
          이 화면을 새로고침하면 상태가 갱신됩니다.
        </Alert>
      )}
      {s.status === 'failed' && (
        <Alert type="error" title="사전 검사에 실패했습니다.">
          <p>
            가장 흔한 원인은 지원하지 않는 파일 포맷이나 손상·불완전한 파일입니다.
            파일을 확인한 뒤 업로드 화면에서 새 스캔으로 다시 시도하세요. 상세 원인은
            워커 실행 창의 로그에 남습니다(3회 자동 재시도 후에도 실패한 상태입니다).
          </p>
          {/* D5: 재시도를 한 클릭으로 - 업로드 화면이 현장·측정위치를 쿼리로 프리필한다(D4). */}
          <LinkButton
            href={loc ? `/upload?site=${loc.site_id}&location=${s.location_id}` : '/upload'}
            variant="normal" className="mt-3">
            다시 업로드
          </LinkButton>
        </Alert>
      )}
      {showFirstFlatness && (
        <Container
          title={`${ANALYSIS_KIND_LABEL.flatness} 분석`}
          actions={user ? (
            // latestStatus를 넘기지 않는다 - 이 종류의 분석이 한 번도 없었다는 뜻이므로
            // ReanalyzeButton은 이를 "진행 중 아님"으로 보고 버튼을 활성 상태로 둔다
            // (구배 첫 분석과 같은 취급). criteriaId는 스캔에 현재 적용된 기준이다;
            // 병합 스캔은 이 값을 원본 A에서 물려받는다(worker의 _merged_scan_fields).
            //
            // isImport={false}는 가정이 아니라 provenNotImport가 증명한 값이다 - 이
            // 섹션은 임포트가 아님이 증명된 스캔에서만 그려진다(위 주석). 이 게이트를
            // 지우면 Colab CSV에 'analyze' 잡이 걸린다.
            <ReanalyzeButton scanId={id} userId={user.id} surface={s.surface} kind="flatness"
              criteriaId={s.selected_criteria_id ?? undefined}
              isImport={false} />
          ) : undefined}>
          <p className="text-cs-text-secondary">
            {s.lineage === 'registered'
              ? '병합 점군은 이미 미터로 환산돼 있어 단위 확인 없이 바로 분석할 수 있습니다. 다만 정합이 실제로 맞았는지는 위 겹쳐보기로 먼저 확인하세요 - 분석은 어긋난 정합도 그대로 받아 수치를 냅니다.'
              : '단위가 확정된 스캔인데 아직 분석이 없습니다. 위 버튼으로 첫 분석을 시작하세요.'}
          </p>
        </Container>
      )}
      {latestFlatness && (
        <Container
          title={`${ANALYSIS_KIND_LABEL.flatness} 분석`}
          actions={user ? (
            // 코드리뷰 Critical(C1): latestFlatness.engine_version/meta로 임포트 결과
            // 여부를 판별해 재분석 잡 타입 분기 근거로 전달한다(isExternalImport, 정의는
            // lib/domain/stats.ts - 배지 표시와 동일 기준 재사용).
            //
            // 코드리뷰 Minor(M3): 판정 기준은 스캔에 현재 적용된
            // scan.selected_criteria_id를 우선한다. latestFlatness.criteria_id(직전
            // 분석이 만들어질 때 스냅샷된 기준)로만 쓰면 사용자가 이후에 스캔의
            // 적용 기준을 바꿔도 재분석이 옛 기준을 그대로 따라가 버려, 버튼이
            // 내건 "판정 기준 변경 후 다시 돌리기" 취지와 어긋난다.
            // selected_criteria_id가 비어 있는 드문 레거시 데이터에서만
            // latestFlatness.criteria_id로 폴백한다.
            <ReanalyzeButton scanId={id} userId={user.id} surface={s.surface} kind="flatness"
              criteriaId={s.selected_criteria_id ?? latestFlatness.criteria_id}
              latestStatus={latestFlatness.status}
              isImport={isImport} />
          ) : undefined}>
          <div className="flex flex-col gap-3">
            <AnalysisProgress analysisId={latestFlatness.id} initialStatus={latestFlatness.status} scanId={id} />
            {flatnessAnalyses.length > 1 && (
              <ul className="flex flex-col gap-2 text-cs-text-secondary">
                {flatnessAnalyses.slice(1).map((a) => (
                  <li key={a.id}>
                    {/* D5: 별도 화면 대신 같은 작업대의 ?analysis= 선택 렌더로 간다. */}
                    <Link href={`/scans/${id}?analysis=${a.id}`}
                      className="inline-flex items-center gap-2 text-cs-link hover:text-cs-link-hover hover:underline">
                      이전 분석 <span className="font-mono text-[13px]">{a.created_at.slice(0, 16).replace('T', ' ')}</span>
                      {a.overall_verdict && (
                        <Badge tone={GRADE_TONE[a.overall_verdict]}>{GRADE_LABEL[a.overall_verdict]}</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Container>
      )}
      {showSlopeSection && (
        // T6 리뷰 수정 1차: 아트보드(ScanDone.dc.html 172-205행)는 헤더에 버튼만 두고
        // '적용 기준' 라디오를 본문 첫 블록으로 그린다. 라디오와 버튼이 같은 클라이언트
        // 상태를 공유해 서버 컴포넌트가 Container의 actions 슬롯과 본문에 나눠 렌더할 수
        // 없으므로, 컨테이너 자체를 SlopeAnalysisContainer(클라이언트)가 그리고 본문에
        // 들어갈 진행 상태·이력만 children으로 넘긴다. 본문은 옛 코드와 같이 latestSlope가
        // 있을 때만 있고, 비면 빈 20px이 남지 않게 padding도 꺼진다(스펙 §7-8).
        //
        // showButton: 재리뷰 수정으로 섹션 렌더(showSlopeSection)와 버튼 노출을 갈랐다 -
        // 섹션은 latestSlope 존재만으로도 그려지고, 버튼만 !isImportUnknownOrTrue로
        // 게이트한다(이미 있는 구배 결과를 숨기지 않으면서 새 구배 분석은 임포트 여부가
        // 확실할 때만 시작한다). 기준 해석(fn_resolve_criteria)·잡 타입 분기는 컴포넌트
        // 쪽 주석 참고 - criteriaId를 넘기지 않는 이유도 거기 있다.
        <SlopeAnalysisContainer
          scanId={id}
          userId={user?.id}
          siteId={loc?.site_id}
          latestStatus={latestSlope?.status}
          showButton={!!user && showSlopeButton}>
          {latestSlope && (
            <div className="flex flex-col gap-3">
              <AnalysisProgress analysisId={latestSlope.id} initialStatus={latestSlope.status} scanId={id} />
              {slopeAnalyses.length > 1 && (
                <ul className="flex flex-col gap-2 text-cs-text-secondary">
                  {slopeAnalyses.slice(1).map((a) => (
                    <li key={a.id}>
                      {/* D5: 별도 화면 대신 같은 작업대의 ?analysis= 선택 렌더로 간다. */}
                      <Link href={`/scans/${id}?analysis=${a.id}`}
                        className="inline-flex items-center gap-2 text-cs-link hover:text-cs-link-hover hover:underline">
                        이전 분석 <span className="font-mono text-[13px]">{a.created_at.slice(0, 16).replace('T', ' ')}</span>
                        {a.overall_verdict && (
                          <Badge tone={GRADE_TONE[a.overall_verdict]}>{GRADE_LABEL[a.overall_verdict]}</Badge>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </SlopeAnalysisContainer>
      )}
      {resultAnalysis && (
        // D5: app/analyses/[id]/page.tsx가 하던 결과 렌더를 이 화면으로 옮겼다.
        // 헤더 제목 옆 보조 텍스트(일시 · 엔진)는 아트보드(ScanDone '평활도 결과')를 따른다.
        // 본문(탭·히트맵·판정 패널)은 T7이 components/analysis/*에서 재스킨한다.
        <Container title={
          <>
            {ANALYSIS_KIND_LABEL[resultAnalysis.kind ?? 'flatness']} 결과
            <span className="ml-3 font-mono text-xs font-normal text-cs-text-secondary">
              {resultAnalysis.created_at.slice(0, 16).replace('T', ' ')}
              {' · '}엔진 {resultAnalysis.engine_version ?? '-'}
            </span>
          </>
        }>
          {isSlopeStats(resultAnalysis.stats) ? (
            // 단계 C 회귀 차단(analyses/[id]에서 이관): ?analysis=는 이 스캔의 analyses
            // 목록에서 id로만 고르므로 어떤 쿼리 필터로도 종류를 못 거른다. stats.format
            // 내용 기반으로 갈라 AnalysisResult로 흘려보내면 lib/domain/stats.ts의
            // coverageLabel이 stats.meta를 옵셔널 체이닝 없이 읽어 TypeError로 페이지가
            // 죽는다 - 구배 결과(단계 D)는 SlopeResult로.
            <SlopeResult analysis={resultAnalysis} />
          ) : (
            <AnalysisResult analysis={resultAnalysis} scan={s} photos={photos} />
          )}
        </Container>
      )}
      {staleSelectedAnalysis && (
        // 리뷰 Important(F1): app/analyses/[id]/page.tsx 원본이 항상 보여주던
        // "아직 완료되지 않았습니다" 안내를 그대로 복원한다. 링크는 ?analysis= 없는
        // 기본 뷰(최신 완료 분석 또는 AnalysisProgress)로 되돌아간다.
        //
        // 후속 리뷰(M4 문구 분기): status==='done'인데 stats가 없는(레거시) 케이스는
        // "아직 완료되지 않았습니다 (상태: 완료)"가 자기모순이라 별도 문구로 갈랐다.
        // resultAnalysis는 selectedAnalysis 단독으로(latest 여부와 무관하게) done && stats를
        // 요구하므로, staleSelectedAnalysis.status==='done'이면 항상 stats가 없는 경우다
        // (stats가 있었다면 resultAnalysis가 채워져 이 분기 자체에 들어오지 못한다) -
        // 그래서 상태만으로 분기해도 안전하다. 미완료(대기/처리/실패) 문구는 그대로 둔다.
        <Alert type="info">
          {staleSelectedAnalysis.status === 'done'
            ? '분석은 완료됐지만 결과 데이터(stats)가 없습니다. 오래된 형식의 분석일 수 있으니 재분석을 권장합니다.'
            : `이 분석은 아직 완료되지 않았습니다 (상태: ${ANALYSIS_STATUS_LABEL[staleSelectedAnalysis.status]}).`}{' '}
          <Link href={`/scans/${id}`}
            className="font-bold text-cs-link hover:text-cs-link-hover hover:underline">스캔 상세에서 진행 상태 보기</Link>
        </Alert>
      )}
    </main>
  );
}
