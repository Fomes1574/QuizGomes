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

export interface SocialSnapshot {
  friends: SocialUser[];
  incoming: SocialRequest[];
  outgoing: SocialRequest[];
}

export type FriendPresence = 'ONLINE' | 'MATCHMAKING' | 'IN_MATCH' | 'RECONNECTING' | 'OFFLINE';

export interface FriendPresenceEntry {
  presence: FriendPresence;
  publicId: string;
  revision: number;
}

export interface FriendPresenceSnapshot {
  friends: FriendPresenceEntry[];
  revision: number;
}
