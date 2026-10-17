// 구배 분석: 제목 줄 버튼 + '구배 분석' 카드(다크 C안, 아트보드 ScanDone).
//
// 아트보드는 '구배 분석' 버튼을 페이지 제목 줄('평활도 분석' 버튼 옆)에, '적용 기준' 라디오를
// 아래 '구배 분석' 카드 본문에 둔다. 둘은 같은 클라이언트 상태(고른 기준 id)를 쓰므로 서버
// 페이지가 두 자리에 따로 그리면 상태가 갈라진다. 그래서 SlopeAnalysisScope가 상태(useReanalyze)를
// 한 번 만들어 컨텍스트로 내려 주고, 제목 줄 조각(SlopeAnalysisAction)과 카드(SlopeAnalysisCard)가
// 같은 ctl을 읽는다. 서버 페이지는 본문 전체를 SlopeAnalysisScope로 감싼다(app/scans/[id]/page.tsx).
// 옛 SlopeAnalysisContainer(카드 하나가 헤더에 버튼, 본문에 라디오)를 이 세 조각이 대신한다.
//
// 잡 등록 로직은 reanalyze-button.tsx의 useReanalyze 그대로다(중복 구현 없음).
'use client';
import { createContext, useContext, type ReactNode } from 'react';
import {
  ReanalyzeAction, SlopeCriteriaField, useReanalyze, type ReanalyzeControl,
} from '@/components/reanalyze-button';
import { Container } from '@/components/ui/container';
import { ANALYSIS_KIND_LABEL } from '@/lib/domain/labels';
import type { AnalysisStatus } from '@/lib/domain/types';

const TITLE = `${ANALYSIS_KIND_LABEL.slope} 분석`;

// null = 버튼을 그리지 않는 경우(showButton=false 또는 비로그인). 이때는 기준 후보도 부르지 않는다.
const SlopeAnalysisContext = createContext<ReanalyzeControl | null>(null);

interface ScopeProps {
  scanId: string;
  /** 로그인 사용자 id. 없으면 버튼을 그리지 않는다 - 옛 page.tsx의 `user &&` 게이트다. */
  userId?: string;
  /** 기준 후보 해석(fn_resolve_criteria)에 쓰는 현장 id. */
  siteId?: string;
  /** 가장 최근 구배 분석의 상태 - queued/processing이면 중복 실행을 막는다. */
  latestStatus?: AnalysisStatus;
  /** 옛 showSlopeButton 게이트. false면 버튼도 기준 라디오도 없다(기준 조회도 안 한다). */
  showButton: boolean;
  children: ReactNode;
}

export function SlopeAnalysisScope({ scanId, userId, siteId, latestStatus, showButton, children }: ScopeProps) {
  // 버튼을 그리지 않는 경우에는 기준 후보도 부르지 않는다 - 옛 코드에서 ReanalyzeButton
  // 자체가 렌더되지 않아 마운트 시 fn_resolve_criteria가 아예 호출되지 않던 것과 같다.
  // 훅 호출 여부를 분기하려고 컴포넌트를 둘로 갈랐다(조건부 훅 금지).
  if (!showButton || !userId) {
    return <SlopeAnalysisContext.Provider value={null}>{children}</SlopeAnalysisContext.Provider>;
  }
  return (
    <ScopeWithButton scanId={scanId} userId={userId} siteId={siteId} latestStatus={latestStatus}>
      {children}
    </ScopeWithButton>
  );
}

function ScopeWithButton({ scanId, userId, siteId, latestStatus, children }: {
  scanId: string; userId: string; siteId?: string; latestStatus?: AnalysisStatus; children: ReactNode;
}) {
  // 구배는 항상 클릭 시점의 기준이 아니라 마운트 시 해석한 후보 중 사용자가 고른 것을
  // 쓰므로 criteriaId를 넘기지 않는다(컨트롤러 보강 확정 1 + 코드리뷰(4차) N1).
  // 호출부(page.tsx)의 showSlopeButton이 이미 !isImportUnknownOrTrue로 걸렀으므로
  // 이 버튼은 항상 'analyze' 잡만 건다 - isImport={false}가 그 사실의 표현이다.
  const ctl = useReanalyze({
    scanId, userId, surface: 'floor', kind: 'slope', siteId, latestStatus, isImport: false,
  });
  return <SlopeAnalysisContext.Provider value={ctl}>{children}</SlopeAnalysisContext.Provider>;
}

// 제목 줄의 '구배 분석' 버튼(+ 진행 중 안내·오류). 범위의 게이트가 닫혀 있으면 아무것도 그리지 않는다.
export function SlopeAnalysisAction() {
  const ctl = useContext(SlopeAnalysisContext);
  return ctl ? <ReanalyzeAction ctl={ctl} /> : null;
}

// '구배 분석' 카드: 적용 기준(버튼이 켜져 있을 때만) → 진행 상태·이전 이력(children).
// 이미 완료된 구배 결과·이력은 버튼 없이도 계속 보인다(컨트롤러 보강 확정 5).
export function SlopeAnalysisCard({ className, children }: { className?: string; children?: ReactNode }) {
  const ctl = useContext(SlopeAnalysisContext);
  return (
    <Container title={TITLE} className={className}>
      <div className="flex flex-col gap-4">
        {ctl && <SlopeCriteriaField ctl={ctl} />}
        {children}
      </div>
    </Container>
  );
}
