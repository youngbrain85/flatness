import Link from 'next/link';
import type { BuildingNode } from '@/lib/domain/tree';
import type { AnalysisStatus, ScanRow, ScanStatus, Verdict } from '@/lib/domain/types';
import { GRADE_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { LinkButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import {
  SCAN_STATUS_TYPE, StatusIndicator, TONE_STATUS, type StatusType,
} from '@/components/ui/status-indicator';

export interface ScanWithCurrent extends ScanRow {
  current?: { id: string; status: AnalysisStatus; overall_verdict: Verdict | null };
}

// 카드 안 텍스트 링크(브레드크럼과 같은 cs-link 규칙)
const TEXT_LINK = 'text-cs-link hover:text-cs-link-hover hover:underline';

// 최종 리뷰 Important 2: 미분석 스캔의 상태 아이콘. 아트보드(SiteDetail.dc.html 137·161행)의
// 트리 행은 '업로드됨'·'분석 준비됨'만 시계로 그린다 - 트리에서 '분석 준비됨'은 "아직 분석
// 결과가 없다"는 뜻이라 이 화면에서는 종결이 아니기 때문이다. 그 두 상태만 예외로 두고
// 나머지(failed·archived·awaiting_unit_confirm)는 스캔 상세와 같은 표를 쓴다 - 예전에는
// 전부 시계라 '실패'·'보관됨'에도 시계가 붙어 같은 스캔이 두 화면에서 달라 보였다.
function treeScanStatusType(status: ScanStatus): StatusType {
  return status === 'ready' || status === 'uploaded' ? 'in-progress' : SCAN_STATUS_TYPE[status];
}

// 아트보드(SiteDetail): 동 › 층 › 공간 소제목이 1px 세로선 + 20px로 들여쓰기되고,
// 측정위치는 1px cs-divider · 8px 라운드 카드다. 카드 안 버튼은 전부 normal(뷰의 primary는 '위치 추가').
export function LocationTree({ tree, scansByLocation, siteId }: {
  tree: BuildingNode[];
  scansByLocation: Map<string, ScanWithCurrent[]>;
  siteId: string;
}) {
  if (tree.length === 0) return <p className="text-sm text-cs-text-secondary">측정위치가 없습니다. 아래에서 추가하세요.</p>;
  return (
    <div className="flex flex-col gap-4">
      {tree.map((b) => (
        <section key={b.building} className="flex flex-col gap-3">
          <h3 className="text-base font-bold leading-5">{b.building || '(동 미지정)'}</h3>
          <div className="flex flex-col gap-3 border-l border-cs-divider pl-5">
            {b.floors.map((f) => (
              <div key={f.floor} className="flex flex-col gap-2">
                <h4 className="text-sm font-bold text-cs-nav-text">{f.floor || '(층 미지정)'}</h4>
                <div className="flex flex-col gap-2 border-l border-cs-divider pl-5">
                  {f.rooms.map((r) => (
                    <div key={r.room} className="flex flex-col gap-2">
                      <h5 className="text-sm text-cs-text-secondary">{r.room || '(공간 미지정)'}</h5>
                      <ul className="flex flex-col gap-2">
                        {r.locations.map((l) => (
                          <li key={l.id} className="flex flex-col gap-2 rounded-lg border border-cs-divider bg-white px-4 py-3 text-sm">
                            <div className="flex items-center justify-between gap-4">
                              <span className="font-bold">{l.name}</span>
                              <span className="flex items-center gap-4">
                                {/* 단계 F: 같은 위치를 나눠 찍은 두 스캔을 하나로 합치는
                                    진입점. 후보 스캔이 2개 미만이면 그 화면이 이유를
                                    안내하므로 여기서는 조건 없이 보여준다(스캔 개수를
                                    세려면 목록 쿼리에 조건을 더해야 하고, 정합 가능
                                    조건은 개수만이 아니다 - 높이 뷰·단위 확정도 본다). */}
                                <Link href={`/registrations/new?location=${l.id}`} className={TEXT_LINK}>스캔 정합</Link>
                                <Link href={`/reports?location=${l.id}`} className={TEXT_LINK}>보고서</Link>
                                {/* C4: 측정위치별 업로드 진입점 강조 - 텍스트 링크에서
                                    눈에 띄는 버튼으로(이 화면에서 가장 자주 하는 다음
                                    동작이므로 "보고서"보다 시각적 우선순위를 둔다) */}
                                <LinkButton href={`/upload?site=${siteId}&location=${l.id}`} variant="normal">
                                  <Icon name="upload" />
                                  스캔 업로드
                                </LinkButton>
                              </span>
                            </div>
                            <ul className="flex flex-col gap-1">
                              {(scansByLocation.get(l.id) ?? []).map((s) => (
                                <li key={s.id}>
                                  <Link href={`/scans/${s.id}`} className="flex items-center gap-2 text-cs-text hover:underline">
                                    <span className="font-mono text-[13px] tabular-nums text-cs-link">{s.scanned_at}</span>
                                    <span className="text-cs-text-secondary">· {SURFACE_LABEL[s.surface]}</span>
                                    {/* 리뷰 Important 3: verdict가 falsy(null)라고 바로 스캔 상태
                                        라벨로 떨어지면 판정 불가·분석 실패 분석이 "분석 준비됨"
                                        등 미분석 스캔과 구분되지 않는다 - 현재 분석의 status를
                                        먼저 분기한다 */}
                                    {s.current?.overall_verdict ? (
                                      <StatusIndicator type={TONE_STATUS[GRADE_TONE[s.current.overall_verdict]]}>
                                        {GRADE_LABEL[s.current.overall_verdict]}
                                      </StatusIndicator>
                                    ) : s.current?.status === 'done' ? (
                                      <StatusIndicator type={TONE_STATUS[GRADE_TONE.na]}>{GRADE_LABEL.na}</StatusIndicator>
                                    ) : s.current?.status === 'failed' ? (
                                      <StatusIndicator type={TONE_STATUS.fail}>분석 실패</StatusIndicator>
                                    ) : (
                                      // 미분석 스캔의 상태 라벨(옛 neutral 배지): 아트보드대로 clock 아이콘 + 보조색
                                      <StatusIndicator type={treeScanStatusType(s.status)}>{SCAN_STATUS_LABEL[s.status]}</StatusIndicator>
                                    )}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
