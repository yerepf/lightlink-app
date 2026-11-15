export function normalizeAz(value: number): number {
  return ((value % 360) + 360) % 360;
}

/** Clockwise bearing from scene north (−Z), using the horizontal camera direction. */
export function headingFromDirection(x: number, z: number, upX = 0, upZ = 0): number {
  let hx = x;
  let hz = z;
  if (Math.hypot(hx, hz) < 1e-6) {
    hx = upX;
    hz = upZ;
  }
  if (Math.hypot(hx, hz) < 1e-6) return 0;
  return normalizeAz((Math.atan2(hx, -hz) * 180) / Math.PI);
}

export function relativeBearing(bodyAzimuth: number, heading: number): number {
  return normalizeAz(bodyAzimuth - heading);
}

export function trueHeading(sceneHeading: number, convergenceDeg: number): number {
  return normalizeAz(sceneHeading - convergenceDeg);
}

/** 0° points up, positive angles rotate clockwise. */
export function polarPoint(radius: number, bearingDeg: number): { x: number; y: number } {
  const radians = (bearingDeg * Math.PI) / 180;
  return { x: radius * Math.sin(radians), y: -radius * Math.cos(radians) };
}
