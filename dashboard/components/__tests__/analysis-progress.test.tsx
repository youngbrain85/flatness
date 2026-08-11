// D6 이월 확인: done 상태의 "결과 보기" 링크가 /analyses/[id](구 URL, D6 리다이렉트가
// 받아준다)가 아니라 /scans/[scanId]?analysis=[id](T5가 정의한 스캔 작업대 규약)로
// 직접 가는지 확인한다 - 한 홉을 줄이는 것이 이 프롭 추가의 목적이므로, 그 목적 자체를
// 못 박아야 나중에 누가 링크를 되돌려도 잡힌다.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const { useRowStatusMock } = vi.hoisted(() => ({ useRowStatusMock: vi.fn() }));
vi.mock('@/lib/hooks/use-row-status', () => ({ useRowStatus: useRowStatusMock }));

import { AnalysisProgress } from '../analysis-progress';

describe('AnalysisProgress 결과 보기 링크 (D6 이월: 리다이렉트 홉 축소)', () => {
  it('done이면 /scans/[scanId]?analysis=[analysisId]로 링크한다(구 /analyses/[id] 아님)', () => {
    useRowStatusMock.mockReturnValue('done');
    render(<AnalysisProgress analysisId="a1" initialStatus="done" scanId="s1" />);

    const link = screen.getByText('분석 완료 - 결과 보기');
    expect(link).toHaveAttribute('href', '/scans/s1?analysis=a1');
  });

  it('진행 중이면 링크 대신 진행 상태 문구를 보여준다', () => {
    useRowStatusMock.mockReturnValue('processing');
    render(<AnalysisProgress analysisId="a1" initialStatus="processing" scanId="s1" />);

    expect(screen.queryByText('분석 완료 - 결과 보기')).not.toBeInTheDocument();
  });
});
