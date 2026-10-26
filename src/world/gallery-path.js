// A scroll coordinate selects a point on the same rail in either direction.
export const galleryPortrait = (width, height) => width < 700 || width / height < 0.85;
export const GALLERY_END = 0.90;
export function galleryRail(t, mobile = false) {
  return [-(mobile ? 0.12 : 3.1) * Math.cos(t * Math.PI), 30 + Math.sin(t * 1.1) * 0.45, -t * 9];
}
export function galleryCamera(progress, mobile) {
  const t = Math.max(0, Math.min(1, progress / GALLERY_END)) * 5;
  const [x, y, z] = galleryRail(t, mobile);
  return { cam: [x * 0.6, y, z + (mobile ? 9.8 : 11.8)], look: [x, y, z - 2], fov: mobile ? 53 : 43 };
}
