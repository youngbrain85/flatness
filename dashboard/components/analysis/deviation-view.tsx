// 정밀 편차맵 탭 - 10cm 해상도 원시 편차(판정과 무관한 보조 시각화).
// C안(아트보드 docs/design/dark/ScanDeviation.dc.html 74~95행의 자리): 이 스펙에서는 엔진이 그린 밝은 PNG 를
// 최소 440px 검정 스테이지 안 여백에 두고, 설명 문구는 스테이지에 붙은 줄(Stage toolbar)에 지금 문구 그대로 둔다
// (스펙 §5 09). 캔버스 렌더·표시 해상도 줄(5·10·20cm)·색 막대 범례는 2번 스펙 몫이라 그리지 않는다.
import { artifactUrl } from '@/lib/domain/paths';
import { Stage } from '@/components/ui/stage';

const WALL_FILE = /^deviation_wall(\d+)\.png$/;
const MUTED = 'text-sm text-muted';

// 워커 flatworker/report/assets.deviation_label과 같은 문구를 만든다
// (화면 캡션과 PDF 캡션이 갈리면 같은 그림이 다른 이름으로 불린다)
export function deviationLabel(name: string): string {
  const m = WALL_FILE.exec(name);
  return m ? `벽 ${m[1]} 정밀 편차맵(10cm)` : '정밀 편차맵(10cm)';
}

export function DeviationView({ artifactsDir, paths, isImport }: {
  artifactsDir: string | null;
  paths: string[];
  // 외부(Colab) 임포트 결과 여부 - 스펙 §8/계약 §2: 임포트 경로는 편차맵을 아예 생성하지
  // 않으므로 재분석을 권해선 안 된다(무한 재시도 유도 방지). 판별은 호출부(analysis-result.tsx)가
  // lib/domain/stats.ts의 isExternalImport로 넘긴다. 3D 프리뷰 탭도 같은 값을 받아 임포트를
  // 가른다(preview3d-tab.tsx의 import 모드: 임포트 결과에는 재분석을 권하지 않는다)
  isImport: boolean;
}) {
  if (!artifactsDir || paths.length === 0) {
    if (isImport) {
      return (
        <p className={MUTED}>
          외부(Colab) 임포트 결과에는 정밀 편차맵을 생성하지 않습니다.
        </p>
      );
    }
    return (
      <p className={MUTED}>
        정밀 편차맵이 없습니다. 이 기능이 추가되기 전 엔진으로 분석한 결과이거나,
        유효 편차 데이터가 없는 경우이거나, 이미지 생성에 실패한 경우입니다(경고 목록 확인).
        재분석하면 생성됩니다.
      </p>
    );
  }
  return (
    // 그림 고유 비율이라 aspect 는 기본('auto'), 최소 높이는 히트맵과 같은 440px(아트보드 ScanDeviation)
    <Stage minHeight={440} className="flex flex-col items-center justify-center gap-5 p-4" toolbar={
      <p className="text-[13px] leading-[1.65] text-muted">
        10cm 격자의 원시 편차 분포입니다. 0mm가 중앙(연노랑)이고 붉을수록 융기(벽은 돌출),
        초록일수록 침하(벽은 함몰)이며 회색은 데이터가 없는 구간입니다.
        판정 등급 산출에는 사용되지 않으며, 등급은 히트맵 탭의 1m 판정 셀 기준입니다.
      </p>
    }>
      {paths.map((name) => (
        <figure key={name} className="flex w-full max-w-[960px] flex-col items-center gap-2">
          {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifactUrl(artifactsDir, name)} alt={deviationLabel(name)} className="block h-auto w-full" />
          <figcaption className="font-mono text-xs text-ink-2">{deviationLabel(name)}</figcaption>
        </figure>
      ))}
    </Stage>
  );
}
