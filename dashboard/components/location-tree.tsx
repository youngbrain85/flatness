import Link from 'next/link';
import type { BuildingNode } from '@/lib/domain/tree';
import type { AnalysisStatus, ScanRow, Verdict } from '@/lib/domain/types';
import { GRADE_COLOR, GRADE_LABEL, SCAN_STATUS_LABEL, SURFACE_LABEL } from '@/lib/domain/labels';

export interface ScanWithCurrent extends ScanRow {
  current?: { id: string; status: AnalysisStatus; overall_verdict: Verdict | null };
}

export function LocationTree({ tree, scansByLocation, siteId }: {
  tree: BuildingNode[];
  scansByLocation: Map<string, ScanWithCurrent[]>;
  siteId: string;
}) {
  if (tree.length === 0) return <p className="text-sm text-slate-500">측정위치가 없습니다. 아래에서 추가하세요.</p>;
  return (
    <div className="space-y-4">
      {tree.map((b) => (
        <section key={b.building}>
          <h3 className="font-semibold">{b.building || '(동 미지정)'}</h3>
          {b.floors.map((f) => (
            <div key={f.floor} className="ml-4 mt-1">
              <h4 className="text-sm font-medium text-slate-600">{f.floor || '(층 미지정)'}</h4>
              {f.rooms.map((r) => (
                <div key={r.room} className="ml-4 mt-1">
                  <h5 className="text-sm text-slate-500">{r.room || '(공간 미지정)'}</h5>
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
                              className="rounded bg-blue-700 px-2 py-1 text-xs font-medium text-white hover:bg-blue-800">
                              스캔 업로드
                            </Link>
                            <Link href={`/reports?location=${l.id}`}
                              className="text-xs text-blue-700 hover:underline">보고서</Link>
                          </span>
                        </div>
                        <ul className="mt-1 space-y-0.5">
                          {(scansByLocation.get(l.id) ?? []).map((s) => (
                            <li key={s.id}>
                              <Link href={`/scans/${s.id}`} className="flex items-center gap-2 hover:underline">
                                <span>{s.scanned_at} · {SURFACE_LABEL[s.surface]}</span>
                                {/* 리뷰 Important 3: verdict가 falsy(null)라고 바로 스캔 상태
                                    라벨로 떨어지면 판정 불가·분석 실패 분석이 "분석 준비됨"
                                    등 미분석 스캔과 구분되지 않는다 - 현재 분석의 status를
                                    먼저 분기한다 */}
                                {s.current?.overall_verdict ? (
                                  <span className="rounded px-1.5 text-xs text-white"
                                    style={{ backgroundColor: GRADE_COLOR[s.current.overall_verdict] }}>
                                    {GRADE_LABEL[s.current.overall_verdict]}
                                  </span>
                                ) : s.current?.status === 'done' ? (
                                  <span className="rounded px-1.5 text-xs text-white"
                                    style={{ backgroundColor: GRADE_COLOR.na }}>
                                    {GRADE_LABEL.na}
                                  </span>
                                ) : s.current?.status === 'failed' ? (
                                  <span className="rounded bg-red-600 px-1.5 text-xs text-white">분석 실패</span>
                                ) : (
                                  <span className="text-xs text-slate-500">{SCAN_STATUS_LABEL[s.status]}</span>
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
