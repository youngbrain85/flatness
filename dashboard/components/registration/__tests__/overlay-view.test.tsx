// 겹쳐보기 **배선** 잠금 (리뷰 C2 - 아홉 번째 "테스트가 회귀를 못 잡는" 형태)
//
// lib/domain/registration.ts의 overlayAffine 단위 테스트가 **수학**은 잠갔지만,
// "어느 이미지를 · 어느 메타로 · 어느 배율로 · 어느 변환으로 · 어떤 alpha로" 그리는지는
// 아무도 잠그지 않았다. 리뷰어 변이 4종(transform=null / B 대신 A를 두 번 / unitScaleB에
// A 배율 / B를 alpha=1로)이 전부 생존했다. 특히 "B 대신 A를 두 번"은 겹쳐보기를 **항상
// 완벽 정합으로** 보이게 만들어 방어를 정반대로 뒤집는다.
//
// jsdom에는 캔버스가 없으므로 두 가지를 스텁으로 준다:
//   1. getContext('2d') -> 호출을 기록하는 가짜 컨텍스트(drawImage 시점의 변환·alpha·
//      이미지 src를 함께 기록한다)
//   2. 전역 Image -> src를 넣으면 onload가 발화하는 가짜(실제 jsdom Image는 영원히
//      로드되지 않아 그리기 경로 자체가 실행되지 않는다)
// 프로덕션 코드에 테스트 전용 주입 지점을 두지 않으려고 전역 스텁을 골랐다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegistrationOverlay } from '../overlay-view';
import { plainPngUrl } from '@/lib/domain/height-view';
import type { HeightViewMeta } from '@/lib/domain/height-view';
import { imageCornersM, overlayAffine, overlayView } from '@/lib/domain/registration';
import { FakeImage, recordingCtx } from './canvas-stub';

const PATH_A = 'artifacts/scans/OTHER-A/hv-a.png';
const PATH_B = 'artifacts/scans/OTHER-B/hv-b.png';

// ★ 두 스캔을 최대한 다르게 잡는다: shape·서브셀·bbox·unit_scale 전부 다르다.
//   같게 두면 "B 대신 A" 변이도 "unitScaleB에 A 배율" 변이도 통과한다.
const META_A: HeightViewMeta = {
  schema_version: 1, bbox_min: [1234.5, -678.25, 12.75],
  bbox_max: [1234.5 + 5 * 31.25, -678.25 + 3 * 31.25, 40],
  subcell_m_file: 31.25, shape: [3, 5],
  median_z: [[0, 1, 2, 3, 4], [10, 11, 12, 13, 14], [20, 21, 22, 23, 24]],
};
const META_B: HeightViewMeta = {
  schema_version: 1, bbox_min: [-10000, 40000, 3500], bbox_max: [-10000 + 6 * 8000, 40000 + 4 * 8000, 9000],
  subcell_m_file: 8000, shape: [4, 6],
  median_z: [
    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], [1.1, 1.2, 1.3, 1.4, 1.5, 1.6],
    [2.1, 2.2, 2.3, 2.4, 2.5, 2.6], [3.1, 3.2, 3.3, 3.4, 3.5, 3.6],
  ],
};
const SCALE_A = 1;
const SCALE_B = 0.001; // B는 mm 파일이다 - 배율을 바꿔 넣으면 1000배 어긋난다
// 회전 20도 + 평행이동. 회전을 무시하거나 transform을 null로 두면 b·c가 0이 되어 잡힌다.
const C = Math.cos(0.349), S = Math.sin(0.349);
const T = [[C, -S, 0, 12.5], [S, C, 0, -3.25], [0, 0, 1, 0.004], [0, 0, 0, 1]];

const MAX_W = 560;
const MAX_H = 420;

function mount(over: Partial<Parameters<typeof RegistrationOverlay>[0]> = {}) {
  const { ctx, calls } = recordingCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(ctx as unknown as RenderingContext);
  vi.stubGlobal('Image', FakeImage);
  const utils = render(
    <RegistrationOverlay pathA={PATH_A} pathB={PATH_B} metaA={META_A} metaB={META_B}
      unitScaleA={SCALE_A} unitScaleB={SCALE_B} transform={T} {...over} />,
  );
  return { calls, ...utils };
}

