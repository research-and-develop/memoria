import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serialize } from 'node:v8';

import type { TestProject } from 'vitest/node';

import { buildSourceIndex } from './sourceIndexBuild';

/**
 * vitest globalSetup: read the source tree ONCE per run and hand every guard
 * the snapshot. A v8-serialized file in the OS temp dir, named by pid so two
 * runs on one machine never share one; rebuilt before each watch-mode rerun so
 * a guard never checks stale code.
 */
let snapshotPath: string | null = null;
let projects = 0;

function writeSnapshot(file: string): void {
  writeFileSync(file, serialize(buildSourceIndex()));
}

export default function setup(project: TestProject): () => void {
  if (!snapshotPath) {
    snapshotPath = path.join(tmpdir(), `repo-source-index-${process.pid}.v8`);
    writeSnapshot(snapshotPath);
  }
  const file = snapshotPath;
  projects += 1;

  project.provide('sourceIndexPath', file);
  project.onTestsRerun(() => writeSnapshot(file));

  return () => {
    projects -= 1;
    if (projects === 0 && snapshotPath) {
      rmSync(snapshotPath, { force: true });
      snapshotPath = null;
    }
  };
}
