import { levelProgress } from '@quiz-gomes/domain';
import { useState, type FormEvent } from 'react';
import { Avatar } from '../components/avatar.js';
import { Button } from '../components/button.js';
import { RankBadge } from '../components/rank-badge.js';
import { useAuth } from '../features/auth-context.js';
import { useThemeMode, type ThemeMode } from '../hooks/use-theme-mode.js';

export function ProfilePage() {
  const { error, firebaseUser, profile, role, signIn, signOut, updateDisplayName } = useAuth();
  const { mode, setMode } = useThemeMode();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(profile?.displayName ?? '');
  const progress = levelProgress(profile?.totalXp ?? 0);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await updateDisplayName(name);
    setEditing(false);
  }

  if (firebaseUser === null) {
    return (
      <section className="page page--narrow">
        <div className="profile-welcome"><span className="profile-welcome__halo"><Avatar name="Visitante" size="large" /></span><span className="eyebrow">Seu espaço</span><h1>Entre no Quiz Gomes</h1><p>Crie seu ID permanente, encontre amigos e construa rankings diferentes em cada tema.</p><Button onClick={() => void signIn()}>Continuar com Google</Button>{error && <p className="form-error">{error}</p>}</div>
      </section>
    );
  }

  return (
    <section className="page page--profile">
      <div className="profile-hero">
        <Avatar name={profile?.displayName ?? firebaseUser.displayName ?? 'Jogador'} photoUrl={profile?.photoUrl ?? firebaseUser.photoURL} size="large" />
        <div><span className="eyebrow">{role === 'ADMIN' ? 'Jogador · ADMIN' : 'Jogador'}</span><h1>{profile?.displayName ?? firebaseUser.displayName}</h1><p>{profile?.publicId ?? 'Criando ID público…'}</p></div>
        {profile && <Button onClick={() => { setName(profile.displayName); setEditing((value) => !value); }} variant="ghost">Editar</Button>}
      </div>
      {editing && <form className="inline-edit" onSubmit={(event) => void submit(event)}><label className="field"><span>Novo nome</span><input maxLength={32} minLength={2} onChange={(event) => setName(event.target.value)} value={name} /></label><Button type="submit">Salvar</Button></form>}
      <div className="profile-grid">
        <article className="level-card"><span>Nível</span><strong>{progress.level}</strong><div className="progress-track"><span style={{ transform: `scaleX(${progress.progress})` }} /></div><small>{progress.nextLevelXp === null ? 'MAX' : `${progress.currentLevelXp} / ${progress.nextLevelXp} XP`}</small></article>
        <article className="profile-card"><span className="eyebrow">Melhor tema</span><RankBadge knowledge={0} showKnowledge /><p>Jogue sua primeira Ranqueada para preencher este espaço.</p></article>
      </div>
      <section className="settings-card"><div><h2>Aparência</h2><p>A preferência acompanha este dispositivo.</p></div><div className="segmented" role="radiogroup" aria-label="Aparência">{(['light', 'dark', 'system'] as ThemeMode[]).map((value) => <button aria-checked={mode === value} className={mode === value ? 'segmented__active' : ''} key={value} onClick={() => setMode(value)} role="radio" type="button">{{ light: 'Claro', dark: 'Escuro', system: 'Sistema' }[value]}</button>)}</div></section>
      <section className="settings-card"><div><h2>Créditos</h2><p>Quiz Gomes foi criado por Gomes.</p></div></section>
      <Button onClick={() => void signOut()} variant="ghost">Sair da conta</Button>
    </section>
  );
}
