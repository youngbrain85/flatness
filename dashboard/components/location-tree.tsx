import Link from 'next/link';
import type { BuildingNode } from '@/lib/domain/tree';
import type { AnalysisStatus, Grade, ScanRow, ScanStatus, Verdict } from '@/lib/domain/types';
import { GRADE_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import { LinkButton } from '@/components/ui/button';
import { GradeDot } from '@/components/ui/grade';
import { Icon } from '@/components/ui/icons';
import { SCAN_STATUS_TYPE, StatusIndicator, type StatusType } from '@/components/ui/status-indicator';

export interface ScanWithCurrent extends ScanRow {
  current?: { id: string; status: AnalysisStatus; overall_verdict: Verdict | null };
}

// 줄 안 글자 링크(아트보드 SiteDetail '스캔 정합'·'보고서'): ink 글자 + dim 밑줄, 높이 44px.
const TEXT_LINK = 'inline-flex min-h-11 items-center text-sm text-ink underline decoration-dim underline-offset-4 hover:decoration-ink';
// 동 › 층 › 공간 들여쓰기: 1px line-2 세로줄 + clamp(12px, 2vw, 20px) 안쪽 여백(아트보드 그대로).
const INDENT = 'border-l border-line-2 pl-[clamp(12px,2vw,20px)]';

// 최종 리뷰 Important 2: 미분석 스캔의 상태 표시. 아트보드(SiteDetail)의 트리 행은
// '업로드됨'·'분석 준비됨'만 진행 중(속 빈 고리)으로 그린다 - 트리에서 '분석 준비됨'은 "아직 분석
// 결과가 없다"는 뜻이라 이 화면에서는 종결이 아니기 때문이다. 그 두 상태만 예외로 두고
// 나머지(failed·archived·awaiting_unit_confirm)는 스캔 상세와 같은 표를 쓴다 - 예전에는
// 전부 같은 표시라 '실패'·'보관됨'까지 진행 중처럼 보여 같은 스캔이 두 화면에서 달라 보였다.
function treeScanStatusType(status: ScanStatus): StatusType {
  return status === 'ready' || status === 'uploaded' ? 'in-progress' : SCAN_STATUS_TYPE[status];
}

// 판정 표시: 8px 등급 색 점 + 등급 글자(색만으로 말하지 않는다 - 스펙 §8). 등급 색은 화면 등급 색 토큰이다.
function GradeMark({ grade }: { grade: Grade }) {
  return (
    <span data-grade={grade} className="inline-flex items-center gap-2 text-sm text-ink">
      <GradeDot grade={grade} />
      {GRADE_LABEL[grade]}
    </span>
  );
}

// 아트보드(SiteDetail): 동(h2) › 층(h3) › 공간(h4) 소제목이 세로줄로 들여쓰기되고, 공간마다 측정위치
// 카드(ground 바탕 · line-2 · 12px)가 340px 이상 칸으로 나란히 놓인다. 카드 줄의 버튼은 전부 보조다
// (이 화면 본문의 주 버튼은 '위치 추가'). 카드 li의 id(loc-<측정위치 id>)는 현장 대시보드 타일과
// 스캔 작업대 브레드크럼이 #으로 가리키는 닻이다.
export function LocationTree({ tree, scansByLocation, siteId }: {
  tree: BuildingNode[];
  scansByLocation: Map<string, ScanWithCurrent[]>;
  siteId: string;
}) {
  if (tree.length === 0) return <p className="text-sm text-muted">측정위치가 없습니다. 아래에서 추가하세요.</p>;
  return (
    <div className="flex flex-col gap-[22px]">
      {tree.map((b, bi) => (
        <section key={b.building} aria-labelledby={`bld-${bi}`} className="flex flex-col gap-3">
          <h2 id={`bld-${bi}`} className="text-base font-semibold [overflow-wrap:anywhere]">{b.building || '(동 미지정)'}</h2>
          <div className={`flex flex-col gap-[18px] ${INDENT}`}>
            {b.floors.map((f) => (
              <div key={f.floor} className="flex flex-col gap-2.5">
                <h3 className="text-sm font-semibold text-ink-2 [overflow-wrap:anywhere]">{f.floor || '(층 미지정)'}</h3>
                <div className={`grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-x-3 gap-y-4 ${INDENT}`}>
                  {f.rooms.map((r) => (
                    <div key={r.room} className="flex min-w-0 flex-col gap-2">
                      <h4 className="text-sm font-medium text-muted [overflow-wrap:anywhere]">{r.room || '(공간 미지정)'}</h4>
                      {/* role="list": Tailwind preflight 의 list-style: none 때문에 Safari VoiceOver 가 목록 의미를 버리지 않게 직접 단다 */}
                      <ul role="list" className="flex flex-auto flex-col gap-2">
                        {r.locations.map((l) => (
                          <li key={l.id} id={`loc-${l.id}`}
                            className="flex flex-auto flex-col gap-1.5 rounded-card border border-line-2 bg-ground px-4 py-1.5">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              <span className="mr-auto min-w-0 text-[15px] font-semibold [overflow-wrap:anywhere]">{l.name}</span>
                              {/* 단계 F: 같은 위치를 나눠 찍은 두 스캔을 하나로 합치는
                                  진입점. 후보 스캔이 2개 미만이면 그 화면이 이유를
                                  안내하므로 여기서는 조건 없이 보여준다(스캔 개수를
                                  세려면 목록 쿼리에 조건을 더해야 하고, 정합 가능
                                  조건은 개수만이 아니다 - 높이 뷰·단위 확정도 본다). */}
                              <Link href={`/registrations/new?location=${l.id}`} className={TEXT_LINK}>스캔 정합</Link>
                              {/* 옛 /reports?location= 은 다크 C안에서 진입 페이지로 리다이렉트된다 - 이 현장의
                                  보고서 탭이 같은 ?location= 거르기를 받는다(T10). */}
                              <Link href={`/sites/${siteId}/reports?location=${l.id}`} className={TEXT_LINK}>보고서</Link>
                              {/* C4: 측정위치별 업로드 진입점 강조 - 텍스트 링크에서
                                  눈에 띄는 버튼으로(이 화면에서 가장 자주 하는 다음
                                  동작이므로 "보고서"보다 시각적 우선순위를 둔다).
                                  다크 C안: 현장 안 업로드 화면(T6)이 ?location= 으로 이 위치를 미리 고른다. */}
                              <LinkButton href={`/sites/${siteId}/upload?location=${l.id}`} variant="normal">
                                <Icon name="upload" />
                                스캔 업로드
                              </LinkButton>
                            </div>
                            <ul role="list" className="flex flex-col">
                              {(scansByLocation.get(l.id) ?? []).map((s) => (
                                <li key={s.id} className="border-t border-line">
                                  <Link href={`/scans/${s.id}`}
                                    className="flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1 text-ink">
                                    <span className="font-mono text-[13px] tabular-nums underline decoration-dim underline-offset-4">{s.scanned_at}</span>
                                    <span className="text-sm text-muted">· {SURFACE_LABEL[s.surface]}</span>
                                    {/* 리뷰 Important 3: verdict가 falsy(null)라고 바로 스캔 상태
                                        라벨로 떨어지면 판정 불가·분석 실패 분석이 "분석 준비됨"
                                        등 미분석 스캔과 구분되지 않는다 - 현재 분석의 status를
                                        먼저 분기한다 */}
                                    {s.current?.overall_verdict ? (
                                      <GradeMark grade={s.current.overall_verdict} />
                                    ) : s.current?.status === 'done' ? (
                                      <GradeMark grade="na" />
                                    ) : s.current?.status === 'failed' ? (
                                      <StatusIndicator type="error">분석 실패</StatusIndicator>
                                    ) : (
                                      <StatusIndicator type={treeScanStatusType(s.status)}>{SCAN_STATUS_LABEL[s.status]}</StatusIndicator>
                                    )}
                                    <Icon name="chevron-right" size={14} className="ml-auto text-dim" />
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
