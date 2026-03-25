// src/index.ts
import { loadConfig } from './config/index.js';
import { createClient } from './bot/client.js';
import { registerEvents } from './bot/events.js';
import { SessionManager } from './session/manager.js';
import { Workspace } from './session/workspace.js';
import { MessageSender } from './message/sender.js';
import { scheduleRetention } from './storage/retention.js';

async function main() {
  const config = loadConfig();
  const workspace = new Workspace(config.dataDir);
  const sender = new MessageSender();
  const sessionManager = new SessionManager(workspace, sender);
  const client = createClient();

  registerEvents(client, sessionManager, config);

  const retentionTimer = scheduleRetention(
    workspace.paths.archives,
    workspace.paths.longTerm,
    config.retentionDays,
  );

  const shutdown = async () => {
    console.log('종료 시작...');
    sessionManager.shutdown();
    sender.cleanup();
    clearInterval(retentionTimer);
    client.destroy();
    console.log('종료 완료');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await client.login(config.discordToken);
}

main().catch((err) => {
  console.error('시작 실패:', err);
  process.exit(1);
});
