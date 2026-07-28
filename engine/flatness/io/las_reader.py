"""LAS/LAZ 리더 — float64 원좌표 청크 스트리밍(센터링은 서브셀 비닝 책임)."""
import laspy
import numpy as np


def read_las_chunks(path, chunk_size=2_000_000):
    """LAS/LAZ 파일을 청크 단위로 읽어 실좌표 float64 배열을 반환한다.

    Args:
        path: LAS/LAZ 파일 경로.
        chunk_size: 청크 크기 (포인트 개수).

    Yields:
        (k, 3) float64 배열. 스케일과 오프셋이 적용된 실좌표.
    """
    with laspy.open(str(path)) as f:
        for pts in f.chunk_iterator(chunk_size):
            yield np.column_stack([np.asarray(pts.x), np.asarray(pts.y),
                                   np.asarray(pts.z)]).astype(np.float64)
