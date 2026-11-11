'use client';

import { createContext, useContext, type ReactNode } from 'react';

import type { AppConfig } from '@/lib/config/appConfig';

/**
 * Hands server-read runtime config to client components. The root layout
 * (a server component) calls `getAppConfig()` and passes the result here.
 * `import type` above is erased before bundling, so the server-only module
 * never reaches the browser.
 */
const AppConfigContext = createContext<AppConfig | null>(null);

export function AppProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  return <AppConfigContext.Provider value={config}>{children}</AppConfigContext.Provider>;
}

export function useAppConfig(): AppConfig {
  const config = useContext(AppConfigContext);
  if (!config) throw new Error('useAppConfig must be used inside <AppProvider>');
  return config;
}
