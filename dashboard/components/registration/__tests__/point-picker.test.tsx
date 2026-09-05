// 무장식 PNG 위 대응점 클릭 (단계 F Task 5, 설계 결정 F6/F7)
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PointPicker } from '../point-picker';
import type { HeightViewMeta } from '@/lib/domain/height-view';

const SUB = 31.25;
const X0 = 1234.5;
const Y0 = -678.25;
const Z0 = 12.75;

// 비정사각 [ny=3, nx=5]. median_z[1][3]은 NaN 셀이다.
const META: HeightViewMeta = {
  schema_version: 1,
  bbox_min: [X0, Y0, Z0],
  bbox_max: [X0 + 5 * SUB, Y0 + 3 * SUB, Z0 + 24],
  subcell_m_file: SUB,
  shape: [3, 5],
  median_z: [
    [0, 1, 2, 3, 4],
    [10, 11, 12, null, 14],
    [20, 21, 22, 23, 24],
  ],
};

// 워커 생성 규칙에서 벗어난 경로(항등식 금지)
const VIEW_PATH = 'artifacts/scans/OTHER-DIR/hv-2026.png';
const PLAIN_URL = '/api/data/artifacts/scans/OTHER-DIR/hv-2026_plain.png';
const DECORATED_URL = '/api/data/artifacts/scans/OTHER-DIR/hv-2026.png';

// 이미지 5x3 픽셀을 500x300 CSS 픽셀로 확대해 띄운 상태를 흉내 낸다.
// (CSS 축소·확대가 있어도 클릭 픽셀 환산이 맞아야 한다)
function stubRect() {
  Object.defineProperty(HTMLImageElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0, top: 0, right: 500, bottom: 300, width: 500, height: 300, x: 0, y: 0, toJSON() {},
    }),
  });
}

function renderPicker(over: Partial<Parameters<typeof PointPicker>[0]> = {}) {
  const onPick = vi.fn();
  const utils = render(
    <PointPicker title="A 스캔" heightViewPath={VIEW_PATH} meta={META} markers={[]}
      onPick={onPick} {...over} />,
  );
  stubRect();
  return { onPick, ...utils };
}

describe('PointPicker 클릭 -> 월드 좌표 (설계 결정 F7)', () => {
  // 장식 PNG는 matplotlib 여백 때문에 픽셀 -> 월드 역산이 불가능하다.
  it('클릭 대상은 무장식 PNG다', () => {
    renderPicker();
    const img = screen.getByRole('img', { name: /A 스캔/ });
    expect(img).toHaveAttribute('src', PLAIN_URL);
    expect(img).not.toHaveAttribute('src', DECORATED_URL);
    expect(img.className).toContain('border-cs-divider');
  });

  it('클릭 픽셀을 사이드카 좌표 계약으로 환산해 넘긴다', () => {
    const { onPick } = renderPicker();
    // clientX=50 -> 가로 10% -> px=floor(0.1*5)=0
    // clientY=250 -> 세로 83.3% -> py=floor(0.833*3)=2
    fireEvent.click(screen.getByRole('img', { name: /A 스캔/ }), { clientX: 50, clientY: 250 });

    expect(onPick).toHaveBeenCalledTimes(1);
    const p = onPick.mock.calls[0][0];
    expect(p.px).toBe(0);
    expect(p.py).toBe(2);
    expect(p.x).toBeCloseTo(X0 + 0.5 * SUB, 9);
    expect(p.y).toBeCloseTo(Y0 + 0.5 * SUB, 9);
    expect(p.z).toBeCloseTo(Z0, 9);
  });

  it('오른쪽 위를 찍으면 격자 최대 인덱스 셀이 나온다(가로 nx·세로 ny 확인)', () => {
    const { onPick } = renderPicker();
    // clientX=450 -> 90% -> px=4 / clientY=50 -> 16.7% -> py=0
    fireEvent.click(screen.getByRole('img', { name: /A 스캔/ }), { clientX: 450, clientY: 50 });

    const p = onPick.mock.calls[0][0];
    expect(p.x).toBeCloseTo(X0 + 4.5 * SUB, 9);
    expect(p.y).toBeCloseTo(Y0 + 2.5 * SUB, 9);
    expect(p.z).toBeCloseTo(Z0 + 24, 9);
  });

  // 설계 결정 F6: 0으로 대체하거나 이웃에서 끌어오면 대응점이 조용히 틀린다.
  it('높이 값이 없는 셀은 대응점으로 받지 않고 한국어 사유를 보여준다', () => {
    const { onPick } = renderPicker();
    // clientX=350 -> 70% -> px=3 / clientY=150 -> 50% -> py=1  => median_z[1][3] === null
    fireEvent.click(screen.getByRole('img', { name: /A 스캔/ }), { clientX: 350, clientY: 150 });

    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(/높이 값이 없어/)).toBeInTheDocument();
    expect(screen.getByText(/높이 값이 없어/).closest('[data-alert]')).toHaveAttribute('data-alert', 'error');
  });

  it('disabled면 클릭을 무시한다(정합 실행 중 등)', () => {
    const { onPick } = renderPicker({ disabled: true });
    fireEvent.click(screen.getByRole('img', { name: /A 스캔/ }), { clientX: 50, clientY: 250 });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('찍은 점을 순번 마커로 표시한다', () => {
    renderPicker({ markers: [{ px: 0, py: 2, label: '1' }, { px: 4, py: 0, label: '2' }] });
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('확정 마커는 cs-link, 짝을 기다리는 마커는 cs-warning으로 구분한다', () => {
    renderPicker({ markers: [{ px: 0, py: 2, label: '1' }, { px: 4, py: 0, label: '2', pending: true }] });
    expect(screen.getByText('1').className).toContain('bg-cs-link');
    expect(screen.getByText('2').className).toContain('bg-cs-warning');
  });

  it('사이드카가 없으면 클릭을 받지 않고 이유를 밝힌다', () => {
    const { onPick } = renderPicker({ meta: null, metaError: '좌표 정보를 불러오지 못했습니다.' });
    expect(screen.getByText(/좌표 정보를 불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/좌표 정보를 불러오지 못했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
    const img = screen.queryByRole('img', { name: /A 스캔/ });
    if (img) fireEvent.click(img, { clientX: 50, clientY: 250 });
    expect(onPick).not.toHaveBeenCalled();
  });

  // ★ 단계 E Task 3에서 실화면으로만 드러난 결함: SSR된 <img>는 하이드레이션(React가
  // onError를 붙이는 시점)보다 먼저 요청이 끝나므로, 그 사이 지나간 error 이벤트를
  // React가 못 받는다. onError만 다는 구현은 fireEvent 테스트만 통과한다.
  it('하이드레이션 전에 이미 실패한 이미지도 폴백 안내로 바꾼다', () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
    const nw = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(0);
    try {
      render(<PointPicker title="A 스캔" heightViewPath={VIEW_PATH} meta={META} markers={[]}
        onPick={vi.fn()} />);
      expect(screen.queryByRole('img', { name: /A 스캔/ })).toBeNull();
      expect(screen.getByText(/높이 뷰를 불러오지 못했습니다/)).toBeInTheDocument();
      expect(screen.getByText(/높이 뷰를 불러오지 못했습니다/).closest('[data-alert]')).toHaveAttribute('data-alert', 'warning');
    } finally {
      complete.mockRestore();
      nw.mockRestore();
    }
  });
});
