// 현장 대시보드 집계(스펙 §5 03, 아트보드 docs/design/dark/DashStatus.dc.html). 순수 함수다 - 조회는
// app/sites/[id]/page.tsx가 하고, 여기서는 받은 행을 센다.
// 등급을 계산하지 않는다: 판정은 엔진이 낸 overall_verdict만 읽는다(스펙 §10, 브라우저 등급 계산 금지 원칙).
import { ANALYSIS_STATUS_LABEL, REPORT_GEN_STATUS_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL } from './labels';
import { locationCrumb } from './location-label';
import { reportIndicator } from './reports';
import { countInProgress, toBarCounts } from './summary';
import { buildLocationTree } from './tree';
import type {
  AnalysisKind, AnalysisStatus, Grade, LocationRow, ReportGenStatus, ReportStatus, ScanStatus, Surface, Verdict,
} from './types';

// StatusIndicator(components/ui/status-indicator.tsx)의 StatusType 가운데 이 화면이 쓰는 넷.
// 문자열이 같아 컴포넌트에 그대로 넘긴다(도메인이 UI 파일을 import하지 않으려고 따로 적는다).
export type DashStatusType = 'success' | 'error' | 'in-progress' | 'pending';

// 판정 현황 격자에 올리는 타일 상한. 넘치면 최근에 스캔한 측정위치부터 고르고, 나머지는 격자 아래
// "…외 n곳 · 측정위치 전체 보기"로 넘긴다(아트보드 DashStatus의 "…외 8곳").
export const GRID_TILE_LIMIT = 24;
// 최근 보고서 카드에 올리는 건수(스펙 §5 03 "최근 5건")
export const RECENT_REPORT_LIMIT = 5;

// ---- 입력: 페이지가 조회한 행 ----
export interface DashScan {
  id: string; location_id: string; surface: Surface; scanned_at: string; status: ScanStatus; created_at: string;
}
/** 현재(is_current) 평활도(kind='flatness') 분석. deleted_at null. */
export interface DashCurrentAnalysis {
  scan_id: string; status: AnalysisStatus; overall_verdict: Verdict | null; kind: AnalysisKind;
}
/** 이 현장 스캔의 분석 전부(kind·is_current 무관, deleted_at null) - 처리 중과 최근 시도 실패를 본다. */
export interface DashAnalysis {
  scan_id: string; kind: AnalysisKind; status: AnalysisStatus; created_at: string;
}
/** deleted_at null인 보고서(상태 무관). */
export interface DashReport {
  id: string; location_id: string; title: string; status: ReportStatus; gen_status: ReportGenStatus; created_at: string;
}

export interface SiteDashboardInput {
  siteId: string;
  locations: LocationRow[];
  scans: DashScan[];
  currentAnalyses: DashCurrentAnalysis[];
  analyses: DashAnalysis[];
  reports: DashReport[];
}

// ---- 출력 ----
export interface DashKpi {
  /** 측정위치 수 */
  locationCount: number;
  /** 스캔 수(삭제 제외) */
  scanCount: number;
  /** 분석 완료: 현재 평활도 분석이 done인 스캔 수(판정 불가 포함) */
  doneCount: number;
  /** 판정 분포 3묶음(적합 · 경계 · 보수·재시공, 스펙 §9) - 홈과 같은 toBarCounts */
  bar: { pass: number; warn: number; fail: number };
  /** 판정 불가: done인데 overall_verdict null(분포 바에는 들지 않는다) */
  naCount: number;
  /** 처리 중: queued·processing 분석 수(종류 무관 - 홈 countInProgress와 같은 규칙) */
  inProgressCount: number;
  /** 보고서 수(삭제 제외, 상태 무관) */
  reportCount: number;
  /** 최근 활동: 가장 최근 스캔 날짜(scanned_at). 스캔이 없으면 null */
  lastScannedAt: string | null;
}

export interface DashTileState { type: DashStatusType; label: string; }

