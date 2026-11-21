import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setInMemoryTokenProvider } from '../lib/tokenStore.ts';
import type { WorkspacePayload } from '../lib/api.ts';
import type { User } from '../../types.ts';

interface AuthContextValue {
  authUser: User | null;
  authToken: string | null;
  initialWorkspace: WorkspacePayload | null;
  clearInitialWorkspace: () => void;
  authLoading: boolean;
  authError: string | null;
  loginWithUsername: (username: string, password: string) => Promise<boolean>;
  completeAuthenticatedSession: (
    token: string,
    user: User,
    workspace?: WorkspacePayload | null
  ) => void;
  logout: () => void;
  setAuthUser: React.Dispatch<React.SetStateAction<User | null>>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [initialWorkspace, setInitialWorkspace] = useState<WorkspacePayload | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      setInMemoryTokenProvider(null);
    };
  }, []);

  const clearInitialWorkspace = useCallback(() => {
    setInitialWorkspace(null);
  }, []);

  const completeAuthenticatedSession = useCallback((
    token: string,
    user: User,
    workspace: WorkspacePayload | null = null
  ) => {
    setInMemoryTokenProvider(async () => token);
    setInitialWorkspace(workspace);
    setAuthToken(token);
    setAuthUser(user);
    setAuthError(null);
  }, []);

  const loginWithUsername = useCallback(async (username: string, password: string): Promise<boolean> => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const payload = JSON.stringify({ username, password });
      let response: Response;
      try {
        response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
      } catch (firstNetErr) {
        // Retry once transparently if the container/proxy was waking up or restarting
        await new Promise((resolve) => setTimeout(resolve, 750));
        response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
        if (!response) throw firstNetErr;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token || !data.user) {
        setAuthError(data.error || 'بيانات الدخول غير صحيحة.');
        return false;
      }

      completeAuthenticatedSession(
        data.token as string,
        data.user as User,
        (data.workspace as WorkspacePayload) || null
      );
      return true;
    } catch (err) {
      console.error('Login failed:', err);
      setAuthError('تعذر الاتصال بالخادم لتسجيل الدخول. يرجى تحديث الصفحة والمحاولة مرة أخرى.');
      return false;
    } finally {
      setAuthLoading(false);
    }
  }, [completeAuthenticatedSession]);

  const logout = useCallback(() => {
    setAuthToken(null);
    setAuthUser(null);
    setInitialWorkspace(null);
    setAuthError(null);
    setInMemoryTokenProvider(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      authUser,
      authToken,
      initialWorkspace,
      clearInitialWorkspace,
      authLoading,
      authError,
      loginWithUsername,
      completeAuthenticatedSession,
      logout,
      setAuthUser,
    }),
    [
      authUser,
      authToken,
      initialWorkspace,
      clearInitialWorkspace,
      authLoading,
      authError,
      loginWithUsername,
      completeAuthenticatedSession,
      logout,
    ]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
