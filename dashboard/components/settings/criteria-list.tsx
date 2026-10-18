'use client';
// 판정 기준 목록(스펙 §7.7). 아트보드 docs/design/dark/Settings.dc.html: 그룹 제목(h3 15px 600 + mono (n)) →
// 표 상자(TableBox, 최소 폭 960px - 가로로 넘치면 상자 안에서만 스크롤) 4열 → 맨 아래 안내 상자.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { groupCriteria, thresholdSummary } from '@/lib/domain/criteria';
import { SURFACE_LABEL } from '@/lib/domain/labels';
import type { CriteriaRow } from '@/lib/domain/types';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { TableBox, tableClass } from '@/components/ui/data-table';
import { checkClass } from '@/components/ui/form';

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

  // 칸 안쪽 글자는 span에 클래스를 준다 - tableClass.td의 글자색·여백과 같은 속성을 칸에 겹쳐 쓰지 않는다.
  return (
    <tr className={tableClass.row}>
      <td className={tableClass.td}>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-medium">{c.name}</span>
            {c.is_default && <Badge tone="neutral">기본</Badge>}
          </div>
          {/* 출처는 전문 표시 - 말줄임(truncate/line-clamp) 금지 */}
          <span className="text-[13px] text-muted">{c.source_text}</span>
        </div>
      </td>
      <td className={tableClass.td}>
        <span className="whitespace-nowrap text-ink-2">{SURFACE_LABEL[c.surface]} · v{c.version}</span>
      </td>
      <td className={tableClass.td}>
        <span className="whitespace-nowrap tabular-nums">{c.thresholds.map(thresholdSummary).join(' · ')}</span>
      </td>
      <td className={tableClass.td}>
        {/* 18px 체크박스를 44x44 라벨이 감싼다(터치 대상, 스펙 §7). 이름은 aria-label('<이름> 활성') */}
        <div className="flex justify-center">
          <label className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
            <input type="checkbox" checked={active} onChange={toggle} aria-label={`${c.name} 활성`}
              className={checkClass} />
          </label>
        </div>
      </td>
    </tr>
  );
}

// 전역·현장 그룹이 같은 4열 표를 쓴다. 비공개 헬퍼 - export 하지 않는다.
function CriteriaTable({ rows, onError }: { rows: CriteriaRow[]; onError: (m: string) => void }) {
  return (
    <TableBox minWidth={960}>
      <thead className={tableClass.thead}>
        <tr>
          <th scope="col" className={tableClass.th}>기준 · 출처</th>
          <th scope="col" className={tableClass.th}>표면 · 버전</th>
          <th scope="col" className={tableClass.th}>임계값</th>
          <th scope="col" className={tableClass.th}><span className="block text-center">활성</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => <Row key={c.id} c={c} onError={onError} />)}
      </tbody>
    </TableBox>
  );
}

// 그룹 제목: h3 15px 600 + (n) mono 12px muted(아트보드 "전역 기본 기준 (16)").
function GroupTitle({ title, count }: { title: React.ReactNode; count: number }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
      <h3 className="font-heading text-[15px] font-semibold">{title}</h3>
      <span className="font-mono text-xs text-muted">({count})</span>
    </div>
  );
}

export function CriteriaList({ criteria, siteNames }: {
  criteria: CriteriaRow[];
  siteNames: Map<string, string>;
}) {
  const [error, setError] = useState<string | null>(null);
  const { global, bySite } = groupCriteria(criteria);
  return (
    <div className="flex flex-col gap-3.5">
      {error && <Alert type="error">{error}</Alert>}
      <GroupTitle title="전역 기본 기준" count={global.length} />
      <CriteriaTable rows={global} onError={setError} />
      {[...bySite.entries()].map(([siteId, rows]) => (
        <div key={siteId} className="flex flex-col gap-3.5">
          <GroupTitle title={<>현장 기준: {siteNames.get(siteId) ?? siteId}</>} count={rows.length} />
          <CriteriaTable rows={rows} onError={setError} />
        </div>
      ))}
      <Alert type="info">
        기준 신설·버전 개정·현장별 재정의 추가는 데모 범위 밖입니다. Supabase SQL Editor에서{' '}
        <span className="font-mono">criteria</span> 테이블에 직접 추가하세요(부분 유니크 제약: 활성 행 기준 (surface, name) 유일).
      </Alert>
    </div>
  );
}
