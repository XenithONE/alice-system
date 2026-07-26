import { chassisBack } from "./heading.ts";

export const CAM_DISTANCE = 4.6;
export const CAM_HEIGHT = 2.4;
export const CAM_LOOK_AHEAD = 0.8;

export interface ChaseCameraPose {
  readonly camera: { readonly x: number; readonly y: number; readonly z: number };
  readonly target: { readonly x: number; readonly y: number; readonly z: number };
}

/** Smooth a yaw on the shortest arc and keep the retained angle in -PI..PI. */
export function smoothChaseYaw(current: number, target: number, dt: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  const next = current + delta * (1 - Math.exp(-Math.max(dt, 0) / 0.12));
  return Math.atan2(Math.sin(next), Math.cos(next));
}

/** Pure, Node-safe chase-camera geometry shared by rendering and its regression gate. */
export function chaseCameraPose(
  focus: { x: number; y: number; z: number },
  heading: { x: number; z: number },
  distance = CAM_DISTANCE
): ChaseCameraPose {
  const length = Math.max(Math.hypot(heading.x, heading.z), Number.EPSILON);
  const forwardX = heading.x / length;
  const forwardZ = heading.z / length;
  const target = {
    x: focus.x + forwardX * CAM_LOOK_AHEAD,
    y: Math.max(focus.y, 0) + 0.45,
    z: focus.z + forwardZ * CAM_LOOK_AHEAD
  };
  return {
    camera: {
      x: focus.x - forwardX * distance,
      y: target.y + CAM_HEIGHT,
      z: focus.z - forwardZ * distance
    },
    target
  };
}

/** Convenience adapter for callers that have a chassis quaternion. */
export function chaseCameraPoseForQuaternion(
  focus: { x: number; y: number; z: number },
  q: { x: number; y: number; z: number; w: number },
  distance = CAM_DISTANCE
): ChaseCameraPose {
  const back = chassisBack(q);
  return chaseCameraPose(focus, { x: -back.x, z: -back.z }, distance);
}
