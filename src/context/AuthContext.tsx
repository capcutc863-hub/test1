import React, { createContext, useContext, useEffect, useState } from 'react';
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

  const clearInitialWorkspace = () => {
    setInitialWorkspace(null);
  };

  const loginWithUsername = async (username: string, password: string): Promise<boolean> => {
    setAuthError(null);
    setAuthLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token || !data.user) {
        setAuthError(data.error || 'بيانات الدخول غير صحيحة.');
        return false;
      }

      setInMemoryTokenProvider(async () => data.token as string);
      setInitialWorkspace((data.workspace as WorkspacePayload) || null);
      setAuthToken(data.token as string);
      setAuthUser(data.user as User);
      return true;
    } catch (err) {
      console.error('Login failed:', err);
      setAuthError('تعذر الاتصال بالخادم لتسجيل الدخول.');
      return false;
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    setAuthToken(null);
    setAuthUser(null);
    setInitialWorkspace(null);
    setAuthError(null);
    setInMemoryTokenProvider(null);
  };

  return (
    <AuthContext.Provider
      value={{
        authUser,
        authToken,
        initialWorkspace,
        clearInitialWorkspace,
        authLoading,
        authError,
        loginWithUsername,
        logout,
        setAuthUser,
      }}
    >
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
