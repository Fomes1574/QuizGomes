import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/avatar.js';
import { AvatarFrame } from '../components/avatar-frame.js';
import { LoadingState } from '../components/async-state.js';
import { Button } from '../components/button.js';
import { Icon } from '../components/icons.js';
import { useAuth } from '../features/auth-context.js';
import { useSocial } from '../features/social-context.js';
import { apiRequest } from '../lib/api.js';
import { publicIdFromInviteCode, rememberInviteAdd, takeInviteAdd } from '../lib/invite-link.js';
import type { SocialCandidate } from '../lib/social.js';

type Lookup =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'error'; message: string }
  | { candidate: SocialCandidate; kind: 'found' };

/** Resultado do toque, por cima da relação que veio da busca. */
type Outcome = 'accepted' | 'sent' | null;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== '' ? error.message : fallback;
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? 'em breve'
    : date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', timeZone: 'America/Sao_Paulo' });
}

/**
 * Os dois retratos frente a frente, ligados por um "+": quando a amizade (ou
 * o pedido) acontece, o "+" vira ✓. Quem ainda não entrou aparece como "?".
 */
function InviteDuo({ inviter, linked, viewer }: {
  inviter: { customAvatarUrl: string | null; frameId: string | null; name: string; photoUrl: string | null } | null;
  linked: boolean;
  viewer: { customAvatarUrl: string | null; frameId: string | null; name: string; photoUrl: string | null } | null;
}) {
  return (
    <div aria-hidden="true" className={`invite-duo${linked ? ' invite-duo--linked' : ''}`}>
      <span className="invite-duo__seat">
        {inviter === null
          ? <span className="invite-duo__unknown">?</span>
          : (
            <AvatarFrame frameId={inviter.frameId}>
              <Avatar customUrl={inviter.customAvatarUrl} googleUrl={inviter.photoUrl} name={inviter.name} size="large" />
            </AvatarFrame>
          )}
      </span>
      <span className="invite-duo__link"><span className="invite-duo__badge"><Icon name={linked ? 'check' : 'add'} /></span></span>
      <span className="invite-duo__seat">
        {viewer === null
          ? <span className="invite-duo__unknown">Você</span>
          : (
            <AvatarFrame frameId={viewer.frameId}>
              <Avatar customUrl={viewer.customAvatarUrl} googleUrl={viewer.photoUrl} name={viewer.name} size="large" />
            </AvatarFrame>
          )}
      </span>
    </div>
  );
}

