import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, apiUpload, ClientApiError } from '../lib/api.js';
import { firebaseAuth, googleProvider } from '../lib/firebase.js';
import { clearAuthIntent } from '../lib/auth-intent.js';

export interface QuizProfile {
  avatarKey: string;
  customAvatarUrl: string | null;
  displayName: string;
  equippedFrameId: string | null;
  equippedTitleId: string | null;
  photoUrl: string | null;
  publicId: string;
  totalXp: number;
  userId: string;
}

/**
 * Estado do perfil separado do erro: só 'missing' (o servidor confirmou que
 * não existe perfil) abre o primeiro acesso. Falha de rede vira 'error' com
 * "tentar de novo", nunca uma conta nova aparente.
 */
export type ProfileStatus = 'disabled' | 'error' | 'idle' | 'loading' | 'missing' | 'ready';

interface AuthValue {
  createProfile: (displayName: string) => Promise<void>;
  profileStatus: ProfileStatus;
  retryProfile: () => Promise<void>;
  error: string | null;
  firebaseUser: User | null;
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  loading: boolean;
  profile: QuizProfile | null;
  removeCustomAvatar: () => Promise<void>;
  role: 'ADMIN' | 'PLAYER' | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  uploadCustomAvatar: (avatar: Blob) => Promise<void>;
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
  const [profileStatus, setProfileStatus] = useState<ProfileStatus>('loading');
  const signingInRef = useRef(false);
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
      setProfileStatus('ready');
    } catch (profileError) {
      if (profileError instanceof ClientApiError && profileError.code === 'PROFILE_NOT_FOUND') {
        setProfile(null);
        setRole(null);
        setError(null);
        setProfileStatus('missing');
        return;
      }
      if (profileError instanceof ClientApiError && profileError.code === 'ACCOUNT_DISABLED') {
        setProfile(null);
        setRole(null);
        setError(profileError.message);
        setProfileStatus('disabled');
        return;
      }
      // Falha transitória de rede não é logout: a sessão do Firebase continua válida
      // e o perfil já carregado permanece na tela.
      setError(profileError instanceof Error ? profileError.message : 'Não foi possível carregar seu perfil.');
      setProfileStatus((current) => (current === 'ready' ? 'ready' : 'error'));
    }
  }, []);

  useEffect(() => onAuthStateChanged(firebaseAuth, (user) => {
    setFirebaseUser(user);
    setError(null);
    if (user === null) {
      setProfile(null);
      setRole(null);
      setLoading(false);
      setProfileStatus('idle');
      return;
    }
    setLoading(true);
    setProfileStatus('loading');
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
    setProfileStatus('ready');
  }, [getToken]);

  const retryProfile = useCallback(async () => {
    const user = firebaseAuth.currentUser;
    if (user === null) return;
    setLoading(true);
    setProfileStatus('loading');
    await loadProfile(user).finally(() => setLoading(false));
  }, [loadProfile]);

  const saveAvatar = useCallback(async (avatar?: Blob) => {
    const token = await getToken();
    if (token === null) throw new Error('Entre com Google para continuar.');
    const result = avatar === undefined
      ? await apiRequest<ProfileResponse>('/api/profile/avatar', { getToken, method: 'DELETE', token })
      : await apiUpload<ProfileResponse>('/api/profile/avatar', { body: avatar, getToken, method: 'PUT', token });
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
    profileStatus,
    retryProfile,
    removeCustomAvatar: () => saveAvatar(),
    role,
    signIn: async () => {
      // Já autenticado ou ainda restaurando: nada de abrir um segundo login.
      if (firebaseAuth.currentUser !== null || signingInRef.current) return;
      signingInRef.current = true;
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
      } finally {
        signingInRef.current = false;
      }
    },
    signOut: async () => {
      clearAuthIntent();
      await firebaseSignOut(firebaseAuth);
    },
    updateDisplayName: (displayName) => saveProfile(displayName, 'PATCH'),
    uploadCustomAvatar: (avatar) => saveAvatar(avatar),
  }), [error, firebaseUser, getToken, loading, profile, profileStatus, retryProfile, role, saveAvatar, saveProfile]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth precisa de AuthProvider.');
  return value;
}
