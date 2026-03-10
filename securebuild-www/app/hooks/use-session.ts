"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Session } from "@/lib/types/session";
import { logger } from "@/lib/utils/logger";
import { extendSessionAction } from "@/lib/auth/actions/extend-session";
import { validateSession } from "@/lib/auth/actions/validate-session";

export const useSession = (redirectIfNotLoggedIn: boolean = false) => {
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const redirectRef = useRef(redirectIfNotLoggedIn);
  const routerRef = useRef(router);
  
  // Update refs when props change
  redirectRef.current = redirectIfNotLoggedIn;
  routerRef.current = router;

  const extendSessionOnActivity = useCallback(async () => {
    const token = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("session="))
      ?.split("=")[1];

    if (token) {
      try {
        await extendSessionAction(token);
      } catch (error) {
        logger.error("Failed to extend session:", error);
      }
    }
  }, []);

  const refreshSession = useCallback(async () => {
    setIsLoading(true);
    const token = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("session="))
      ?.split("=")[1];

    if (!token) {
      setSession(undefined);
      setIsLoading(false);
      if (redirectRef.current) {
        routerRef.current.replace("/");
      }
      return;
    }

    try {
      const sess = await validateSession(token);
      if (!sess && redirectRef.current) {
        routerRef.current.replace("/");
        setSession(undefined);
      } else {
        setSession(sess);
      }
    } catch (error) {
      logger.error("Session validation failed:", error);
      setSession(undefined);
      if (redirectRef.current) {
        routerRef.current.replace("/");
      }
    } finally {
      setIsLoading(false);
    }
  }, []); // Now stable - no dependencies

  useEffect(() => {
    // Setup activity listeners
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    let activityTimeout: NodeJS.Timeout;

    const handleActivity = () => {
      clearTimeout(activityTimeout);
      activityTimeout = setTimeout(() => {
        extendSessionOnActivity();
      }, 1000); // Debounce session extension
    };

    events.forEach(event => {
      window.addEventListener(event, handleActivity);
    });

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      clearTimeout(activityTimeout);
    };
  }, [extendSessionOnActivity]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  return {
    isSessionLoading: isLoading,
    session,
    refreshSession,
  };
};
