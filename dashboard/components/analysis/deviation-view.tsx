// 정밀 편차맵 탭 - 10cm 해상도 원시 편차(판정과 무관한 보조 시각화). Cloudscape 리스킨(T7): 클래스만.
import { artifactUrl } from '@/lib/domain/paths';

const WALL_FILE = /^deviation_wall(\d+)\.png$/;
const MUTED = 'text-sm text-cs-text-secondary';

// 워커 flatworker/report/assets.deviation_label과 같은 문구를 만든다
// (화면 캡션과 PDF 캡션이 갈리면 같은 그림이 다른 이름으로 불린다)
export function deviationLabel(name: string): string {
  const m = WALL_FILE.exec(name);
  return m ? `벽 ${m[1]} 정밀 편차맵(10cm)` : '정밀 편차맵(10cm)';
}

export function DeviationView({ artifactsDir, paths, isImport }: {
  artifactsDir: string | null;
  paths: string[];
  // 외부(Colab) 임포트 결과 여부 — 스펙 §8/계약 §2: 임포트 경로는 편차맵을 아예 생성하지
  // 않으므로 재분석을 권해선 안 된다(무한 재시도 유도 방지). 판별은 호출부가
  // lib/domain/stats.ts의 isExternalImport로 넘긴다(3D 프리뷰 탭과 동일한 분기 선례)
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
    <div className="flex flex-col gap-3">
      {paths.map((name) => (
        <figure key={name} className="flex flex-col gap-1">
          {/* 로컬 route 서빙 이미지 - 데모에서 next/image 최적화 불필요 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={artifactUrl(artifactsDir, name)} alt={deviationLabel(name)}
            className="max-w-full rounded-lg border border-cs-divider bg-white" />
          <figcaption className="text-xs leading-4 text-cs-nav-text">{deviationLabel(name)}</figcaption>
        </figure>
      ))}
      <p className="text-xs leading-4 text-cs-text-secondary">
        10cm 격자의 원시 편차 분포입니다. 0mm가 중앙(연노랑)이고 붉을수록 융기(벽은 돌출),
        초록일수록 침하(벽은 함몰)이며 회색은 데이터가 없는 구간입니다.
        판정 등급 산출에는 사용되지 않으며, 등급은 히트맵 탭의 1m 판정 셀 기준입니다.
      </p>
    </div>
  );
}
