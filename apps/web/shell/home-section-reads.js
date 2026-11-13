import { HOME_PAGE_LIMIT, SYNC_TIMING } from '../generated/packages/shared-types/src/sync-protocol.js';
export const HOME_SECTION_SERVER_PAGE_SIZE = HOME_PAGE_LIMIT;
export const HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT = 3;
export const HOME_SECTION_VISIBLE_PAGE_SIZE_WIDE = 4;
export const createHomeSectionState = (title) => ({
  title,
  loaded: false,
  error: null,
  page: 0,
  totalPages: 0,
  totalGames: 0,
  gameIds: [],
  serverPage: 0,
  serverTotalPages: 0,
  serverPageGameIds: [],
  serverPageGameIdsByPage: {},
  visiblePageSize: HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT,
  visibleColumnCount: 1,
  slideDirection: "none",
  animationToken: 0,
});
export const getHomeSectionVisibleTotalPages = (totalGames, visiblePageSize) =>
  totalGames <= 0 ? 0 : Math.ceil(totalGames / visiblePageSize);
export const getHomeSectionSafePage = (totalGames, visiblePageSize, page) => {
  const totalPages = getHomeSectionVisibleTotalPages(totalGames, visiblePageSize);
  return totalPages === 0 ? 0 : Math.min(Math.max(0, page), totalPages - 1);
};
export const getHomeSectionVisibleRange = ({ totalGames, visiblePageSize, page }) => {
  const safePage = getHomeSectionSafePage(totalGames, visiblePageSize, page);
  const start = safePage * visiblePageSize;
  const end = Math.min(totalGames, start + visiblePageSize);
  return { safePage, start, end };
};
export const getHomeSectionRequiredServerPages = ({ totalGames, visiblePageSize, page }) => {
  if (totalGames <= 0) {
    return [];
  }
  const { start, end } = getHomeSectionVisibleRange({ totalGames, visiblePageSize, page });
  if (end <= start) {
    return [];
  }
  const firstServerPage = Math.floor(start / HOME_SECTION_SERVER_PAGE_SIZE);
  const lastServerPage = Math.floor((end - 1) / HOME_SECTION_SERVER_PAGE_SIZE);
  return Array.from({ length: lastServerPage - firstServerPage + 1 }, (_, index) => firstServerPage + index);
};
export const getHomeSectionServerPageGameIds = (section, serverPage) =>
  Array.isArray(section.serverPageGameIdsByPage?.[serverPage]) ? section.serverPageGameIdsByPage[serverPage] : [];
export const hasHomeSectionServerPages = (section, serverPages) =>
  serverPages.every((serverPage) => Array.isArray(section.serverPageGameIdsByPage?.[serverPage]));
export const getHomeSectionVisibleGameIdsFromCache = (section, { page = section.page, visiblePageSize = section.visiblePageSize } = {}) => {
  const { totalGames } = section;
  if (totalGames <= 0) {
    return [];
  }
  const requiredServerPages = getHomeSectionRequiredServerPages({ totalGames, visiblePageSize, page });
  if (!hasHomeSectionServerPages(section, requiredServerPages)) {
    return null;
  }
  const { start, end } = getHomeSectionVisibleRange({ totalGames, visiblePageSize, page });
  const visibleCount = Math.max(0, end - start);
  if (visibleCount === 0) {
    return [];
  }
  const serverStart = requiredServerPages[0] * HOME_SECTION_SERVER_PAGE_SIZE;
  const flattened = requiredServerPages.flatMap((serverPage) => getHomeSectionServerPageGameIds(section, serverPage));
  const offset = Math.max(0, start - serverStart);
  return flattened.slice(offset, offset + visibleCount);
};
export const getHomeSectionCachedGameIndex = (section, gameId) => {
  if (!gameId) {
    return null;
  }
  const pageEntries = Object.entries(section.serverPageGameIdsByPage ?? {}).sort(([left], [right]) => Number(left) - Number(right));
  for (const [pageKey, ids] of pageEntries) {
    const offset = Array.isArray(ids) ? ids.indexOf(gameId) : -1;
    if (offset >= 0) {
      return (Number(pageKey) * HOME_SECTION_SERVER_PAGE_SIZE) + offset;
    }
  }
  return null;
};
export const sameRouteRead = (read, current) => read.generation === current.generation && read.routeKey === current.routeKey
  && read.owner === current.owner && read.epoch === current.epoch
  && (read.route.name !== "home" || read.inputs === current.inputs);
// Compare only input changes through the same authority primitive. Home visit
// is explicit because returning to an identical URL must not revive old work.
export const sameHomeReadScope = (read, current) => read.route.name === "home" && current.route.name === "home"
  && read.homeVisit === current.homeVisit
  && sameRouteRead({ ...read, inputs: current.inputs }, current);
