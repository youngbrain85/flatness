import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
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
