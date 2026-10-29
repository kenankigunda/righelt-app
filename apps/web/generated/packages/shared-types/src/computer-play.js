import { SYNC_TIMING } from './sync-protocol.js';
/** Browser, server and diagnostics share these public behavior contracts. */
export const COMPUTER_TIMING = Object.freeze({ phaseLabelAfterMs: 500, detailAfterMs: 5_000, saveNoticeAfterMs: 10_000, stalledAfterMs: 30_000, renewAfterMs: SYNC_TIMING.heartbeatIntervalMs, leaseMs: SYNC_TIMING.inboundTimeoutMs });
export const COMPUTER_CAPABILITIES = Object.freeze({ resumeHere: 'resume-here-v1' });
export const COMPUTER_LIMITS = Object.freeze({ cachedModels: 2, historyPage: 100, attemptPage: 20, checkpointEvery: 50, noteCharacters: 2000, attemptBytes: 256 * 1024 });
export const COMPUTER_PROFILES = Object.freeze({
    babs: Object.freeze({ name: 'Babs', version: 'experimental-v1', simulations: 8, temperature: 1, maxValueGap: 0.1 }),
    tau: Object.freeze({ name: 'Tau', version: 'experimental-v1', simulations: 32, temperature: 0.5, maxValueGap: 0.05 }),
    horus: Object.freeze({ name: 'Horus', version: 'experimental-v1', simulations: 128, temperature: 0.1, maxValueGap: 0.01 }),
});
const LEGACY_COMPUTER_MODEL = Object.freeze({
    id: 'initial-1554', sha256: '748fcc5e7346900ead62a241002c50ca1012ef8857c73c3eb71e308b955d0490', bytes: 411327,
    checkpoint: '04302e437e01868cc48a237df3c3e8621d84dade628511324b6a3e6e438d6291',
    url: '/computer/models/initial-1554.onnx', experimental: true,
});
export const CURRENT_COMPUTER_MODEL = Object.freeze({
    id: 'trained-20261029-1086', sha256: 'f5b0f38763f290eaecf7f1958738342bb327f42efe95b5021b1f59b2b78f8a0f', bytes: 322842,
    checkpoint: 'fece7b0b299f3980e257c6c1f29e6f5e5162e32026d73875e78e6c38719c4e44',
    url: '/computer/models/trained-20261029-1086.onnx', experimental: true,
});
// This historical HTTP default stays fixed when CURRENT changes in a later release.
const LEGACY_COMPUTER_MODEL_ID = 'initial-1554';
// Only published compatible models belong here.
export const COMPUTER_MODELS = Object.freeze({
    [LEGACY_COMPUTER_MODEL_ID]: LEGACY_COMPUTER_MODEL,
    [CURRENT_COMPUTER_MODEL.id]: CURRENT_COMPUTER_MODEL,
});
export const getComputerModel = (id) => Object.hasOwn(COMPUTER_MODELS, id) ? COMPUTER_MODELS[id] : null;
/** Requests from cached clients predate model pinning and know only the original model. */
export const computerModelForCreation = (value) => value === undefined
    ? getComputerModel(LEGACY_COMPUTER_MODEL_ID) : typeof value === 'string' ? getComputerModel(value) : null;
