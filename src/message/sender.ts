import { AttachmentBuilder, type Message, type TextChannel } from 'discord.js';

import type { FormattedMessage } from './formatter.js';

export class MessageSender {
  private typingIntervals = new Map<string, NodeJS.Timeout>();
  private statusMessages = new Map<string, Message>();

  startTyping(channel: TextChannel): void {
    channel.sendTyping();
    const interval = setInterval(() => channel.sendTyping(), 9000);
    this.typingIntervals.set(channel.id, interval);
  }

  stopTyping(channelId: string): void {
    const interval = this.typingIntervals.get(channelId);
    if (interval) {
      clearInterval(interval);
      this.typingIntervals.delete(channelId);
    }
  }

  async sendStatusUpdate(channel: TextChannel, status: string): Promise<void> {
    const existing = this.statusMessages.get(channel.id);
    if (existing) {
      await existing.edit(status).catch(() => {});
    } else {
      const msg = await channel.send(status);
      this.statusMessages.set(channel.id, msg);
    }
  }

  async clearStatus(channelId: string): Promise<void> {
    const msg = this.statusMessages.get(channelId);
    if (msg) {
      await msg.delete().catch(() => {});
      this.statusMessages.delete(channelId);
    }
  }

  async sendResponse(channel: TextChannel, formatted: FormattedMessage): Promise<void> {
    if (formatted.type === 'text') {
      for (const chunk of formatted.chunks) {
        await channel.send(chunk);
      }
    } else {
      const attachment = new AttachmentBuilder(
        Buffer.from(formatted.content, 'utf-8'),
        { name: formatted.filename },
      );
      await channel.send({
        content: formatted.summary,
        files: [attachment],
      });
    }
  }

  cleanup(): void {
    for (const interval of this.typingIntervals.values()) {
      clearInterval(interval);
    }
    this.typingIntervals.clear();

    for (const msg of this.statusMessages.values()) {
      msg.delete().catch(() => {});
    }
    this.statusMessages.clear();
  }
}
