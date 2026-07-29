// 서버 전용: DATA_DIR 결합·경로 탈출 차단
import path from 'path';

const ALLOWED_ROOTS = ['raw-scans', 'artifacts', 'reports'];

export function resolveDataPath(dataDir: string, segments: string[]): string | null {
  if (segments.length < 2) return null; // 루트 디렉터리 자체는 서빙하지 않는다
  if (!ALLOWED_ROOTS.includes(segments[0])) return null;
  if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('\\'))) return null;
  const base = path.resolve(dataDir);
  const abs = path.resolve(base, ...segments);
  if (!abs.startsWith(base + path.sep)) return null; // 방어선 2중화
  return abs;
}

export function contentTypeFor(p: string): string {
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.pdf': 'application/pdf',
  };
  return map[path.extname(p).toLowerCase()] ?? 'application/octet-stream';
}
