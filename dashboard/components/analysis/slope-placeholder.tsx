// 구배 결과 화면은 단계 D에서 만든다. 그때까지 이 화면이 URL 직접 접근을 받는다.
// AnalysisResult로 흘려보내면 lib/domain/stats.ts의 coverageLabel이 stats.meta를
// 옵셔널 체이닝 없이 읽어 TypeError로 페이지가 죽는다(app/analyses/[id]/page.tsx가
// isSlopeStats(analysis.stats)로 갈라 이 컴포넌트로 보낸다).
import { ANALYSIS_KIND_LABEL, warningLabel } from '@/lib/domain/labels';
import { dataUrl } from '@/lib/domain/paths';
import type { SlopeStats } from '@/lib/domain/types';

const COUNT_ORDER = ['적합', '경계', '보수', '재시공', '판정불가'] as const;

// 전 셀 판정불가면 편차 통계 3개가 전부 null이다(engine/flatness/core/slope.py
// slope_summary) - 숫자 포맷 함수에 null을 그냥 넘기지 않고 여기서 먼저 걸러낸다.
function fmtDevPct(v: number | null): string {
  return v === null ? '판정 가능한 셀 없음' : `${v.toFixed(2)}%`;
}

export function SlopePlaceholder({ stats }: { stats: SlopeStats }) {
  const { summary } = stats;
  return (
    <div className="space-y-4 rounded-lg border bg-white p-4">
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-800 px-3 py-1 text-sm font-bold text-white">
          {ANALYSIS_KIND_LABEL.slope}
        </span>
      </div>

      <div>
        <h3 className="text-sm font-semibold">판정 요약</h3>
        <p className="mt-1 text-sm text-slate-700">
          {COUNT_ORDER.map((k) => `${k} ${summary.counts[k]}`).join(' · ')}
        </p>
        <p className="mt-1 text-xs text-slate-500">판정 가능 비율 {summary.coverage_pct.toFixed(1)}%</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">평균 편차</dt><dd>{fmtDevPct(summary.mean_dev_pct)}</dd>
        <dt className="text-slate-500">편차 표준편차</dt><dd>{fmtDevPct(summary.std_dev_pct)}</dd>
        <dt className="text-slate-500">최대 편차</dt><dd>{fmtDevPct(summary.max_dev_pct)}</dd>
      </dl>

      {stats.warnings.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">경고</h3>
          {/* 구배 warnings는 엔진이 이미 완성된 한국어 문장으로 내보낸다(평활도의 ASCII
              코드 슬러그와 다르다) - warningLabel은 미지 코드를 원문 그대로 반환하므로
              그대로 통과시켜도 안전하다. */}
          <ul className="mt-1 space-y-1">
            {stats.warnings.map((w) => (
              <li key={w} className="rounded border border-amber-300 bg-amber-50 p-2 text-xs">
                {warningLabel(w)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats.artifacts.map_png && (
        <div>
          <h3 className="text-sm font-semibold">구배 판정 지도</h3>
          {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={dataUrl(stats.artifacts.map_png)} alt="구배 판정 지도"
            className="mt-1 max-w-full rounded border bg-white" />
        </div>
      )}

      <p className="text-xs text-slate-500">
        구배 분석 상세 결과 화면은 준비 중입니다. 위 요약과 판정 지도만 우선 제공됩니다.
      </p>
    </div>
  );
}
