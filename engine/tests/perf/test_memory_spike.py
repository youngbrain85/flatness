"""30M 점 성능·메모리 실측 (스펙 §5.2: 1 vCPU/2GB에서 5분) — 기본 스위트 제외."""
import threading
import time
import numpy as np
import psutil
import pytest
from flatness.core.pipeline import analyze_floor
from flatness.criteria import load_criteria

N_POINTS = 30_000_000
SIZE = (30.0, 20.0)  # 600m² — 30M점이면 점간격 ≈ 4.5mm


def _write_big_ply(path):
    # 메모리 오염 없이 스트리밍 생성: 청크 단위로 생성해 즉시 기록
    header = (f"ply\nformat binary_little_endian 1.0\nelement vertex {N_POINTS}\n"
              "property float x\nproperty float y\nproperty float z\nend_header\n")
    rng = np.random.default_rng(0)
    per_chunk = 2_000_000
    written = 0
    with open(path, "wb") as f:
        f.write(header.encode())
        while written < N_POINTS:
            k = min(per_chunk, N_POINTS - written)
            xs = rng.uniform(0, SIZE[0], k).astype(np.float32)
            ys = rng.uniform(0, SIZE[1], k).astype(np.float32)
            zs = rng.normal(0.0, 0.001, k).astype(np.float32)  # 1mm 노이즈 평탄 바닥
            f.write(np.column_stack([xs, ys, zs]).astype("<f4").tobytes())
            written += k


class _RssPeakMonitor:
    """백그라운드 폴링 스레드로 max RSS 추적 — 종료 시점 근사치의 한계 보완."""

    def __init__(self, proc, interval=0.2):
        self._proc, self._interval = proc, interval
        self._stop = threading.Event()
        self.peak = proc.memory_info().rss
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        while not self._stop.is_set():
            self.peak = max(self.peak, self._proc.memory_info().rss)
            self._stop.wait(self._interval)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join(timeout=2.0)
        self.peak = max(self.peak, self._proc.memory_info().rss)


@pytest.mark.perf
def test_30m_points_within_budget(tmp_path):
    big = tmp_path / "big.ply"
    _write_big_ply(big)
    proc = psutil.Process()
    rss0 = proc.memory_info().rss
    t0 = time.monotonic()
    with _RssPeakMonitor(proc) as mon:
        stats = analyze_floor(big, 1.0, load_criteria()["floor-kcs-exposed"], 5.0, tmp_path / "out")
    dt = time.monotonic() - t0
    rss_delta_gib = (mon.peak - rss0) / 2 ** 30
    print(f"\n[perf] 30M점: {dt:.1f}s, 피크 RSS 증가 {rss_delta_gib:.2f} GiB, "
          f"셀 {stats['n_cells']} 유효 {stats['n_valid']} coverage {stats['coverage_pct']}%")
    assert dt < 300.0
    assert (mon.peak - rss0) < 2 * 2 ** 30
