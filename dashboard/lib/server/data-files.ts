// 서버 전용: DATA_DIR 결합·경로 탈출 차단
import path from 'path';

const ALLOWED_ROOTS = ['raw-scans', 'artifacts', 'reports'];

export function resolveDataPath(dataDir: string, segments: string[]): string | null {
  if (segments.length < 2) return null; // 루트 디렉터리 자체는 서빙하지 않는다
  if (!ALLOWED_ROOTS.includes(segments[0])) return null;
  // 포함 검사로 강화: Next.js 라우팅은 %2f를 세그먼트 경계가 아닌 디코딩된 문자로
  // 취급하므로 단일 세그먼트에 '../secret.txt'처럼 슬래시·..가 임베드될 수 있다
  // (리뷰 Critical: 정확 일치(===)만으로는 이 임베드 트래버설을 놓친다).
  if (segments.some((s) =>
    s.length === 0 || s === '.' || s.includes('..') || s.includes('/') || s.includes('\\') || s.includes('\0')
  )) return null;
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
