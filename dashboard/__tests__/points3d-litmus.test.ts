// 판정 이중화 금지 리트머스(스펙 2026-10-02-pointcloud-viewer-design.md §8의 1번, §10.4).
// 3D 점군 뷰어 코드는 판정 기준 필드를 읽지 않는다. 엔진이 따로 써 준 표시용 points3d_threshold_q 만 읽는다.
// 아래 파일에 판정 기준 필드 이름이 주석으로라도 나오면 실패한다(리뷰가 아니라 테스트가 막는다).
// 같은 파일들에 U+2014 가 없는지도 함께 본다(사용자 대면 문자열 규칙).
//
// 이 파일 자신은 금지 문자열을 갖고 있으므로 검사 대상에 넣지 않는다(dashboard/__tests__ 는 아래 목록에 없다).
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// vitest 는 __dirname 을 준다(palette-sweep.test.ts 와 같은 방식)
const ROOT = join(__dirname, '..'); // dashboard/

// WebGL 접점과 순수 모듈. 스펙 §7.2 의 모듈 분해 그대로다(테스트 폴더 __tests__ 는 제외).
const VIZ_DIR = 'lib/viz/points3d';
const VIZ_FILES = ['budget.ts', 'controls.ts', 'gl-renderer.ts', 'mat4.ts', 'orbit.ts', 'pick.ts', 'scaffold.ts'];
const OTHER_FILES = [
  'lib/domain/points3d.ts',
  'components/analysis/points3d-view.tsx',
  'components/analysis/preview3d-tab.tsx',
];

const FORBIDDEN = ['pass_mm', 'rework_mm', 'u_mm', 'applied_criteria'];
// 문자 자체를 이 파일에 적지 않으려고 코드 값으로 만든다
const EM_DASH = String.fromCharCode(0x2014);

/** lib/viz/points3d 바로 아래의 소스 파일 이름(하위 폴더 제외, 이름순). */
function vizSources(): string[] {
  const dir = join(ROOT, VIZ_DIR);
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isFile() && /\.(ts|tsx)$/.test(name))
    .sort();
}

/** 검사 대상 전체(dashboard 기준 상대 경로). viz 폴더는 실제로 있는 파일을 읽어 목록을 만든다. */
function targets(): string[] {
  return [...OTHER_FILES, ...vizSources().map((name) => `${VIZ_DIR}/${name}`)];
}

/** needle 이 나온 곳을 `파일:줄: 내용` 으로 모은다. */
function hits(needles: string[]): string[] {
  const found: string[] = [];
  for (const rel of targets()) {
    readFileSync(join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      for (const needle of needles) {
        if (line.includes(needle)) found.push(`${rel}:${i + 1}: ${needle}`);
      }
    });
  }
  return found;
}

describe('3D 점군 뷰어 리트머스 (판정 이중화 금지)', () => {
  it('검사 대상 파일이 전부 있다: viz 폴더는 정확히 7개, 나머지 3개', () => {
    // 파일 이름이 바뀌거나 모듈이 늘면 여기서 드러난다. 목록을 고치지 않고는 검사에서 빠질 수 없다.
    expect(vizSources()).toEqual(VIZ_FILES);
    expect(OTHER_FILES.filter((rel) => !existsSync(join(ROOT, rel)))).toEqual([]);
    expect(targets()).toHaveLength(10);
  });

  it('뷰어 코드에 판정 기준 필드 이름이 0건이다(주석 포함)', () => {
    expect(hits(FORBIDDEN)).toEqual([]);
  });

  it('뷰어 코드에 U+2014 가 0건이다', () => {
    expect(hits([EM_DASH])).toEqual([]);
  });
});
