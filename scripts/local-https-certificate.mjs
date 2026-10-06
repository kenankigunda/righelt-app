import { X509Certificate, createPrivateKey } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const HTTPS_VARIABLES = ['WRANGLER_HTTPS_CERT_PATH', 'WRANGLER_HTTPS_KEY_PATH'];
export const defaultCertificateDirectory = () => path.join(os.homedir(), '.config', 'righelt', 'https');

export function validateCertificate(certPem, keyPem, now = Date.now()) {
  const cert = new X509Certificate(certPem);
  if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) < now + 30 * 86400_000) {
    throw Error('Local certificate is not valid for the next 30 days. Run setup:https --renew.');
  }
  if (!cert.checkHost('localhost') || !cert.checkIP('127.0.0.1') || !cert.checkIP('::1')) {
    throw Error('Local certificate must cover localhost, 127.0.0.1 and ::1. Run setup:https --renew.');
  }
  if (!cert.checkPrivateKey(createPrivateKey(keyPem))) throw Error('Local certificate and private key do not match.');
  return cert;
}
