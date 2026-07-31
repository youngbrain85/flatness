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
});
