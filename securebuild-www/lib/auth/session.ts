// lib/auth/get-session.ts
import { cookies } from 'next/headers';
import jwt from 'jsonwebtoken';
import { Session } from '@/lib/types/session';

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('session')?.value;
  if (!token) return null;

  try {
    const session = jwt.verify(token, process.env.HMAC_SECRET!) as Session;
    return session;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      // do not throw
      return null;
    }
    console.error('Invalid session token', err);
    return null;
  }
}
