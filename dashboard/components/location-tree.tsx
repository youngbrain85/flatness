import Link from 'next/link';
import type { BuildingNode } from '@/lib/domain/tree';
import type { AnalysisStatus, ScanRow, Verdict } from '@/lib/domain/types';
import { GRADE_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';
import { GRADE_TONE } from '@/lib/domain/grade-tone';
import { Badge } from '@/components/ui/badge';

export interface ScanWithCurrent extends ScanRow {
  current?: { id: string; status: AnalysisStatus; overall_verdict: Verdict | null };
}

export function LocationTree({ tree, scansByLocation, siteId }: {
  tree: BuildingNode[];
  scansByLocation: Map<string, ScanWithCurrent[]>;
  siteId: string;
}) {
  if (tree.length === 0) return <p className="text-sm text-zinc-500">측정위치가 없습니다. 아래에서 추가하세요.</p>;
  return (
    <div className="space-y-4">
      {tree.map((b) => (
        <section key={b.building}>
          <h3 className="font-semibold">{b.building || '(동 미지정)'}</h3>
          {b.floors.map((f) => (
            <div key={f.floor} className="ml-4 mt-1">
              <h4 className="text-sm font-medium text-zinc-600">{f.floor || '(층 미지정)'}</h4>
              {f.rooms.map((r) => (
                <div key={r.room} className="ml-4 mt-1">
                  <h5 className="text-sm text-zinc-500">{r.room || '(공간 미지정)'}</h5>
                  <ul className="ml-4 space-y-1">
                    {r.locations.map((l) => (
                      <li key={l.id} className="rounded border bg-white p-2 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{l.name}</span>
                          <span className="flex items-center gap-3">
                            {/* C4: 측정위치별 업로드 진입점 강조 - 텍스트 링크에서
                                눈에 띄는 버튼으로(이 화면에서 가장 자주 하는 다음
                                동작이므로 "보고서"보다 시각적 우선순위를 둔다) */}
                            <Link href={`/upload?site=${siteId}&location=${l.id}`}
                              className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-700">
                              스캔 업로드
                            </Link>
                            {/* 단계 F: 같은 위치를 나눠 찍은 두 스캔을 하나로 합치는
                                진입점. 후보 스캔이 2개 미만이면 그 화면이 이유를
                                안내하므로 여기서는 조건 없이 보여준다(스캔 개수를
                                세려면 목록 쿼리에 조건을 더해야 하고, 정합 가능
                                조건은 개수만이 아니다 - 높이 뷰·단위 확정도 본다). */}
                            <Link href={`/registrations/new?location=${l.id}`}
                              className="text-xs text-zinc-600 hover:text-zinc-900 hover:underline">스캔 정합</Link>
                            <Link href={`/reports?location=${l.id}`}
                              className="text-xs text-zinc-600 hover:text-zinc-900 hover:underline">보고서</Link>
                          </span>
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {(scansByLocation.get(l.id) ?? []).map((s) => (
                            <li key={s.id}>
                              <Link href={`/scans/${s.id}`} className="flex items-center gap-2 hover:underline">
                                <span className="font-mono tabular-nums">{s.scanned_at}</span>
                                <span>· {SURFACE_LABEL[s.surface]}</span>
                                {/* 리뷰 Important 3: verdict가 falsy(null)라고 바로 스캔 상태
                                    라벨로 떨어지면 판정 불가·분석 실패 분석이 "분석 준비됨"
                                    등 미분석 스캔과 구분되지 않는다 - 현재 분석의 status를
                                    먼저 분기한다 */}
                                {s.current?.overall_verdict ? (
                                  <Badge tone={GRADE_TONE[s.current.overall_verdict]}>
                                    {GRADE_LABEL[s.current.overall_verdict]}
                                  </Badge>
                                ) : s.current?.status === 'done' ? (
                                  <Badge tone={GRADE_TONE.na}>{GRADE_LABEL.na}</Badge>
                                ) : s.current?.status === 'failed' ? (
                                  <Badge tone="fail">분석 실패</Badge>
                                ) : (
                                  <Badge tone="neutral">{SCAN_STATUS_LABEL[s.status]}</Badge>
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
          ))}
        </section>
      ))}
    </div>
  );
}