afterEach(() => {
  FakeImage.fail = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('RegistrationOverlay 그리기 배선', () => {
  it('A는 원본 좌표로 불투명하게, B는 정합 변환을 통과해 반투명으로 그린다', async () => {
    const { calls } = mount();
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    const view = overlayView([
      imageCornersM(META_A, SCALE_A, null),
      imageCornersM(META_B, SCALE_B, T),
    ], MAX_W, MAX_H);

    // (1) 어느 이미지를 그렸나 - "B 대신 A를 두 번" 변이를 잡는다.
    expect(calls[0].src).toBe(plainPngUrl(PATH_A));
    expect(calls[1].src).toBe(plainPngUrl(PATH_B));
    expect(calls[1].src).not.toBe(calls[0].src);

    // (2) 어느 메타·배율·변환으로 그렸나 - unitScaleB 오전달·transform=null을 잡는다.
    expect(calls[0].transform).toEqual(overlayAffine(META_A, SCALE_A, null, view));
    expect(calls[1].transform).toEqual(overlayAffine(META_B, SCALE_B, T, view));

    // (3) alpha - B를 alpha=1로 그리면 A를 완전히 덮어 대조가 불가능해진다.
    expect(calls[0].alpha).toBe(1);
    expect(calls[1].alpha).toBeCloseTo(0.55, 6);
    expect(calls[1].alpha).toBeLessThan(1);
  });

  // 위 (2)의 기대값을 같은 함수로 계산하므로, 인자 오전달과 별개로 "회전이 실제로
  // 실린 행렬인가"를 절대량으로 한 번 더 못 박는다. transform을 null로 두거나 회전을
  // 떨어뜨리면 b·c가 0이 된다.
  it('B의 변환행렬에 회전 성분이 실제로 실린다', async () => {
    const { calls } = mount();
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    const [, b, c] = calls[1].transform;
    expect(Math.abs(b)).toBeGreaterThan(1e-6);
    expect(Math.abs(c)).toBeGreaterThan(1e-6);
    // A(기준)는 회전이 없다 - 두 행렬이 같아지면 B가 A로 대체됐다는 뜻이다.
    expect(calls[1].transform).not.toEqual(calls[0].transform);
  });

  it('B의 배율을 A의 것으로 바꾸면 나오는 행렬과 다르다(unit_scale 오전달 차단)', async () => {
    const { calls } = mount();
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    const view = overlayView([
      imageCornersM(META_A, SCALE_A, null),
      imageCornersM(META_B, SCALE_B, T),
    ], MAX_W, MAX_H);
    expect(calls[1].transform).not.toEqual(overlayAffine(META_B, SCALE_A, T, view));
  });

  // ★ 리뷰 C1: 사이드카가 404면 metaA/metaB가 null이 되고, 예전 구현은 캔버스 크기조차
  //   설정하지 않은 채 빈 300x150 흰 상자를 내놓았다 - 아무 안내도 없이.
  it.each([
    ['A 사이드카 없음', { metaA: null }],
    ['B 사이드카 없음', { metaB: null }],
  ])('%s이면 빈 캔버스 대신 사유를 보여준다', async (_label, over) => {
    const { container, calls } = mount(over);

    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText(/좌표 정보\(사이드카\)를 불러오지 못해/)).toBeInTheDocument();
    expect(screen.getByText(/수치만으로 이 정합을 승인하지 마세요/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  // transform이 null인 채 done이면 B가 자기 좌표로 그려져 **정합된 것처럼 보인다** -
  // 그리지 않는 편이 옳다.
  it('정합 변환이 없으면 그리지 않고 사유를 보여준다', async () => {
    const { container, calls } = mount({ transform: null });

    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText(/정합 변환이 저장되지 않아/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('그림 로딩이 실패하면 경고를 띄운다', async () => {
    FakeImage.fail = true;
    mount();
    expect(await screen.findByText(/겹쳐보기 그림을 불러오지 못했습니다/)).toBeInTheDocument();
  });

  // 리뷰 I4·I5: 이 그림이 최종 심급처럼 읽히면 안 된다(30cm급은 정합과 구분 불가,
  // 특징 없는 평탄 바닥은 신호가 거의 0). 위쪽 "수평 검증 가능성" 안내와 같은 현상의
  // 두 얼굴이므로 문구가 그 연결을 말해야 한다.
  it('겹쳐보기의 분해능 한계를 밝히고 수평 감도와 같은 이야기임을 잇는다', async () => {
    mount();
    const limit = screen.getByText(/수십 cm급은 정합된 것과/);
    expect(limit).toBeInTheDocument();
    expect(limit).toHaveTextContent('수평 감도가 낮게 나오는 바닥이 정확히 이 경우');
    expect(limit).toHaveTextContent('대응점을 넓게 분산해 찍었는가');
  });
});
