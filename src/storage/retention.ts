import { readdir, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function moveExpiredArchives(
  archivesDir: string,
  longTermDir: string,
  retentionDays: number,
): Promise<number> {
  await mkdir(longTermDir, { recursive: true });
  let movedCount = 0;

  let entries: string[];
  try {
    entries = await readdir(archivesDir);
  } catch {
    return 0;
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    const metadataPath = join(archivesDir, entry, 'metadata.json');
    try {
      const raw = await readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(raw);

      if (metadata.movedToLongTermAt) continue;

      const archivedAt = new Date(metadata.archivedAt).getTime();
      if (archivedAt < cutoff) {
        const dest = join(longTermDir, entry);
        await rename(join(archivesDir, entry), dest);
        metadata.movedToLongTermAt = new Date().toISOString();
        await writeFile(join(dest, 'metadata.json'), JSON.stringify(metadata, null, 2));
        movedCount++;
      }
    } catch {
      // metadata.json 없거나 파싱 실패 시 스킵
    }
  }

  return movedCount;
}

export function scheduleRetention(
  archivesDir: string,
  longTermDir: string,
  retentionDays: number,
): NodeJS.Timeout {
  moveExpiredArchives(archivesDir, longTermDir, retentionDays);
  return setInterval(
    () => moveExpiredArchives(archivesDir, longTermDir, retentionDays),
    24 * 60 * 60 * 1000,
  );
}
