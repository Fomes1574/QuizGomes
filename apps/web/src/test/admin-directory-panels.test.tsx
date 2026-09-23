// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditLogPanel, AdminUsersPanel } from '../pages/admin-directory-panels.js';

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn(), getToken: vi.fn(() => Promise.resolve('synthetic-auth')) }));
vi.mock('../lib/api.js', () => ({ apiRequest: mocks.apiRequest }));

describe('AdminUsersPanel', () => {
  beforeEach(() => { mocks.apiRequest.mockReset(); });
  afterEach(cleanup);

  it('lista usuários e concede/revoga ADMIN', async () => {
    const user = { createdAt: '2026-01-01T00:00:00.000Z', displayName: 'Jogador Um', publicId: '#QGONE1', role: 'PLAYER' as const, userId: 'user-1' };
    mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path.startsWith('/api/admin/users') && (options?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ nextCursor: null, users: [user] });
      }
      if (path === '/api/admin/users/user-1/roles/admin' && options?.method === 'POST') return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: true });
    });
    render(<AdminUsersPanel currentUserId="admin-self" getToken={mocks.getToken} />);

    expect(await screen.findByText('Jogador Um')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Conceder ADMIN' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/users/user-1/roles/admin', expect.objectContaining({ method: 'POST' })));
    expect(await screen.findByRole('button', { name: 'Revogar ADMIN' })).toBeInTheDocument();
  });

  it('revogar ADMIN pede confirmação antes de chamar a API', async () => {
    const admin = { createdAt: '2026-01-01T00:00:00.000Z', displayName: 'Outro Admin', publicId: '#QGADM1', role: 'ADMIN' as const, userId: 'user-2' };
    mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path.startsWith('/api/admin/users') && (options?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ nextCursor: null, users: [admin] });
      }
      if (path === '/api/admin/users/user-2/roles/admin' && options?.method === 'DELETE') return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: true });
    });
    render(<AdminUsersPanel currentUserId="admin-self" getToken={mocks.getToken} />);

    expect(await screen.findByText('Outro Admin')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revogar ADMIN' }));
    expect(mocks.apiRequest).not.toHaveBeenCalledWith('/api/admin/users/user-2/roles/admin', expect.anything());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revogar ADMIN' }));
    await waitFor(() => expect(mocks.apiRequest).toHaveBeenCalledWith('/api/admin/users/user-2/roles/admin', expect.objectContaining({ method: 'DELETE' })));
  });

  it('não permite revogar o próprio acesso', async () => {
    const self = { createdAt: '2026-01-01T00:00:00.000Z', displayName: 'Eu Mesmo', publicId: '#QGSELF', role: 'ADMIN' as const, userId: 'admin-self' };
    mocks.apiRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path.startsWith('/api/admin/users') && (options?.method ?? 'GET') === 'GET') {
        return Promise.resolve({ nextCursor: null, users: [self] });
      }
      return Promise.resolve({ ok: true });
    });
    render(<AdminUsersPanel currentUserId="admin-self" getToken={mocks.getToken} />);

    expect(await screen.findByText('Eu Mesmo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revogar ADMIN' })).toBeDisabled();
  });
});

describe('AdminAuditLogPanel', () => {
  beforeEach(() => { mocks.apiRequest.mockReset(); });
  afterEach(cleanup);

  it('lista as entradas mais recentes com o ator', async () => {
    mocks.apiRequest.mockImplementation((path: string) => {
      if (path.startsWith('/api/admin/audit-logs')) {
        return Promise.resolve({
          entries: [{
            action: 'APPROVE_THEME', actorDisplayName: 'Admin Um', createdAt: '2026-01-02T00:00:00.000Z',
            entityId: 'theme-1', entityType: 'theme', id: 'audit-1', metadata: {},
          }],
          nextCursor: null,
        });
      }
      return Promise.resolve({ ok: true });
    });
    render(<AdminAuditLogPanel getToken={mocks.getToken} />);

    expect(await screen.findByText('APPROVE_THEME')).toBeInTheDocument();
    expect(screen.getByText('Admin Um')).toBeInTheDocument();
    expect(screen.getByText('theme · theme-1')).toBeInTheDocument();
  });

  it('sem entradas mostra o estado vazio', async () => {
    mocks.apiRequest.mockImplementation(() => Promise.resolve({ entries: [], nextCursor: null }));
    render(<AdminAuditLogPanel getToken={mocks.getToken} />);
    expect(await screen.findByText('Nenhuma ação registrada ainda.')).toBeInTheDocument();
  });
});
