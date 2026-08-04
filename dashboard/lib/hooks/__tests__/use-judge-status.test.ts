import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useJudgeStatus } from '../use-judge-status';
import type { JudgeInfo } from '@/lib/domain/types';

const { supabaseStub, removeChannelMock, channelStub } = vi.hoisted(() => {
  const removeChannelMock = vi.fn();
  const channelStub = {
    on: vi.fn(function (this: unknown) { return this; }),
    subscribe: vi.fn(function (this: unknown) { return this; }),
  };
  const supabaseStub = {
    channel: vi.fn(() => channelStub),
    removeChannel: removeChannelMock,
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async (): Promise<{ data: Record<string, unknown> | null }> => ({ data: null }),
        }),
      }),
    })),
  };
  return { supabaseStub, removeChannelMock, channelStub };
});

vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabaseStub }));

describe('useJudgeStatus 언마운트 정리', () => {
  it('언마운트 시 Realtime 채널 구독 해제와 폴링 타이머 정리를 모두 수행한다', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useJudgeStatus('a1', null));

    unmount();

    expect(removeChannelMock).toHaveBeenCalledTimes(1);
    expect(removeChannelMock).toHaveBeenCalledWith(channelStub);
    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
  });
});

describe('useJudgeStatus 폴링 (브리프 D5: use-row-status의 종결 정지 버그를 재현하지 않는다)', () => {
  it('done 상태를 감지한 뒤에도 폴링을 계속한다(순환 상태 - 재클릭으로 queued로 되돌아갈 수 있음)', async () => {
    supabaseStub.from.mockClear();
    supabaseStub.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { params: { judge: { state: 'done', at: 't1' } } } }),
        }),
      }),
    }));
    vi.useFakeTimers();

    const { result, unmount } = renderHook(
      ({ analysisId, initial }: { analysisId: string; initial: JudgeInfo | null }) => (
        useJudgeStatus(analysisId, initial)
      ),
      { initialProps: { analysisId: 'a1', initial: { state: 'processing', at: 't0' } as JudgeInfo | null } },
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(supabaseStub.from).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ state: 'done', at: 't1' });

    // use-row-status였다면 종결 상태(done) 감지 즉시 멈췄을 구간 - 여기서는 계속돼야 한다.
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(supabaseStub.from).toHaveBeenCalledTimes(4);

    unmount();
    vi.useRealTimers();
  });

  it('params.judge가 없는 응답(구배 아닌 분석 등)은 이전 값을 유지한다', async () => {
    supabaseStub.from.mockClear();
    supabaseStub.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { params: {} } }) }) }),
    }));
    vi.useFakeTimers();

    const initial: JudgeInfo = { state: 'queued', at: 't0' };
    const { result, unmount } = renderHook(() => useJudgeStatus('a1', initial));

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current).toEqual(initial);

    unmount();
    vi.useRealTimers();
  });
});
