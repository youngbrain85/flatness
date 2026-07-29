import type { SiteRow, Verdict } from './types';

export interface SiteSummary {
  site: SiteRow;
  locationCount: number;
  lastScannedAt: string | null;
  verdictCounts: Record<Verdict, number>;
}

export function buildSiteSummaries(
  sites: SiteRow[],
  locations: { id: string; site_id: string }[],
  scans: { id: string; scanned_at: string; location_id: string }[],
  currentAnalyses: { scan_id: string; overall_verdict: Verdict | null }[],
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
    for (const a of currentAnalyses) {
      if (siteOfScan.get(a.scan_id) === site.id && a.overall_verdict) {
        verdictCounts[a.overall_verdict] += 1;
      }
    }
    return { site, locationCount: locCount, lastScannedAt, verdictCounts };
  });
}
