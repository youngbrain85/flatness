// 3D 프리뷰 탭 본문 - 뷰어 / 기존 정적 PNG / 경우별 안내 분기(스펙 2026-10-02 pointcloud-viewer §7.11).
// 어느 화면을 낼지는 lib/domain/points3d.ts 의 resolvePreview3dMode(분기표를 옮긴 순수 함수)가 정한다.
// 이 컴포넌트는 그 모드를 그리고, WebGL2 탐지 결과와 점 파일 적재 요청을 상위(AnalysisResult)에 올린다.
//
// 상위가 가진 것(props): 적재 상태 load, 탐지 결과 support, 소프트웨어 렌더 선택 optedIn.
//   탭 본문은 조건부 렌더라 탭을 벗어나면 언마운트된다. 이 셋을 여기 로컬 state 로 두면
//   탭에 돌아올 때마다 다시 탐지하고 다시 받고 "3D로 보기"를 다시 눌러야 한다.
// 여기 로컬 state 는 rendererFailed 와 contextLost 둘뿐이다. 탭을 벗어나거나 분석이 바뀌면(key) 사라진다.
'use client';
import { useCallback, useEffect, useState } from 'react';
import { artifactUrl } from '@/lib/domain/paths';
import {
  defaultThresholdQ, loadFor, points3dFile, resolvePreview3dMode, shouldProbe, shouldRequestLoad,
} from '@/lib/domain/points3d';
import type { Points3dLoad, Preview3dInput, Webgl2Support } from '@/lib/domain/points3d';
import type { AnalysisRow, ScanRow, Stats } from '@/lib/domain/types';
import { probeWebgl2 } from '@/lib/viz/points3d/gl-renderer';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Points3dLoadingFrame, Points3dView } from './points3d-view';

// 화면 문구(스펙 §7.12 전문 그대로). M9(로딩)는 Points3dLoadingFrame 이 갖는다.
const M1 = '벽면 분석은 3D 프리뷰 이미지와 3D 점군 뷰를 제공하지 않습니다.';
const M2 = '외부 결과(임포트)에는 3D 점군 데이터를 생성하지 않습니다.';
const M3 = '이 분석에는 3D 점군 데이터가 없습니다. 재분석하면 생성됩니다.';
const M4 = '이 기기는 그래픽 가속을 사용할 수 없어 3D 점군 뷰가 느릴 수 있습니다. 기본으로 정적 이미지를 표시합니다.';
const M5 = '3D 점군 데이터를 저장소에서 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도하세요.';
const M6 = '3D 점군 데이터 형식을 읽을 수 없습니다. 지원하지 않는 버전이거나 손상된 파일입니다.';
const M7 = '이 브라우저 또는 기기에서는 WebGL2를 사용할 수 없어 3D 점군 뷰를 표시할 수 없습니다.';
const M8 = '그래픽 컨텍스트가 끊겨 3D 점군 뷰를 표시할 수 없습니다. 다시 시도하세요.';
const M10 = '엔진이 생성한 정적 3D 프리뷰 이미지입니다. 높이 축은 편차(mm)이며 실제 축 비율이 아닙니다.';

const STACK = 'flex flex-col gap-3';
const MUTED = 'text-sm text-cs-text-secondary';

