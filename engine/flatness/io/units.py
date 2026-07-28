"""단위 추정 휴리스틱 — 후보만 제시하고 확정은 사용자가 한다(스펙 §5.1.1)."""
from dataclasses import dataclass
from flatness.io.reader import CloudInfo


@dataclass
class UnitGuess:
    unit: str
    scale_to_m: float
    confidence: str
    evidence: str


def detect_units(info: CloudInfo) -> list[UnitGuess]:
    d = info.bbox_max - info.bbox_min
    extent = float(max(d[0], d[1]))
    ev = f"수평 범위 {extent:.1f} (파일 단위)"
    if 1.0 <= extent <= 200.0:
        return [UnitGuess("m", 1.0, "high", ev + " → 실내외 현장 규모(m)와 부합"),
                UnitGuess("mm", 0.001, "low", ev)]
    if 1000.0 <= extent <= 200000.0:
        return [UnitGuess("mm", 0.001, "high", ev + " → mm 단위 좌표로 추정"),
                UnitGuess("m", 1.0, "low", ev)]
    # 모호 구간(200~1000: cm 또는 대형 현장 m 등) — 전부 low
    return [UnitGuess("cm", 0.01, "low", ev + " → cm/m 모호"),
            UnitGuess("m", 1.0, "low", ev),
            UnitGuess("mm", 0.001, "low", ev)]
