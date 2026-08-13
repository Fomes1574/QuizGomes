// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar, resolveAvatarSource } from '../components/avatar.js';

describe('resolução centralizada de avatar', () => {
  afterEach(() => cleanup());

  it('prioriza custom, depois Google e por fim iniciais', () => {
    expect(resolveAvatarSource('/custom.webp', '/google.jpg')).toBe('/custom.webp');
    expect(resolveAvatarSource(null, '/google.jpg')).toBe('/google.jpg');
    expect(resolveAvatarSource(null, null)).toBeNull();
  });

  it('recua de custom quebrado para Google e depois para iniciais', () => {
    const { container } = render(<Avatar customUrl="/custom.webp" googleUrl="/google.jpg" name="Ana" />);
    const custom = container.querySelector('img');
    expect(custom).toHaveAttribute('src', '/custom.webp');
    fireEvent.error(custom as Element);
    const google = container.querySelector('img');
    expect(google).toHaveAttribute('src', '/google.jpg');
    fireEvent.error(google as Element);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container).toHaveTextContent('A');
  });
});
