// 브라우저에서 Storage로 직접 올린다(lib/photos/upload.ts 패턴 확장).
// 서버 경유(/api/upload)를 없앤 이유: Vercel 요청 본문 상한(약 4.5MB)에 걸려 원본
// 점군을 아예 못 올리고, 클라이언트가 anon 키로 Storage를 직접 호출할 수 있는 이상
// 보안상 얻는 것도 없다.
import type { SupabaseClient } from '@supabase/supabase-js';
import { rawScanRelPath } from '@/lib/domain/paths';

export function storageErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(msg)) {
    return '파일이 저장소 한도를 초과했습니다. 관리자에게 저장소 요금제 상향을 요청하거나 더 작은 범위로 나눠 스캔하세요.';
  }
  if (/exceeded.*quota|storage limit/i.test(msg)) {
    return '저장소 용량이 가득 찼습니다. 오래된 스캔을 정리하거나 요금제를 올려야 합니다.';
  }
  return `파일 업로드에 실패했습니다: ${msg}`;
}

// 보안 참고: 서버 코드를 거치지 않고 브라우저가 Storage로 직접 올리므로 서버 측 검증이
// 전혀 없다 - 접근 통제는 전적으로 Storage 버킷 정책(RLS)에 달려 있다. 현재 유일한
// 방어선은 supabase/migrations/005_storage_buckets.sql의 raw_scans_all_auth 정책
// (to authenticated 전원에게 raw-scans 버킷 전체 읽기·쓰기 허용)이다. 이 정책을 바꿀 때는
// (1) 회원가입이 여전히 차단돼 있는지(docs/DEPLOY.md §1), (2) 경로 스코프 제한이 필요한지
// (다중 기관 사용 시 - 백로그 티켓 55·57)를 함께 확인한다.
export async function uploadRawScan(
  supabase: SupabaseClient, file: File, siteId: string, scanId: string, ext: string,
): Promise<string> {
  const rel = rawScanRelPath(siteId, scanId, ext); // raw-scans/{site}/{scan}/raw.{ext}
  const key = rel.replace(/^raw-scans\//, '');
  const { error } = await supabase.storage.from('raw-scans').upload(key, file, { upsert: true });
  if (error) throw new Error(storageErrorMessage(error));
  return rel;
}
