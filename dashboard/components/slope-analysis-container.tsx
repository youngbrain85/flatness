// 구배 분석 컨테이너(T6 리뷰 수정 1차, 아트보드 ScanDone.dc.html 172-205행).
//
// 아트보드는 헤더에 '구배 분석' 버튼만 두고, 본문(20px 패딩)에 '적용 기준' + 기준
// 라디오를 그린다. 그런데 라디오와 버튼은 같은 클라이언트 상태(고른 기준 id)를
// 공유하므로 한 클라이언트 컴포넌트가 서버 Container의 actions 슬롯과 본문에 동시에
// 렌더할 수 없다 - 그래서 컨테이너 자체를 이 클라이언트 컴포넌트가 그리고, 본문에
// 들어갈 서버 렌더 결과(진행 상태·이전 이력)는 children으로 받는다.
// 수정 전에는 ReanalyzeButton 하나가 두 조각을 함께 들고 actions 슬롯에 들어가,
// 기준 5개짜리 라디오 목록이 shrink-0인 헤더 오른쪽 칸을 통째로 차지했다.
//
// 잡 등록 로직은 reanalyze-button.tsx의 useReanalyze 그대로다(중복 구현 없음).
'use client';
import type { ReactNode } from 'react';
import { ReanalyzeAction, SlopeCriteriaField, useReanalyze } from '@/components/reanalyze-button';
import { Container } from '@/components/ui/container';
import { ANALYSIS_KIND_LABEL } from '@/lib/domain/labels';
import type { AnalysisStatus } from '@/lib/domain/types';

const TITLE = `${ANALYSIS_KIND_LABEL.slope} 분석`;

interface Props {
  scanId: string;
  /** 로그인 사용자 id. 없으면 버튼을 그리지 않는다 - 옛 page.tsx의 `user &&` 게이트다. */
  userId?: string;
  /** 기준 후보 해석(fn_resolve_criteria)에 쓰는 현장 id. */
  siteId?: string;
  /** 가장 최근 구배 분석의 상태 - queued/processing이면 중복 실행을 막는다. */
  latestStatus?: AnalysisStatus;
  /** 옛 showSlopeButton 게이트. false면 버튼도 기준 라디오도 없다(기준 조회도 안 한다). */
  showButton: boolean;
  /** 본문: 진행 상태(AnalysisProgress)와 이전 분석 목록. 없으면 본문 패딩을 끈다. */
  children?: ReactNode;
}

export function SlopeAnalysisContainer({ scanId, userId, siteId, latestStatus, showButton, children }: Props) {
  // 버튼을 그리지 않는 경우에는 기준 후보도 부르지 않는다 - 옛 코드에서 ReanalyzeButton
  // 자체가 렌더되지 않아 마운트 시 fn_resolve_criteria가 아예 호출되지 않던 것과 같다.
  // 훅 호출 여부를 분기하려고 컴포넌트를 둘로 갈랐다(조건부 훅 금지).
  if (!showButton || !userId) {
    return <Container title={TITLE} padded={!!children}>{children}</Container>;
  }
  return (
    <SlopeAnalysisWithButton scanId={scanId} userId={userId} siteId={siteId} latestStatus={latestStatus}>
      {children}
    </SlopeAnalysisWithButton>
  );
}

function SlopeAnalysisWithButton({ scanId, userId, siteId, latestStatus, children }: {
  scanId: string; userId: string; siteId?: string; latestStatus?: AnalysisStatus; children?: ReactNode;
}) {
  // 구배는 항상 클릭 시점의 기준이 아니라 마운트 시 해석한 후보 중 사용자가 고른 것을
  // 쓰므로 criteriaId를 넘기지 않는다(컨트롤러 보강 확정 1 + 코드리뷰(4차) N1).
  // 호출부(page.tsx)의 showSlopeButton이 이미 !isImportUnknownOrTrue로 걸렀으므로
  // 이 버튼은 항상 'analyze' 잡만 건다 - isImport={false}가 그 사실의 표현이다.
  const ctl = useReanalyze({
    scanId, userId, surface: 'floor', kind: 'slope', siteId, latestStatus, isImport: false,
  });
  // 본문이 비면 20px 패딩만 남으므로 끈다(옛 padded={!!latestSlope}와 같은 취지).
  const hasBody = !!children || ctl.slopeCriteria.length > 0 || !!ctl.criteriaLoadError;
  return (
    <Container title={TITLE} padded={hasBody} actions={<ReanalyzeAction ctl={ctl} />}>
      <div className="flex flex-col gap-2">
        <SlopeCriteriaField ctl={ctl} />
        {children}
      </div>
    </Container>
  );
}
