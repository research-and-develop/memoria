import { redirect } from 'next/navigation';

import { SETTINGS_HOME } from '@/components/admin/settings/nav';

/** `/admin/settings` opens the first built section. */
export default function SettingsIndexPage() {
  redirect(SETTINGS_HOME);
}
