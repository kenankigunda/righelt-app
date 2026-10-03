// Shared by browser validation, API sessions and private hashing Workers.
export const AUTH_PROTOCOL_VERSION = 1;
export const SESSION_COOKIE = '__Host-righelt_session';
export const FLOW_COOKIE = '__Host-righelt_recovery';
export const SESSION_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const FLOW_TTL_MS = 10 * 60 * 1000;
export const ACTIVITY_THROTTLE_MS = 60 * 1000;
export const PASSWORD_MIN_CODE_POINTS = 12;
export const PASSWORD_MAX_CODE_POINTS = 128;
export const SCRYPT_PARAMETERS = Object.freeze({ N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 });
export const SCRYPT_KEY_BYTES = 32;
export const SCRYPT_SALT_BYTES = 16;
export const HASH_MAX_WAITING = 4;
export const AUTH_REQUEST_HEADER = 'X-Righelt-Auth';
export const SESSION_CONTEXT_HEADER = 'X-Righelt-Session';
