// Mutable scene description shared between React (writes, on layout changes)
// and the fire shader (reads, every frame). Kept out of React state on
// purpose: the canvas animates at display rate and must never trigger renders.

export interface ScenePerson {
  sid: string;
  color: string; // hex
  el?: HTMLElement | null; // tile element → the shader wraps it in flame
  leaving?: boolean;
}

export const scene = {
  // Base of the campfire in viewport CSS px, and its height
  fire: { x: window.innerWidth / 2, y: window.innerHeight * 0.62, size: 180 },
  // 0 = the fire is mostly hidden (embers + glow only), 1 = full campfire
  fireAlpha: 1,
  people: [] as ScenePerson[],
  // Extra heat that decays — a log on the fire, a new arrival
  flare: 0,
  pointer: { x: -9999, y: -9999, active: 0 },
};

export function flare(amount = 1) {
  scene.flare = Math.min(2, scene.flare + amount);
}

window.addEventListener("pointermove", (e) => {
  scene.pointer.x = e.clientX;
  scene.pointer.y = e.clientY;
  scene.pointer.active = e.pointerType === "mouse" ? 1 : 0;
});
document.addEventListener("pointerleave", () => {
  scene.pointer.active = 0;
});
