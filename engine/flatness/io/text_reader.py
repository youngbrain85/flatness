"""XYZ/TXT/CSV/PTS 텍스트 리더 — 공백·쉼표 구분, 앞 3열을 x y z로 해석.

숫자 3개를 만들 수 없는 행(헤더, PTS 점 개수 행, 빈 줄, 주석)은 건너뛴다.
"""
import math
import numpy as np


def read_text_chunks(path, chunk_size=2_000_000):
    buf = []
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = line.replace(",", " ").split()
            if len(parts) < 3:
                continue
            try:
                row = (float(parts[0]), float(parts[1]), float(parts[2]))
            except ValueError:
                continue  # 비수치 행(헤더 등)
            if not all(math.isfinite(v) for v in row):
                continue  # nan/inf 행 스킵 (티켓 15)
            buf.append(row)
            if len(buf) >= chunk_size:
                yield np.asarray(buf, dtype=np.float64)
                buf = []
    if buf:
        yield np.asarray(buf, dtype=np.float64)
