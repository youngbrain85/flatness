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
