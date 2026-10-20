import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DeviationView, deviationLabel } from '../deviation-view';

describe('DeviationView (정밀 편차맵 탭)', () => {
  it('파일명에서 바닥·벽 캡션을 만든다 (워커 deviation_label과 동일 문구)', () => {
    expect(deviationLabel('deviation.png')).toBe('정밀 편차맵(10cm)');
    expect(deviationLabel('deviation_wall3.png')).toBe('벽 3 정밀 편차맵(10cm)');
  });

  it('바닥 편차맵을 artifacts 경로로 표시한다', () => {
    render(<DeviationView artifactsDir="artifacts/an1" paths={['deviation.png']} isImport={false} />);

    const img = screen.getByAltText('정밀 편차맵(10cm)') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/data/artifacts/an1/deviation.png');
    expect(screen.getByText(/판정 등급 산출에는 사용되지 않으며/)).toBeInTheDocument();
  });

  it('벽 결번을 그대로 유지해 표시한다', () => {
    render(<DeviationView artifactsDir="artifacts/an1"
      paths={['deviation_wall1.png', 'deviation_wall3.png']} isImport={false} />);

    expect(screen.getByAltText('벽 1 정밀 편차맵(10cm)')).toBeInTheDocument();
    expect(screen.getByAltText('벽 3 정밀 편차맵(10cm)')).toBeInTheDocument();
    expect(screen.queryByAltText('벽 2 정밀 편차맵(10cm)')).not.toBeInTheDocument();
  });

  it('목록이 비었거나 산출물 경로가 없으면 안내 문구를 보여준다(비임포트: 재분석 권유 + 렌더 실패 가능성)', () => {
    const { unmount } = render(<DeviationView artifactsDir="artifacts/an1" paths={[]} isImport={false} />);
    expect(screen.getByText(/정밀 편차맵이 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/이미지 생성에 실패한 경우입니다\(경고 목록 확인\)/)).toBeInTheDocument();
    expect(screen.getByText(/재분석하면 생성됩니다/)).toBeInTheDocument();
    unmount();

    render(<DeviationView artifactsDir={null} paths={['deviation.png']} isImport={false} />);
    expect(screen.getByText(/정밀 편차맵이 없습니다/)).toBeInTheDocument();
  });

  it('임포트(Colab) 결과에서는 재분석을 권하지 않고 임포트 전용 안내를 보여준다', () => {
    render(<DeviationView artifactsDir="artifacts/an1" paths={[]} isImport={true} />);

    expect(screen.getByText(/외부\(Colab\) 임포트 결과에는 정밀 편차맵을 생성하지 않습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/재분석하면 생성됩니다/)).not.toBeInTheDocument();
    expect(screen.queryByText(/정밀 편차맵이 없습니다/)).not.toBeInTheDocument();
  });

  // 다크 T8: 엔진 PNG(밝은 10cm)는 검정 스테이지 안 여백에, 설명은 스테이지에 붙은 줄(toolbar)에(아트보드 ScanDeviation)
  it('PNG 는 최소 440px 검정 스테이지(Stage) 안 그림(캡션 포함)이고, 설명 문구는 그대로 스테이지에 붙은 줄에 있다', () => {
    const { container } = render(<DeviationView artifactsDir="artifacts/an1" paths={['deviation.png']} isImport={false} />);
    const img = screen.getByAltText('정밀 편차맵(10cm)');
    const stage = img.closest('[data-stage]')!;
    expect(img.closest('figure')!.parentElement).toBe(stage);
    for (const cls of ['min-h-[440px]', 'rounded-t-card', 'p-4']) expect(stage.className.split(/\s+/)).toContain(cls);
    expect(screen.getByText('정밀 편차맵(10cm)').tagName).toBe('FIGCAPTION');
    const note = screen.getByText(/판정 등급 산출에는 사용되지 않으며/);
    expect(note.textContent).toContain('0mm가 중앙(연노랑)이고 붉을수록 융기(벽은 돌출)');   // 문구 그대로(스펙 §5 09)
    expect(stage.nextElementSibling).toBe(note.parentElement);
    // 표시 해상도 줄은 2번 스펙 몫이라 없다
    expect(screen.queryByRole('group', { name: '표시 해상도' })).toBeNull();
    expect(container.innerHTML).not.toMatch(/\bcs-/);
  });
});

