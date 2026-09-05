'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { groupCriteria, thresholdSummary } from '@/lib/domain/criteria';
import { SURFACE_LABEL } from '@/lib/domain/labels';
import type { CriteriaRow } from '@/lib/domain/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { tableClass } from '@/components/ui/data-table';
import { checkClass } from '@/components/ui/form';

// 아트보드 Settings의 셀: padding 12px 20px, 세로 중앙(첫 열이 두 줄이라 h-11은 최소 높이로만 작동).
const cell = `${tableClass.td} py-3 align-middle`;

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
    <tr className={tableClass.row}>
      <td className={cell}>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] font-bold">{c.name}</span>
            {c.is_default && <Badge tone="neutral">기본</Badge>}
          </div>
          {/* 출처는 전문 표시 - 말줄임(truncate/line-clamp) 금지(스펙 §6 Settings) */}
          <span className="block text-xs leading-4 text-cs-text-secondary">{c.source_text}</span>
        </div>
      </td>
      <td className={`${cell} whitespace-nowrap text-cs-nav-text`}>{SURFACE_LABEL[c.surface]} · v{c.version}</td>
      <td className={`${cell} whitespace-nowrap tabular-nums`}>{c.thresholds.map(thresholdSummary).join(' · ')}</td>
      <td className={cell}>
        <input type="checkbox" checked={active} onChange={toggle} aria-label={`${c.name} 활성`} className={checkClass} />
      </td>
    </tr>
  );
}

// 전역·현장 그룹이 같은 4열 표를 쓴다. 비공개 헬퍼 - export 하지 않는다.
function CriteriaTable({ rows, onError }: { rows: CriteriaRow[]; onError: (m: string) => void }) {
  return (
    <table className={tableClass.table}>
      <thead className={tableClass.thead}>
        <tr>
          <th className={tableClass.th}>기준 · 출처</th>
          <th className={tableClass.th}>표면 · 버전</th>
          <th className={tableClass.th}>임계값</th>
          <th className={tableClass.th}>활성</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => <Row key={c.id} c={c} onError={onError} />)}
      </tbody>
    </table>
  );
}

// 소제목 16px 700 + (n) 보조색, padding 12px 20px(아트보드 "전역 기본 기준 (16)").
function GroupTitle({ title, count, divided }: { title: React.ReactNode; count: number; divided?: boolean }) {
  return (
    <div className={`flex items-baseline gap-1.5 px-5 py-3${divided ? ' border-t border-cs-divider' : ''}`}>
      <h3 className="text-base font-bold leading-5">{title}</h3>
      <span className="text-base leading-5 text-cs-text-secondary">({count})</span>
    </div>
  );
}

export function CriteriaList({ criteria, siteNames }: {
  criteria: CriteriaRow[];
  siteNames: Map<string, string>;
}) {
  const [error, setError] = useState<string | null>(null);
  const { global, bySite } = groupCriteria(criteria);
  // padded={false} 컨테이너 안이므로 여백은 여기서 준다.
  return (
    <div className="flex flex-col">
      {error && <div className="px-5 pt-5"><Alert type="error">{error}</Alert></div>}
      <section>
        <GroupTitle title="전역 기본 기준" count={global.length} />
        <CriteriaTable rows={global} onError={setError} />
      </section>
      {[...bySite.entries()].map(([siteId, rows]) => (
        <section key={siteId}>
          <GroupTitle title={<>현장 기준: {siteNames.get(siteId) ?? siteId}</>} count={rows.length} divided />
          <CriteriaTable rows={rows} onError={setError} />
        </section>
      ))}
      <p className="border-t border-cs-divider p-5 text-xs leading-4 text-cs-text-secondary">
        기준 신설·버전 개정·현장별 재정의 추가는 데모 범위 밖입니다. Supabase SQL Editor에서
        criteria 테이블에 직접 추가하세요(부분 유니크 제약: 활성 행 기준 (surface, name) 유일).
      </p>
    </div>
  );
}
