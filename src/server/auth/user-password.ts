import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);

const PASSWORD_VERSION = 's1';
const SALT_BYTES = 16;
const KEY_LENGTH = 64;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72;

export function validateUserPassword(input: string): string | null {
  const password = input.trim();
  if (password.length < MIN_PASSWORD_LENGTH) return `パスワードは${MIN_PASSWORD_LENGTH}文字以上で入力してください`;
  if (password.length > MAX_PASSWORD_LENGTH) return `パスワードは${MAX_PASSWORD_LENGTH}文字以内で入力してください`;
  return null;
}

export async function hashUserPassword(input: string): Promise<string> {
  const password = input.trim();
  const salt = randomBytes(SALT_BYTES).toString('hex');
  const derived = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
  return `${PASSWORD_VERSION}:${salt}:${derived.toString('hex')}`;
}

export async function verifyUserPassword(input: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;

  const [version, salt, expectedHex] = stored.split(':');
  if (version !== PASSWORD_VERSION || !salt || !expectedHex) return false;

  const derived = (await scrypt(input.trim(), salt, KEY_LENGTH)) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}