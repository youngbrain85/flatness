// D7 Step 1(→ Task 10): /reports/new?site= 로 들어왔을 때 먼저 보여 주는 측정위치 고르기. 고르는 즉시
// 라우트를 바꿔 서버 컴포넌트가 그 location으로 후보를 다시 조회하게 한다(로컬 상태로 후보를 들고 있지 않는다 -
// 후보 쿼리 자체가 서버 전용 Supabase 클라이언트를 쓴다). 현장은 경로가 이미 정했다 - 이 현장의 측정위치만
// 받고 현장 묶음(optgroup)을 두지 않는다(스펙 §5 15행: 화면 안 현장 고르기 없음).
'use client';
import { useRouter } from 'next/navigation';
import { FormField, SelectWrap, selectClass } from '@/components/ui/form';
import type { LocationRow } from '@/lib/domain/types';

export function ReportLocationPicker({ locations }: { locations: LocationRow[] }) {
  const router = useRouter();
  return (
    <div className="max-w-md">
      <FormField label="측정위치" htmlFor="report-location">
        <SelectWrap>
          <select id="report-location" defaultValue=""
            onChange={(e) => {
              if (e.target.value) router.push(`/reports/new?location=${e.target.value}`);
            }}
            className={selectClass}>
            <option value="">선택...</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {[l.building, l.floor, l.room, l.name].filter(Boolean).join(' / ')}
              </option>
            ))}
          </select>
        </SelectWrap>
      </FormField>
    </div>
  );
}
