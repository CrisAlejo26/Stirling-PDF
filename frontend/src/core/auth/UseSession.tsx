import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email?: string;
  role: "ADMIN" | "EDITOR" | "VIEWER";
  [key: string]: unknown;
}

export interface AuthContextType {
  session: null;
  user: AuthUser | null;
  loading: boolean;
  error: Error | null;
  signOut: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  loading: true,
  error: null,
  signOut: async () => {},
  refreshSession: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/auth/me", {
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as Omit<AuthUser, "email">;
        setUser({ ...data, email: data.username });
        setError(null);
      } else {
        setUser(null);
      }
    } catch (e) {
      setError(e as Error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const signOut = async () => {
    await fetch("/api/v1/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session: null,
        user,
        loading,
        error,
        signOut,
        refreshSession: fetchMe,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  return useContext(AuthContext);
}
