export const OPPONENT_STORIES = Object.freeze({
  babs: { name: "Babs", difficulty: "Easy", bit: 1, story: "Babs discovered Righelt during a rainstorm and has been demanding rematches ever since. She plays on instinct, celebrates early, and considers every defeat valuable research. Her research collection is impressive.", scenes: [["babs-1-discovery", "Babs discovers the board during a rainstorm."], ["babs-2-rematch", "Babs eagerly invites another match."], ["babs-3-research", "Babs studies her growing collection of game notebooks."]] },
  tau: { name: "Tau", difficulty: "Medium", bit: 2, story: "Tau spent years tending the village gardens, where he learned that everything depends on a good supply line. He brought that lesson to the board. He calls it patience. Babs calls it taking forever.", scenes: [["tau-1-gardens", "Tau waters the village garden."], ["tau-2-connections", "Tau considers a board beside connected irrigation channels."], ["tau-3-patience", "Tau considers his move while Babs waits."]] },
  horus: { name: "Horus", difficulty: "Hard", bit: 4, story: "Horus learned to play in a watchtower, studying matches in the courtyard below. He eventually came down to explain what everyone was doing wrong. Unfortunately, he was usually right.", scenes: [["horus-1-watchtower", "Horus observes the courtyard from a watchtower."], ["horus-2-studying", "Horus studies a match in the courtyard below."], ["horus-3-opinion", "Horus offers his opinion at the game table."]] },
});

export const createStoryCarousel = ({ reducedMotion = false, now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {} } = {}) => {
  let index = 0, paused = reducedMotion, hidden = false, timer = null, remaining = 6000, started = 0;
  const state = () => ({ index, paused, hidden });
  const stop = () => { if (timer !== null) { clearTimer(timer); timer = null; remaining = Math.max(0, remaining - (now() - started)); } };
  const schedule = () => { if (paused || hidden || timer !== null) return; started = now(); timer = setTimer(() => { timer = null; index = (index + 1) % 3; remaining = 6000; onChange(state()); schedule(); }, remaining); };
  schedule();
  return { state, select(next) { if (![0, 1, 2].includes(next)) return; stop(); index = next; paused = true; remaining = 6000; onChange(state()); }, toggle() { if (reducedMotion) return; stop(); paused = !paused; onChange(state()); schedule(); }, visibility(value) { stop(); hidden = value; schedule(); }, destroy: stop };
};

export const shouldShowOpponentIntroduction = (opponent, introduced, readiness) =>
  !OPPONENT_STORIES[opponent] || !(introduced & OPPONENT_STORIES[opponent].bit) || readiness.state !== "ready";

export const cancelAbandonedOpponentTutorial = (previous, next, pending, cancel) => {
  if (previous.name !== "tutorial" || next.name === "tutorial" || !pending) return false;
  cancel();
  pending.reject(new Error("Tutorial closed. Choose your opponent again."));
  return true;
};

// All authority/readiness is rechecked after each asynchronous handoff. The
// production caller supplies the real adapter; an unavailable adapter cannot create.
export const createOpponentStartCoordinator = ({ getAccount, getReadiness, markIntroduced, runTutorial, createGame }) => {
  let generation = 0, pending = false;
  return {
    cancel() { generation++; pending = false; },
    async accept(intent) {
      if (!OPPONENT_STORIES[intent?.opponent] || !["p1", "p2"].includes(intent?.side)) return { state: "invalid" };
      if (pending) return { state: "busy" };
      const account = { ...getAccount() };
      if (!account.canPlay) return { state: "account-required" };
      if (getReadiness(intent.opponent).state !== "ready") return { state: "unavailable" };
      const request = ++generation;
      const current = () => request === generation && getAccount().generation === account.generation && getAccount().canPlay;
      pending = true;
      try {
        await markIntroduced(OPPONENT_STORIES[intent.opponent].bit);
        if (!current()) return { state: "cancelled" };
        if (getAccount().tutorial === "new") { await runTutorial(intent); if (!current()) return { state: "cancelled" }; }
        if (getReadiness(intent.opponent).state !== "ready") return { state: "unavailable" };
        await createGame(intent);
        return { state: "started" };
      } catch (error) { if (!current()) return { state: "cancelled" }; return { state: "error", message: error?.message || "Could not start. Try again." }; }
      finally { if (request === generation) pending = false; }
    },
  };
};

