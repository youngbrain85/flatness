export const SCAN_EXTS = ['ply', 'las', 'laz', 'xyz', 'txt', 'csv', 'pts'] as const;

// 기존 결과 가져오기(임포트) 전용 확장자 — 엔진 계약(docs/contracts/stats-schema.md
// §7 "flatness-import-v1")이 CSV(colab)에 이어 JSON을 지원하면서 추가됨.
// csv는 SCAN_EXTS와 겹친다(스캔 원본 포맷이기도 하므로).
export const IMPORT_EXTS = ['csv', 'json'] as const;

/** filename의 확장자가 allowed 목록에 있으면 { ext }, 아니면 null. */
export function validateFile(
  filename: string,
  allowed: readonly string[] = SCAN_EXTS,
): { ext: string } | null {
  const parts = filename.split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop()!.toLowerCase();
  return allowed.includes(ext) ? { ext } : null;
}

/** 스캔 원본 업로드 검증(기본 동작 그대로 — SCAN_EXTS 7종). */
export function validateScanFile(filename: string): { ext: string } | null {
  return validateFile(filename, SCAN_EXTS);
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
