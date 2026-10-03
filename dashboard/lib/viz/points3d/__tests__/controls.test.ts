// reduceControl: 정규화된 입력 이벤트 -> 카메라·제스처 상태(스펙 §7.7 조작 표).
// handled 는 "호출자가 preventDefault 해야 하는가"다. 표의 "기본 동작 막음" 열과 한 줄씩 맞춘다.
import { describe, expect, it } from 'vitest';
import { ELEVATION_LIMIT, pan, zoom, type OrbitState } from '../orbit';
import {
  KEY_ROTATE_PX, KEY_ZOOM_IN, KEY_ZOOM_OUT, WHEEL_ZOOM_RATE,
  initialControlState, isGesturing, reduceControl,
  type ControlEvent, type ControlState,
} from '../controls';

const H = 480; // canvas.clientHeight (CSS px)

// 손으로 적은 카메라. 줌 제한은 [0.02 * 4, 20 * 4] = [0.08, 80] 이다
const CAM: OrbitState = {
  target: [5, 4, 0], distance: 10, azimuth: -1, elevation: 0.3,
  fovy: (40 * Math.PI) / 180, radius: 4,
};

type PointerType = 'down' | 'move' | 'up' | 'cancel';
const ptr = (
  type: PointerType, pointerId: number, x: number, y: number,
  over: { button?: number; shiftKey?: boolean } = {},
): ControlEvent => ({ type, pointerId, x, y, button: 0, shiftKey: false, ...over });
const wheel = (deltaY: number, over: { ctrlKey?: boolean; metaKey?: boolean } = {}): ControlEvent =>
  ({ type: 'wheel', deltaY, ctrlKey: false, metaKey: false, ...over });
const key = (k: string): ControlEvent => ({ type: 'key', key: k });

// 이벤트를 차례로 넣고 마지막 상태를 돌려준다
function run(events: ControlEvent[], start: ControlState = initialControlState(CAM), cssH = H): ControlState {
  return events.reduce((s, e) => reduceControl(s, e, cssH).state, start);
}

