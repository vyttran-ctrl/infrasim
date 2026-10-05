// Module-level camera command bus so UI code can drive the camera without
// holding a ref into the Canvas.

export type CameraCommand =
  | { type: 'reset' }
  | { type: 'focus'; target: { kind: 'edge' | 'node'; id: string } };

const listeners = new Set<(c: CameraCommand) => void>();

export function onCameraCommand(l: (c: CameraCommand) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Frames the whole network. */
export function requestCameraReset(): void {
  listeners.forEach((l) => l({ type: 'reset' }));
}

/** Smoothly pans to an edge or node. */
export function requestFocus(target: { kind: 'edge' | 'node'; id: string }): void {
  listeners.forEach((l) => l({ type: 'focus', target }));
}

/** Shared per-frame camera facts (read by labels etc.; written by CameraRig). */
export const cameraState = { distance: 1000 };