// 정밀 편차맵 화면 렌더(스펙 2·3 §2, 아트보드 ScanDeviation 74~95행): residual_grid.json 을 캔버스로 그린다
describe('DeviationView 잔차 격자 캔버스', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  // 4열 x 2행(5cm): 행 0 = [-20, 0, 10, 30], 행 1 = [null, 5, 5, 5] (0.1mm)
  const body = { subcell_m: 0.05, cols: 4, rows: 2, values: [-20, 0, 10, 30, null, 5, 5, 5] };
  function stubGrid(ok = true, json: unknown = body) {
    const f = vi.fn(async () => ({ ok, json: async () => json } as unknown as Response));
    vi.stubGlobal('fetch', f);
    return f;
  }

  it('5cm 가 눌린 채 그리고, HUD·범례(±R, R = |값| 98번째 백분위)를 보이며, 20cm 를 누르면 접어서 다시 센다', async () => {
    const f = stubGrid();
    render(<DeviationView artifactsDir="artifacts/an1" paths={['deviation.png']} isImport={false}
      residualGridPath="residual_grid.json" />);
    expect(f).toHaveBeenCalledWith('/api/data/artifacts/an1/residual_grid.json');
    await waitFor(() => expect(screen.getByTestId('deviation-hud')).toHaveTextContent('5cm 격자 · 4 × 2칸 · −2.0 ~ +3.0 mm'));
    const group = screen.getByRole('group', { name: '표시 해상도' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['5 cm', '10 cm', '20 cm']);
    expect(within(group).getByRole('button', { name: '5 cm' })).toHaveAttribute('aria-pressed', 'true');
    const legend = screen.getByTestId('deviation-legend');
    expect(legend).toHaveTextContent('−3.0');
    expect(legend).toHaveTextContent('+3.0');
    expect(screen.getByRole('img', { name: /정밀 편차맵 평면도\. 5cm 격자/ })).toBeInTheDocument();
    expect(screen.queryByAltText('정밀 편차맵(10cm)')).toBeNull();   // 엔진 PNG 는 쓰지 않는다
    expect(screen.getByText(/5cm 격자의 원시 편차 분포입니다/)).toBeInTheDocument();

    fireEvent.click(within(group).getByRole('button', { name: '20 cm' }));
    expect(screen.getByTestId('deviation-hud')).toHaveTextContent('20cm 격자 · 1 × 1칸 · +0.5 ~ +0.5 mm');
    expect(legend).toHaveTextContent('+3.0');   // 색 범위는 해상도와 무관(원 격자 기준)
  });

  it('격자를 못 받거나 모양이 다르면 엔진 PNG 로 대체한다', async () => {
    stubGrid(false);
    const { unmount } = render(<DeviationView artifactsDir="artifacts/an1" paths={['deviation.png']} isImport={false}
      residualGridPath="residual_grid.json" />);
    await waitFor(() => expect(screen.getByAltText('정밀 편차맵(10cm)')).toBeInTheDocument());
    expect(screen.queryByRole('group', { name: '표시 해상도' })).toBeNull();
    unmount();

    stubGrid(true, { subcell_m: 0.05, cols: 2, rows: 2, values: [1] });
    render(<DeviationView artifactsDir="artifacts/an1" paths={['deviation.png']} isImport={false}
      residualGridPath="residual_grid.json" />);
    await waitFor(() => expect(screen.getByAltText('정밀 편차맵(10cm)')).toBeInTheDocument());
  });
});

// 바닥 기준면 개선(2026-10-20): 국부(1m) 기준이 기본, 전체 기준으로 바꿔 볼 수 있다. 옛 격자는 구역 평면 기준
describe('DeviationView 기준면 전환', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const v2 = {
    schema_version: 2, subcell_m: 0.05, cols: 2, rows: 1, values: [-10, 20], values_global: [-300, 150],
  };
  function stub(json: unknown) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => json } as unknown as Response)));
  }

  it('국부가 눌린 채 시작하고, 전체를 누르면 전체 기준 값으로 다시 센다', async () => {
    stub(v2);
    render(<DeviationView artifactsDir="artifacts/an1" paths={[]} isImport={false} residualGridPath="residual_grid.json" />);
    await waitFor(() => expect(screen.getByTestId('deviation-hud')).toHaveTextContent('−1.0 ~ +2.0 mm'));
    const group = screen.getByRole('group', { name: '기준면' });
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['국부', '전체']);
    expect(within(group).getByRole('button', { name: '국부' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/1m 국부 기준면 대비/)).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: '전체' }));
    expect(screen.getByTestId('deviation-hud')).toHaveTextContent('−30.0 ~ +15.0 mm');
    expect(screen.getByText(/바닥 전체 기준면 대비/)).toBeInTheDocument();
  });

  // 스펙 §9: 1m 국부 창은 넓은 처짐을 흡수한다(깊이 10mm 함몰이 지름 2.5m 면 약 −3mm). 등급(직선자)과 지도가 어긋나 보이니
  // 국부일 때만 '전체' 기준을 알린다. 전체 기준 설명에 붙으면 거짓이다
  it('국부일 때만 넓은 처짐은 전체 기준으로 확인하라고 알린다', async () => {
    stub(v2);
    render(<DeviationView artifactsDir="artifacts/an1" paths={[]} isImport={false} residualGridPath="residual_grid.json" />);
    await waitFor(() => expect(screen.getByTestId('deviation-hud')).toBeInTheDocument());
    expect(screen.getByText(/1m보다 넓은 처짐·함몰은 국부 기준에서 얕게 보이므로 '전체' 기준으로 확인하세요\./))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '전체' }));
    expect(screen.getByText(/바닥 전체 기준면 대비/)).toBeInTheDocument();
    expect(screen.queryByText(/넓은 처짐/)).toBeNull();
  });

  it('옛 격자(values_global 없음)는 전환이 없고 구역 평면 기준이라고 밝힌다', async () => {
    stub({ subcell_m: 0.05, cols: 2, rows: 1, values: [-10, 20] });
    render(<DeviationView artifactsDir="artifacts/an1" paths={[]} isImport={false} residualGridPath="residual_grid.json" />);
    await waitFor(() => expect(screen.getByTestId('deviation-hud')).toHaveTextContent('5cm 격자'));
    expect(screen.queryByRole('group', { name: '기준면' })).toBeNull();
    expect(screen.getByText(/구역 평면 대비/)).toBeInTheDocument();
    expect(screen.queryByText(/넓은 처짐/)).toBeNull();   // 누를 '전체' 가 없다
  });
});
