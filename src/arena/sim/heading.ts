/** 機体の進行方向（前）。driver も AI も描画も HUD も、必ずこれを使う。 */
export function chassisForward(
  q: { x: number; y: number; z: number; w: number },
  out: { x: number; z: number } = { x: 0, z: 0 }
): { x: number; z: number } {
  const x = -2 * (q.x * q.z + q.w * q.y);
  const z = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const length = Math.max(Math.hypot(x, z), Number.EPSILON);
  out.x = x / length;
  out.z = z / length;
  return out;
}

/** 機体の後方（カメラが立つ側）。= -forward */
export function chassisBack(
  q: { x: number; y: number; z: number; w: number },
  out: { x: number; z: number } = { x: 0, z: 0 }
): { x: number; z: number } {
  chassisForward(q, out);
  out.x = -out.x;
  out.z = -out.z;
  return out;
}
