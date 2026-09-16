"use client";

import { createContext, useContext, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export type Role = "Admin" | "User";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: Role;
  teamId?: number | null;
  active: boolean;
  lastActiveAt?: string | null;
  createdAt: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  authLoading: boolean;
  setUser: Dispatch<SetStateAction<AuthUser | null>>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/auth/me", { cache: "no-store", signal: controller.signal })
      .then((response) => response.json())
      .then((data: { user?: AuthUser | null }) => setUser(data.user || null))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setUser(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setAuthLoading(false);
      });

    return () => controller.abort();
  }, []);

  const value = useMemo(() => ({ user, authLoading, setUser }), [authLoading, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