export interface DashTile {
  locationId: string;
  /** 공간 · 측정위치(예 "501호 · 거실"). 동·층은 격자 머리가 말한다 */
  label: string;
  /** 최근 스캔(/scans/[id]), 스캔이 없으면 측정위치 탭의 그 줄(/sites/[id]/locations#loc-<id>) */
  href: string;
  scanCount: number;
  /** 최근 현재 평활도 분석 판정. 판정이 안 나왔으면 'na', 분석이 없으면 null(미분석) */
  grade: Grade | null;
  /** 판정이 최근 스캔보다 앞선 스캔에서 나왔으면 그 스캔 날짜(타일의 "2026-08-29 스캔"), 아니면 null */
  gradeScanDate: string | null;
  /** 최근 스캔 날짜 */
  latestScanDate: string | null;
  /** 최근 스캔의 상태(타일 바닥 줄) */
  state: DashTileState;
}

export interface DashFloor { floor: string; tiles: DashTile[]; }
export interface DashBuilding { building: string; floors: DashFloor[]; }

export type DashTodoKind =
  | 'awaiting_unit' | 'scan_failed' | 'analysis_failed' | 'report_failed' | 'analysis_processing' | 'scan_processing';

export interface DashTodo {
  kind: DashTodoKind;
  /** 목록 key(종류 + 대상 id) */
  key: string;
  type: DashStatusType;
  /** 상태 문구(예 "단위 확인 대기") */
  label: string;
  /** 스캔이면 측정위치(locationCrumb), 보고서면 보고서 제목 */
  title: string;
  /** 스캔이면 표면(바닥·벽면), 보고서면 측정위치 */
  detail: string;
  /** YYYY-MM-DD(스캔 날짜 또는 보고서 생성일) */
  date: string;
  /** "열기" 대상 */
  href: string;
  /** "열기" 링크의 읽을 이름(스캔 "101동 5층 502호 거실 스캔 열기", 보고서 "<제목> 열기") */
  ariaLabel: string;
}

export interface DashReportItem {
  id: string; title: string; href: string; type: DashStatusType; label: string; date: string;
}

export interface SiteDashboard {
  kpi: DashKpi;
  /** 동 → 층(floor_order 내림차순) → 측정위치 타일(공간·이름 순) */
  grid: DashBuilding[];
  /** 상한을 넘어 격자에 못 올린 측정위치 수 */
  hiddenTileCount: number;
  /** 단위 확인 대기 → 실패(스캔·분석) → 보고서 생성 실패 → 처리 중 */
  todos: DashTodo[];
  /** 실패하거나 단위 확인을 기다리는 스캔이 없다(아트보드 할 일 카드의 안내 문구를 보일지) */
  noScanAttention: boolean;
  /** 최근 보고서(생성 최근 순, RECENT_REPORT_LIMIT건) */
  recentReports: DashReportItem[];
}

// 스캔 상태 → 표시. components/ui/status-indicator.tsx의 SCAN_STATUS_TYPE과 같은 값이어야 한다 -
// 같은 스캔이 화면마다 다른 점을 달지 않게(지난 최종 리뷰 Important 2). 테스트가 두 표를 대조한다.
// 예외 하나: 타일 바닥 줄의 분석 없는 ready 는 이 표를 거치지 않고 stateOf 가 고리로 그린다(트리와 같은 점).
const SCAN_TYPE: Record<ScanStatus, DashStatusType> = {
  uploaded: 'in-progress', awaiting_unit_confirm: 'pending', ready: 'success', archived: 'pending', failed: 'error',
};
const ANALYSIS_KINDS: AnalysisKind[] = ['flatness', 'slope'];
// 측정위치 트리(components/location-tree.tsx)가 평활도 실패를 "분석 실패"로 쓴다 - 같은 말을 쓴다
const ANALYSIS_FAILED_LABEL: Record<AnalysisKind, string> = { flatness: '분석 실패', slope: '구배 분석 실패' };
const SCAN_ATTENTION = new Set<DashTodoKind>(['awaiting_unit', 'scan_failed', 'analysis_failed']);

