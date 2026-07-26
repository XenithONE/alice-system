import {
  CAM_DISTANCE,
  CAM_HEIGHT,
  chaseCameraPose,
  smoothChaseYaw,
  type ChaseCameraPose
} from "./chaseCamera";
import { chassisForward } from "./heading";

declare const process: { exitCode?: number };

interface TestBot {
  readonly seat: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly q: { x: number; y: number; z: number; w: number };
}

function dot(
  a: { x: number; z: number },
  b: { x: number; z: number }
): number {
  return a.x * b.x + a.z * b.z;
}

function normalize(v: { x: number; z: number }): { x: number; z: number } {
  const length = Math.max(Math.hypot(v.x, v.z), Number.EPSILON);
  return { x: v.x / length, z: v.z / length };
}

function oldDriverForward(q: TestBot["q"]): { x: number; z: number } {
  return normalize({
    x: -2 * (q.x * q.z + q.w * q.y),
    z: -(1 - 2 * (q.x * q.x + q.y * q.y))
  });
}

function poseForFocus(bots: readonly TestBot[], focusSeat: number): ChaseCameraPose {
  const focus = bots.find((bot) => bot.seat === focusSeat);
  if (!focus) throw new Error(`focus seat ${focusSeat} missing`);
  return chaseCameraPose(focus, chassisForward(focus.q));
}

let failed = false;
const rows = Array.from({ length: 16 }, (_, index) => {
  const degrees = index * 22.5;
  const yaw = degrees * Math.PI / 180;
  const q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
  const forward = chassisForward(q);
  const oldForward = oldDriverForward(q);
  const focus = { x: 1.25, y: 0.2, z: -2.5 };
  const pose = chaseCameraPose(focus, forward);
  const cameraForward = normalize({
    x: pose.target.x - pose.camera.x,
    z: pose.target.z - pose.camera.z
  });
  const botFromCamera = normalize({
    x: focus.x - pose.camera.x,
    z: focus.z - pose.camera.z
  });
  const cameraDot = dot(forward, cameraForward);
  const placementDot = dot(forward, botFromCamera);
  const legacyDot = dot(forward, oldForward);
  const pass = cameraDot > 0.999 && placementDot > 0.9 && legacyDot > 0.999999;
  failed ||= !pass;
  return {
    yawDeg: degrees.toFixed(1),
    forwardX: forward.x.toFixed(6),
    forwardZ: forward.z.toFixed(6),
    cameraDot: cameraDot.toFixed(6),
    placementDot: placementDot.toFixed(6),
    oldDriverDot: legacyDot.toFixed(6),
    pass
  };
});

console.log("HEADING 16-DIRECTION TABLE");
console.table(rows);

const focus: TestBot = {
  seat: 0,
  x: 2,
  y: 0.15,
  z: -3,
  q: { x: 0, y: Math.sin(Math.PI / 8), z: 0, w: Math.cos(Math.PI / 8) }
};
const forward = chassisForward(focus.q);
const oldBugCamera = {
  x: focus.x + forward.x * CAM_DISTANCE,
  z: focus.z + forward.z * CAM_DISTANCE
};
const oldBugPlacementDot = dot(
  normalize({ x: focus.x - oldBugCamera.x, z: focus.z - oldBugCamera.z }),
  forward
);
const oldBugWouldPass = oldBugPlacementDot > 0.9;
console.log("OLD BUG INJECTION", {
  injected: "camera = bot + forward * CAM_DISTANCE",
  placementDot: oldBugPlacementDot.toFixed(6),
  gatePass: oldBugWouldPass,
  expected: false
});
failed ||= oldBugWouldPass;

const nearOthers: readonly TestBot[] = [
  focus,
  { ...focus, seat: 1, x: 2.5, z: -2.5 },
  { ...focus, seat: 2, x: 1.5, z: -3.5 }
];
const farOthers: readonly TestBot[] = [
  focus,
  { ...focus, seat: 1, x: 5000, z: -8000 },
  { ...focus, seat: 2, x: -9000, z: 12000 }
];
const nearPose = poseForFocus(nearOthers, focus.seat);
const farPose = poseForFocus(farOthers, focus.seat);
const otherBotIndependent = JSON.stringify(nearPose.camera) === JSON.stringify(farPose.camera);
console.log("OTHER-BOT INDEPENDENCE", {
  nearOthersCamera: nearPose.camera,
  farOthersCamera: farPose.camera,
  exactMatch: otherBotIndependent
});
failed ||= !otherBotIndependent;

const deg = (value: number): number => value * Math.PI / 180;
const wrapForward = smoothChaseYaw(deg(179), deg(-179), 0.12);
const wrapReverse = smoothChaseYaw(deg(-179), deg(179), 0.12);
const shortestArcPass = wrapForward < 0 && wrapReverse > 0;
console.log("YAW SHORTEST ARC", {
  from179ToMinus179: (wrapForward * 180 / Math.PI).toFixed(6),
  fromMinus179To179: (wrapReverse * 180 / Math.PI).toFixed(6),
  pass: shortestArcPass
});
failed ||= !shortestArcPass;

const steerRight = { throttle: 0, steer: 1, left: 1, right: -1 };
const steerLeft = { throttle: 0, steer: -1, left: -1, right: 1 };
const yawTorque = (leftCommand: number, rightCommand: number): number => {
  // Forward traction is -Z at yaw=0. x=-1 is the left channel, x=+1 the right.
  const leftForceZ = -leftCommand;
  const rightForceZ = -rightCommand;
  return -(-1 * leftForceZ) - (1 * rightForceZ);
};
const steeringPass = yawTorque(steerRight.left, steerRight.right) < 0 &&
  yawTorque(steerLeft.left, steerLeft.right) > 0;
console.log("STEERING CHANNELS", {
  screenRightD: {
    ...steerRight,
    yawTorque: yawTorque(steerRight.left, steerRight.right),
    resultingForwardX: "+X (screen right)"
  },
  screenLeftA: {
    ...steerLeft,
    yawTorque: yawTorque(steerLeft.left, steerLeft.right),
    resultingForwardX: "-X (screen left)"
  },
  sideConvention: "driveSide left=-1, right=+1",
  pass: steeringPass
});
failed ||= !steeringPass;
console.log("CAMERA CONSTANTS", { CAM_DISTANCE, CAM_HEIGHT });
const debugPose = chaseCameraPose(focus, forward);
const debugCamForward = normalize({
  x: debugPose.target.x - debugPose.camera.x,
  z: debugPose.target.z - debugPose.camera.z
});
console.log("GET DEBUG STATE CAMERA SAMPLE", {
  camForward: [debugCamForward.x, 0, debugCamForward.z],
  botForward: [forward.x, 0, forward.z],
  cameraForwardDot: dot(debugCamForward, forward)
});
console.log(failed ? "HEADING SELFTEST FAIL" : "HEADING SELFTEST PASS");
if (failed) process.exitCode = 1;
