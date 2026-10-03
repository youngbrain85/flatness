"""points3d.bin 형식 골든의 입력 표본 (pytest 와 vitest 가 같은 .bin 을 읽는다).

골든 파일을 다시 만드는 방법(engine 폴더에서):
    PYTHONPATH=D:/Projects/Flatness/engine <py> -m tests.fixtures.points3d_golden
형식을 바꾸지 않았는데 파일이 달라지면 결함이다. 난수를 쓰지 않는다.

표본은 아래 상수로만 만든다: xyz_local = MN + Q * EXT / 65535.0
- 축 범위가 서로 다르다(4.0 / 2.5 / 0.3125 m): 축 전치 변이가 죽는다
- 원점이 UTM 급 대좌표다: origin_m 을 float32 로 다루는 변이가 죽는다
- 패딩 전 JSON 이 382바이트라 공백 2바이트가 붙는다: 패딩·오프셋 변이가 죽는다
- dev 에 0, 양수, 음수, 두 센티널, DEV_MAX, DEV_MIN, 임계값 경계(70, 71, -70, -71)가 있다
- Q 에 상·하위 바이트가 다른 값(258 = 0x0102, 772 = 0x0304, 1286 = 0x0506)이 있다: 엔디안 변이가 죽는다
- 7번 점은 z 가 최댓값인데 센티널이다: fit_bounds 가 전체 범위보다 작다
"""
from pathlib import Path

import numpy as np

from flatness.core.pointsample import PointSample

GOLDEN_PATH = Path(__file__).with_name("points3d_golden.bin")

ORIGIN_ABS = (254012.3371, 4180044.9126, 31.4802)   # 절대 좌표 원점(m)
MN = (0.5, 0.25, 0.125)                             # 표본 로컬 좌표의 축별 최솟값(m)
EXT = (4.0, 2.5, 0.3125)                            # 축별 범위(m)
SAMPLE_CELL_M = 0.0125
SOURCE_POINTS = 12345
CAP = 500000

# 행 = 점, 열 = (qx, qy, qz). 작성기가 양자화하면 이 값이 그대로 나와야 한다
Q = (
    (0, 0, 0),
    (65535, 65535, 4096),
    (258, 772, 1286),
    (32768, 16384, 8192),
    (1, 65534, 2),
    (40000, 20000, 10000),
    (12345, 54321, 23456),
    (100, 200, 65535),
    (50000, 60000, 300),
    (65280, 255, 4660),
    (4660, 43981, 291),
    (21845, 43690, 13107),
)

# 0.1mm 정수 편차. 7번 = DEV_NOT_FLOOR, 8번 = DEV_NO_DEVIATION, 9번 = DEV_MAX, 10번 = DEV_MIN
DEV = (0, 32, -105, 70, 71, -70, -71, -32768, -32767, 32767, -32766, 1)


def golden_sample() -> PointSample:
    """골든 표본. 부를 때마다 같은 값을 새 배열로 돌려준다."""
    q = np.array(Q, dtype=np.float64)
    xyz_local = np.array(MN, dtype=np.float64) + q * np.array(EXT, dtype=np.float64) / 65535.0
    return PointSample(
        xyz_local=xyz_local,
        dev_q=np.array(DEV, dtype=np.int16),
        origin_abs=np.array(ORIGIN_ABS, dtype=np.float64),
        sample_cell_m=SAMPLE_CELL_M,
        source_points=SOURCE_POINTS,
        cap=CAP,
    )


if __name__ == "__main__":
    import hashlib

    from flatness.outputs.points3d import write_points3d

    write_points3d(golden_sample(), GOLDEN_PATH)
    data = GOLDEN_PATH.read_bytes()
    print(f"{GOLDEN_PATH.name}: {len(data)} bytes, sha256 {hashlib.sha256(data).hexdigest()}")
