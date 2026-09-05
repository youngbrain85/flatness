// Free 일시정지 안내 (스펙 §3.3). Cloudscape warning Alert(스펙 §4)로 그리고 문구는 그대로 둔다.
// 상세(원문 오류 메시지)는 mono 12px/16px 보조색.
import { Alert } from '@/components/ui/alert';

export function SupabaseErrorNotice({ message }: { message: string }) {
  return (
    <Alert type="warning" title="Supabase 연결에 실패했습니다">
      <p>
        Free 프로젝트는 7일 미사용 시 일시정지됩니다. Supabase 대시보드에서 프로젝트를
        Restore(재개)한 뒤 새로고침하세요. 그 밖의 원인이면 .env.local의 URL·anon key를 확인하세요.
      </p>
      <p className="mt-1 font-mono text-xs leading-4 text-cs-text-secondary">상세: {message}</p>
    </Alert>
  );
}