export const createOpponentStoryDialog = ({ createModal, document = globalThis.document, getReadiness, onPlay, onRetry = () => {}, onViewResult = () => {}, onPresentation = () => () => {}, onClose = () => {} }) => {
  let opponent, side, carousel, mode, gameId, busy = false, session = 0, destroyPresentation = () => {};
  const modal = createModal({ document, labelId: "opponent-story-title", onClose: reason => { session++; busy = false; destroyPresentation(); destroyPresentation = () => {}; carousel?.destroy(); carousel = null; onClose(reason); } });
  const refresh = () => {
    if (!modal.element.open) return;
    const readiness = getReadiness(opponent);
    const play = modal.element.querySelector("[data-story-play]");
    if (play) play.disabled = busy || readiness.state !== "ready";
    modal.element.querySelector("[data-story-readiness]").textContent = readiness.message || (readiness.state === "ready" ? "Ready to play" : "Preparing opponent…");
    const retry = modal.element.querySelector("[data-story-retry]");
    if (retry) retry.hidden = readiness.state !== "error";
  };
  const syncImages = ({ index, paused }) => {
    const images = [...modal.element.querySelectorAll("[data-story-image]")];
    const selected = images[index];
    const request = session;
    const reveal = () => {
      if (request !== session || carousel?.state().index !== index) return;
      images.forEach((image, i) => { image.dataset.active = String(i === index); image.setAttribute("aria-hidden", String(i !== index)); });
    };
    if (selected?.dataset.src) {
      selected.addEventListener("load", reveal, { once: true });
      selected.addEventListener("error", reveal, { once: true });
      selected.src = selected.dataset.src; delete selected.dataset.src;
    } else if (selected?.complete) reveal();
    else selected?.addEventListener("load", reveal, { once: true });
    modal.element.querySelectorAll("[data-story-position]").forEach((button, i) => button.setAttribute("aria-pressed", String(i === index)));
    modal.element.querySelector("[data-story-pause]").textContent = paused ? "Resume images" : "Pause images";
  };
  const onVisibility = () => carousel?.visibility(document.hidden);
  document.addEventListener("visibilitychange", onVisibility);
  modal.element.addEventListener("click", async event => {
    if (event.target.closest("[data-story-result]")) { const id = gameId; modal.close(); onViewResult(id); return; }
    const position = event.target.closest("[data-story-position]");
    if (position) carousel?.select(Number(position.dataset.storyPosition));
    if (event.target.closest("[data-story-pause]")) carousel?.toggle();
    const retry = event.target.closest("[data-story-retry]");
    const play = event.target.closest("[data-story-play]");
    if ((!retry && !play) || busy || !modal.element.open) return;
    const request = session;
    const intent = { opponent, side };
    busy = true; refresh();
    try {
      const result = retry ? await onRetry(intent.opponent) : await onPlay(intent);
      if (request !== session || !modal.element.open) return;
      busy = false;
      if (result?.state === "started") modal.close();
      else { refresh(); if (result?.message) modal.element.querySelector("[data-story-readiness]").textContent = result.message; }
    } catch {
      if (request !== session || !modal.element.open) return;
      busy = false; refresh();
      modal.element.querySelector("[data-story-readiness]").textContent = "Could not prepare this game. Try again.";
    }
  });
  return {
    close: modal.close,
    destroy() { document.removeEventListener("visibilitychange", onVisibility); modal.destroy(); },
    isOpen: () => modal.element.open,
    gameId: () => gameId,
    refresh,
    setMatchStatus(text, finished = false) { if (!modal.element.open || mode !== "revisit") return; modal.element.querySelector("[data-story-readiness]").textContent = text; const result = modal.element.querySelector("[data-story-result]"); if (result) result.hidden = !finished; },
    open(id, options = {}) {
      const story = OPPONENT_STORIES[id]; if (!story) return;
      session++; destroyPresentation(); carousel?.destroy(); opponent = id; side = options.side || "p1"; mode = options.mode || "intro"; gameId = options.gameId || null; busy = false;
      destroyPresentation = mode === "intro" ? onPresentation() : () => {};
      const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches || false;
      modal.open(`<div class="story-modal-top"><h2 id="opponent-story-title">${story.name} · ${story.difficulty}</h2><button class="secondary" data-modal-close aria-label="Close opponent story">Close</button></div>
        <div class="story-art">${story.scenes.map(([file, alt], i) => `<img data-story-image data-active="${i === 0}" aria-hidden="${i !== 0}" ${i ? "data-src" : "src"}="/assets/opponents/${file}.webp" width="960" height="640" alt="${alt}" ${i ? 'loading="lazy"' : ''}>`).join("")}</div>
        <div class="story-carousel-controls" aria-label="Story images">${story.scenes.map((_, i) => `<button class="secondary" data-story-position="${i}" aria-label="Show image ${i + 1} of 3" aria-pressed="${i === 0}">${i + 1}</button>`).join("")}<button class="secondary" data-story-pause ${reduced ? 'hidden' : ''}>${reduced ? "Resume images" : "Pause images"}</button></div>
        <p class="opponent-story-copy">${story.story}</p><p role="status" data-story-readiness></p><div class="story-modal-actions">${mode === "intro" ? `<button data-story-play disabled>Play ${story.name}</button><button class="secondary" data-story-retry hidden>Retry</button>` : '<button data-modal-close>Return to game</button><button data-story-result hidden>View result</button>'}</div>`, options.trigger, options.mode === "revisit" ? null : () => document.querySelector(`button[data-opponent="${id}"]`));
      modal.element.dataset.opponent = id;
      modal.element.dataset.actionAffiliation = side === "p2" ? "blue" : "red";
      modal.element.querySelectorAll("img").forEach(img => img.addEventListener("error", () => { img.style.visibility = "hidden"; }));
      carousel = createStoryCarousel({ reducedMotion: reduced, onChange: syncImages });
      carousel.visibility(document.hidden);
      refresh();
    },
  };
};
