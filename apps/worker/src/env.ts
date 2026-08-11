export interface Env {
  ADMIN_FIREBASE_UIDS?: string;
  ALLOWED_ORIGINS?: string;
  ASSETS: Fetcher;
  CORE_DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  MATCH_ROOM: DurableObjectNamespace;
  MATCHMAKING_QUEUE: DurableObjectNamespace;
  PRESENCE_HUB: DurableObjectNamespace;
  QUESTIONS_DB: D1Database;
  TICKET_BROKER: DurableObjectNamespace;
}

export interface AuthenticatedUser {
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  uid: string;
}
