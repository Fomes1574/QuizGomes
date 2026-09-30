import type { Env } from '../env.js';
import { ApiError } from './api-error.js';
import { apiErrorResponse } from './response.js';

const WRITE_METHODS = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);

/**
 * Freio contra rajadas automatizadas: um script que dispara centenas de
 * chamadas por minuto de um mesmo IP recebe 429 antes de tocar o banco,
 * poupando as cotas gratuitas de leitura/escrita do D1 e dos Durable Objects.
 * Limites folgados para uso humano (inclusive várias pessoas atrás do mesmo
 * IP de operadora) e para a importação em partes do admin, que tenta de novo.
 *
 * Sem IP (teste/local) ou sem o binding, não limita. Se o limitador falhar,
 * deixa passar: indisponibilidade dele nunca derruba o jogo.
 */
export async function rateLimitedResponse(request: Request, env: Env, url: URL): Promise<Response | null> {
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip === null || ip === '' || url.pathname === '/api/health') return null;
  try {
    const limiters: RateLimit[] = [];
    if (env.API_RATE_LIMITER !== undefined) limiters.push(env.API_RATE_LIMITER);
    if (env.WRITE_RATE_LIMITER !== undefined && WRITE_METHODS.has(request.method)) limiters.push(env.WRITE_RATE_LIMITER);
    for (const limiter of limiters) {
      const outcome = await limiter.limit({ key: ip });
      if (!outcome.success) {
        const response = apiErrorResponse(new ApiError(
          429,
          'RATE_LIMITED',
          'Muitas ações em pouco tempo. Espere alguns segundos e tente de novo.',
        ));
        response.headers.set('Retry-After', '10');
        return response;
      }
    }
  } catch {
    return null;
  }
  return null;
}
