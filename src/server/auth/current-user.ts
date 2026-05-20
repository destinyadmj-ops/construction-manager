import { cookies } from 'next/headers';

const COOKIE_NAME = 'masterHub.uid';

export async function getCurrentUserId(): Promise<string | null> {
  const jar = await cookies();
  const userId = (jar.get(COOKIE_NAME)?.value ?? '').trim();
  return userId.length > 0 ? userId : null;
}