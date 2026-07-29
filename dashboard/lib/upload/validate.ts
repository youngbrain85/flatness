export const SCAN_EXTS = ['ply', 'las', 'laz', 'xyz', 'txt', 'csv', 'pts'] as const;

export function validateScanFile(filename: string): { ext: string } | null {
  const parts = filename.split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop()!.toLowerCase();
  return (SCAN_EXTS as readonly string[]).includes(ext) ? { ext } : null;
}

// 단위 확정 배율(스펙 §5.1.1): 파일 좌표 -> m 변환 계수 (scans.unit_scale)
export const UNIT_OPTIONS = [
  { value: 1.0, label: 'm(미터)' },
  { value: 0.01, label: 'cm(센티미터)' },
  { value: 0.001, label: 'mm(밀리미터)' },
];

// 업로드 크기 상한(리뷰 Important #3): 라이다 원본은 수백 MB~GB급이지만, 현재
// app/api/upload/route.ts가 파일 전체를 메모리에 버퍼링하므로 데모 서버 보호를 위해
// 1GiB로 제한한다. 스트리밍 저장으로 상한 자체를 없애는 건 이번 범위 밖(백로그).
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1 GiB

export function isUploadSizeAllowed(size: number): boolean {
  return size <= MAX_UPLOAD_BYTES;
}