export function Preview3dTab({
  analysis, stats, scan, isImport, load, support, optedIn,
  onSupport, onOptIn, onRequestLoad, onRetryLoad,
}: {
  analysis: AnalysisRow; stats: Stats; scan: ScanRow; isImport: boolean;
  load: Points3dLoad;                         // 상위가 가진 적재 상태. 그대로 받는다
  support: Webgl2Support | null;              // 상위가 가진 탐지 결과. null = 아직 탐지 전
  optedIn: boolean;                           // 상위가 가진 소프트웨어 렌더 선택
  onSupport(s: Webgl2Support | null): void;   // 탐지 결과를 상위에 올린다. null = 다시 탐지하겠다
  onOptIn(): void;                            // "3D로 보기"를 눌렀다
  onRequestLoad(): void;                      // 점 파일을 받아 달라(상위에서 멱등)
  onRetryLoad(): void;                        // 적재 상태를 버리고 곧바로 다시 받는다
}) {
  // Points3dView 가 onError 로 알린 실패. 탭 본문이 다시 마운트되면 사라진다(다시 시도와 같은 효과)
  const [rendererFailed, setRendererFailed] = useState(false);
  const [contextLost, setContextLost] = useState(false);

  const dir = analysis.artifacts_dir;
  const thresholdQ = defaultThresholdQ(stats);
  const input: Preview3dInput = {
    surface: analysis.surface, isImport, dir, file: points3dFile(stats), thresholdQ,
    support, optedIn, load, rendererFailed, contextLost,
  };
  const mode = resolvePreview3dMode(input);
  const probe = shouldProbe(input);
  const request = shouldRequestLoad(input);

  // 탐지 effect: 뷰어 대상이고 아직 탐지 전일 때만 WebGL2 를 탐지해 상위에 올린다.
  // 의존성은 탐지 여부 값 하나다. 콜백은 상위가 렌더마다 새로 만들 수 있어 넣지 않는다(넣으면 렌더마다 다시 탐지한다)
  useEffect(() => {
    if (probe) onSupport(probeWebgl2());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe]);

  // 요청 effect: 받을 차례일 때만 상위에 적재를 요청한다. 실제 fetch 와 멱등 검사는 상위가 한다.
  // 의존성은 요청 여부 값과 지금 분석의 artifacts_dir 다(분석이 바뀌면 값이 그대로 참이어도 다시 요청한다)
  useEffect(() => {
    if (request) onRequestLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, dir]);

  const onViewerError = useCallback((kind: 'webgl' | 'context') => {
    if (kind === 'webgl') setRendererFailed(true);
    else setContextLost(true);
  }, []);

  // viewer: 뷰어가 보일 때는 정적 PNG 를 함께 그리지 않는다.
  // 넘기는 점 데이터는 지금 분석의 것(loadFor)이다. 다른 분석의 ready 는 idle 로 읽힌다
  const current = loadFor(load, dir);
  if (mode === 'viewer' && current.status === 'ready' && thresholdQ !== null) {
    return (
      <Points3dView data={current.data} defaultThresholdQ={thresholdQ}
        isRegistered={scan.lineage === 'registered'} onError={onViewerError} />
    );
  }

  // 기존 정적 PNG. 대체 화면에서만 그린다. artifacts_dir 가 없거나 목록이 비면 이미지도 캡션도 없다
  const images = (stats.preview3d_paths ?? []).filter(Boolean);
  const png = dir !== null && images.length > 0 && (
    <div className={STACK}>
      {images.map((name) => (
        // 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요
        // eslint-disable-next-line @next/next/no-img-element
        <img key={name} src={artifactUrl(dir, name)} alt={`3D 프리뷰 ${name}`}
          className="max-w-full rounded-lg border border-cs-divider bg-white" />
      ))}
      <p className="text-xs leading-4 text-cs-text-secondary">{M10}</p>
    </div>
  );

  switch (mode) {
    case 'wall':        // 1행. 벽면은 정적 PNG 도 점군 뷰도 없다
      return <p className={MUTED}>{M1}</p>;
    case 'import':      // 2행. 임포트는 점 파일을 만들지 않는다. 재분석을 권하지 않는다
      return <div className={STACK}>{png}<p className={MUTED}>{M2}</p></div>;
    case 'no_data':     // 3행. 점 파일이 없는 옛 분석이거나 점 파일 생성에 실패한 분석
      return <div className={STACK}>{png}<p className={MUTED}>{M3}</p></div>;
    case 'error_stats': // 4행. 계약 위반이라 Alert 로 드러내지만 다시 시도로 고칠 수 없어 버튼이 없다
      return <div className={STACK}><Alert type="error">{M6}</Alert>{png}</div>;
    case 'error_webgl': // 6행. 실패 플래그를 되돌리고 상위에 다시 탐지하겠다고 알린다
      return (
        <div className={STACK}>
          <Alert type="warning">{M7}</Alert>
          <div><Button onClick={() => { setRendererFailed(false); onSupport(null); }}>다시 시도</Button></div>
          {png}
        </div>
      );
    case 'software_prompt': // 7행. 기본은 정적 이미지, 사용자가 고르면 3D
      return (
        <div className={STACK}>
          {png}
          <Alert type="info">{M4}</Alert>
          <div><Button onClick={onOptIn}>3D로 보기</Button></div>
        </div>
      );
    case 'error_fetch':  // 8행
    case 'error_format': // 9행
      return (
        <div className={STACK}>
          <Alert type="error">{mode === 'error_fetch' ? M5 : M6}</Alert>
          <div><Button onClick={onRetryLoad}>다시 시도</Button></div>
          {png}
        </div>
      );
    case 'error_context': // 10행. 플래그만 되돌리면 Points3dView 가 새 canvas 로 다시 마운트된다. 점 데이터는 다시 받지 않는다
      return (
        <div className={STACK}>
          <Alert type="error">{M8}</Alert>
          <div><Button onClick={() => setContextLost(false)}>다시 시도</Button></div>
          {png}
        </div>
      );
    case 'loading':     // 5·11행. 로딩 틀은 뷰어 영역과 같은 검정이다
    case 'viewer':      // 위의 if 가 이미 그렸다. 여기는 타입을 좁히기 위한 자리이며 도달하지 않는다
      return <Points3dLoadingFrame theme="dark" />;
    default: {
      // 모드가 하나 더 생기면 여기서 tsc 가 멈춘다(그 모드가 빈 화면으로 조용히 지나가지 않게 한다)
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}