// Layout can change during the owner's own render without changing a player's
// page choice. Compare those choices explicitly; never adopt a foreign visit.
export const homeContinuationLayoutCompatible = (previous, current) => {
  if (previous?.route?.name!=="home" || current?.route?.name!=="home" || typeof previous.hash!=="string" || !Number.isSafeInteger(previous.homeVisit) || typeof previous.homeDebug!=="boolean" || !previous.owner || !sameHomeReadScope(previous,current) || previous.hash !== current.hash || previous.homeDebug !== current.homeDebug) return false;
  const choices = read => {
    let value;try { value=JSON.parse(read.inputs); } catch { return null; }
    if (!Array.isArray(value) || value.length!==3 || value[0]!==read.homeVisit || value[1]!==read.homeDebug || !Array.isArray(value[2]) || !value[2].length) return null;
    const keys=new Set(),pages=[];
    for (const tuple of value[2]) {
      if (!Array.isArray(tuple) || tuple.length!==4 || typeof tuple[0]!=="string" || !tuple[0] || keys.has(tuple[0]) || !Number.isSafeInteger(tuple[1]) || tuple[1]<0 || !Number.isSafeInteger(tuple[2]) || tuple[2]<=0 || !Number.isSafeInteger(tuple[3]) || tuple[3]<=0) return null;
      keys.add(tuple[0]);pages.push([tuple[0],tuple[1]]);
    }
    return JSON.stringify(pages);
  };
  const before=choices(previous),after=choices(current);
  return before!==null && before===after;
};
export const resultForHomeContinuation = record => {
  if (record?.outcome!=="fulfilled" || record.result?.healthySettled!==true) throw record?.error ?? record?.result?.error ?? Object.assign(new Error("Home read did not settle completely"),{code:"home_read_incomplete"});
  return record.result;
};
const transferredContinuation = (pending, read) => ({...pending,...read,intent:pending.intent,running:false,recoveryEpisode:pending.recoveryEpisode});
export const bindHomeContinuationAfterRender = (pending,currentPending,read) => {
  if (!pending || pending!==currentPending) return null;
  if (sameRouteRead(pending,read)) return pending;
  return homeContinuationLayoutCompatible(pending,read) ? transferredContinuation(pending,read) : null;
};
// A completed healthy read proves the same data window after a columns-only
// render change. A different visible page size still needs its responsive read.
export const bindHomeContinuationAfterSettlement = ({pending,currentPending,read,settledRead,result,job,replacement}) => {
  if (!pending || pending!==currentPending || job || replacement || result?.healthySettled!==true || !settledRead || !sameRouteRead(pending,settledRead) || !homeContinuationLayoutCompatible(pending,settledRead) || !homeContinuationLayoutCompatible(pending,read)) return null;
  const dataWindow=value=>JSON.parse(value.inputs)[2].map(([key,page,size])=>[key,page,size]);
  return {continuation:transferredContinuation(pending,read),requiresRead:JSON.stringify(dataWindow(pending))!==JSON.stringify(dataWindow(read))};
};
export const createHomeReadReplacement = ({job,activeJob,read,pending,previous,currentReplacement,recovery}) => {
  const owned = previous ? previous===currentReplacement && previous.job===job : job===activeJob;
  const from=previous?.read ?? job?.read;
  const replacement={job,read,fulfilledByNewer:false};
  if (!owned || !from || !pending || previous && previous.continuation!==pending || !sameRouteRead(pending,from)) return replacement;
  if (homeContinuationLayoutCompatible(from,read)) {
    replacement.continuation=transferredContinuation(pending,read);
    if (recovery?.read && sameRouteRead(recovery.read,from)) replacement.continuation.recoveryEpisode=true;
  } else replacement.retiredContinuation=pending;
  return replacement;
};

export const homeReadMayRetry = error => {
  const code = error?.code ?? "";
  if (/auth|credential|session|protocol|schema|storage|upgrade|contract|invalid_home_page/i.test(code)) return false;
  return code === "request_timeout" || !code && error?.diagnosticEvidence?.stage === "request_failed"
    || [500, 502, 503, 504].includes(error?.status);
};

export const homeSectionShowsSkeleton = (section,pending) => (pending || !section.loaded) && section.gameIds.length === 0;
export const homeSectionIsEmpty = (section,games) => games.length === 0 || section.totalGames === 0;

export const homeSectionVisiblePageSize = columnCount => columnCount === 2
  ? HOME_SECTION_VISIBLE_PAGE_SIZE_WIDE : HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT;

/** Home list transactions and presentation reads share the shell's live state.
 * Generic route/account authority stays with capture/assert callbacks. */
