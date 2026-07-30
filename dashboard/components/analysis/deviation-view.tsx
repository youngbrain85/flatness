// 정밀 편차맵 탭 - 10cm 해상도 원시 편차(판정과 무관한 보조 시각화)
import { artifactUrl } from '@/lib/domain/paths';

const WALL_FILE = /^deviation_wall(\d+)\.png$/;

// 워커 flatworker/report/assets.deviation_label과 같은 문구를 만든다
// (화면 캡션과 PDF 캡션이 갈리면 같은 그림이 다른 이름으로 불린다)
export function deviationLabel(name: string): string {
  const m = WALL_FILE.exec(name);
  return m ? `벽 ${m[1]} 정밀 편차맵(10cm)` : '정밀 편차맵(10cm)';
}

export function DeviationView({ artifactsDir, paths }: {
  artifactsDir: string | null;
  paths: string[];
}) {
  if (!artifactsDir || paths.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        정밀 편차맵이 없습니다. 이 기능이 추가되기 전 엔진으로 분석한 결과이거나,
        유효 편차 데이터가 없는 경우입니다. 재분석하면 생성됩니다.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {paths.map((name) => (
        <figure key={name} className="space-y-1">
          {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifactUrl(artifactsDir, name)} alt={deviationLabel(name)}
            className="max-w-full rounded border bg-white" />
          <figcaption className="text-xs text-slate-600">{deviationLabel(name)}</figcaption>
        </figure>
      ))}
      <p className="text-xs text-slate-500">
        10cm 격자의 원시 편차 분포입니다. 0mm가 중앙(연노랑)이고 붉을수록 융기(벽은 돌출),
        초록일수록 침하(벽은 함몰)이며 회색은 데이터가 없는 구간입니다.
        판정 등급 산출에는 사용되지 않으며, 등급은 히트맵 탭의 1m 판정 셀 기준입니다.
      </p>
    </div>
  );
}
