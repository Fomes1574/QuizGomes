export interface SocialUser {
  customAvatarUrl: string | null;
  displayName: string;
  frameId: string | null;
  photoUrl: string | null;
  publicId: string;
}

export interface SocialCandidate extends SocialUser {
  availableAt: string | null;
  relationship: 'FRIEND' | 'INCOMING' | 'NONE' | 'OUTGOING';
  requestId: string | null;
}

export interface SocialRequest {
  createdAt: string;
  id: string;
  user: SocialUser;
}

export interface SocialFriend extends SocialUser {
  /** Silenciado por você: some das notificações, continua amigo e desafiável. */
  muted: boolean;
}

export interface SocialSnapshot {
  friendLimit: number;
  friends: SocialFriend[];
  incoming: SocialRequest[];
  incomingNextCursor: string | null;
  outgoing: SocialRequest[];
  outgoingNextCursor: string | null;
}

export type FriendPresence = 'ONLINE' | 'MATCHMAKING' | 'IN_MATCH' | 'RECONNECTING' | 'OFFLINE';

export interface FriendPresenceEntry {
  presence: FriendPresence;
  publicId: string;
  /** Tema da fila, só enquanto o amigo procura partida. */
  queueThemeId?: string;
  revision: number;
}

export interface FriendPresenceSnapshot {
  friends: FriendPresenceEntry[];
  revision: number;
}