export function createHomeSectionReads({state, getHomeSection, setHomeSection, getHomeSectionVisiblePageSize, getHomeSectionColumnCount, getVisibleHomeSectionKeys, captureRouteRead, assertCurrentRouteRead, routeReadIsCurrent, render, syncLiveChannels, startRouteSync, isHomeSectionPending, scrollHomeSectionToTop, captureHomeFocus, restoreHomeReadingPosition, restoreHomeFocus,
  pendingHomeSectionKeys, gameSound, storyDialog, appEl, document, window, resumeAccountContinuation,
  syncAnnouncement, saveHomeVisit, setTimeout=(...args)=>globalThis.setTimeout(...args), clearTimeout=(...args)=>globalThis.clearTimeout(...args),
}) {
  const jobResults=new WeakMap(),continuationSettlements=new WeakMap();
  const takeContinuationSettlement = (pending,token) => {
    const owned=continuationSettlements.get(token);continuationSettlements.delete(token);
    if (!owned || owned.pending!==pending || state.accountContinuation!==pending || !sameRouteRead(pending,owned.read) || !routeReadIsCurrent(owned.read)) return null;
    return owned.record;
  };
  const loadHomeSectionServerPage = async (
    sectionKey,
    serverPage,
    {
      visiblePageSize = getHomeSectionVisiblePageSize(sectionKey),
      visibleColumnCount = getHomeSectionColumnCount(sectionKey),
      adapter = null,
      read: ownedRead = null,
    } = {},
  ) => {
    const read = adapter?.read ?? ownedRead ?? captureRouteRead();
    const readPage = () => (adapter?.readPage ?? (options => read.owner.loadGamesPage(options)))({
      section: sectionKey, page: serverPage, pageSize: HOME_SECTION_SERVER_PAGE_SIZE, debug: read.homeDebug === true,
    });
    let response = await readPage();
    if (adapter) adapter.assertCurrent(); else assertCurrentRouteRead(read);
    if(response.homeListChanged){
      response = await readPage();
      if (adapter) adapter.assertCurrent(); else assertCurrentRouteRead(read);
      if(response.homeListChanged)throw Object.assign(new Error('Your game list changed. Try again.'),{code:'home_list_changed'});
    }
    const previous = (adapter?.getSection ?? getHomeSection)(sectionKey);
    const normalizedServerPage = typeof response.page === "number" ? response.page : 0;
    const serverPageGameIds = Array.isArray(response.games) ? response.games.map((game) => game.id) : [];
    const nextSection = {
      ...previous,
      loaded:true,error:null,refreshUnsettled:false,homeListRevision:response.homeListRevision??null,
      totalGames: typeof response.totalGames === "number" ? response.totalGames : 0,
      serverPage: normalizedServerPage,
      serverTotalPages: typeof response.totalPages === "number" ? response.totalPages : 0,
      serverPageGameIds,
      serverPageGameIdsByPage: {
        ...(previous.homeListRevision===response.homeListRevision?previous.serverPageGameIdsByPage:{}),
        [normalizedServerPage]: serverPageGameIds,
      },
    };
    (adapter?.setSection ?? setHomeSection)(sectionKey, nextSection);
    return nextSection;
  };

  const loadHomeSectionPage = async (
    sectionKey,
    {
      page = getHomeSection(sectionKey).page,
      direction = "none",
      visiblePageSize = getHomeSectionVisiblePageSize(sectionKey),
      visibleColumnCount = getHomeSectionColumnCount(sectionKey),
      adapter = null,
      read: ownedRead = null,
    } = {},
  ) => {
    const read = adapter?.read ?? ownedRead ?? captureRouteRead();
    const previous = (adapter?.getSection ?? getHomeSection)(sectionKey);
    let nextSection = {
      ...previous,
      visiblePageSize,
      visibleColumnCount,
    };
    if (previous.homeListRevision !== (read.owner.getHomeListRevision?.() ?? previous.homeListRevision)) {
      nextSection.serverPageGameIdsByPage = {};
    }
    const initialServerPage = Math.floor((Math.max(0, page) * visiblePageSize) / HOME_SECTION_SERVER_PAGE_SIZE);
    const shouldPrimeCache = Object.keys(nextSection.serverPageGameIdsByPage ?? {}).length === 0;
    if (shouldPrimeCache) {
      nextSection = await loadHomeSectionServerPage(sectionKey, initialServerPage, { visiblePageSize, visibleColumnCount, adapter, read });
    }
    // Reads may overlap a newer completed page or responsive-layout change.
    // Merge server data into the current cache, then keep the latest view intent.
    const currentIntent = () => {
      const current = (adapter?.getSection ?? getHomeSection)(sectionKey);
      const superseded = current.page !== previous.page || current.visiblePageSize !== previous.visiblePageSize || current.visibleColumnCount !== previous.visibleColumnCount;
      return superseded ? {page:current.page,visiblePageSize:current.visiblePageSize,visibleColumnCount:current.visibleColumnCount} : {page,visiblePageSize,visibleColumnCount};
    };
    let intent;
    // A later server page can reveal membership evidence that invalidates an
    // earlier cached page. Settle that bounded cache change before publishing
    // the visible slice; an incomplete slice must never hide the whole section.
    for (let pass = 0; pass < 2; pass++) {
      intent = currentIntent();
      const required = getHomeSectionRequiredServerPages({totalGames:nextSection.totalGames,...intent});
      for (const serverPage of required) {
        if (!hasHomeSectionServerPages(nextSection, [serverPage])) {
          nextSection = await loadHomeSectionServerPage(sectionKey, serverPage, {...intent,adapter,read});
        }
      }
      if (hasHomeSectionServerPages(nextSection, required)) break;
    }
    intent = currentIntent();
    if (!hasHomeSectionServerPages(nextSection, getHomeSectionRequiredServerPages({totalGames:nextSection.totalGames,...intent}))) {
      throw Object.assign(new Error('Your game list changed. Try again.'),{code:'home_list_changed'});
    }
    ({page,visiblePageSize,visibleColumnCount} = intent);
    const normalizedPage = getHomeSectionSafePage(nextSection.totalGames, visiblePageSize, page);
    const normalizedTotalPages = getHomeSectionVisibleTotalPages(nextSection.totalGames, visiblePageSize);
    const visibleGameIds = getHomeSectionVisibleGameIdsFromCache(nextSection, {
      page: normalizedPage,
      visiblePageSize,
    }) ?? [];
    const nextDirection = normalizedTotalPages > 1 && normalizedPage !== previous.page ? direction : "none";
    if(adapter)adapter.assertCurrent();else assertCurrentRouteRead(read);
    const publishedSection = {
      ...nextSection,
      error: null,
      visiblePageSize,
      visibleColumnCount,
      page: normalizedPage,
      totalPages: normalizedTotalPages,
      gameIds: visibleGameIds,
      slideDirection: nextDirection,
      animationToken: nextDirection === "none" ? previous.animationToken : previous.animationToken + 1,
    };
    delete publishedSection.pendingVisitPage;
    (adapter?.setSection ?? setHomeSection)(sectionKey,publishedSection);
    // Advance only this successfully published read before any async work.
    // Its page change is ours; unrelated input changes still fail the guard above.
    if(!adapter)read.inputs = JSON.stringify([state.homeReadVisit, read.homeDebug, getVisibleHomeSectionKeys({ debug: read.homeDebug }).map(key => [key, getHomeSection(key).page, getHomeSectionVisiblePageSize(key), getHomeSectionColumnCount(key)])]);
    if(!adapter && nextDirection !== "none")gameSound.play(nextDirection === "prev" ? "page-back" : "page");
  };

  const syncResponsiveHomeSectionPageSizes = async () => {
    const visibleSectionKeys = getVisibleHomeSectionKeys();
    let updated = false;
    for (const sectionKey of visibleSectionKeys) {
      const section = getHomeSection(sectionKey);
      const nextVisibleColumnCount = getHomeSectionColumnCount(sectionKey);
      const nextVisiblePageSize = getHomeSectionVisiblePageSize(sectionKey);
      if (section.visiblePageSize === nextVisiblePageSize && section.visibleColumnCount === nextVisibleColumnCount) {
        continue;
      }
      // Resizing must not turn an unrelated manual recovery into a new request.
      // It must also not let that failure prevent healthy sections from rendering.
      if(section.error){
        setHomeSection(sectionKey,{...section,visiblePageSize:nextVisiblePageSize,visibleColumnCount:nextVisibleColumnCount});
        updated=true;
        continue;
      }
      const anchorGameId = section.gameIds[0] ?? null;
      const anchorIndex = getHomeSectionCachedGameIndex(section, anchorGameId);
      const nextPage = anchorIndex === null ? section.page : Math.floor(anchorIndex / nextVisiblePageSize);
      if (section.visiblePageSize === nextVisiblePageSize) {
        const visibleGameIds = getHomeSectionVisibleGameIdsFromCache(section, {
          page: nextPage,
          visiblePageSize: nextVisiblePageSize,
        }) ?? section.gameIds;
        setHomeSection(sectionKey, {
          ...section,
          page: nextPage,
          totalPages: getHomeSectionVisibleTotalPages(section.totalGames, nextVisiblePageSize),
          gameIds: visibleGameIds,
          visibleColumnCount: nextVisibleColumnCount,
        });
      } else {
        await loadHomeSectionPage(sectionKey, {
          page: nextPage,
          direction: "none",
          visiblePageSize: nextVisiblePageSize,
          visibleColumnCount: nextVisibleColumnCount,
        });
      }
      updated = true;
    }
    return updated;
  };

  const syncHomeSections = async (read = captureRouteRead(), isActive = () => true, {onlyStale=false} = {}) => {
    if (state.pendingResponsiveHomeRead) {
      // Starting a newer full read fulfills the old resize obligation, regardless
      // of its eventual success or failure. Retain the marker until RAF consumes it.
      state.pendingResponsiveHomeRead = sameHomeReadScope(state.pendingResponsiveHomeRead.read, read)
        ? { ...state.pendingResponsiveHomeRead, read, fulfilledByNewer: true } : null;
    }
    state.homeReadJob?.retire();
    let retired = false, batch = null, delayTimer = null, rejectDelay = null;
    let settleRead, outcome = "retired";
    const resultRecord={read,outcome:null,result:null,error:null};
    const settled = new Promise(resolve => { settleRead = resolve; });
    const job = {
      read, settled,
      retire() {
        try {
          retired = true; batch?.retire();
          clearTimeout(delayTimer); delayTimer = null;
          rejectDelay?.(Object.assign(new Error("session_changed"), { code: "session_changed" })); rejectDelay = null;
          if (state.homeReadJob === job) state.homeReadJob = null;
        } finally { if (resultRecord.outcome===null) resultRecord.outcome=outcome;settleRead(outcome); }
      },
    };
    jobResults.set(job,resultRecord);
    state.homeReadJob = job;
    if (state.pendingResponsiveHomeRead?.fulfilledByNewer && state.pendingResponsiveHomeRead.read===read) state.pendingResponsiveHomeRead.fulfilledByJob=job;
    const assertCurrent = () => {
      assertCurrentRouteRead(read, () => !retired && state.homeReadJob === job && isActive());
    };
    let recovered = Boolean(state.homeReadRecovery);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        assertCurrent();
        const continuationAtStart = state.accountContinuation && sameRouteRead(state.accountContinuation, read) ? state.accountContinuation : null;
        const allowPartial = attempt === 1 && !continuationAtStart;
        batch = read.owner.createHomeRead({
          isCurrent: () => !retired && state.homeReadJob === job && isActive() && routeReadIsCurrent(read),
          retainSectionFailure: error => allowPartial && !(state.accountContinuation && sameRouteRead(state.accountContinuation, read)) && homeReadMayRetry(error),
        });
        const attemptBatch = batch;
        const assertAttemptCurrent = () => {
          assertCurrent();
          if (batch !== attemptBatch) throw Object.assign(new Error("session_changed"), { code: "session_changed" });
        };
        // Everything page filling can mutate, including caches/counts and hidden
        // sections, lives in this attempt's map until the whole read is ready.
        const sectionMap = structuredClone(state.homeSections);
        const adapter = { read, readPage: options => attemptBatch.readPage(options), assertCurrent: assertAttemptCurrent,
          getSection: key => sectionMap[key] ?? createHomeSectionState(key),
          setSection: (key, value) => { sectionMap[key] = value; } };
        const visibleSectionKeys = getVisibleHomeSectionKeys({ debug: read.homeDebug });
        const preservedErrors = new Set(onlyStale ? visibleSectionKeys.filter(key => getHomeSection(key).error) : []);
        const readKeys = visibleSectionKeys.filter(key => !preservedErrors.has(key) && (!onlyStale || getHomeSection(key).homeListRevision !== read.owner.getHomeListRevision?.()));
        const loadSection = async sectionKey => {
            const section = adapter.getSection(sectionKey);
            adapter.setSection(sectionKey, { ...section, serverPageGameIdsByPage: {},
              visiblePageSize: getHomeSectionVisiblePageSize(sectionKey), visibleColumnCount: getHomeSectionColumnCount(sectionKey), slideDirection: "none" });
            await loadHomeSectionPage(sectionKey, { page: section.page, direction: "none", adapter });
        };
        try {
          const settled = await Promise.allSettled(readKeys.map(loadSection));
          assertAttemptCurrent();
          const errors = new Map(settled.flatMap((result,index) => result.status === "rejected" ? [[readKeys[index],result.reason]] : []));
          const earlyFailure = [...errors.values()].find(error => error?.code !== 'home_list_changed');
          if(earlyFailure && (!allowPartial || !homeReadMayRetry(earlyFailure)))throw earlyFailure;
          const revision = attemptBatch.getHomeListRevision?.();
          const staleKeys = revision === undefined ? [] : readKeys.filter(key => errors.get(key)?.code === "home_list_changed" || !errors.has(key) && sectionMap[key].homeListRevision !== revision);
          // One bounded repair after all initial sections settle; no publication
          // of cards, counts or focus while parallel membership evidence changes.
          const repaired = await Promise.allSettled(staleKeys.map(loadSection));
          repaired.forEach((result,index) => {if(result.status === "rejected")errors.set(staleKeys[index],result.reason);else errors.delete(staleKeys[index]);});
          assertAttemptCurrent();
          const finalRevision = attemptBatch.getHomeListRevision?.();
          if(finalRevision !== undefined)for(const key of readKeys)if(!errors.has(key) && sectionMap[key].homeListRevision !== finalRevision)
            errors.set(key,Object.assign(new Error('Your game list changed. Try again.'),{code:'home_list_changed'}));
          const failures = [...errors].map(([key,error]) => ({key,error}));
          const continuationNow = state.accountContinuation && sameRouteRead(state.accountContinuation, read) ? state.accountContinuation : null;
          if (failures.length && (!allowPartial || continuationNow || failures.length === readKeys.length || failures.some(({error}) => !homeReadMayRetry(error)))) {
            throw failures.find(({error}) => !homeReadMayRetry(error))?.error ?? failures[0].error;
          }
          for (const {key} of failures) {
            const currentSection=getHomeSection(key);
            sectionMap[key] = {...currentSection,loaded:true,error:true,refreshUnsettled:false,
              ...(currentSection.pendingVisitPage===currentSection.page ? {gameIds:[]} : {})};
          }
          for (const sectionKey of ["my", "completed", "other", "smoke"].filter(key => !visibleSectionKeys.includes(key))) {
            adapter.setSection(sectionKey, { ...adapter.getSection(sectionKey), page: 0, totalPages: 0, totalGames: 0, gameIds: [],
              serverPage: 0, serverTotalPages: 0, serverPageGameIds: [], serverPageGameIdsByPage: {},
              visiblePageSize: HOME_SECTION_VISIBLE_PAGE_SIZE_COMPACT, visibleColumnCount: 1, slideDirection: "none" });
          }
          assertAttemptCurrent();
          const continuation = state.accountContinuation && sameRouteRead(state.accountContinuation, read) ? state.accountContinuation : null;
          // These adjacent synchronous publications have no await/emit gap.
          attemptBatch.commit();
          const publishedRevision = read.owner.getHomeListRevision?.() ?? null;
          for(const key of readKeys)if(!errors.has(key))sectionMap[key].homeListRevision=publishedRevision;
          // Sections outside this transaction may have settled a manual Retry
          // while our healthy read was pending. Keep their current publication.
          for (const key of visibleSectionKeys) if (!readKeys.includes(key)) sectionMap[key] = getHomeSection(key);
          state.homeSections = sectionMap;
          state.homeSectionsHydrated = true;
          // An unread healthy section can predate membership learned by our batch.
          // Keep the existing trailing-refresh obligation instead of stamping it.
          state.lastHomeBatchRevision = visibleSectionKeys.every(key => sectionMap[key].error || sectionMap[key].homeListRevision === publishedRevision)
            ? publishedRevision : null;
          // A successful count refresh can clamp our own page. Advance only this
          // proven read's input snapshot, never accept a concurrent user change.
          read.inputs = JSON.stringify([state.homeReadVisit, read.homeDebug, getVisibleHomeSectionKeys({ debug: read.homeDebug }).map(key => [key, getHomeSection(key).page, getHomeSectionVisiblePageSize(key), getHomeSectionColumnCount(key)])]);
          if (continuation) continuation.inputs = read.inputs;
          state.homeReadRecovery = null;
          outcome = "fulfilled";
          resultRecord.result={ recovered, healthySettled: failures.length === 0, error:failures[0]?.error ?? null };
          return resultRecord.result;
        } catch (error) {
          attemptBatch.retire();
          assertCurrent();
          recovered = true;
          state.homeReadRecovery ??= { read, error: null };
          storyDialog.refresh();
          if (state.accountContinuation && sameRouteRead(state.accountContinuation, read)) state.accountContinuation.recoveryEpisode = true;
          if (attempt === 0 && homeReadMayRetry(error)) {
            // Keep the same Home loading keys and recovery episode across retry;
            // the existing Home owner retains its 200ms cue / 5s context clock.
            render({ animatePanels: false, includeBoard: false });
            await new Promise((resolve, reject) => {
              rejectDelay = reject;
              delayTimer = setTimeout(() => { delayTimer = null; rejectDelay = null; resolve(); }, SYNC_TIMING.retryDelaysMs[0]);
            });
            assertCurrent();
            continue;
          }
          state.homeReadRecovery.error = error;
          throw error;
        }
      }
    } catch (error) {
      outcome = "failed";resultRecord.error=error;
      throw error;
    } finally { job.retire(); }
  };

  const scheduleHomeListRefresh = ({onlyStale=true} = {}) => {
    if (state.currentRoute.name !== 'home')return;
    if(state.pendingHomeRefresh)return state.pendingHomeRefresh;
    if(state.lastHomeBatchRevision === (state.transport.getHomeListRevision?.() ?? null))return;
    const read = captureRouteRead();
    state.homeFocusToRestore ??= captureHomeFocus(appEl,document);
    let succeeded=false;
    const work = Promise.resolve().then(async () => {
      assertCurrentRouteRead(read);
      const initialJob = state.homeReadJob;
      if (initialJob) {
        // A background refresh must not retire a legitimate full read during its
        // retry delay. Only that read's successful settlement can grant this work.
        const outcome = await initialJob.settled;
        assertCurrentRouteRead(read);
        if (outcome !== "fulfilled" || state.homeReadJob) return;
        // The initial read may already have published the current revision,
        // including a partial result that retains its manual section recovery.
        if (state.lastHomeBatchRevision === (read.owner.getHomeListRevision?.() ?? null)) return;
      }
      const result=await syncHomeSections(read,()=>true,{onlyStale});
      assertCurrentRouteRead(read);
      succeeded=result?.healthySettled ?? getVisibleHomeSectionKeys().every(key=>!getHomeSection(key).error);
    }).catch(error => { if(routeReadIsCurrent(read)) window.__righeltLastError = error.message; });
    state.pendingHomeRefresh = work;
    void work.finally(() => {
      if(state.pendingHomeRefresh !== work)return;
      state.pendingHomeRefresh=null;
      if(routeReadIsCurrent(read))render({animatePanels:false,includeBoard:false});
      if(succeeded && routeReadIsCurrent(read))scheduleHomeListRefresh({onlyStale});
    });
    return work;
  };

  // A manual page, Retry or responsive read can learn off-page membership changes.
  // Settle the existing owner first, then repair healthy stale sections once.
  const stabilizeAfterHomeRead = async read => {
    assertCurrentRouteRead(read);
    if(state.pendingHomeRefresh)await state.pendingHomeRefresh;
    assertCurrentRouteRead(read);
    await scheduleHomeListRefresh({onlyStale:true});
    assertCurrentRouteRead(read);
  };


  const restoreHomeReadingIntent = ({patched}) => {
    if(state.currentRoute.name !== 'home' || !state.homeFocusToRestore)return;
    const settled=state.routeHydrated && !state.pendingHomeRefresh && getVisibleHomeSectionKeys().every(key=>!isHomeSectionPending(key));
    if(!patched && !settled)return;
    restoreHomeReadingPosition(appEl,state.homeFocusToRestore,document);
    if(settled) {
      if(restoreHomeFocus(appEl,state.homeFocusToRestore))syncAnnouncement.textContent='Your game lists were updated.';
      state.homeFocusToRestore=null;
    }
  };

  const refreshResponsive = async () => {
        const replacement = state.pendingResponsiveHomeRead;
        if (replacement) {
          const current = routeReadIsCurrent(replacement.read);
          // Validation can itself discover a newer input retirement. Consume only
          // this snapshot; do not erase its freshly queued replacement.
          if (state.pendingResponsiveHomeRead === replacement) state.pendingResponsiveHomeRead = null;
          if (!current) return;
          if (replacement.continuation && state.accountContinuation===replacement.continuation && resumeAccountContinuation) {
            const pending=replacement.continuation;
            const job=replacement.fulfilledByJob ?? state.homeReadJob;
            if (job) {
              const record=jobResults.get(job);
              if (!record || record.read!==replacement.read) return;
              await job.settled;
              if (state.accountContinuation!==pending || !sameRouteRead(pending,record.read)) return;
              const latest=captureRouteRead();
              if (state.accountContinuation!==pending) return;
              if (!sameRouteRead(record.read,latest)) {
                if (homeContinuationLayoutCompatible(record.read,latest)) {
                  const next=transferredContinuation(pending,latest);
                  if (record.result?.recovered) next.recoveryEpisode=true;
                  state.accountContinuation=next;
                  state.pendingResponsiveHomeRead={job,read:latest,continuation:next,fulfilledByNewer:false};
                  queueResponsiveHomeSectionPageSizes();
                } else state.accountContinuation=null;
                return;
              }
              const token={};continuationSettlements.set(token,{pending,read:record.read,record});
              await resumeAccountContinuation(pending,token);
            } else await resumeAccountContinuation(pending);
            return;
          }
          // Fulfillment survives completion or terminal failure before this frame.
          // Do not start a third batch or fall through to standalone pagination.
          if (replacement.fulfilledByNewer || state.homeReadJob) return;
          startRouteSync({ renderStart: false });
          return;
        }
        if (state.currentRoute.name !== "home") {
          return;
        }
        const read=captureRouteRead();
        const didUpdate = await syncResponsiveHomeSectionPageSizes();
        if (!didUpdate) {
          return;
        }
        await stabilizeAfterHomeRead(read);
        syncLiveChannels();
        render({ animatePanels: false, includeBoard: false });

  };
  const queueResponsiveHomeSectionPageSizes = () => {
    window.cancelAnimationFrame(state.homeSectionResizeFrame);
    state.homeSectionResizeFrame = window.requestAnimationFrame(() => {
      state.homeSectionResizeFrame = 0;
      return refreshResponsive();
    });
  };

  const scheduleResponsiveHomeSectionPageSizes = () => {
    captureRouteRead(); // Input retirement queues its own exact replacement.
    queueResponsiveHomeSectionPageSizes();
  };


  const retry = async sectionKey => {
      if (!getVisibleHomeSectionKeys().includes(sectionKey) || isHomeSectionPending(sectionKey)) return;
      const read=captureRouteRead();
      state.homeFocusToRestore ??= captureHomeFocus(appEl,document);
      pendingHomeSectionKeys.add(sectionKey);
      render({animatePanels:false,includeBoard:false});
      try { await loadHomeSectionPage(sectionKey,{read});await stabilizeAfterHomeRead(read); }
      catch (error) { if(routeReadIsCurrent(read))setHomeSection(sectionKey,{...getHomeSection(sectionKey),error:true}); }
      finally { if(routeReadIsCurrent(read)){pendingHomeSectionKeys.delete(sectionKey);render({animatePanels:false,includeBoard:false});} }

  };
  const page = async (sectionKey,direction) => {
      const section = getHomeSection(sectionKey);
      if (!sectionKey || section.totalPages <= 1 || isHomeSectionPending(sectionKey)) {
        return;
      }
      const delta = direction === "prev" ? -1 : 1;
      const nextPage = (section.page + delta + section.totalPages) % section.totalPages;
      const read=captureRouteRead();
      pendingHomeSectionKeys.add(sectionKey);
      render({ animatePanels: false, includeBoard: false });
      try {
        await loadHomeSectionPage(sectionKey, {
          page: nextPage,
          read,
          direction: direction === "prev" ? "prev" : "next",
        });
        await stabilizeAfterHomeRead(read);
        syncLiveChannels();
      } catch (error) {
        window.__righeltLastError = error instanceof Error ? error.message : String(error);
      } finally {
        if(!routeReadIsCurrent(read))return;
        pendingHomeSectionKeys.delete(sectionKey);
        render({ animatePanels: false, includeBoard: false });
        window.requestAnimationFrame(() => {
          scrollHomeSectionToTop(sectionKey);
          saveHomeVisit?.();
        });
      }

  };

  // A saved visit requests acknowledged pages, not a new authority or cache.
  const advanceVisit = () => {
    state.homeReadVisit++;
    state.homeReadJob?.retire();
    // A different browser visit owns its own reading/focus restoration.
    state.homeFocusToRestore=null;
    state.pendingHomeRefresh=null;
  };
  const applyVisitPages = (pages = {}) => {
    const entries = Object.entries(pages).filter(([key]) => state.homeSections[key]);
    if (entries.some(([key,page]) => state.homeSections[key].page !== page)) state.homeSectionsHydrated = false;
    for (const [key,page] of entries) {
      const section=state.homeSections[key];
      state.homeSections[key] = {...section,page,...(section.page!==page?{pendingVisitPage:page}:{})};
    }
  };

  const leaveHome = (previous,next) => {
    if(previous.name !== 'home' || next.name === 'home') return;
    pendingHomeSectionKeys.clear();
    state.pendingHomeRefresh = null;
    state.homeFocusToRestore = null;
  };
  return {
    advanceVisit, applyVisitPages, loadServerPage:loadHomeSectionServerPage, loadPage:loadHomeSectionPage,
    syncSections:syncHomeSections, syncResponsive:syncResponsiveHomeSectionPageSizes,
    scheduleRefresh:scheduleHomeListRefresh, stabilize:stabilizeAfterHomeRead,
    restoreReading:restoreHomeReadingIntent, queueResponsive:queueResponsiveHomeSectionPageSizes,
    scheduleResponsive:scheduleResponsiveHomeSectionPageSizes,
    next:key=>page(key,'next'), previous:key=>page(key,'prev'), retry, leaveHome, refreshResponsive,takeContinuationSettlement,
  };
}

export const scrollHomeSectionIntoView = ({getShellLayoutMode,appEl,HTMLElement,prefersReducedMotion},sectionKey) => {
  if (getShellLayoutMode() !== "narrow" || !(appEl instanceof HTMLElement)) {
    return;
  }
  const sectionEl = appEl.querySelector(`[data-home-section-root="${sectionKey}"]`);
  if (!(sectionEl instanceof HTMLElement)) {
    return;
  }
  sectionEl.scrollIntoView({
    behavior: prefersReducedMotion() ? "instant" : "smooth",
    block: "start",
  });
};


// A restored page remains covered until its current acknowledged batch publishes.
export const homeVisitSectionShowsSkeleton = (section,pending,{homeReady,routeReady}) =>
  homeSectionShowsSkeleton(section,pending) || (!homeReady && !routeReady);
