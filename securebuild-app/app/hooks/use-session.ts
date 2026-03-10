"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Session } from "@/lib/types/session";
import { logger } from "@/lib/utils/logger";
import { extendSessionAction } from "@/lib/auth/actions/extend-session";
import { validateSession } from "@/lib/auth/actions/validate-session";

export const useSession = (redirectIfNotLoggedIn: boolean = false) => {
  const extendSessionOnActivity = useCallback(async () => {
    const token = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("buildadmin_session="))
      ?.split("=")[1];

    if (token) {
      try {
        await extendSessionAction(token);
      } catch (error) {
        logger.error("Failed to extend session:", error);
      }
    }
  }, []);

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
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const token = document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("buildadmin_session="))
      ?.split("=")[1];

    if (!token) {
      if (redirectIfNotLoggedIn) {
        setIsLoading(false);
        router.replace("/");
        return;
      }
      setIsLoading(false);
      return;
    }

    const validate = async (token: string) => {
      try {
        const sess = await validateSession(token);
        if (!sess && redirectIfNotLoggedIn) {
          setIsLoading(false);
          router.replace("/");
          return;
        }

        setSession(sess);
        setIsLoading(false);
      } catch (error) {
        logger.error("Session validation failed:", error);
        if (redirectIfNotLoggedIn) {
          setIsLoading(false);
          router.replace("/");
        } else {
          setIsLoading(false);
        }
      }
    };

    validate(token);
  }, [router, redirectIfNotLoggedIn]);

  return {
    isSessionLoading: isLoading,
    session,
  };
};