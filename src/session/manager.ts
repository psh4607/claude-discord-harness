import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import type { TextChannel } from 'discord.js';

import type { Workspace } from './workspace.js';
import type { MessageSender } from '../message/sender.js';
import { formatResponse } from '../message/formatter.js';
import { archiveSession, type ArchiveResult } from '../storage/archive.js';

export interface SessionEntry {
  channelId: string;
  sessionId: string;
  workspacePath: string;
  createdAt: Date;
  status: 'active' | 'closing';
  activeQuery: Query | null;
}

interface QueueItem {
  prompt: string;
  channel: TextChannel;
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>();
  private queues = new Map<string, QueueItem[]>();
  private processing = new Set<string>();
  private shuttingDown = false;

  constructor(
    private workspace: Workspace,
    private sender: MessageSender,
  ) {}

  async create(channelId: string): Promise<SessionEntry> {
    const workspacePath = await this.workspace.create(channelId);

    const result = query({
      prompt: '새 세션이 시작되었습니다. 간단히 인사해주세요.',
      options: {
        cwd: workspacePath,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
      },
    });

    let sessionId = '';
    for await (const message of result) {
      if (message.type === 'result' && message.subtype === 'success') {
        sessionId = message.session_id;
      }
    }

    if (sessionId) {
      await this.workspace.saveSessionId(channelId, sessionId);
    }

    const entry: SessionEntry = {
      channelId,
      sessionId,
      workspacePath,
      createdAt: new Date(),
      status: 'active',
      activeQuery: null,
    };

    this.sessions.set(channelId, entry);
    this.queues.set(channelId, []);
    return entry;
  }

  async restore(channelId: string): Promise<SessionEntry> {
    const workspacePath = this.workspace.getWorkspacePath(channelId);
    const sessionId = await this.workspace.loadSessionId(channelId);

    const entry: SessionEntry = {
      channelId,
      sessionId: sessionId ?? '',
      workspacePath,
      createdAt: new Date(),
      status: 'active',
      activeQuery: null,
    };

    this.sessions.set(channelId, entry);
    this.queues.set(channelId, []);
    return entry;
  }

  enqueue(channelId: string, prompt: string, channel: TextChannel): void {
    if (this.shuttingDown) return;

    const queue = this.queues.get(channelId);
    if (!queue) return;

    queue.push({ prompt, channel });
    if (!this.processing.has(channelId)) {
      this.processQueue(channelId);
    }
  }

  private async processQueue(channelId: string): Promise<void> {
    this.processing.add(channelId);
    const queue = this.queues.get(channelId);

    while (queue && queue.length > 0) {
      const item = queue.shift()!;
      try {
        await this.processMessage(channelId, item.prompt, item.channel);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류';
        await item.channel.send(`오류가 발생했습니다: ${errorMessage}`).catch(() => {});
      }
    }

    this.processing.delete(channelId);
  }

  private async processMessage(
    channelId: string,
    prompt: string,
    channel: TextChannel,
  ): Promise<void> {
    const entry = this.sessions.get(channelId);
    if (!entry || entry.status !== 'active') return;

    this.sender.startTyping(channel);
    await this.sender.sendStatusUpdate(channel, '생각하는 중...');

    try {
      const result = query({
        prompt,
        options: {
          cwd: entry.workspacePath,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          ...(entry.sessionId ? { resume: entry.sessionId } : {}),
        },
      });
      entry.activeQuery = result;

      let responseText = '';
      for await (const message of result) {
        if (message.type === 'assistant') {
          await this.sender.sendStatusUpdate(channel, '응답 작성 중...');
        }
        if (message.type === 'result' && message.subtype === 'success') {
          responseText = message.result;
          if (message.session_id !== entry.sessionId) {
            entry.sessionId = message.session_id;
            await this.workspace.saveSessionId(channelId, message.session_id);
          }
        }
      }

      entry.activeQuery = null;

      if (responseText) {
        const formatted = formatResponse(responseText);
        await this.sender.sendResponse(channel, formatted);
      }
    } catch (err) {
      entry.activeQuery = null;

      // resume 실패 시 새 세션으로 폴백
      if (entry.sessionId && String(err).includes('session')) {
        entry.sessionId = '';
        await this.workspace.saveSessionId(channelId, '').catch(() => {});
        await channel.send('세션이 만료되었습니다. 새 세션으로 시작합니다.').catch(() => {});
        return;
      }

      throw err;
    } finally {
      this.sender.stopTyping(channelId);
      await this.sender.clearStatus(channelId);
    }
  }

  async close(channelId: string, channelName?: string): Promise<ArchiveResult | null> {
    const entry = this.sessions.get(channelId);
    if (!entry) return null;

    entry.status = 'closing';

    if (entry.activeQuery) {
      entry.activeQuery.close();
      entry.activeQuery = null;
    }

    this.sender.stopTyping(channelId);
    await this.sender.clearStatus(channelId);

    const result = await archiveSession(
      this.workspace,
      channelId,
      channelName ?? channelId,
    );

    this.sessions.delete(channelId);
    this.queues.delete(channelId);
    this.processing.delete(channelId);

    return result;
  }

  has(channelId: string): boolean {
    return this.sessions.has(channelId);
  }

  get(channelId: string): SessionEntry | undefined {
    return this.sessions.get(channelId);
  }

  shutdown(): void {
    this.shuttingDown = true;
    for (const entry of this.sessions.values()) {
      if (entry.activeQuery) {
        entry.activeQuery.close();
        entry.activeQuery = null;
      }
    }
  }

  get activeSessionCount(): number {
    return this.sessions.size;
  }
}
