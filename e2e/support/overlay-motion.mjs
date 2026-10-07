// Geometry assertions measure the settled overlay, not a transient source-scale frame.
// Keep size animations independently observable for tests that intentionally pause them.
export async function waitForOverlayEntry(dialog) {
  await dialog.evaluate(async element => {
    await Promise.all(element.getAnimations().filter(animation =>
      animation.effect?.getKeyframes().some(frame => typeof frame.transform === 'string' && frame.transform.includes('scale('))
    ).map(animation => animation.finished.catch(() => {})));
  });
}