export function InvitePage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { firebaseUser, getToken, loading: authLoading, profile, signIn } = useAuth();
  const { refresh } = useSocial();
  const publicId = publicIdFromInviteCode(code);
  const [lookup, setLookup] = useState<Lookup>({ kind: 'loading' });
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoAddTried = useRef(false);

  const own = profile !== null && publicId !== null && profile.publicId.toUpperCase() === publicId;

  useEffect(() => {
    if (profile === null || publicId === null || own) return undefined;
    let active = true;
    queueMicrotask(() => { if (active) setLookup({ kind: 'loading' }); });
    void apiRequest<{ users: SocialCandidate[] }>(`/api/social/search?q=${encodeURIComponent(publicId)}`, { getToken })
      .then((result) => {
        if (!active) return;
        const candidate = result.users.find((user) => user.publicId.toUpperCase() === publicId);
        setLookup(candidate === undefined ? { kind: 'missing' } : { candidate, kind: 'found' });
      })
      .catch((lookupError: unknown) => {
        if (active) setLookup({ kind: 'error', message: errorText(lookupError, 'Não foi possível abrir o convite.') });
      });
    return () => { active = false; };
  }, [getToken, own, profile, publicId]);

  const sendRequest = useCallback(async (target: SocialCandidate) => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest('/api/social/requests', { body: { publicId: target.publicId }, getToken, method: 'POST' });
      setOutcome('sent');
      void refresh();
    } catch (sendError) {
      setError(errorText(sendError, 'Não foi possível enviar o pedido.'));
    } finally {
      setBusy(false);
    }
  }, [getToken, refresh]);

  async function acceptRequest(target: SocialCandidate) {
    if (target.requestId === null) return;
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/api/social/requests/${encodeURIComponent(target.requestId)}/accept`, { body: {}, getToken, method: 'POST' });
      setOutcome('accepted');
      void refresh();
    } catch (acceptError) {
      setError(errorText(acceptError, 'Não foi possível aceitar o pedido.'));
    } finally {
      setBusy(false);
    }
  }

  // Quem tocou em "Entrar e adicionar" antes de ter conta: o pedido sai sozinho agora.
  useEffect(() => {
    if (lookup.kind !== 'found' || publicId === null || autoAddTried.current) return;
    const candidate = lookup.candidate;
    if (candidate.relationship !== 'NONE' || candidate.availableAt !== null) {
      takeInviteAdd(publicId);
      return;
    }
    if (!takeInviteAdd(publicId)) return;
    autoAddTried.current = true;
    queueMicrotask(() => { void sendRequest(candidate); });
  }, [lookup, publicId, sendRequest]);

  const goSocial = () => { void navigate('/social'); };
  const goHome = () => { void navigate('/'); };
  const viewer = profile === null ? null : {
    customAvatarUrl: profile.customAvatarUrl, frameId: profile.equippedFrameId, name: profile.displayName, photoUrl: profile.photoUrl,
  };

  let body: ReactNode;
  if (publicId === null) {
    body = (
      <>
        <InviteDuo inviter={null} linked={false} viewer={viewer} />
        <div className="invite-page__copy">
          <h1>Convite inválido</h1>
          <p>Esse link de convite está incompleto. Peça para te mandarem de novo ou procure a pessoa pelo código no Social.</p>
        </div>
        <Button onClick={goSocial}><Icon name="search" />Buscar no Social</Button>
      </>
    );
  } else if (profile === null) {
    const restoring = authLoading || firebaseUser !== null;
    body = (
      <>
        <InviteDuo inviter={null} linked={false} viewer={null} />
        <div className="invite-page__copy">
          <span className="eyebrow">Convite para duelar</span>
          <h1>Te chamaram pro QUIZ GOMES</h1>
          <p>Entre para adicionar <strong className="invite-page__id">{publicId}</strong> como amigo, ver quando está online e se desafiarem ao vivo.</p>
        </div>
        {restoring
          ? <p className="invite-page__hint">{firebaseUser !== null ? 'Escolha seu nome para continuar.' : 'Restaurando sua sessão…'}</p>
          : (
            <Button onClick={() => { rememberInviteAdd(publicId); void signIn().catch(() => undefined); }}>
              <Icon name="add" />Entrar com Google e adicionar
            </Button>
          )}
      </>
    );
  } else if (own) {
    body = (
      <>
        <InviteDuo inviter={viewer} linked={false} viewer={null} />
        <div className="invite-page__copy">
          <span className="eyebrow">Seu convite</span>
          <h1>Esse link é seu</h1>
          <p>Quem abrir esse link cai direto aqui para te adicionar. Mande pra galera pelo botão "Chamar amigos" no Social.</p>
        </div>
        <Button onClick={goSocial}><Icon name="social" />Ir para o Social</Button>
      </>
    );
  } else if (lookup.kind === 'loading') {
    body = <LoadingState label="Abrindo convite" />;
  } else if (lookup.kind === 'missing') {
    body = (
      <>
        <InviteDuo inviter={null} linked={false} viewer={viewer} />
        <div className="invite-page__copy">
          <h1>Convite não encontrado</h1>
          <p>Ninguém usa o código <strong className="invite-page__id">{publicId}</strong> agora, ou esse perfil não está disponível para você.</p>
        </div>
        <Button onClick={goSocial}><Icon name="search" />Buscar no Social</Button>
      </>
    );
  } else if (lookup.kind === 'error') {
    body = (
      <>
        <div className="invite-page__copy"><h1>Algo saiu do ritmo</h1><p>{lookup.message}</p></div>
        <Button onClick={() => window.location.reload()} variant="secondary">Tentar de novo</Button>
      </>
    );
  } else {
    const person = lookup.candidate;
    const name = firstName(person.displayName);
    const inviter = { customAvatarUrl: person.customAvatarUrl, frameId: person.frameId, name: person.displayName, photoUrl: person.photoUrl };
    const relationship = outcome === 'accepted' ? 'FRIEND' : outcome === 'sent' ? 'OUTGOING' : person.relationship;
    const copy: Record<typeof relationship, { action: ReactNode; eyebrow: string; text: string; title: string }> = {
      FRIEND: {
        action: <Button onClick={goSocial}><Icon name="bolt" />Desafiar no Social</Button>,
        eyebrow: outcome === 'accepted' ? 'Amizade feita' : 'Já são amigos',
        text: outcome === 'accepted'
          ? `Agora você e ${name} podem se desafiar e ver quando o outro está online.`
          : `Você e ${name} já estão na mesma roda. Bora um desafio?`,
        title: outcome === 'accepted' ? `Você e ${name} agora são amigos` : `Você e ${name} já são amigos`,
      },
      INCOMING: {
        action: (
          <Button disabled={busy} onClick={() => void acceptRequest(person)}>
            <Icon name="check" />{busy ? 'Aceitando…' : 'Aceitar e virar amigos'}
          </Button>
        ),
        eyebrow: 'Pedido esperando você',
        text: `${name} já te mandou um pedido de amizade. É só aceitar.`,
        title: `${name} quer ser seu amigo`,
      },
      NONE: {
        action: person.availableAt === null
          ? (
            <Button disabled={busy} onClick={() => void sendRequest(person)}>
              <Icon name="add" />{busy ? 'Enviando…' : `Adicionar ${name}`}
            </Button>
          )
          : <Button onClick={goSocial} variant="secondary"><Icon name="social" />Ir para o Social</Button>,
        eyebrow: 'Convite para duelar',
        text: person.availableAt === null
          ? 'Adicione para se desafiarem, ver quando está online e cair na mesma fila.'
          : `Você poderá mandar um novo pedido a partir de ${formatDay(person.availableAt)}.`,
        title: `${name} te chamou pra duelar`,
      },
      OUTGOING: {
        action: <Button onClick={goSocial} variant="secondary"><Icon name="social" />Ir para o Social</Button>,
        eyebrow: outcome === 'sent' ? 'Pedido enviado' : 'Pedido já enviado',
        text: `Falta só ${name} aceitar. Você recebe um aviso quando isso acontecer.`,
        title: outcome === 'sent' ? `Pedido enviado para ${name}!` : `Seu pedido para ${name} já está lá`,
      },
    };
    const view = copy[relationship];
    body = (
      <>
        <InviteDuo inviter={inviter} linked={relationship === 'FRIEND' || relationship === 'OUTGOING'} viewer={viewer} />
        <div className="invite-page__copy">
          <span className="eyebrow">{view.eyebrow}</span>
          <h1>{view.title}</h1>
          <span className="invite-page__id">{person.publicId}</span>
          <p>{view.text}</p>
        </div>
        {view.action}
        {relationship === 'NONE' && person.availableAt === null && (
          <Button disabled={busy} onClick={goHome} variant="ghost">Agora não</Button>
        )}
      </>
    );
  }

  return (
    <section className="page page--narrow invite-page">
      <div className="invite-card invite-card--lonely invite-page__card">
        {body}
        {error !== null && <p className="form-message form-message--error" role="alert">{error}</p>}
        <span aria-live="polite" className="sr-only">
          {outcome === 'sent' ? 'Pedido de amizade enviado' : outcome === 'accepted' ? 'Pedido aceito' : ''}
        </span>
      </div>
    </section>
  );
}
