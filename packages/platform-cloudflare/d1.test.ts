import { describeDbContract } from '@repo/platform/contract/db';

import { createProxy } from './testing/proxy';

describeDbContract('D1 (workerd)', () => createProxy());
