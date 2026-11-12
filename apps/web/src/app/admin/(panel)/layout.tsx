import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Container } from '@repo/ui/layout';
import { Text } from '@repo/ui/typography';

import { LogoutButton } from '@/components/admin/LogoutButton';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { getAppConfig } from '@/lib/config/appConfig';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s | Admin' },
  robots: { index: false, follow: false },
};

/**
 * The gate for every admin PAGE: no live session → the login page. Each admin
 * API route checks again on its own (`requireAdmin`, guard:
 * admin-routes-require-admin) — a page gate never protects an API.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  const { appName } = getAppConfig();
  return (
    <div className="min-h-screen bg-ground">
      <header className="border-b border-line bg-surface">
        <Container className="flex h-16 items-center justify-between gap-4">
          <Text weight="title">
            {appName} · Admin
          </Text>
          <LogoutButton />
        </Container>
      </header>
      <Container className="py-8">{children}</Container>
    </div>
  );
}
