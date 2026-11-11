// Register native press ownership once. Destination notices are the only
// additional body-hosted controls admitted outside the app root.
export const mountRenderGestureOwner = ({appEl,window,document,renderGesture}) => {
  const listeners=[];
  const listen=(target,type,callback,options)=>{target.addEventListener(type,callback,options);listeners.push({target,type,callback,options});};
// Compatibility mouse events alias their admitted pointer control, so one
// physical release cannot leave an alias held or release another input.
const pointerPresses = new Map(), mousePresses = new Map();
const isShellGestureTarget = target => appEl.contains(target) || Boolean(target?.closest?.('.destination-load-notice'));
const pressedControl = event => isShellGestureTarget(event.target) ? event.target.closest?.("button, a, [data-action]") : null;
const mouseButton = event => event.button ?? 0;
const pointerKey = event => event.pointerId ?? "legacy-pointer";
const retireRenderPress = owner => {
  if (!owner) return;
  for (const [id, press] of pointerPresses) if (press.owner === owner) pointerPresses.delete(id);
  for (const [button, held] of mousePresses) if (held === owner) mousePresses.delete(button);
  renderGesture.end(owner);
};
listen(window,"pointerdown", event => {
  const control = pressedControl(event);
  if (!control) return;
  const id = pointerKey(event), owner = Symbol("pointer-press");
  retireRenderPress(pointerPresses.get(id)?.owner);
  pointerPresses.set(id, {owner, control, button: mouseButton(event), kind: event.pointerType ?? "mouse", primary: event.isPrimary !== false});
  renderGesture.begin(owner);
}, true);
listen(window,"mousedown", event => {
  const control = pressedControl(event);
  if (!control) return;
  const button = mouseButton(event);
  const pointer = [...pointerPresses.values()].reverse().find(press => press.primary && press.control === control && press.button === button);
  const owner = pointer?.owner ?? mousePresses.get(button) ?? Symbol("mouse-press");
  mousePresses.set(button, owner);
  renderGesture.begin(owner);
}, true);
listen(window,"keydown", event => {
  if (!event.repeat && (event.key === " " || event.key === "Enter") && pressedControl(event)) renderGesture.begin(`key:${event.code || event.key}`);
}, true);
listen(window,"keyup", event => {
  if (event.key === " " || event.key === "Enter") renderGesture.end(`key:${event.code || event.key}`);
}, true);
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  listen(window,type, event => retireRenderPress(pointerPresses.get(pointerKey(event))?.owner), true);
listen(window,"mouseup", event => retireRenderPress(mousePresses.get(mouseButton(event))), true);
listen(window,"touchcancel", () => {
  for (const press of [...pointerPresses.values()]) if (press.kind === "touch") retireRenderPress(press.owner);
}, true);
const cancelRenderPresses = () => { pointerPresses.clear(); mousePresses.clear(); renderGesture.cancelAll(); };
listen(window,"blur", event => { if (event.target === window) cancelRenderPresses(); });
listen(document,"visibilitychange", () => { if (document.visibilityState === "hidden") cancelRenderPresses(); });

  return {destroy(){for(const {target,type,callback,options}of listeners)target.removeEventListener(type,callback,options);listeners.length=0;cancelRenderPresses();}};
};
