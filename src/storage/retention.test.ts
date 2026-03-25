import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { moveExpiredArchives } from './retention.js';

describe('moveExpiredArchives', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'retention-test-'));
    await mkdir(join(baseDir, 'archives'), { recursive: true });
    await mkdir(join(baseDir, 'long-term'), { recursive: true });
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('30일 경과 아카이브를 long-term으로 이동', async () => {
    const oldDir = join(baseDir, 'archives', 'ch-old_1000');
    await mkdir(oldDir);
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(
      join(oldDir, 'metadata.json'),
      JSON.stringify({ archivedAt: oldDate, movedToLongTermAt: null }),
    );

    await moveExpiredArchives(join(baseDir, 'archives'), join(baseDir, 'long-term'), 30);

    const archives = await readdir(join(baseDir, 'archives'));
    expect(archives).not.toContain('ch-old_1000');

    const longTerm = await readdir(join(baseDir, 'long-term'));
    expect(longTerm).toContain('ch-old_1000');

    const metadata = JSON.parse(
      await readFile(join(baseDir, 'long-term', 'ch-old_1000', 'metadata.json'), 'utf-8'),
    );
    expect(metadata.movedToLongTermAt).toBeDefined();
  });

  it('30일 미만 아카이브는 이동하지 않음', async () => {
    const recentDir = join(baseDir, 'archives', 'ch-new_2000');
    await mkdir(recentDir);
    await writeFile(
      join(recentDir, 'metadata.json'),
      JSON.stringify({ archivedAt: new Date().toISOString(), movedToLongTermAt: null }),
    );

    await moveExpiredArchives(join(baseDir, 'archives'), join(baseDir, 'long-term'), 30);

    const archives = await readdir(join(baseDir, 'archives'));
    expect(archives).toContain('ch-new_2000');
  });
});
