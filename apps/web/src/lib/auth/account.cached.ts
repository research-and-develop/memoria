import 'server-only';

import { perRender } from '@/lib/perRender';

import { readAdminAccount } from './account';

/** The account, read once per server render (server components only; routes use `ctx.account`). */
export const getAdminAccount = perRender(() => readAdminAccount());