export const isComputerProfile = (value) => typeof value === 'string' && Object.hasOwn(COMPUTER_PROFILES, value);
export function parseComputerSeats(value) {
    if (!value || typeof value !== 'object')
        return null;
    const seats = value;
    if (![seats.p1, seats.p2].every((seat) => seat === null || isComputerProfile(seat)) || (!seats.p1 && !seats.p2))
        return null;
    return { p1: seats.p1, p2: seats.p2 };
}
export const createComputerControl = (ownerId, seats, modelId = CURRENT_COMPUTER_MODEL.id) => {
    if (!getComputerModel(modelId))
        throw new Error('invalid_computer_model');
    return { ownerId, seats, modelId, generation: 0, lease: null, paused: false, singleStep: false, manual: false, takeoverTurn: null, declinedModelId: null };
};
/** Invalid persisted ownership must never turn into an ordinary human game. */
export function parseComputerControl(value) {
    const control = value;
    if (!control || typeof control.ownerId !== 'string' || !control.ownerId || !parseComputerSeats(control.seats)
        || typeof control.modelId !== 'string' || !control.modelId || !Number.isSafeInteger(control.generation) || control.generation < 0
        || !['paused', 'singleStep', 'manual'].every((key) => typeof control[key] === 'boolean')
        || !(control.takeoverTurn === null || (Number.isSafeInteger(control.takeoverTurn) && control.takeoverTurn >= 0))
        || !(control.declinedModelId === null || typeof control.declinedModelId === 'string')
        || !(control.lease === null || (typeof control.lease.deviceId === 'string' && control.lease.deviceId.length > 0 && control.lease.deviceId.length <= 128 && typeof control.lease.authContextId === 'string' && Number.isFinite(control.lease.expiresAt))))
        throw new Error('invalid_computer_control');
    return structuredClone(control);
}
export function computerProfileFor(control, side, turnIndex) {
    return !control || control.manual || control.takeoverTurn === turnIndex ? null : control.seats[side === 'P1' ? 'p1' : 'p2'];
}
export function computerCommandError(control, input) {
    if (control.ownerId !== input.ownerId)
        return 'computer_owner_required';
    const profile = computerProfileFor(control, input.side, input.turnIndex);
    if (!profile)
        return input.proof === undefined ? null : 'computer_control_changed';
    const proof = input.proof;
    if (!proof || control.paused || !control.lease || control.lease.expiresAt <= input.now || control.lease.authContextId !== input.authContextId
        || proof.deviceId !== control.lease.deviceId || proof.generation !== control.generation)
        return 'computer_control_changed';
    if (proof.modelId !== control.modelId || !getComputerModel(proof.modelId) || proof.profile !== profile || proof.profileVersion !== COMPUTER_PROFILES[profile].version
        || !Number.isSafeInteger(proof.seed) || proof.seed < 0 || typeof proof.attemptId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(proof.attemptId))
        return 'invalid_computer_proof';
    return null;
}
/** Called inside the room's serialized, durable mutation path. All control changes fence old workers. */
export function changeComputerControl(control, input) {
    if (input.ownerId !== control.ownerId)
        throw new Error('computer_owner_required');
    if (typeof input.deviceId !== 'string' || !/^[a-zA-Z0-9-]{1,128}$/.test(input.deviceId))
        throw new Error('invalid_device');
    if (input.generation !== control.generation)
        throw new Error('computer_control_changed');
    const next = structuredClone(control);
    const owned = control.lease?.deviceId === input.deviceId && control.lease.authContextId === input.authContextId && control.lease.expiresAt > input.now;
    if (input.action === 'acquire' || input.action === 'switch' || input.action === 'resume-here') {
        if (input.action === 'acquire' && control.lease && control.lease.expiresAt > input.now && !owned)
            throw new Error('computer_device_busy');
        if (!owned || input.action === 'switch' || input.action === 'resume-here')
            next.generation++;
        next.lease = { deviceId: input.deviceId, authContextId: input.authContextId, expiresAt: input.now + COMPUTER_TIMING.leaseMs };
        if (input.action === 'resume-here') {
            next.paused = false;
            next.singleStep = false;
            next.manual = false;
            next.takeoverTurn = null;
        }
        return next;
    }
    if (!owned)
        throw new Error('computer_control_changed');
    if (input.action === 'renew') {
        next.lease.expiresAt = input.now + COMPUTER_TIMING.leaseMs;
        return next;
    }
    next.generation++;
    if (input.action === 'release')
        next.lease = null;
    else if (input.action === 'pause') {
        next.paused = true;
        next.singleStep = false;
    }
    else if (input.action === 'resume' || input.action === 'step') {
        next.paused = false;
        next.singleStep = input.action === 'step';
    }
    else if (input.action === 'takeover') {
        next.takeoverTurn = input.turnIndex;
        next.paused = false;
    }
    else if (input.action === 'manual') {
        next.manual = true;
        next.paused = false;
    }
    else if (input.action === 'upgrade') {
        next.modelId = CURRENT_COMPUTER_MODEL.id;
        next.declinedModelId = null;
    }
    else if (input.action === 'decline-upgrade')
        next.declinedModelId = CURRENT_COMPUTER_MODEL.id;
    else
        throw new Error('invalid_computer_action');
    return next;
}
