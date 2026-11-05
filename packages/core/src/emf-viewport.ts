/** Choose the physical EMF frame when it encloses its device bounds. */
export function emfViewport(bytes: Uint8Array, physicalFrame = false) {
  if (bytes.length < 108) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const i = (at: number) => view.getInt32(at, true);
  if (view.getUint32(0, true) !== 1 || view.getUint32(40, true) !== 0x464d4520) return;
  const boundsLeft = i(8);
  const boundsTop = i(12);
  let originX = boundsLeft;
  let originY = boundsTop;
  let width = i(16) - boundsLeft + 1;
  let height = i(20) - boundsTop + 1;
  if (width < 1 || height < 1 || width > 20000 || height > 20000) return;
  const deviceX = i(72);
  const deviceY = i(76);
  const mmX = i(80);
  const mmY = i(84);
  const frameLeft = i(24);
  const frameTop = i(28);
  const frameRight = i(32);
  const frameBottom = i(36);
  if (
    deviceX > 0 &&
    deviceY > 0 &&
    mmX > 0 &&
    mmY > 0 &&
    frameRight > frameLeft &&
    frameBottom > frameTop
  ) {
    const frameX = (frameLeft * deviceX) / (mmX * 100);
    const frameY = (frameTop * deviceY) / (mmY * 100);
    const frameW = ((frameRight - frameLeft) * deviceX) / (mmX * 100);
    const frameH = ((frameBottom - frameTop) * deviceY) / (mmY * 100);
    const boundsRight = boundsLeft + width - 1;
    const boundsBottom = boundsTop + height - 1;
    if (
      frameW > 1 &&
      frameH > 1 &&
      frameW <= 20000 &&
      frameH <= 20000 &&
      (physicalFrame || (
        frameX <= boundsLeft + 2 &&
        frameY <= boundsTop + 2 &&
        frameX + frameW >= boundsRight - 2 &&
        frameY + frameH >= boundsBottom - 2
      ))
    ) {
      originX = frameX;
      originY = frameY;
      width = frameW;
      height = frameH;
    }
  }

  return { originX, originY, width, height };
}
