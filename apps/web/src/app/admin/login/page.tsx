import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { Card, Section } from '@repo/ui/layout';
import { Heading } from '@repo/ui/typography';

import { LoginForm } from '@/components/admin/LoginForm';
import { getAdminSession } from '@/lib/auth/requireAdmin';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false, follow: false } };

export default async function AdminLoginPage() {
  if (await getAdminSession()) redirect('/admin');
  return (
    <main>
      <Section surface="ground" className="min-h-screen">
        <Card className="mx-auto flex max-w-md flex-col gap-6 rounded-panel p-6 sm:p-8">
          <Heading level={1} size="title-lg">
            Admin sign-in
          </Heading>
          <LoginForm />
        </Card>
      </Section>
    </main>
  );
}