function expectCameraClose(actual: OrbitState, expected: OrbitState) {
  expect(actual.distance).toBeCloseTo(expected.distance, 10);
  expect(actual.azimuth).toBeCloseTo(expected.azimuth, 10);
  expect(actual.elevation).toBeCloseTo(expected.elevation, 10);
  expect(actual.fovy).toBe(expected.fovy);
  expect(actual.radius).toBe(expected.radius);
  for (let i = 0; i < 3; i++) expect(actual.target[i]).toBeCloseTo(expected.target[i], 10);
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

describe('상수와 초기 상태', () => {
  it('스펙 §7.7 의 값이다', () => {
    expect(WHEEL_ZOOM_RATE).toBe(0.001);
    expect(KEY_ROTATE_PX).toBe(20);
    expect(KEY_ZOOM_IN).toBe(0.9);
    expect(KEY_ZOOM_OUT).toBe(1.1);
  });

  it('initialControlState 는 눌린 포인터가 없는 상태다', () => {
    const s = initialControlState(CAM);
    expect(s.camera).toBe(CAM);
    expect(s.pointers).toEqual({});
    expect(s.pinchDist).toBe(0);
    expect(isGesturing(s)).toBe(false);
  });
});

describe('휠', () => {
  it('Ctrl·Cmd 없는 휠은 가로채지 않는다: handled false, 카메라 불변', () => {
    const s = initialControlState(CAM);
    for (const deltaY of [100, -100, 5000]) {
      const r = reduceControl(s, wheel(deltaY), H);
      expect(r.handled).toBe(false);
      expect(r.state.camera).toBe(CAM); // 참조까지 같다(다시 그릴 이유가 없다)
      expect(r.state.camera.distance).toBe(10);
    }
  });

  it('Ctrl+휠은 distance * exp(deltaY * 0.001) 로 줌하고 handled true', () => {
    const s = initialControlState(CAM);
    const out = reduceControl(s, wheel(100, { ctrlKey: true }), H);
    expect(out.handled).toBe(true);
    expect(out.state.camera.distance).toBeCloseTo(11.051709180756477, 10); // 10 * e^0.1 (멀어진다)
    const inn = reduceControl(s, wheel(-100, { ctrlKey: true }), H);
    expect(inn.handled).toBe(true);
    expect(inn.state.camera.distance).toBeCloseTo(9.048374180359595, 10); // 10 * e^-0.1 (가까워진다)
    // 줌은 거리만 바꾼다
    expectCameraClose(out.state.camera, { ...CAM, distance: 11.051709180756477 });
  });

  it('Cmd+휠(metaKey)도 같은 줌이고 handled true', () => {
    const r = reduceControl(initialControlState(CAM), wheel(100, { metaKey: true }), H);
    expect(r.handled).toBe(true);
    expect(r.state.camera.distance).toBeCloseTo(11.051709180756477, 10);
  });

  it('줌 제한(20 * radius)을 넘지 않는다', () => {
    // 10 * e^5 = 1484 -> 20 * 4 = 80 으로 잘린다
    const r = reduceControl(initialControlState(CAM), wheel(5000, { ctrlKey: true }), H);
    expect(r.state.camera.distance).toBe(80);
    expect(r.handled).toBe(true);
  });
});

describe('한 포인터 드래그', () => {
  it('왼쪽 버튼 드래그는 회전: 오른쪽으로 끌면 방위가 줄고 아래로 끌면 고도가 는다(1px 당 0.005rad)', () => {
    // (100,100) -> (130,90): dx = +30, dy = -10 -> 방위 -1 - 0.15, 고도 0.3 - 0.05
    const a = run([ptr('down', 1, 100, 100), ptr('move', 1, 130, 90)]);
    expectCameraClose(a.camera, { ...CAM, azimuth: -1.15, elevation: 0.25 });
    // 이어서 (130,90) -> (110,150): dx = -20, dy = +60 -> 방위 -1.15 + 0.1, 고도 0.25 + 0.3
    // (직전 위치를 저장하지 않으면 down 지점 기준 dx = +10, dy = +50 이 되어 값이 달라진다)
    const b = run([ptr('move', 1, 110, 150)], a);
    expectCameraClose(b.camera, { ...CAM, azimuth: -1.05, elevation: 0.55 });
  });

  it('Shift+드래그는 팬: target 만 움직이고 각도·거리는 그대로', () => {
    const s = run([ptr('down', 1, 100, 100, { shiftKey: true }), ptr('move', 1, 148, 124, { shiftKey: true })]);
    expectCameraClose(s.camera, pan(CAM, 48, 24, H));
    expect(s.camera.azimuth).toBe(CAM.azimuth);
    expect(s.camera.elevation).toBe(CAM.elevation);
    expect(s.camera.distance).toBe(CAM.distance);
    expect(s.camera.target).not.toEqual(CAM.target);
  });

  it('오른쪽 버튼 드래그도 팬', () => {
    const s = run([ptr('down', 1, 100, 100, { button: 2 }), ptr('move', 1, 148, 124, { button: 2 })]);
    expectCameraClose(s.camera, pan(CAM, 48, 24, H));
    expect(s.camera.azimuth).toBe(CAM.azimuth);
  });

  it('팬·회전 판정은 down 때의 button·shift 로 한다(move 의 값은 보지 않는다)', () => {
    // Shift 를 누른 채 시작했다가 떼어도 팬이 이어진다
    const p = run([ptr('down', 1, 100, 100, { shiftKey: true }), ptr('move', 1, 148, 124)]);
    expectCameraClose(p.camera, pan(CAM, 48, 24, H));
    // 그냥 시작한 드래그는 도중에 Shift 를 눌러도 회전이다
    const r = run([ptr('down', 1, 100, 100), ptr('move', 1, 130, 90, { shiftKey: true, button: 2 })]);
    expectCameraClose(r.camera, { ...CAM, azimuth: -1.15, elevation: 0.25 });
  });

  it('팬은 cssHPx 를 pan 에 그대로 넘긴다(높이가 절반이면 이동량이 달라진다)', () => {
    const events = [ptr('down', 1, 100, 100, { button: 2 }), ptr('move', 1, 148, 124, { button: 2 })];
    const tall = run(events, initialControlState(CAM), 480);
    const short = run(events, initialControlState(CAM), 240);
    expectCameraClose(short.camera, pan(CAM, 48, 24, 240));
    expect(short.camera.target).not.toEqual(tall.camera.target);
  });

  it('가운데 버튼 드래그는 회전이다(팬은 오른쪽 버튼과 Shift 뿐)', () => {
    const s = run([ptr('down', 1, 100, 100, { button: 1 }), ptr('move', 1, 130, 90, { button: 1 })]);
    expectCameraClose(s.camera, { ...CAM, azimuth: -1.15, elevation: 0.25 });
  });
});

describe('두 포인터 핀치', () => {
  // 손가락 1 은 (100,100), 손가락 2 는 (200,100) 에서 시작한다
  const start = run([ptr('down', 1, 100, 100), ptr('down', 2, 200, 100)]);

  it('down 직후에는 pinchDist 가 0 이고 첫 move 는 팬만 한다', () => {
    expect(start.pinchDist).toBe(0);
    // 손가락 2: (200,100) -> (220,100). dx = 20 -> 중점은 10px 이동. 간격 120 을 기억한다
    const s = run([ptr('move', 2, 220, 100)], start);
    expectCameraClose(s.camera, pan(CAM, 10, 0, H));
    expect(s.camera.distance).toBe(10); // 기준 간격이 없어 줌하지 않는다
    expect(s.pinchDist).toBeCloseTo(120, 10);
  });

  it('간격 비로 줌하고 중점 이동(포인터 이동의 절반)으로 팬한다', () => {
    const c1 = pan(CAM, 10, 0, H);
    // 손가락 2: (220,100) -> (196,228). dx = -24, dy = 128. 간격 hypot(96,128) = 160 -> 줌 120 / 160 = 0.75
    const s2 = run([ptr('move', 2, 220, 100), ptr('move', 2, 196, 228)], start);
    const c2 = zoom(pan(c1, -12, 64, H), 0.75);
    expectCameraClose(s2.camera, c2);
    expect(s2.camera.distance).toBeCloseTo(7.5, 10); // 손가락을 벌리면 가까워진다
    expect(s2.pinchDist).toBeCloseTo(160, 10);
    // 손가락 1: (100,100) -> (148,164). dx = 48, dy = 64. 간격 hypot(48,64) = 80 -> 줌 160 / 80 = 2
    // (pinchDist 를 갱신하지 않으면 120 / 80 = 1.5 가 되어 11.25 가 나온다)
    const s3 = run([ptr('move', 1, 148, 164)], s2);
    expectCameraClose(s3.camera, zoom(pan(c2, 24, 32, H), 2));
    expect(s3.camera.distance).toBeCloseTo(15, 10); // 손가락을 모으면 멀어진다
    // 핀치는 각도를 바꾸지 않는다
    expect(s3.camera.azimuth).toBe(CAM.azimuth);
    expect(s3.camera.elevation).toBe(CAM.elevation);
  });

  it('한 손가락을 떼면 pinchDist 가 0 으로 돌아가고 남은 손가락은 회전한다', () => {
    const pinched = run([ptr('move', 2, 220, 100)], start);
    const lifted = run([ptr('up', 2, 220, 100)], pinched);
    expect(lifted.pinchDist).toBe(0);
    expect(Object.keys(lifted.pointers)).toEqual(['1']);
    const rotated = run([ptr('move', 1, 120, 100)], lifted); // dx = +20 -> 방위 -0.1
    expect(rotated.camera.azimuth).toBeCloseTo(pinched.camera.azimuth - 0.1, 10);
    expect(rotated.camera.target).toEqual(pinched.camera.target);
  });

  it('두 번째 손가락을 다시 대면 첫 move 는 줌하지 않는다', () => {
    const again = run(
      [ptr('move', 2, 220, 100), ptr('up', 2, 220, 100), ptr('down', 3, 300, 100), ptr('move', 3, 400, 100)],
      start,
    );
    expect(again.camera.distance).toBe(10);
    expect(again.pinchDist).toBeCloseTo(300, 10); // (100,100) 과 (400,100)
  });

  it('세 번째 손가락이 닿으면(down) 기억한 간격을 버린다', () => {
    const pinched = run([ptr('move', 2, 220, 100)], start);
    expect(pinched.pinchDist).toBeCloseTo(120, 10);
    expect(run([ptr('down', 3, 300, 300)], pinched).pinchDist).toBe(0);
  });

  it('세 포인터가 눌린 동안의 move 는 카메라를 바꾸지 않고 위치만 기억한다', () => {
    const three = run([ptr('down', 3, 300, 300)], start);
    const moved = run([ptr('move', 3, 350, 380)], three);
    expect(moved.camera).toBe(three.camera);
    expect(moved.pointers[3]).toEqual({ x: 350, y: 380, button: 0, shift: false });
  });
});

describe('포인터 추적', () => {
  it('down 이 위치·버튼·shift 를 기억하고 isGesturing 이 true 가 된다', () => {
    const s = run([ptr('down', 4, 12, 34, { button: 2, shiftKey: true })]);
    expect(s.pointers).toEqual({ 4: { x: 12, y: 34, button: 2, shift: true } });
    expect(isGesturing(s)).toBe(true);
    expect(s.camera).toBe(CAM);
  });

  it('추적하지 않는 pointerId 의 move 는 무시한다(버튼 없이 지나가는 마우스)', () => {
    const idle = initialControlState(CAM);
    const r = reduceControl(idle, ptr('move', 7, 50, 50), H);
    expect(r.state.camera).toBe(CAM);
    expect(r.state.pointers).toEqual({});
    expect(isGesturing(r.state)).toBe(false);
    // 다른 포인터가 눌려 있어도 모르는 id 는 끼워 넣지 않는다
    const one = run([ptr('down', 1, 100, 100)]);
    const r2 = reduceControl(one, ptr('move', 7, 50, 50), H);
    expect(r2.state.camera).toBe(CAM);
    expect(Object.keys(r2.state.pointers)).toEqual(['1']);
  });

  it('up 과 cancel 이 포인터를 지운다. 그 뒤의 move 는 회전하지 않는다', () => {
    for (const end of ['up', 'cancel'] as const) {
      const s = run([ptr('down', 1, 100, 100), ptr(end, 1, 100, 100)]);
      expect(s.pointers).toEqual({});
      expect(isGesturing(s)).toBe(false);
      const after = run([ptr('move', 1, 160, 160)], s);
      expect(after.camera).toBe(CAM);
    }
  });

  it('모르는 pointerId 의 up 은 다른 포인터를 건드리지 않는다', () => {
    const s = run([ptr('down', 1, 100, 100), ptr('up', 9, 0, 0)]);
    expect(Object.keys(s.pointers)).toEqual(['1']);
    expect(isGesturing(s)).toBe(true);
  });

  it('포인터 이벤트는 전부 handled false 다(터치 스크롤은 touch-action 이 막는다)', () => {
    let s = initialControlState(CAM);
    const events = [
      ptr('down', 1, 100, 100), ptr('move', 1, 130, 90), ptr('down', 2, 200, 100),
      ptr('move', 2, 220, 100), ptr('cancel', 2, 220, 100), ptr('up', 1, 130, 90),
      ptr('move', 1, 0, 0), ptr('down', 5, 10, 10, { button: 2 }), ptr('move', 5, 20, 20, { button: 2 }),
    ];
    for (const e of events) {
      const r = reduceControl(s, e, H);
      expect(r.handled).toBe(false);
      s = r.state;
    }
  });
});

describe('키', () => {
  const s = initialControlState(CAM);

  it('ArrowLeft / ArrowRight 는 방위 +0.1 / -0.1 이고 handled true', () => {
    const l = reduceControl(s, key('ArrowLeft'), H);
    expect(l.handled).toBe(true);
    expectCameraClose(l.state.camera, { ...CAM, azimuth: -0.9 });
    const r = reduceControl(s, key('ArrowRight'), H);
    expect(r.handled).toBe(true);
    expectCameraClose(r.state.camera, { ...CAM, azimuth: -1.1 });
  });

  it('ArrowUp / ArrowDown 은 고도 +0.1 / -0.1 이고 handled true', () => {
    const u = reduceControl(s, key('ArrowUp'), H);
    expect(u.handled).toBe(true);
    expectCameraClose(u.state.camera, { ...CAM, elevation: 0.4 });
    const d = reduceControl(s, key('ArrowDown'), H);
    expect(d.handled).toBe(true);
    expectCameraClose(d.state.camera, { ...CAM, elevation: 0.2 });
  });

  it('화살표 키의 고도는 제한(±89.9°)에서 멈춘다', () => {
    const high = initialControlState({ ...CAM, elevation: ELEVATION_LIMIT - 0.05 });
    expect(reduceControl(high, key('ArrowUp'), H).state.camera.elevation).toBeCloseTo(ELEVATION_LIMIT, 12);
    const low = initialControlState({ ...CAM, elevation: -ELEVATION_LIMIT + 0.05 });
    expect(reduceControl(low, key('ArrowDown'), H).state.camera.elevation).toBeCloseTo(-ELEVATION_LIMIT, 12);
  });

  it('+ 와 = 는 줌 x0.9, - 는 줌 x1.1 이고 handled false', () => {
    for (const k of ['+', '=']) {
      const r = reduceControl(s, key(k), H);
      expect(r.handled).toBe(false);
      expectCameraClose(r.state.camera, { ...CAM, distance: 9 });
    }
    const out = reduceControl(s, key('-'), H);
    expect(out.handled).toBe(false);
    expectCameraClose(out.state.camera, { ...CAM, distance: 11 });
  });

  it('그 밖의 키는 상태를 바꾸지 않고 handled false', () => {
    for (const k of ['a', 'Enter', ' ', 'Tab', 'Escape', 'PageDown', 'Home', '_', 'Shift']) {
      const r = reduceControl(s, key(k), H);
      expect(r.handled).toBe(false);
      expect(r.state).toBe(s);
    }
  });
});

describe('불변성', () => {
  it('입력 상태 객체를 바꾸지 않는다(얼린 상태로 모든 종류의 이벤트를 넣어도 던지지 않는다)', () => {
    const events: ControlEvent[] = [
      ptr('down', 1, 100, 100), ptr('move', 1, 130, 90), ptr('down', 2, 200, 100, { shiftKey: true }),
      ptr('move', 2, 220, 100), ptr('move', 1, 140, 120), ptr('up', 2, 220, 100), ptr('cancel', 1, 140, 120),
      wheel(100), wheel(100, { ctrlKey: true }), key('ArrowLeft'), key('ArrowUp'), key('+'), key('-'), key('a'),
    ];
    let s = deepFreeze(initialControlState(deepFreeze({ ...CAM, target: [5, 4, 0] as [number, number, number] })));
    for (const e of events) {
      const before = JSON.stringify(s);
      const next = reduceControl(s, e, H).state;
      expect(JSON.stringify(s)).toBe(before);
      s = deepFreeze(next);
    }
  });
});
