import { PageHeader } from '@/components/admin/PageHeader';
import { SettingsNav } from '@/components/admin/settings/SettingsNav';

/** Settings: the section list beside (from `lg`) or above the section. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-7">
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <SettingsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
