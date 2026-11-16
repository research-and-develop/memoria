import { firstRow, statement, type Options } from '@repo/db/client';

import { JOB_COLUMNS, toJobRow, type JobDbRow, type JobRow } from './types';

export function getJob(id: string, opts?: Options): Promise<JobRow | null> {
  return firstRow<JobDbRow, JobRow>(statement(`SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`, [id]), toJobRow, opts);
}
