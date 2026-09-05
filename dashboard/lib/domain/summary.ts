import type { AnalysisStatus, SiteRow, Verdict } from './types';

export interface SiteSummary {
  site: SiteRow;
  locationCount: number;
  scanCount: number;
  lastScannedAt: string | null;
  verdictCounts: Record<Verdict, number>;
  // 리뷰 Important 3: 워커 overall_verdict()는 n_valid=0이면 null을 반환한다(analyses는
  // done·is_current). 이전에는 이 "판정 불가" 건이 verdictCounts 어디에도 잡히지 않아
  // 홈 카드 집계에서 조용히 누락됐다 - 별도 카운트로 분리해 총계에 포함시킨다.
  naCount: number;
  // 현장별 처리 중(큐 대기·실행 중) 분석 건수 - 홈 테이블 상태 열("처리 중 n건")용.
  // 판정 집계(currentAnalyses, kind='flatness')와 달리 kind 무필터 행을 받는다(countInProgress와 같은 출처).
  inProgressCount: number;
}

export function buildSiteSummaries(
  sites: SiteRow[],
  locations: { id: string; site_id: string }[],
  scans: { id: string; scanned_at: string; location_id: string }[],
  currentAnalyses: { scan_id: string; status: AnalysisStatus; overall_verdict: Verdict | null }[],
  // 처리 중 분석 행. 상태 필터는 호출자의 쿼리(.in('status', ['queued','processing']))가 담당하므로
  // 여기서는 scan_id만 본다. 생략하면 inProgressCount는 0 - 기존 4인자 호출 호환.
  inProgress: { scan_id: string }[] = [],
): SiteSummary[] {
  const siteOfLocation = new Map(locations.map((l) => [l.id, l.site_id]));
  const siteOfScan = new Map(
    scans.map((s) => [s.id, siteOfLocation.get(s.location_id)]).filter(([, v]) => v) as [string, string][],
  );
  return sites.map((site) => {
    const locCount = locations.filter((l) => l.site_id === site.id).length;
    const siteScans = scans.filter((s) => siteOfLocation.get(s.location_id) === site.id);
    const lastScannedAt = siteScans.length
      ? siteScans.map((s) => s.scanned_at).sort().at(-1)! : null;
    const verdictCounts: Record<Verdict, number> = { pass: 0, borderline: 0, repair: 0, rework: 0 };
    let naCount = 0;
    for (const a of currentAnalyses) {
      if (siteOfScan.get(a.scan_id) !== site.id) continue;
      if (a.overall_verdict) {
        verdictCounts[a.overall_verdict] += 1;
      } else if (a.status === 'done') {
        naCount += 1;
      }
    }
    // 판정 집계와 같은 siteOfScan 맵을 재사용한다 - 어느 현장의 스캔도 아닌 scan_id(삭제된 스캔 등)는
    // 어디에도 잡히지 않는다.
    const inProgressCount = inProgress.filter((a) => siteOfScan.get(a.scan_id) === site.id).length;
    return {
      site, locationCount: locCount, scanCount: siteScans.length, lastScannedAt, verdictCounts, naCount, inProgressCount,
    };
  });
}

// 처리 중(큐 대기·실행 중) 분석 건수 - 홈 지표 스트립용. kind 무필터(평활도·구배 모두
// "처리 중"에 잡혀야 한다) - 판정 집계용 쿼리(.eq('kind','flatness'))와는 별개다.
export function countInProgress(analyses: { status: AnalysisStatus }[]): number {
  return analyses.filter((a) => a.status === 'queued' || a.status === 'processing').length;
}
