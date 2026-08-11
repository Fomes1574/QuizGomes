import { describe, expect, it } from 'vitest';
import { corsHeaders, isRequestOriginAllowed } from '../http/response.js';

describe('política de origem da API', () => {
  it('aceita automaticamente a própria origem do Worker', () => {
    const request = new Request('https://quiz-gomes.exemplo.workers.dev/api/health', {
      headers: { Origin: 'https://quiz-gomes.exemplo.workers.dev' },
    });

    expect(isRequestOriginAllowed(request)).toBe(true);
    expect(corsHeaders(request).get('Access-Control-Allow-Origin'))
      .toBe('https://quiz-gomes.exemplo.workers.dev');
  });

  it('aceita localhost somente quando configurado explicitamente', () => {
    const request = new Request('http://localhost:8787/api/health', {
      headers: { Origin: 'http://localhost:5173' },
    });

    expect(isRequestOriginAllowed(request)).toBe(false);
    expect(isRequestOriginAllowed(request, 'http://localhost:5173')).toBe(true);
  });

  it('não trata wildcard ou origem estrangeira como autorizados', () => {
    const request = new Request('https://quiz-gomes.exemplo.workers.dev/api/profile/me', {
      headers: { Origin: 'https://malicioso.example' },
    });

    expect(isRequestOriginAllowed(request, '*')).toBe(false);
    expect(isRequestOriginAllowed(request, 'https://malicioso.example/caminho')).toBe(false);
    expect(corsHeaders(request, '*').has('Access-Control-Allow-Origin')).toBe(false);
  });

  it('permite clientes sem cabeçalho Origin sem transformar isso em CORS aberto', () => {
    const request = new Request('https://quiz-gomes.exemplo.workers.dev/api/health');

    expect(isRequestOriginAllowed(request)).toBe(true);
    expect(corsHeaders(request).has('Access-Control-Allow-Origin')).toBe(false);
  });
});
