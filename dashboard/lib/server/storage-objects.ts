// 서버 전용: /api/data 세그먼트를 Storage 버킷·객체키로 해석한다.
// 로컬 파일시스템이 없어도 경로 탈출 방어는 그대로 유지해야 한다 - 슬래시를 임베드한
// 단일 세그먼트로 다른 버킷·상위 경로를 가리키는 우회를 과거 리뷰가 실 HTTP로 재현한
// 이력이 있다(worker/flatworker/storage.py의 split_key와 동일 규칙).
import path from 'path';

const ALLOWED_BUCKETS = ['raw-scans', 'artifacts', 'reports'];

export function resolveStorageObject(segments: string[]): { bucket: string; key: string } | null {
  if (segments.length < 2) return null; // 버킷 단독은 서빙하지 않는다
  if (!ALLOWED_BUCKETS.includes(segments[0])) return null;
  if (segments.some((s) =>
    s.length === 0 || s === '.' || s.includes('..') || s.includes('/') ||
    s.includes('\\') || s.includes('\0')
  )) return null;
  return { bucket: segments[0], key: segments.slice(1).join('/') };
}

export function contentTypeFor(p: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.pdf': 'application/pdf',
  };
  return map[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
}
