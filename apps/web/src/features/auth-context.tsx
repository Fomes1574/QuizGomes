import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiRequest, ClientApiError } from '../lib/api.js';
import { firebaseAuth, googleProvider } from '../lib/firebase.js';

export interface QuizProfile {
  avatarKey: string;
  displayName: string;
  equippedFrameId: string | null;
  equippedTitleId: string | null;
  photoUrl: string | null;
  publicId: string;
  totalXp: number;
  userId: string;
}

interface AuthValue {
  createProfile: (displayName: string) => Promise<void>;
  error: string | null;
  firebaseUser: User | null;
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  loading: boolean;
  profile: QuizProfile | null;
  role: 'ADMIN' | 'PLAYER' | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
}

interface ProfileResponse {
  profile: QuizProfile;
  role: 'ADMIN' | 'PLAYER';
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<QuizProfile | null>(null);
  const [role, setRole] = useState<'ADMIN' | 'PLAYER' | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (user: User) => {
    try {
      const token = await user.getIdToken();
      const result = await apiRequest<ProfileResponse>('/api/profile/me', {
        getToken: (forceRefresh) => user.getIdToken(forceRefresh),
        token,
      });
      setProfile(result.profile);
      setRole(result.role);
      setError(null);
    } catch (profileError) {
      if (profileError instanceof ClientApiError && profileError.code === 'PROFILE_NOT_FOUND') {
        setProfile(null);
        setRole(null);
        setError(null);
      } else {
        setError(profileError instanceof Error ? profileError.message : 'Não foi possível carregar seu perfil.');
      }
    }
  }, []);

  useEffect(() => onAuthStateChanged(firebaseAuth, (user) => {
    setFirebaseUser(user);
    setError(null);
    if (user === null) {
      setProfile(null);
      setRole(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadProfile(user).finally(() => setLoading(false));
  }), [loadProfile]);

  const getToken = useCallback(async (forceRefresh = false) => (
    firebaseAuth.currentUser?.getIdToken(forceRefresh) ?? null
  ), []);

  const saveProfile = useCallback(async (displayName: string, method: 'PATCH' | 'POST') => {
    const token = await getToken();
    if (token === null) throw new Error('Entre com Google para continuar.');
    const result = await apiRequest<ProfileResponse>('/api/profile/me', {
      body: { displayName },
      getToken,
      method,
      token,
    });
    setProfile(result.profile);
    setRole(result.role);
    setError(null);
  }, [getToken]);

  const value = useMemo<AuthValue>(() => ({
    createProfile: (displayName) => saveProfile(displayName, 'POST'),
    error,
    firebaseUser,
    getToken,
    loading,
    profile,
    role,
    signIn: async () => {
      setError(null);
      try {
        await signInWithPopup(firebaseAuth, googleProvider);
      } catch (signInError) {
        const code = typeof signInError === 'object' && signInError !== null && 'code' in signInError
          ? String(signInError.code)
          : '';
        if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
          await signInWithRedirect(firebaseAuth, googleProvider);
          return;
        }
        setError('Não foi possível entrar com Google. Tente novamente.');
        throw signInError;
      }
    },
    signOut: async () => firebaseSignOut(firebaseAuth),
    updateDisplayName: (displayName) => saveProfile(displayName, 'PATCH'),
  }), [error, firebaseUser, getToken, loading, profile, role, saveProfile]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth precisa de AuthProvider.');
  return value;
}
