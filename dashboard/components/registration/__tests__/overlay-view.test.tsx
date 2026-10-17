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
//      이미지 src와 바탕·격자 호출을 함께 기록한다)
//   2. 전역 Image -> src를 넣으면 onload가 발화하는 가짜(실제 jsdom Image는 영원히
//      로드되지 않아 그리기 경로 자체가 실행되지 않는다)
// 프로덕션 코드에 테스트 전용 주입 지점을 두지 않으려고 전역 스텁을 골랐다.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RegistrationOverlay } from '../overlay-view';
import { plainPngUrl } from '@/lib/domain/height-view';
import type { HeightViewMeta } from '@/lib/domain/height-view';
import { STAGE_BG, STAGE_GRID } from '@/lib/domain/palette';
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
  const rec = recordingCtx();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(rec.ctx as unknown as RenderingContext);
  vi.stubGlobal('Image', FakeImage);
  const utils = render(
    <RegistrationOverlay pathA={PATH_A} pathB={PATH_B} metaA={META_A} metaB={META_B}
      unitScaleA={SCALE_A} unitScaleB={SCALE_B} transform={T} {...over} />,
  );
  return { ...rec, ...utils };
}

function expectedView() {
  return overlayView([
    imageCornersM(META_A, SCALE_A, null),
    imageCornersM(META_B, SCALE_B, T),
  ], MAX_W, MAX_H);
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

    const view = expectedView();

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

  // 다크 테마(Task 9, 스펙 §6 캔버스 그림): 그림 밑에 스테이지 바탕과 격자를 먼저 깐다.
  // 격자가 그림 뒤에 그려지면 두 그림 위를 덮어 대조를 흐린다 - 순서까지 잠근다.
  it('캔버스 전체를 STAGE_BG로 채우고 STAGE_GRID 1px 격자를 그린 뒤 두 그림을 얹는다', async () => {
    const { calls, fills, strokes, ops } = mount();
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    const view = expectedView();
    expect(fills[0]).toEqual({ style: STAGE_BG, rect: [0, 0, view.width, view.height] });
    expect(strokes).toHaveLength(1);
    expect(strokes[0].style).toBe(STAGE_GRID);
    expect(strokes[0].width).toBe(1);
    expect(strokes[0].segments).toBeGreaterThan(0);
    expect(ops.indexOf('fillRect')).toBeLessThan(ops.indexOf('stroke'));
    expect(ops.indexOf('stroke')).toBeLessThan(ops.indexOf('drawImage'));
  });

  // 아트보드 RegistrationDetail '겹쳐보기': 캔버스는 검정 스테이지 안, 슬라이더는 눈썹 라벨로 이름이 붙고 accent는 ink.
  it('캔버스는 검정 스테이지 안에 있고, 슬라이더는 "맞춘 스캔(B) 진하기"라는 이름과 accent-ink를 쓴다', async () => {
    const { container, calls } = mount();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(container.querySelector('canvas')?.closest('[data-stage]')).not.toBeNull();
    const slider = screen.getByRole('slider', { name: '맞춘 스캔(B) 진하기' });
    expect(slider.className).toContain('accent-ink');
    expect(slider).toHaveValue('55');
    expect(screen.getByText('55%').className).toContain('font-mono');
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
    expect(calls[1].transform).not.toEqual(overlayAffine(META_B, SCALE_A, T, expectedView()));
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
    expect(screen.getByText(/좌표 정보\(사이드카\)를 불러오지 못해/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(screen.getByText(/수치만으로 이 정합을 승인하지 마세요/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  // transform이 null인 채 done이면 B가 자기 좌표로 그려져 **정합된 것처럼 보인다** -
  // 그리지 않는 편이 옳다.
  it('정합 변환이 없으면 그리지 않고 사유를 보여준다', async () => {
    const { container, calls } = mount({ transform: null });

    expect(container.querySelector('canvas')).toBeNull();
    expect(screen.getByText(/정합 변환이 저장되지 않아/)).toBeInTheDocument();
    expect(screen.getByText(/정합 변환이 저장되지 않아/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
    expect(calls).toHaveLength(0);
  });

  it('그림 로딩이 실패하면 경고를 띄운다', async () => {
    FakeImage.fail = true;
    mount();
    const warn = await screen.findByText(/겹쳐보기 그림을 불러오지 못했습니다/);
    expect(warn).toBeInTheDocument();
    expect(warn.closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
  });

  // 리뷰 I4·I5: 이 그림이 최종 심급처럼 읽히면 안 된다(30cm급은 정합과 구분 불가,
  // 특징 없는 평탄 바닥은 신호가 거의 0). 위쪽 "수평 검증 가능성" 안내와 같은 현상의
  // 두 얼굴이므로 문구가 그 연결을 말해야 한다.
  it('겹쳐보기의 분해능 한계를 밝히고 수평 감도와 같은 이야기임을 잇는다', async () => {
    mount();
    const limit = screen.getByText(/수십 cm급은 정합된 것과/);
    expect(limit).toBeInTheDocument();
    // 회색 박스였던 한계 안내는 info Alert(아트보드: line-3 안내 상자). 경고가 아니다.
    expect(limit.closest('[data-alert]')).toHaveAttribute('data-alert', 'info');
    expect(limit).toHaveTextContent('수평 감도가 낮게 나오는 바닥이 정확히 이 경우');
    expect(limit).toHaveTextContent('대응점을 넓게 분산해 찍었는가');
  });
});

// ---- Task 9 변이 실험 보강 --------------------------------------------------------------------
// 변이 실험(보고서 참고)으로 위 테스트가 가르지 못한 것을 막는다: 격자의 간격·시작·방향·반 픽셀,
// 보간 끄기, 캔버스 크기(가로가 가득 찬 그림과 세로가 가득 찬 그림), 슬라이더 배선과 재그리기 취소,
// 캔버스의 접근성 이름.
type OverlayProps = Parameters<typeof RegistrationOverlay>[0];

// 세로로 긴 그림: 뷰가 높이에 막혀 가로가 MAX_W 보다 훨씬 좁아진다.
const TALL: HeightViewMeta = {
  schema_version: 1, bbox_min: [0, 0, 0], bbox_max: [20, 80, 1],
  subcell_m_file: 10, shape: [8, 2],
  median_z: Array.from({ length: 8 }, (_, r) => [r, r + 0.5]),
};

describe('RegistrationOverlay 변이 실험 보강 (Task 9)', () => {
  it('격자는 40px 간격 세로선과 가로선을 반 픽셀 안쪽에 긋는다', async () => {
    const { calls, strokes } = mount();
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    const { width, height } = expectedView();
    const { moves } = strokes[0];
    // 세로선은 (x, 0)에서, 가로선은 (0, y)에서 시작한다
    const verticals = moves.filter(([x, y]) => x > 0 && y === 0).map(([x]) => x);
    const horizontals = moves.filter(([x, y]) => x === 0 && y > 0).map(([, y]) => y);
    expect(verticals.length + horizontals.length).toBe(moves.length);
    for (const [lines, extent] of [[verticals, width], [horizontals, height]] as const) {
      expect(lines[0]).toBe(40.5);
      // 간격은 모두 40이고, 마지막 선 다음 칸은 캔버스 밖이다
      expect(lines.slice(1).every((v, i) => v - lines[i] === 40)).toBe(true);
      expect(lines[lines.length - 1] - 0.5).toBeLessThan(extent);
      expect(lines[lines.length - 1] - 0.5 + 40).toBeGreaterThanOrEqual(extent);
    }
  });

  it('보간을 끄고 그린다 - 켜 두면 칸 경계가 뭉개져 어긋남이 흐려진다', async () => {
    const { calls } = mount();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls.map((c) => c.smoothing)).toEqual([false, false]);
  });

  // 가로가 가득 찬 그림(기본 픽스처)만 쓰면 canvas.width = MAX_W 같은 상수 대입이 우연히 맞아 통과한다.
  it.each([
    ['가로가 가득 찬 그림', {} as Partial<OverlayProps>],
    ['세로가 가득 찬 그림', { metaA: TALL, metaB: TALL, unitScaleB: 1 } as Partial<OverlayProps>],
  ])('%s: 캔버스 크기가 겹쳐보기 뷰 크기와 같다', async (label, over) => {
    const { container, calls } = mount(over);
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    const view = over.metaA
      ? overlayView([imageCornersM(TALL, SCALE_A, null), imageCornersM(TALL, 1, T)], MAX_W, MAX_H)
      : expectedView();
    if (over.metaA) expect(view.width).toBeLessThan(MAX_W); // 이 픽스처가 정말 세로로 가득 찬 그림인지
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect([canvas.width, canvas.height], label).toEqual([view.width, view.height]);
  });

  // 슬라이더 배선: 이전에는 클래스만 확인해서 onChange·재그리기 의존성이 비어 있어도 통과했다.
  it('슬라이더를 움직이면 B만 새 alpha 로 다시 그리고, 값을 바꾸기 전의 그리기는 취소된다', async () => {
    const { calls, strokes } = mount();
    const slider = screen.getByRole('slider', { name: '맞춘 스캔(B) 진하기' });

    // 이미지 로드(마이크로태스크)가 끝나기 전에 값을 바꾼다 -> 첫 그리기는 정리되고 두 번째만 그려야 한다
    fireEvent.change(slider, { target: { value: '80' } });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 0)); // 남은 마이크로태스크를 비운다 - 취소가 안 되면 4가 된다
    expect(calls).toHaveLength(2);
    expect(calls[0].alpha).toBe(1);
    expect(calls[1].alpha).toBeCloseTo(0.8, 6);
    expect(screen.getByText('80%')).toBeInTheDocument();

    // 한 번 더 바꾸면 바탕 → 격자 → A → B 를 처음부터 다시 그린다
    fireEvent.change(slider, { target: { value: '30' } });
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    expect(calls[2].alpha).toBe(1);
    expect(calls[3].alpha).toBeCloseTo(0.3, 6);
    expect(screen.getByText('30%')).toBeInTheDocument();
    // 다시 그릴 때마다 경로를 새로 시작한다 - 안 하면 지난 선이 쌓여 선 수가 늘어난다
    expect(strokes).toHaveLength(2);
    expect(strokes[1].segments).toBe(strokes[0].segments);
  });

  it('불투명도 라벨은 눈썹 글씨(mono·dim)이고, 캔버스는 "두 스캔 겹쳐보기"라는 이름으로 스테이지 폭 안에서 줄어든다', async () => {
    const { container, calls } = mount();
    await vi.waitFor(() => expect(calls).toHaveLength(2));

    const label = screen.getByText('맞춘 스캔(B) 진하기');
    expect(label.className).toContain('font-mono');
    expect(label.className).toContain('text-dim');
    const canvas = screen.getByRole('img', { name: '두 스캔 겹쳐보기' });
    expect(canvas).toBe(container.querySelector('canvas'));
    // 휴대폰 폭에서 페이지 가로 스크롤이 생기지 않게 max-w-full, 비율을 지키려고 h-auto
    expect(canvas.className).toContain('max-w-full');
    expect(canvas.className).toContain('h-auto');
  });
});
