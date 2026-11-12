import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AdminShell } from '@/components/admin/AdminShell';
import { getAdminSession } from '@/lib/auth/requireAdmin';
import { getAppConfig } from '@/lib/config/appConfig';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s | Admin' },
  robots: { index: false, follow: false },
};

/**
 * Every admin PAGE: the gate (no live session → the login page) and the studio
 * shell around it (sidebar, mobile menu). Each admin API route checks again on
 * its own (`requireAdmin`, guard: admin-routes-require-admin) — a page gate
 * never protects an API.
 */
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  return <AdminShell appName={getAppConfig().appName}>{children}</AdminShell>;
}
