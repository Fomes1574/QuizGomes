import { useState, type FormEvent } from 'react';
import type { User } from 'firebase/auth';
import { useAuth } from '../features/auth-context.js';
import { Button } from './button.js';
import { Logo } from './logo.js';

export function OnboardingDialog() {
  const { error, firebaseUser, loading, profile } = useAuth();
  if (loading || firebaseUser === null || profile !== null) return null;
  return <OnboardingForm authError={error} key={firebaseUser.uid} user={firebaseUser} />;
}

function OnboardingForm({ authError, user }: { authError: string | null; user: User }) {
  const { createProfile, signOut } = useAuth();
  const [displayName, setDisplayName] = useState(() => user.displayName?.slice(0, 32) ?? '');
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createProfile(displayName);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Não foi possível criar seu perfil.');
    } finally {
      setSaving(false);
    }
  }

  async function leaveOnboarding() {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch {
      setError('Não foi possível sair da conta. Tente novamente.');
      setSigningOut(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="onboarding-title" aria-modal="true" className="dialog" role="dialog">
        <Logo />
        <div className="dialog__intro">
          <span className="eyebrow">Primeiro acesso</span>
          <h1 id="onboarding-title">Como você quer ser chamado?</h1>
          <p>Seu nome pode mudar depois. Seu ID público será criado agora e nunca muda.</p>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>Nome de exibição</span>
            <input autoFocus maxLength={32} minLength={2} onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
            <small>Entre 2 e 32 caracteres.</small>
          </label>
          {(error ?? authError) && <p className="form-error" role="alert">{error ?? authError}</p>}
          <div className="dialog__actions">
            <Button disabled={saving || signingOut || displayName.trim().length < 2} type="submit">
              {saving ? 'Criando perfil…' : 'Criar meu perfil'}
            </Button>
            <Button
              disabled={saving || signingOut}
              onClick={() => void leaveOnboarding()}
              type="button"
              variant="ghost"
            >
              {signingOut ? 'Saindo…' : 'Sair / trocar conta'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
