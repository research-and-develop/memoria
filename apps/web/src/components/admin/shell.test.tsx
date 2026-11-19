import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileBar } from './MobileBar';
import { NavList, NewGalleryAction } from './NavList';
import { PageHeader } from './PageHeader';

const nav = vi.hoisted(() => ({ pathname: '/admin' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

/** A controllable `matchMedia('(min-width: 1024px)')`. */
let mediaListeners: (() => void)[];
let desktop: boolean;
beforeEach(() => {
  nav.pathname = '/admin';
  mediaListeners = [];
  desktop = false;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return desktop;
    },
    addEventListener: (_: string, fn: () => void) => mediaListeners.push(fn),
    removeEventListener: () => {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('NavList', () => {
  it('marks the current page and links the built items', () => {
    nav.pathname = '/admin';
    render(<NavList />);
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows "Soon" items as text: not links, not focusable, announced once', () => {
    render(<NavList />);
    expect(screen.queryByRole('link', { name: /Selections/ })).toBeNull();
    const item = screen.getByText('Selections').closest('li') as HTMLElement;
    expect(item.textContent).toBe('Selections, not available yetSoon');
    expect(within(item).getByText('Soon').closest('[aria-hidden]')).not.toBeNull();
    expect(item.querySelector('a, button, [tabindex]')).toBeNull();
  });

  it('links Galleries and the New gallery action now that Phase 5 built them', () => {
    render(<NavList />);
    expect(screen.getByRole('link', { name: 'Galleries' })).toHaveAttribute('href', '/admin/galleries');
    cleanup();
    render(<NewGalleryAction />);
    expect(screen.getByRole('link', { name: /New gallery/ })).toHaveAttribute('href', '/admin/galleries/new');
  });
});

describe('MobileBar', () => {
  const renderBar = () =>
    render(
      <MobileBar mark={<span>Memoria</span>}>
        <a href="/admin">Dashboard</a>
      </MobileBar>,
    );
  const menu = () => screen.getByRole('button', { name: 'Menu' });
  const drawer = () => document.getElementById(menu().getAttribute('aria-controls') ?? '') as HTMLDialogElement;

  it('the Menu button controls the drawer and says whether it is open', () => {
    renderBar();
    expect(menu()).toHaveAttribute('aria-expanded', 'false');
    expect(drawer().tagName).toBe('DIALOG');
    menu().focus();
    fireEvent.click(menu());
    expect(menu()).toHaveAttribute('aria-expanded', 'true');
    expect(drawer()).toHaveAttribute('open');
    expect(document.documentElement.style.overflow).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(drawer()).not.toHaveAttribute('open');
    expect(document.documentElement.style.overflow).toBe('');
    expect(menu()).toHaveFocus();
  });

  it('closes on a navigation', () => {
    const { rerender } = renderBar();
    fireEvent.click(menu());
    nav.pathname = '/admin/design';
    rerender(
      <MobileBar mark={<span>Memoria</span>}>
        <a href="/admin">Dashboard</a>
      </MobileBar>,
    );
    expect(drawer()).not.toHaveAttribute('open');
  });

  it('closes when the window reaches the desktop width', () => {
    renderBar();
    fireEvent.click(menu());
    desktop = true;
    act(() => mediaListeners.forEach((fn) => fn()));
    expect(drawer()).not.toHaveAttribute('open');
  });

  it('closes on a click on the backdrop', () => {
    renderBar();
    fireEvent.click(menu());
    fireEvent.click(drawer());
    expect(drawer()).not.toHaveAttribute('open');
  });
});

describe('PageHeader', () => {
  it('is the page’s one h1, with its description and actions', () => {
    render(<PageHeader title="Dashboard" description="Today" actions={<button>Act</button>} />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Act' })).toBeInTheDocument();
  });
});
