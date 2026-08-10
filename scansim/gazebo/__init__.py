# -*- coding: utf-8 -*-
"""Gazebo 대조검증 (스펙 §7-3, 계획 Task 9).

export_sdf: 세부과업 2 덤프 기하 → SDF world (벽·가구·차동구동 로봇)
validate:   gz sim 헤드리스에서 같은 경유점을 주행시켜 운행 거리·시간을
            자체 시뮬레이터와 대조한다 (허용 오차 ±5% — 늘리지 않는다).
"""