// 내림차순 비교(ISO 날짜·시각 문자열은 사전 순이 곧 시간 순이다)
function desc(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? 1 : -1;
}
// 최근 스캔 먼저: 촬영일(scanned_at, 날짜) 내림차순, 같은 날이면 올린 시각(created_at) 내림차순
function byRecentScan(a: DashScan, b: DashScan): number {
  return desc(a.scanned_at, b.scanned_at) || desc(a.created_at, b.created_at);
}
// 읽을 이름용 측정위치(아트보드 aria-label "101동 5층 502호 거실 스캔 열기"): 빈 부분을 빼고 띄어 쓴다
function spoken(l: LocationRow): string {
  return [l.building, l.floor, l.room, l.name].filter(Boolean).join(' ');
}

export function buildSiteDashboard(input: SiteDashboardInput): SiteDashboard {
  const { siteId, locations } = input;
  const locById = new Map(locations.map((l) => [l.id, l]));
  // 조회가 이미 이 현장으로 거르지만, 다른 현장의 행이 섞여 들어와도 집계에 새지 않게 한 번 더 거른다.
  const scans = input.scans.filter((s) => locById.has(s.location_id)).sort(byRecentScan);
  const scanIds = new Set(scans.map((s) => s.id));
  const scansByLoc = new Map<string, DashScan[]>();
  for (const s of scans) {
    const list = scansByLoc.get(s.location_id) ?? [];
    list.push(s); // scans가 이미 최근 순이라 위치별 목록도 최근 순이다
    scansByLoc.set(s.location_id, list);
  }

  // 현재 평활도 분석(스캔당 하나). kind는 조회의 .eq('kind', 'flatness')가 거르지만 여기서도 막는다 -
  // 구배 현재 분석이 섞이면 판정 집계가 2배로 계상된다(단계 C 사고).
  const currentByScan = new Map<string, DashCurrentAnalysis>();
  for (const a of input.currentAnalyses) {
    if (a.kind === 'flatness' && scanIds.has(a.scan_id)) currentByScan.set(a.scan_id, a);
  }

  const analyses = input.analyses.filter((a) => scanIds.has(a.scan_id));
  // 스캔별 처리 중 상태(종류 무관). 하나라도 processing이면 processing, 아니면 queued.
  const activeByScan = new Map<string, AnalysisStatus>();
  for (const a of analyses) {
    if (a.status !== 'queued' && a.status !== 'processing') continue;
    if (activeByScan.get(a.scan_id) !== 'processing') activeByScan.set(a.scan_id, a.status);
  }
  // (스캔, 종류)별 가장 최근 시도. 새 분석은 is_current=false로 들어가 완료돼야 현재가 되므로
  // (components/reanalyze-button.tsx), 실패한 시도는 현재 분석으로 잡히지 않는다 - 최근 시도가 실패면
  // "분석 실패"이고, 다시 돌려 성공하면 최근 시도가 done이라 할 일에서 사라진다.
  const latestAttempt = new Map<string, DashAnalysis>();
  for (const a of analyses) {
    const key = `${a.scan_id}:${a.kind}`;
    const prev = latestAttempt.get(key);
    if (!prev || a.created_at > prev.created_at) latestAttempt.set(key, a);
  }
  const attemptFailed = (scanId: string, kind: AnalysisKind) =>
    latestAttempt.get(`${scanId}:${kind}`)?.status === 'failed';

  const reports = input.reports
    .filter((r) => locById.has(r.location_id))
    .sort((a, b) => desc(a.created_at, b.created_at));

  // ---- KPI(스펙 §5 03) ----
  const verdicts: Record<Verdict, number> = { pass: 0, borderline: 0, repair: 0, rework: 0 };
  let doneCount = 0;
  let naCount = 0;
  for (const a of currentByScan.values()) {
    if (a.status !== 'done') continue;
    doneCount += 1;
    if (a.overall_verdict) verdicts[a.overall_verdict] += 1;
    else naCount += 1; // 엔진은 돌았는데 판정이 안 나온 건 - 분석 완료에는 들고 분포 바에는 없다
  }
  const kpi: DashKpi = {
    locationCount: locations.length,
    scanCount: scans.length,
    doneCount,
    bar: toBarCounts(verdicts),
    naCount,
    inProgressCount: countInProgress(analyses),
    reportCount: reports.length,
    lastScannedAt: scans.length > 0 ? scans[0].scanned_at : null,
  };

  // ---- 판정 현황 격자 ----
  // 타일 바닥 줄: 최근 스캔의 상태. 처리 중(종류 무관)이 먼저, 그다음 실패, 완료, 스캔 상태 순.
  function stateOf(s: DashScan): DashTileState {
    const active = activeByScan.get(s.id);
    if (active) return { type: 'in-progress', label: ANALYSIS_STATUS_LABEL[active] };
    if (s.status === 'failed') return { type: 'error', label: '스캔 실패' };
    if (attemptFailed(s.id, 'flatness')) return { type: 'error', label: ANALYSIS_FAILED_LABEL.flatness };
    if (currentByScan.get(s.id)?.status === 'done') return { type: 'success', label: '분석 완료' };
    // 분석이 없는 ready 스캔은 속 빈 고리다: 아트보드 DashStatus.dc.html 136~146행의 "분석 준비됨" 타일(94~96행 범례
    // "새 스캔 ○ 처리 중")과 측정위치 트리(location-tree.tsx treeScanStatusType)가 그렇게 그린다 - 아트보드가 이긴다(스펙 §2).
    // 스캔 화면의 '상태' 칸만 SCAN_STATUS_TYPE.ready(초록 점, ScanProcessing 아트보드)를 쓴다.
    if (s.status === 'ready') return { type: 'in-progress', label: SCAN_STATUS_LABEL.ready };
    return { type: SCAN_TYPE[s.status], label: SCAN_STATUS_LABEL[s.status] };
  }

  function tileOf(l: LocationRow): DashTile {
    const locScans = scansByLoc.get(l.id) ?? [];
    const latest: DashScan | undefined = locScans[0];
    // 최근 판정: 현재 평활도 분석이 done인 스캔 가운데 가장 최근 것(최근 스캔이 아직 분석 전이면 그 앞 스캔)
    const graded = locScans.find((s) => currentByScan.get(s.id)?.status === 'done');
    const verdict = graded ? currentByScan.get(graded.id)!.overall_verdict : null;
    return {
      locationId: l.id,
      label: [l.room, l.name].filter(Boolean).join(' · '),
      href: latest ? `/scans/${latest.id}` : `/sites/${siteId}/locations#loc-${l.id}`,
      scanCount: locScans.length,
      grade: graded ? (verdict ?? 'na') : null,
      gradeScanDate: graded && latest && graded.id !== latest.id ? graded.scanned_at : null,
      latestScanDate: latest ? latest.scanned_at : null,
      state: latest ? stateOf(latest) : { type: 'pending', label: '스캔 없음' },
    };
  }

  // 상한을 넘으면 최근에 스캔한 측정위치부터 올린다(스캔이 없는 곳은 뒤, 그중에는 최근 등록 순).
  // 고른 뒤에는 동 → 층 → 공간 → 이름 순(buildLocationTree)으로 다시 배치한다.
  const ranked = [...locations].sort((a, b) => {
    const sa = scansByLoc.get(a.id)?.[0];
    const sb = scansByLoc.get(b.id)?.[0];
    if (sa && sb) return byRecentScan(sa, sb);
    if (sa) return -1;
    if (sb) return 1;
    return desc(a.created_at, b.created_at);
  });
  const shown = ranked.slice(0, GRID_TILE_LIMIT);
  const grid: DashBuilding[] = buildLocationTree(shown).map((b) => ({
    building: b.building,
    floors: b.floors.map((f) => ({
      floor: f.floor,
      tiles: f.rooms.flatMap((r) => r.locations.map(tileOf)),
    })),
  }));

  // ---- 할 일(스펙 §5 03의 순서) ----
  function scanTodo(kind: DashTodoKind, s: DashScan, type: DashStatusType, label: string, keyTail = ''): DashTodo {
    const loc = locById.get(s.location_id)!;
    return {
      kind, key: `${kind}:${s.id}${keyTail}`, type, label,
      title: locationCrumb(loc), detail: SURFACE_LABEL[s.surface], date: s.scanned_at,
      href: `/scans/${s.id}`, ariaLabel: `${spoken(loc)} 스캔 열기`,
    };
  }
  const todos: DashTodo[] = [];
  // 1) 단위 확인 대기 - 사용자가 단위를 골라야 분석이 시작된다
  for (const s of scans) {
    if (s.status === 'awaiting_unit_confirm') {
      todos.push(scanTodo('awaiting_unit', s, SCAN_TYPE.awaiting_unit_confirm, SCAN_STATUS_LABEL.awaiting_unit_confirm));
    }
  }
  // 2) 실패: 스캔(사전 검사·임포트 잡의 최종 실패) → 그 스캔 분석의 최근 시도(평활도 → 구배)
  for (const s of scans) {
    if (s.status === 'failed') todos.push(scanTodo('scan_failed', s, 'error', '스캔 실패'));
    for (const kind of ANALYSIS_KINDS) {
      if (attemptFailed(s.id, kind)) {
        todos.push(scanTodo('analysis_failed', s, 'error', ANALYSIS_FAILED_LABEL[kind], `:${kind}`));
      }
    }
  }
  // 3) 보고서 생성 실패 - 발행본의 gen_status는 갱신되지 않는 잔재라 초안만 본다(reportStatusBadge와 같은 전제)
  for (const r of reports) {
    if (r.status !== 'draft' || r.gen_status !== 'failed') continue;
    const loc = locById.get(r.location_id)!;
    todos.push({
      kind: 'report_failed', key: `report_failed:${r.id}`, type: 'error', label: REPORT_GEN_STATUS_LABEL.failed,
      title: r.title, detail: locationCrumb(loc), date: r.created_at.slice(0, 10),
      // 보고서 제목은 대개 "… 보고서"로 끝나 "보고서"를 덧붙이지 않는다
      href: `/reports/${r.id}`, ariaLabel: `${r.title} 열기`,
    });
  }
  // 4) 처리 중 - 분석이 도는 스캔(종류 무관, 스캔당 한 줄)과 사전 검사를 기다리는 업로드 스캔.
  //    KPI "처리 중"은 분석 건수라 한 스캔에 평활도·구배가 함께 돌면 KPI는 2, 할 일은 1줄이다.
  for (const s of scans) {
    const active = activeByScan.get(s.id);
    if (active) todos.push(scanTodo('analysis_processing', s, 'in-progress', ANALYSIS_STATUS_LABEL[active]));
    else if (s.status === 'uploaded') todos.push(scanTodo('scan_processing', s, SCAN_TYPE.uploaded, SCAN_STATUS_LABEL.uploaded));
  }

  const recentReports: DashReportItem[] = reports.slice(0, RECENT_REPORT_LIMIT).map((r) => {
    const status = reportIndicator(r);
    return {
      id: r.id, title: r.title, href: `/reports/${r.id}`, type: status.type, label: status.label,
      date: r.created_at.slice(0, 10),
    };
  });

  return {
    kpi,
    grid,
    hiddenTileCount: locations.length - shown.length,
    todos,
    noScanAttention: !todos.some((t) => SCAN_ATTENTION.has(t.kind)),
    recentReports,
  };
}
