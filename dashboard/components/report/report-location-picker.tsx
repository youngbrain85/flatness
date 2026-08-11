// D7 Step 1: /reports/new에 location 쿼리 없이 들어왔을 때 먼저 보여주는 측정위치
// 선택 UI. 선택 즉시 라우트를 바꿔 서버 컴포넌트가 그 location으로 후보를 다시
// 조회하게 한다(로컬 상태로 후보를 들고 있지 않는다 - 후보 쿼리 자체가 서버 전용
// Supabase 클라이언트를 쓴다). optgroup 구성은 upload-form.tsx(T4)와 동일하게
// "현장별로 묶고, 측정위치가 0개인 현장은 목록에서 뺀다".
'use client';
import { useRouter } from 'next/navigation';
import type { LocationRow, SiteRow } from '@/lib/domain/types';

export function ReportLocationPicker({ sites, locations }: {
  sites: SiteRow[];
  locations: LocationRow[];
}) {
  const router = useRouter();
  return (
    <div className="max-w-md">
      <label htmlFor="report-location" className="block text-sm font-medium">측정위치</label>
      <select id="report-location" defaultValue=""
        onChange={(e) => {
          if (e.target.value) router.push(`/reports/new?location=${e.target.value}`);
        }}
        className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2">
        <option value="">선택...</option>
        {sites.map((s) => {
          const locs = locations.filter((l) => l.site_id === s.id);
          if (locs.length === 0) return null;
          return (
            <optgroup key={s.id} label={s.name}>
              {locs.map((l) => (
                <option key={l.id} value={l.id}>
                  {[l.building, l.floor, l.room, l.name].filter(Boolean).join(' / ')}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}
