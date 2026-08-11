'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { groupCriteria, thresholdSummary } from '@/lib/domain/criteria';
import { SURFACE_LABEL } from '@/lib/domain/labels';
import type { CriteriaRow } from '@/lib/domain/types';

function Row({ c, onError }: { c: CriteriaRow; onError: (m: string) => void }) {
  const router = useRouter();
  const [active, setActive] = useState(c.is_active);

  async function toggle() {
    const next = !active;
    // RLS 무음 거부 주의: USING 절이 거르면 오류 없이 0행이 갱신된다.
    // .select()로 갱신된 행을 돌려받아 0행이면 실패로 처리한다.
    const { data, error } = await createClient().from('criteria')
      .update({ is_active: next }).eq('id', c.id).select('id');
    if (error || !data || data.length === 0) {
      // RLS: 전역 행(site_id null)은 admin만 수정 가능 (001 site_write 정책)
      onError(c.site_id === null
        ? '전역 기준은 관리자만 수정할 수 있습니다 (is_admin은 SQL Editor에서 부여).'
        : `수정 실패: ${error?.message ?? '권한이 없습니다'}`);
      return;
    }
    setActive(next);
    router.refresh();
  }

  return (
    <li className="flex items-start justify-between gap-3 border-t p-2 first:border-t-0">
      <div>
        <p className="text-sm font-medium">
          {c.name}
          {c.is_default && <span className="ml-2 rounded bg-zinc-100 px-1.5 text-xs text-zinc-600">기본</span>}
          <span className="ml-2 text-xs text-zinc-500">{SURFACE_LABEL[c.surface]} · v{c.version}</span>
        </p>
        <p className="text-xs text-zinc-500">{c.source_text}</p>
        <p className="text-xs text-zinc-600">{c.thresholds.map(thresholdSummary).join(' · ')}</p>
      </div>
      <label className="flex shrink-0 items-center gap-1 text-xs">
        <input type="checkbox" checked={active} onChange={toggle} aria-label={`${c.name} 활성`} />
        활성
      </label>
    </li>
  );
}

export function CriteriaList({ criteria, siteNames }: {
  criteria: CriteriaRow[];
  siteNames: Map<string, string>;
}) {
  const [error, setError] = useState<string | null>(null);
  const { global, bySite } = groupCriteria(criteria);
  return (
    <div className="space-y-4">
      {error && <p className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
      <section>
        <h3 className="mb-1 text-sm font-semibold">전역 기본 기준</h3>
        <ul className="rounded border bg-white">
          {global.map((c) => <Row key={c.id} c={c} onError={setError} />)}
        </ul>
      </section>
      {[...bySite.entries()].map(([siteId, rows]) => (
        <section key={siteId}>
          <h3 className="mb-1 text-sm font-semibold">현장 기준: {siteNames.get(siteId) ?? siteId}</h3>
          <ul className="rounded border bg-white">
            {rows.map((c) => <Row key={c.id} c={c} onError={setError} />)}
          </ul>
        </section>
      ))}
      <p className="text-xs text-zinc-500">
        기준 신설·버전 개정·현장별 재정의 추가는 데모 범위 밖입니다. Supabase SQL Editor에서
        criteria 테이블에 직접 추가하세요(부분 유니크 제약: 활성 행 기준 (surface, name) 유일).
      </p>
    </div>
  );
}
