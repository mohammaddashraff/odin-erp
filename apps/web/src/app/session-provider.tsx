'use client';

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type SessionStatus = 'restoring' | 'authenticated' | 'anonymous';
type SessionUser = any;
type SessionPayload = { token: string; accessToken?: string; user: SessionUser };

interface SessionContextValue {
  status: SessionStatus;
  token: string;
  user: SessionUser;
  sessionMessage: string;
  establishSession: (result: SessionPayload) => void;
  endSession: () => void;
  authorizedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const SessionContext = createContext<SessionContextValue | null>(null);
let refreshInFlight: Promise<SessionPayload> | null = null;

function decodeActor(token: string) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/')));
  } catch {
    return null;
  }
}

async function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) {
          const error: any = new Error(response.status === 401 ? 'Your session has expired. Sign in to continue.' : 'The session service is temporarily unavailable.');
          error.status = response.status;
          throw error;
        }
        return response.json();
      })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('restoring');
  const [token, setToken] = useState('');
  const [user, setUser] = useState<SessionUser>(null);
  const [sessionMessage, setSessionMessage] = useState('');
  const tokenRef = useRef('');
  const stepUpTokenRef = useRef('');

  const applySession = useCallback((result: SessionPayload) => {
    const accessToken = result.accessToken || result.token;
    localStorage.setItem('odin_token', accessToken);
    localStorage.setItem('odin_refresh_hint', '1');
    tokenRef.current = accessToken;
    setToken(accessToken);
    setUser(result.user);
    setSessionMessage('');
    setStatus('authenticated');
  }, []);

  const clearSession = useCallback((message = '') => {
    localStorage.removeItem('odin_token');
    localStorage.removeItem('odin_refresh_hint');
    tokenRef.current = '';
    setToken('');
    setUser(null);
    setSessionMessage(message);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    let active = true;
    const savedToken = localStorage.getItem('odin_token') || '';
    const refreshHint = localStorage.getItem('odin_refresh_hint') === '1';
    tokenRef.current = savedToken;

    const restore = async () => {
      if (savedToken) {
        try {
          const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${savedToken}` }, credentials: 'same-origin' });
          if (response.ok) {
            if (!active) return;
            setToken(savedToken);
            setUser(await response.json());
            setStatus('authenticated');
            return;
          }
          if (response.status !== 401) throw new Error('Temporary session verification error');
        } catch (error) {
          const cachedUser = decodeActor(savedToken);
          if (cachedUser && active) {
            setToken(savedToken);
            setUser(cachedUser);
            setStatus('authenticated');
            return;
          }
          if (!active) return;
        }
      }
      if (!savedToken && !refreshHint) {
        if (active) setStatus('anonymous');
        return;
      }
      try {
        const refreshed = await refreshAccessToken();
        if (active) applySession(refreshed);
      } catch (error: any) {
        if (!active) return;
        if (error?.status === 401) clearSession(savedToken ? 'Your session has expired. Sign in to continue.' : '');
        else {
          const cachedUser = decodeActor(savedToken);
          if (savedToken && cachedUser) {
            setToken(savedToken);
            setUser(cachedUser);
            setStatus('authenticated');
          } else {
            setSessionMessage('The session service is temporarily unavailable. Please try again.');
            setStatus('anonymous');
          }
        }
      }
    };
    void restore();
    return () => { active = false; };
  }, [applySession, clearSession]);

  useEffect(() => {
    const synchronize = (event: StorageEvent) => {
      if (event.key !== 'odin_token') return;
      if (!event.newValue) clearSession();
      else {
        const synchronizedUser = decodeActor(event.newValue);
        if (synchronizedUser) {
          tokenRef.current = event.newValue;
          setToken(event.newValue);
          setUser(synchronizedUser);
          setStatus('authenticated');
        }
      }
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, [clearSession]);

  const authorizedFetch = useCallback(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const execute = (accessToken: string, stepUpToken = stepUpTokenRef.current) => fetch(input, {
      ...init,
      credentials: 'same-origin',
      headers: { ...init.headers, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(stepUpToken ? { 'X-Odin-Step-Up': stepUpToken } : {}) },
    });
    let response = await execute(tokenRef.current);
    if (response.status === 403) {
      const denial = await response.clone().json().catch(() => null);
      if (denial?.denial?.reason === 'STEP_UP_REQUIRED') {
        const password = window.prompt('Re-enter your password to authorize this protected action.');
        if (!password) return response;
        const code = user?.mfaEnabled ? window.prompt('Enter your six-digit MFA code.') || '' : '';
        const stepUp = await fetch('/api/auth/step-up', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenRef.current}` },
          body: JSON.stringify({ password, code }),
        });
        if (!stepUp.ok) return stepUp;
        const result = await stepUp.json();
        stepUpTokenRef.current = result.stepUpToken;
        response = await execute(tokenRef.current, result.stepUpToken);
      }
    }
    if (response.status !== 401) return response;
    try {
      const refreshed = await refreshAccessToken();
      applySession(refreshed);
      response = await execute(refreshed.accessToken || refreshed.token);
      if (response.status === 401) clearSession('Your session has expired. Sign in to continue.');
      return response;
    } catch (error: any) {
      if (error?.status === 401) clearSession('Your session has expired. Sign in to continue.');
      throw error;
    }
  }, [applySession, clearSession, user]);

  const establishSession = useCallback((result: SessionPayload) => applySession(result), [applySession]);

  const endSession = useCallback(() => {
    void fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
    clearSession();
  }, [clearSession]);

  const value = useMemo(() => ({
    status,
    token,
    user,
    sessionMessage,
    establishSession,
    endSession,
    authorizedFetch,
  }), [status, token, user, sessionMessage, establishSession, endSession, authorizedFetch]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside SessionProvider');
  return session;
}
