import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { buttonClassName } from '@repo/ui/button';

import { GalleriesList } from '@/components/admin/galleries/GalleriesList';
import { PageHeader } from '@/components/admin/PageHeader';
import { getAdminSession } from '@/lib/auth/requireAdmin';

export const metadata: Metadata = { title: 'Galleries' };
export const dynamic = 'force-dynamic';

/** Galleries (plan p05 T5.3): the list renders in the browser from the paged API (D5.14). */
export default async function GalleriesPage() {
  const session = await getAdminSession();
  if (!session) redirect('/admin/login');
  return (
    <div className="flex flex-col gap-7">
      <PageHeader
        title="Galleries"
        actions={
          <Link href="/admin/galleries/new" className={buttonClassName({ variant: 'primary' })}>
            New gallery
          </Link>
        }
      />
      <GalleriesList />
    </div>
  );
}
