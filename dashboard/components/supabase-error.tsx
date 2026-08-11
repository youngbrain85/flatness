// Free 일시정지 안내 (스펙 §3.3)
export function SupabaseErrorNotice({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
      <p className="font-semibold">Supabase 연결에 실패했습니다</p>
      <p className="mt-1 text-zinc-700">
        Free 프로젝트는 7일 미사용 시 일시정지됩니다. Supabase 대시보드에서 프로젝트를
        Restore(재개)한 뒤 새로고침하세요. 그 밖의 원인이면 .env.local의 URL·anon key를 확인하세요.
      </p>
      <p className="mt-1 text-xs text-zinc-500">상세: {message}</p>
    </div>
  );
}
