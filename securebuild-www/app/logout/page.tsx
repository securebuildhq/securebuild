"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    // Attempt to delete the session cookie.
    // IMPORTANT: Replace 'session' with the actual name of your session cookie.
    // Also, ensure the path and domain attributes match how the cookie was set.
    // If your cookie is HttpOnly, this client-side deletion will NOT work.
    // You would need a server-side mechanism (e.g., an API route) to clear it.
    const cookieName = 'session'; // <<<<< IMPORTANT: Change this if your cookie name is different
    document.cookie = `${cookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
    // If the cookie might have been set with the Secure attribute:
    // document.cookie = `${cookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax; Secure`;

    // Add any other cookies that need to be cleared
    // document.cookie = 'another_cookie=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax';

    // Redirect to the homepage
    // Using router.replace so the logout page isn't in the browser's history
    router.replace('/');
  }, [router]);

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <p>Logging out...</p>
    </div>
  );
}
