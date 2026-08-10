# -*- coding: utf-8 -*-
"""스캔 시뮬레이션 설정 (ScanConfig).

밀도 목표·장비 파라미터는 전부 이 데이터클래스로 주입한다 — 코드 매직넘버 금지.
"가정값" 표기가 붙은 기본값은 장비 공표치가 아니라 모델 파라미터다 (스펙 §9-1).
실제 장비가 정해지면 from_json 또는 kwargs 로 값만 바꾼다.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, fields
from pathlib import Path


@dataclass
class ScanConfig:
    cell_mm: float = 50.0                  # 격자 셀 한 변 (스펙 §2)
    robot_radius_mm: float = 250.0         # 가정값: 로봇 반경
    mobile_fov_deg: float = 90.0           # 가정값: 모바일 스캐너 시야각
    mobile_range_mm: float = 4000.0        # 가정값: 모바일 유효 사거리
    mobile_speed_mms: float = 300.0        # 가정값: 주행 속도
    mobile_scan_hz: float = 30.0           # 가정값: 스캔율
    # ↑ 30Hz 인 이유: 기본값끼리 자기일관이어야 한다. 진행방향 점 간격 바닥값 v/f =
    #   300/30 = 10mm 로 기본 모바일 목표(20mm)를 달성할 수 있다. 10Hz 로 두면 바닥값
    #   30mm > 목표 20mm 라 기본 실행의 모바일 커버리지가 원천적으로 0% 가 된다 —
    #   실제로 그렇게 출하될 뻔했다(검증 결함 2). 달성 불가 조합의 정직 보고 경로는
    #   테스트가 hz 를 명시해 따로 고정한다.
    mobile_angres_deg: float = 0.5         # 가정값: 모바일 각해상도
    tls_range_mm: float = 10000.0          # 가정값: TLS 유효 사거리
    tls_angres_deg: float = 0.035          # 가정값: TLS 각해상도
    tls_height_mm: float = 1500.0          # 가정값: TLS 센서(삼각대) 높이 — 바닥 입사각 모델용
    tls_dwell_s: float = 120.0             # 가정값: 거치점당 체류 시간
    step_s: float = 0.2                    # 시뮬레이션 시간 스텝 (스펙 §6)
    density_targets_mm: dict = field(
        # 스펙 §3 기본 목표: 모바일 ≤20mm(스크리닝급), TLS ≤5mm(세부과업 1 해상도 요구)
        default_factory=lambda: {"mobile": 20.0, "tls": 5.0}
    )

    @classmethod
    def from_json(cls, path) -> "ScanConfig":
        """JSON 파일의 키로 기본값을 덮어쓴다. 모르는 키는 오류 — 오타 침묵 방지."""
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"알 수 없는 설정 키: {sorted(unknown)}")
        return cls(**data)
