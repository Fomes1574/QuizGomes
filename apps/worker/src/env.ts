export interface Env {
  ADMIN_FIREBASE_UIDS?: string;
  ALLOWED_ORIGINS?: string;
  /** Limite por IP de toda a API (opcional: sem o binding, não limita). */
  API_RATE_LIMITER?: RateLimit;
  ASSETS: Fetcher;
  CORE_DB: D1Database;
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FIREBASE_PROJECT_ID: string;
  CHALLENGE_ROOM: DurableObjectNamespace;
  MATCH_ROOM: DurableObjectNamespace;
  MATCHMAKING_QUEUE: DurableObjectNamespace;
  PRESENCE_HUB: DurableObjectNamespace;
  QUESTION_IMAGES: R2Bucket;
  QUESTIONS_DB: D1Database;
  SOCIAL_REALTIME_HUB: DurableObjectNamespace;
  TICKET_BROKER: DurableObjectNamespace;
  /** Limite por IP só de escrita (POST/PUT/PATCH/DELETE). */
  WRITE_RATE_LIMITER?: RateLimit;
}

export interface AuthenticatedUser {
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  picture: string | null;
  uid: string;
}
