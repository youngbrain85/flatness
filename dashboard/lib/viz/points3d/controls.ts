// 입력 reducer(순수 함수). 정규화된 입력 이벤트를 받아 카메라·제스처 상태를 새로 만든다.
// DOM 이벤트 객체를 받지 않는다. 리스너 연결과 preventDefault 호출은 뷰(points3d-view.tsx)가 한다.
// handled 가 true 인 입력만 호출자가 기본 동작을 막는다: Ctrl/Cmd+휠(브라우저 페이지 확대)과 화살표 키(페이지 스크롤).
import { pan, rotate, zoom, type OrbitState } from './orbit';

export const WHEEL_ZOOM_RATE = 0.001; // 휠 줌: distance * exp(deltaY * 0.001)
export const KEY_ROTATE_PX = 20; //     화살표 키 한 번 = 20px 드래그(0.1rad)
export const KEY_ZOOM_IN = 0.9; //      + 와 = 키
export const KEY_ZOOM_OUT = 1.1; //     - 키

// x·y 는 CSS px. button 은 PointerEvent.button(0 왼쪽, 1 가운데, 2 오른쪽)
export type ControlEvent =
  | { type: 'down' | 'move' | 'up' | 'cancel'; pointerId: number; x: number; y: number; button: number; shiftKey: boolean }
  | { type: 'wheel'; deltaY: number; ctrlKey: boolean; metaKey: boolean }
  | { type: 'key'; key: string };

// pointers: 눌린 포인터의 직전 위치와, down 때의 버튼·Shift. pinchDist: 두 포인터의 직전 간격(0 = 기준 없음)
export interface ControlState {
  camera: OrbitState;
  pointers: Record<number, { x: number; y: number; button: number; shift: boolean }>;
  pinchDist: number;
}

export function initialControlState(camera: OrbitState): ControlState {
  return { camera, pointers: {}, pinchDist: 0 };
}

// 눌린 포인터가 하나라도 있는가(드래그·핀치 중)
export function isGesturing(s: ControlState): boolean {
  return Object.keys(s.pointers).length > 0;
}

// 입력 상태는 바꾸지 않는다. 카메라가 변하지 않는 입력에서는 camera 참조를 그대로 돌려준다.
export function reduceControl(
  s: ControlState, e: ControlEvent, cssHPx: number,
): { state: ControlState; handled: boolean } {
  switch (e.type) {
    case 'down': {
      const pointers = { ...s.pointers, [e.pointerId]: { x: e.x, y: e.y, button: e.button, shift: e.shiftKey } };
      return { state: { camera: s.camera, pointers, pinchDist: 0 }, handled: false };
    }
    case 'move': {
      const prev = s.pointers[e.pointerId];
      if (!prev) return { state: s, handled: false }; // 누르지 않은 포인터(지나가는 마우스)
      const dx = e.x - prev.x;
      const dy = e.y - prev.y;
      const pointers = { ...s.pointers, [e.pointerId]: { ...prev, x: e.x, y: e.y } };
      const held = Object.values(pointers);
      if (held.length === 1) {
        // 팬·회전 판정은 down 때 저장한 버튼·Shift 로 한다
        const camera = prev.button === 2 || prev.shift ? pan(s.camera, dx, dy, cssHPx) : rotate(s.camera, dx, dy);
        return { state: { camera, pointers, pinchDist: s.pinchDist }, handled: false };
      }
      if (held.length === 2) {
        // 두 포인터: 중점 이동(포인터 이동의 절반)만큼 팬, 간격 비만큼 줌
        const d = Math.hypot(held[0].x - held[1].x, held[0].y - held[1].y);
        let camera = pan(s.camera, dx / 2, dy / 2, cssHPx);
        if (s.pinchDist > 0 && d > 0) camera = zoom(camera, s.pinchDist / d);
        return { state: { camera, pointers, pinchDist: d }, handled: false };
      }
      return { state: { camera: s.camera, pointers, pinchDist: s.pinchDist }, handled: false }; // 세 포인터 이상
    }
    case 'up':
    case 'cancel': {
      const pointers = { ...s.pointers };
      delete pointers[e.pointerId];
      return { state: { camera: s.camera, pointers, pinchDist: 0 }, handled: false };
    }
    case 'wheel': {
      if (!e.ctrlKey && !e.metaKey) return { state: s, handled: false }; // 일반 휠은 페이지 스크롤에 맡긴다
      const camera = zoom(s.camera, Math.exp(e.deltaY * WHEEL_ZOOM_RATE));
      return { state: { ...s, camera }, handled: true };
    }
    case 'key': {
      switch (e.key) {
        case 'ArrowLeft': //  방위 +0.1rad (왼쪽으로 20px 끈 것과 같다)
          return { state: { ...s, camera: rotate(s.camera, -KEY_ROTATE_PX, 0) }, handled: true };
        case 'ArrowRight': // 방위 -0.1rad
          return { state: { ...s, camera: rotate(s.camera, KEY_ROTATE_PX, 0) }, handled: true };
        case 'ArrowUp': //    고도 +0.1rad (아래로 20px 끈 것과 같다)
          return { state: { ...s, camera: rotate(s.camera, 0, KEY_ROTATE_PX) }, handled: true };
        case 'ArrowDown': //  고도 -0.1rad
          return { state: { ...s, camera: rotate(s.camera, 0, -KEY_ROTATE_PX) }, handled: true };
        case '+':
        case '=':
          return { state: { ...s, camera: zoom(s.camera, KEY_ZOOM_IN) }, handled: false };
        case '-':
          return { state: { ...s, camera: zoom(s.camera, KEY_ZOOM_OUT) }, handled: false };
        default:
          return { state: s, handled: false };
      }
    }
  }
}
