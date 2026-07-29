// 경로 계약(P2 최종 리뷰 확정): DB에는 버킷-상대 규약 문자열만,
// 소비자(대시보드)는 /api/data route를 통해 자신의 DATA_DIR에 결합한다
export function dataUrl(relPath: string): string {
  const clean = relPath.replace(/^\/+/, '');
  return '/api/data/' + clean.split('/').map(encodeURIComponent).join('/');
}

export function artifactUrl(artifactsDir: string, filename: string): string {
  return dataUrl(`${artifactsDir}/${filename}`);
}

// 스펙 §6.3 규약: raw-scans/{site_id}/{scan_id}/raw.{ext}
export function rawScanRelPath(siteId: string, scanId: string, ext: string): string {
  return `raw-scans/${siteId}/${scanId}/raw.${ext}`;
}
