// 겹쳐보기 테스트용 캔버스·이미지 스텁 (테스트 헬퍼 - vitest include가
// `**/__tests__/**/*.test.{ts,tsx}`이므로 이 파일 자체는 테스트로 수집되지 않는다).
//
// jsdom에는 캔버스 2D 컨텍스트가 없고, jsdom의 Image는 src를 넣어도 영원히 로드되지
// 않는다. 두 가지를 스텁으로 주면 "어느 이미지를 · 어느 변환으로 · 어떤 alpha로"
// 그리는지를 실제 렌더 경로에서 관찰할 수 있다. 프로덕션 코드에 테스트 전용 주입
// 지점을 두지 않으려고 전역 스텁을 골랐다.
//
// 다크 테마(Task 9): 겹쳐보기는 그림 밑에 스테이지 바탕(fillRect)과 격자(stroke 한 번)를 먼저
// 깐다. 그 호출과 순서(ops)도 기록해 "바탕 → 격자 → A → B" 순서를 테스트가 본다.

export interface DrawCall { src: string; transform: number[]; alpha: number }
export interface FillCall { style: string; rect: [number, number, number, number] }
export interface StrokeCall { style: string; width: number; segments: number }

/** drawImage 시점의 (이미지 src, 변환행렬, alpha)와 바탕·격자 호출을 기록하는 가짜 2D 컨텍스트. */
export function recordingCtx() {
  const calls: DrawCall[] = [];
  const fills: FillCall[] = [];
  const strokes: StrokeCall[] = [];
  /** 호출 순서: 'fillRect' | 'stroke' | 'drawImage' */
  const ops: string[] = [];
  let cur = [1, 0, 0, 1, 0, 0];
  let segments = 0;
  const ctx = {
    globalAlpha: 1,
    imageSmoothingEnabled: true,
    fillStyle: '' as string,
    strokeStyle: '' as string,
    lineWidth: 1,
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      cur = [a, b, c, d, e, f];
    },
    clearRect() {},
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ style: ctx.fillStyle, rect: [x, y, w, h] });
      ops.push('fillRect');
    },
    beginPath() { segments = 0; },
    moveTo() { segments += 1; },
    lineTo() {},
    stroke() {
      strokes.push({ style: ctx.strokeStyle, width: ctx.lineWidth, segments });
      ops.push('stroke');
    },
    drawImage(img: { src: string }) {
      calls.push({ src: img.src, transform: [...cur], alpha: ctx.globalAlpha });
      ops.push('drawImage');
    },
  };
  return { ctx, calls, fills, strokes, ops };
}

/** src를 넣으면 다음 마이크로태스크에 onload(또는 fail=true면 onerror)가 발화한다. */
export class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private value = '';
  static fail = false;

  set src(v: string) {
    this.value = v;
    queueMicrotask(() => (FakeImage.fail ? this.onerror?.() : this.onload?.()));
  }

  get src() { return this.value; }
}
