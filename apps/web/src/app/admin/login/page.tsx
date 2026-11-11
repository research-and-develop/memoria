import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Section } from '@repo/ui/layout';
import { Heading } from '@repo/ui/typography';

import { LoginForm } from '@/components/admin/LoginForm';
import { getAdminSession } from '@/lib/auth/requireAdmin';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  if (await getAdminSession()) redirect('/admin');
  return (
    <main>
      <Section surface="lavender" className="min-h-screen">
        <div className="mx-auto flex max-w-md flex-col gap-6 rounded-panel bg-white p-8 shadow-card">
          <Heading level={1} size="lg">
            Admin sign-in
          </Heading>
          <LoginForm />
        </div>
      </Section>
    </main>
  );
}
