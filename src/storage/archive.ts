import type { Workspace } from '../session/workspace.js';

export interface ArchiveResult {
  archivePath: string;
  channelId: string;
}

export async function archiveSession(
  workspace: Workspace,
  channelId: string,
  channelName: string,
): Promise<ArchiveResult> {
  const archivePath = await workspace.archive(channelId, channelName);
  return { archivePath, channelId };
}
