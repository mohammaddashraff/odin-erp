"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import StepUpDialog, { type Verification } from "../components/step-up-dialog";

type SessionStatus = "restoring" | "authenticated" | "anonymous";
type SessionUser = any;
type SessionPayload = {
  token: string;
  accessToken?: string;
  user: SessionUser;
};

interface SessionContextValue {
  status: SessionStatus;
  token: string;
  user: SessionUser;
  sessionMessage: string;
  establishSession: (result: SessionPayload) => void;
  endSession: () => void;
  authorizedFetch: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
}

const SessionContext = createContext<SessionContextValue | null>(null);
let refreshInFlight: Promise<SessionPayload> | null = null;

const sessionEventKey = "av8_session_event";
const sessionLock = "av8-cookie-session";
export async function withSessionLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks)
    return navigator.locks.request(sessionLock, work);
  return work();
}
async function refreshAccessToken() {
  if (!refreshInFlight) {
    refreshInFlight = withSessionLock(async () => {
      const response = await fetch("/api/auth/refresh", {method:"POST",credentials:"same-origin"});
      if (!response.ok) {
        const error: any = new Error(response.status === 401 ? "Your session has expired. Sign in to continue." : "The session service is temporarily unavailable.");
        error.status = response.status;
        throw error;
      }
      return response.json() as Promise<SessionPayload>;
    }).finally(() => {refreshInFlight = null;});
  }
  return refreshInFlight;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("restoring");
  const [token, setToken] = useState("");
  const [user, setUser] = useState<SessionUser>(null);
  const [sessionMessage, setSessionMessage] = useState("");
  const tokenRef = useRef("");
  const generation = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);
  const explicitlyLoggedOut = useRef(false);
  const sessionMarker = useRef<string|null>(null);
  const stepUpTokenRef = useRef("");
  const [verification, setVerification] = useState<{ mfa: boolean } | null>(
    null,
  );
  const pendingVerification = useRef<{
    promise: Promise<Verification>;
    resolve: (value: Verification) => void;
  } | null>(null);
  const requestVerification = useCallback((mfa: boolean) => {
    if (pendingVerification.current) return pendingVerification.current.promise;
    let resolve!: (value: Verification) => void;
    const promise = new Promise<Verification>((done) => {
      resolve = done;
    });
    pendingVerification.current = { promise, resolve };
    setVerification({ mfa });
    return promise;
  }, []);
  const completeVerification = useCallback((value: Verification) => {
    pendingVerification.current?.resolve(value);
    pendingVerification.current = null;
    setVerification(null);
  }, []);

  const applySession = useCallback((result: SessionPayload) => {
    const accessToken = result.accessToken || result.token;
    try { localStorage.removeItem("av8_token"); localStorage.setItem("av8_refresh_hint", "1"); } catch { /* Authentication does not require browser storage. */ }
    tokenRef.current = accessToken;
    setToken(accessToken);
    setUser(result.user);
    setSessionMessage("");
    setStatus("authenticated");
  }, []);

  const clearSession = useCallback((message = "", forgetHint = true) => {
    generation.current += 1;
    try { localStorage.removeItem("av8_token"); if (forgetHint) localStorage.removeItem("av8_refresh_hint"); } catch { /* Tokens are memory-only. */ }
    tokenRef.current = "";
    stepUpTokenRef.current = "";
    pendingVerification.current?.resolve(null);
    pendingVerification.current = null;
    setVerification(null);
    setToken("");
    setUser(null);
    setSessionMessage(message);
    setStatus("anonymous");
  }, []);

  const announceSession = useCallback((result: SessionPayload, login = false) => {
    // BroadcastChannel is transient same-origin memory, never persistent storage.
    let signalId:string|null = null;
    try {
      if (login) localStorage.setItem(sessionEventKey, JSON.stringify({type:"login",id:crypto.randomUUID()}));
      const marker = JSON.parse(localStorage.getItem(sessionEventKey) || "null");
      if (!login && marker?.type === "logout") return;
      signalId = marker?.id || null;
      sessionMarker.current = signalId;
    } catch { /* Optional cross-tab signal. */ }
    channel.current?.postMessage({type:"session",payload:result,signalId,login});
  }, []);

  useEffect(() => {
    let active = true;
    const initialGeneration = generation.current;
    let refreshHint = false;
    try { refreshHint = localStorage.getItem("av8_refresh_hint") === "1"; sessionMarker.current=JSON.parse(localStorage.getItem(sessionEventKey)||"null")?.id||null; localStorage.removeItem("av8_token"); } catch { /* No cached bearer is trusted. */ }
    if (!refreshHint) { setStatus("anonymous"); return; }
    void refreshAccessToken().then(result => {
      if (!active || generation.current !== initialGeneration) return;
      applySession(result); announceSession(result);
    }).catch((error:any) => {
      if (!active || generation.current !== initialGeneration) return;
      clearSession(error?.status === 401 ? "Your session has expired. Sign in to continue." : "The session service is temporarily unavailable. Please try again.", error?.status === 401);
    });
    return () => { active = false; };
  }, [applySession, announceSession, clearSession]);

  useEffect(() => {
    let active = true;
    const acceptLogin = (id:string|null|undefined) => {
      if (!id || sessionMarker.current === id) return;
      sessionMarker.current=id; explicitlyLoggedOut.current=false; clearSession("",false); setStatus("restoring");
    };
    const verifySharedSession = async (message: {payload:SessionPayload;signalId?:string|null;login?:boolean}) => {
      const payload = message.payload;
      if (explicitlyLoggedOut.current && !message.login) return;
      try { const marker=JSON.parse(localStorage.getItem(sessionEventKey)||"null"); if (marker?.type==="logout" || (marker?.id||null)!==(message.signalId||null)) return; } catch { /* In-memory sign-out still wins. */ }
      if (message.login) acceptLogin(message.signalId);
      const candidate = payload?.accessToken || payload?.token;
      if (typeof candidate !== "string" || !candidate) return;
      const expectedGeneration = generation.current;
      try {
        // Another tab's message is not authority: verify it with the server.
        const response = await fetch("/api/auth/me", {credentials:"same-origin",headers:{Authorization:`Bearer ${candidate}`}});
        if (!response.ok) return;
        const verifiedUser = await response.json();
        if (!active || generation.current !== expectedGeneration) return;
        explicitlyLoggedOut.current = false;
        applySession({token:candidate,user:verifiedUser});
      } catch { /* Never authenticate from an unverified message or decoded JWT. */ }
    };
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("av8-session");
      channel.current.onmessage = event => {
        if (event.data?.type === "logout") {
          try { const marker=JSON.parse(localStorage.getItem(sessionEventKey)||"null"); if(marker?.id!==event.data.signalId || marker?.type!=="logout") return; } catch { /* Storage may be disabled; the transient event still clears memory. */ }
          explicitlyLoggedOut.current = true; clearSession();
        }
        if (event.data?.type === "session") void verifySharedSession(event.data);
      };
    }
    const synchronize = (event: StorageEvent) => {
      if (event.key !== sessionEventKey || !event.newValue) return;
      let signal:any; try { signal = JSON.parse(event.newValue); } catch { return; }
      if (signal.type === "logout") {
        try { if (JSON.parse(localStorage.getItem(sessionEventKey)||"null")?.id !== signal.id) return; } catch { return; }
        explicitlyLoggedOut.current = true; clearSession();
      }
      if (signal.type === "login") {
        try { if (JSON.parse(localStorage.getItem(sessionEventKey)||"null")?.id !== signal.id) return; } catch { return; }
        acceptLogin(signal.id);
        const expectedGeneration = generation.current;
        void refreshAccessToken().then(result => {if (active && generation.current === expectedGeneration) {applySession(result); announceSession(result);}}).catch((error:any) => {if(active && generation.current === expectedGeneration && !tokenRef.current) clearSession(error?.status===401?"Your session has expired. Sign in to continue.":"The session service is temporarily unavailable. Please try again.",error?.status===401);});
      }
    };
    window.addEventListener("storage", synchronize);
    return () => {active = false; channel.current?.close(); channel.current = null; window.removeEventListener("storage", synchronize);};
  }, [applySession, announceSession, clearSession]);

  const authorizedFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const execute = (
        accessToken: string,
        stepUpToken = stepUpTokenRef.current,
      ) =>
        fetch(input, {
          ...init,
          credentials: "same-origin",
          headers: {
            ...init.headers,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(stepUpToken ? { "X-Odin-Step-Up": stepUpToken } : {}),
          },
        });
      const requestGeneration = generation.current;
      const requestToken = tokenRef.current;
      let response = await execute(requestToken);
      if (response.status === 403) {
        const denial = await response
          .clone()
          .json()
          .catch(() => null);
        if (denial?.denial?.reason === "STEP_UP_REQUIRED") {
          const verification = await requestVerification(!!user?.mfaEnabled);
          if (!verification) return response;
          const { password, code } = verification;
          const stepUp = await fetch("/api/auth/step-up", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${tokenRef.current}`,
            },
            body: JSON.stringify({ password, code }),
          });
          if (!stepUp.ok) return stepUp;
          const result = await stepUp.json();
          stepUpTokenRef.current = result.stepUpToken;
          response = await execute(tokenRef.current, result.stepUpToken);
        }
      }
      if (response.status !== 401) return response;
      if (generation.current !== requestGeneration) return response;
      if (tokenRef.current && tokenRef.current !== requestToken) {
        response = await execute(tokenRef.current);
        if (response.status !== 401) return response;
      }
      try {
        const refreshed = await refreshAccessToken();
        if (generation.current !== requestGeneration) return response;
        applySession(refreshed);
        announceSession(refreshed);
        response = await execute(refreshed.accessToken || refreshed.token);
        if (response.status === 401)
          clearSession("Your session has expired. Sign in to continue.");
        return response;
      } catch (error: any) {
        if (error?.status === 401)
          clearSession("Your session has expired. Sign in to continue.");
        throw error;
      }
    },
    [applySession, announceSession, clearSession, user, requestVerification],
  );

  const establishSession = useCallback(
    (result: SessionPayload) => {explicitlyLoggedOut.current = false; generation.current += 1; applySession(result); announceSession(result, true);},
    [applySession, announceSession],
  );

  const endSession = useCallback(() => {
    const announceLogout = () => {
      const signalId=crypto.randomUUID();
      explicitlyLoggedOut.current = true;
      clearSession();
      try { localStorage.setItem(sessionEventKey, JSON.stringify({type:"logout",id:signalId})); } catch { /* Optional cross-tab signal. */ }
      channel.current?.postMessage({type:"logout",signalId});
    };
    announceLogout();
    void withSessionLock(async () => {
      const response = await fetch("/api/auth/logout", {method:"POST",credentials:"same-origin"});
      if (!response.ok) throw new Error("Could not confirm server sign-out. Please try again.");
      // A login already in flight may have completed before this queued logout.
      announceLogout();
    }).catch(() => setSessionMessage("Could not confirm server sign-out. Please try again."));
  }, [clearSession]);

  const value = useMemo(
    () => ({
      status,
      token,
      user,
      sessionMessage,
      establishSession,
      endSession,
      authorizedFetch,
    }),
    [
      status,
      token,
      user,
      sessionMessage,
      establishSession,
      endSession,
      authorizedFetch,
    ],
  );
  return (
    <SessionContext.Provider value={value}>
      {children}
      {verification ? (
        <StepUpDialog mfa={verification.mfa} complete={completeVerification} />
      ) : null}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const session = useContext(SessionContext);
  if (!session)
    throw new Error("useSession must be used inside SessionProvider");
  return session;
}
