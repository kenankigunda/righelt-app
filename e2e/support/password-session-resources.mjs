// Own only the extra resources in the password/session-revocation journey.
// Creation remains lazy and is awaited in the original product-body positions.
export function createPasswordSessionResourceOwner({page, browser}) {
  let sibling, separate, siblingCreation, contextCreation, disposal;
  let retired = false;
  return {
    newSiblingPage() {
      if (retired || siblingCreation) throw new Error('Password sibling resource is unavailable');
      siblingCreation = Promise.resolve().then(() => page.context().newPage()).then(value => (sibling = value));
      return siblingCreation;
    },
    newIndependentContext() {
      if (retired || contextCreation) throw new Error('Password independent resource is unavailable');
      contextCreation = Promise.resolve().then(() => browser.newContext({ignoreHTTPSErrors: true})).then(value => (separate = value));
      return contextCreation;
    },
    dispose() {
      if (disposal) return disposal;
      retired = true;
      disposal = (async () => {
        // A timed-out body may still have resource creation in flight.
        await Promise.allSettled([siblingCreation, contextCreation].filter(Boolean));
        const closed = await Promise.allSettled([
          Promise.resolve().then(() => sibling?.close()),
          Promise.resolve().then(() => separate?.close()),
        ]);
        const errors = closed.filter(result => result.status === 'rejected').map(result => result.reason);
        if (errors.length) throw new AggregateError(errors, 'Password session resource cleanup failed');
      })();
      return disposal;
    },
  };
}

// One shared setup/teardown slot, separate from the unchanged 60s product body.
// Depending on page/browser makes this finish before their base teardown.
export const passwordSessionResourcesFixture = [async ({page, browser}, use) => {
  const owner = createPasswordSessionResourceOwner({page, browser});
  let bodyError, bodyFailed = false;
  try { await use(owner); }
  catch (error) { bodyFailed = true; bodyError = error; throw error; }
  finally {
    try { await owner.dispose(); }
    catch (error) {
      if (bodyFailed) throw new AggregateError([bodyError, error], 'Password body and resource cleanup failed');
      throw error;
    }
  }
}, {timeout: 5000}];
