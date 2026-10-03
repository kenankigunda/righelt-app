import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { SCRYPT_PARAMETERS, SCRYPT_KEY_BYTES, SCRYPT_SALT_BYTES, PASSWORD_MIN_CODE_POINTS, PASSWORD_MAX_CODE_POINTS } from '../../packages/shared-types/src/auth-policy.js';
const prefix = `scrypt$1$${SCRYPT_PARAMETERS.N}$${SCRYPT_PARAMETERS.r}$${SCRYPT_PARAMETERS.p}`;
export function validPassword(password) {
  return typeof password === 'string' && password === password.normalize('NFC') && Array.from(password).length >= PASSWORD_MIN_CODE_POINTS && Array.from(password).length <= PASSWORD_MAX_CODE_POINTS && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(password);
}
export function parseHash(encoded) {
  if(typeof encoded !== 'string') return null;
  const parts=encoded.split('$');
  if(parts.length!==7 || parts.slice(0,5).join('$')!==prefix || !/^[a-f0-9]{32}$/.test(parts[5]) || !/^[a-f0-9]{64}$/.test(parts[6])) return null;
  return {salt:Buffer.from(parts[5],'hex'),key:Buffer.from(parts[6],'hex')};
}
export function hashPassword(password) {
  if(!validPassword(password)) throw new Error('invalid_input');
  const salt=randomBytes(SCRYPT_SALT_BYTES);
  const key=scryptSync(password,salt,SCRYPT_KEY_BYTES,SCRYPT_PARAMETERS);
  return `${prefix}$${salt.toString('hex')}$${key.toString('hex')}`;
}
export function verifyPassword(password,encoded) {
  if(!validPassword(password)) return false;
  const record=parseHash(encoded);
  if(!record) return false;
  const actual=scryptSync(password,record.salt,SCRYPT_KEY_BYTES,SCRYPT_PARAMETERS);
  return timingSafeEqual(actual,record.key);
}
