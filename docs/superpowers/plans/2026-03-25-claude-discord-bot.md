# Claude Discord Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discord "claude" 카테고리 하위 채널과 Claude Code 세션을 1:1로 매핑하는 봇을 구현한다.

**Architecture:** discord.js v14로 채널 이벤트를 감지하고, @anthropic-ai/claude-agent-sdk의 `query()` API로 세션을 관리한다. 채널별 메시지 큐로 동시성을 제어하고, sessionId를 디스크에 영속화하여 재시작 시 복구한다.

**Tech Stack:** TypeScript, discord.js v14, @anthropic-ai/claude-agent-sdk, tsup

**Spec:** `docs/superpowers/specs/2026-03-25-claude-discord-bot-design.md`

---

## File Map

| 파일 | 책임 | 생성/수정 |
|------|------|-----------|
| `package.json` | 의존성, 스크립트 | 생성 |
| `tsconfig.json` | TypeScript 설정 | 생성 |
| `tsup.config.ts` | 번들링 설정 | 생성 |
| `.gitignore` | data/, node_modules/, dist/, .env | 생성 |
| `.env.example` | 환경변수 템플릿 | 생성 |
| `src/config/index.ts` | 환경변수 파싱, 설정 객체 | 생성 |
| `src/session/workspace.ts` | 작업 디렉토리 CRUD, sessionId 영속화 | 생성 |
| `src/message/formatter.ts` | 2000자 분할, 코드블록 보존 | 생성 |
| `src/message/sender.ts` | 타이핑, 상태 메시지, 응답 전송 | 생성 |
| `src/bot/guards.ts` | 카테고리/역할 검증 | 생성 |
| `src/session/manager.ts` | 세션 라이프사이클, 메시지 큐 | 생성 |
| `src/storage/archive.ts` | 아카이브 + metadata.json | 생성 |
| `src/storage/retention.ts` | 30일 보관 정책 | 생성 |
| `src/bot/client.ts` | Discord 클라이언트 생성 | 생성 |
| `src/bot/events.ts` | 이벤트 핸들러 등록 | 생성 |
| `src/index.ts` | 진입점, 부트스트랩, graceful shutdown | 생성 |
| `CLAUDE.md` | 프로젝트 컨텍스트 | 생성 |

---

## Task 1: 프로젝트 스캐폴딩

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `CLAUDE.md`

- [ ] **Step 1: git init**

```bash
cd /Users/seongho/projects/seongho/projects/claude-discord-bot
git init
```

- [ ] **Step 2: package.json 생성**

```json
{
  "name": "claude-discord-bot",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "discord.js": "^14.16.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: tsconfig.json 생성**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: tsup.config.ts 생성**

```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
});
```

- [ ] **Step 5: .gitignore 생성**

```
node_modules/
dist/
data/
.env
.DS_Store
```

- [ ] **Step 6: .env.example 생성**

```
DISCORD_TOKEN=
DISCORD_CATEGORY_NAME=claude
DISCORD_REQUIRED_ROLE=
ANTHROPIC_API_KEY=
DATA_DIR=./data
ARCHIVE_RETENTION_DAYS=30
```

- [ ] **Step 7: CLAUDE.md 생성**

프로젝트 설명, 기술 스택, 디렉토리 구조, 빌드/실행 명령을 포함한다.

- [ ] **Step 8: pnpm install**

```bash
pnpm install
```

- [ ] **Step 9: 빌드 확인**

빈 `src/index.ts` (placeholder `console.log('claude-discord-bot')`) 생성 후:

```bash
pnpm build
```

Expected: `dist/index.js` 생성됨

- [ ] **Step 10: Commit**

```bash
git add .
git commit -m "chore: 프로젝트 스캐폴딩"
```

---

## Task 2: Config 모듈

**Files:**
- Create: `src/config/index.ts`
- Create: `src/config/index.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/config/index.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './index.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('필수 환경변수 누락 시 에러', () => {
    delete process.env.DISCORD_TOKEN;
    expect(() => loadConfig()).toThrow('DISCORD_TOKEN');
  });

  it('기본값 적용', () => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.DISCORD_REQUIRED_ROLE = 'admin';
    const config = loadConfig();
    expect(config.categoryName).toBe('claude');
    expect(config.dataDir).toContain('data');
    expect(config.retentionDays).toBe(30);
  });

  it('환경변수 오버라이드', () => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.DISCORD_REQUIRED_ROLE = 'admin';
    process.env.DISCORD_CATEGORY_NAME = 'my-claude';
    process.env.ARCHIVE_RETENTION_DAYS = '7';
    const config = loadConfig();
    expect(config.categoryName).toBe('my-claude');
    expect(config.retentionDays).toBe(7);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/config/index.test.ts
```

Expected: FAIL — `loadConfig` not found

- [ ] **Step 3: 구현**

```typescript
// src/config/index.ts
import { resolve } from 'node:path';

export interface Config {
  discordToken: string;
  categoryName: string;
  requiredRole: string;
  anthropicApiKey: string;
  dataDir: string;
  retentionDays: number;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`환경변수 ${key}가 설정되지 않았습니다`);
  return value;
}

export function loadConfig(): Config {
  return {
    discordToken: requireEnv('DISCORD_TOKEN'),
    anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
    requiredRole: requireEnv('DISCORD_REQUIRED_ROLE'),
    categoryName: process.env.DISCORD_CATEGORY_NAME ?? 'claude',
    dataDir: resolve(process.env.DATA_DIR ?? './data'),
    retentionDays: Number(process.env.ARCHIVE_RETENTION_DAYS ?? '30'),
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/config/index.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/
git commit -m "feat: config 모듈 구현"
```

---

## Task 3: Workspace 모듈

**Files:**
- Create: `src/session/workspace.ts`
- Create: `src/session/workspace.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/session/workspace.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workspace } from './workspace.js';

describe('Workspace', () => {
  let baseDir: string;
  let workspace: Workspace;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'ws-test-'));
    workspace = new Workspace(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('create: 작업 디렉토리 생성', async () => {
    const path = await workspace.create('ch-123');
    expect(path).toContain('ch-123');
    const entries = await readdir(join(baseDir, 'workspaces'));
    expect(entries).toContain('ch-123');
  });

  it('saveSessionId / loadSessionId: 영속화', async () => {
    await workspace.create('ch-123');
    await workspace.saveSessionId('ch-123', 'sess-abc');
    const id = await workspace.loadSessionId('ch-123');
    expect(id).toBe('sess-abc');
  });

  it('loadSessionId: 파일 없으면 null', async () => {
    await workspace.create('ch-123');
    const id = await workspace.loadSessionId('ch-123');
    expect(id).toBeNull();
  });

  it('archive: workspaces → archives 이동', async () => {
    await workspace.create('ch-123');
    const archivePath = await workspace.archive('ch-123', 'my-channel');
    expect(archivePath).toContain('archives');
    expect(archivePath).toContain('ch-123');

    const workspaces = await readdir(join(baseDir, 'workspaces'));
    expect(workspaces).not.toContain('ch-123');

    const metadata = JSON.parse(
      await readFile(join(archivePath, 'metadata.json'), 'utf-8')
    );
    expect(metadata.channelId).toBe('ch-123');
    expect(metadata.channelName).toBe('my-channel');
    expect(metadata.archivedAt).toBeDefined();
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/session/workspace.test.ts
```

Expected: FAIL

- [ ] **Step 3: 구현**

```typescript
// src/session/workspace.ts
import { mkdir, rename, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export class Workspace {
  private workspacesDir: string;
  private archivesDir: string;
  private longTermDir: string;

  constructor(dataDir: string) {
    this.workspacesDir = join(dataDir, 'workspaces');
    this.archivesDir = join(dataDir, 'archives');
    this.longTermDir = join(dataDir, 'long-term');
  }

  async create(channelId: string): Promise<string> {
    const dir = join(this.workspacesDir, channelId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async archive(channelId: string, channelName: string): Promise<string> {
    const src = join(this.workspacesDir, channelId);
    const timestamp = Date.now();
    const dest = join(this.archivesDir, `${channelId}_${timestamp}`);
    await mkdir(this.archivesDir, { recursive: true });
    await rename(src, dest);

    const metadata = {
      channelId,
      channelName,
      createdAt: new Date().toISOString(),
      archivedAt: new Date().toISOString(),
      movedToLongTermAt: null,
    };
    await writeFile(join(dest, 'metadata.json'), JSON.stringify(metadata, null, 2));
    return dest;
  }

  async cleanup(channelId: string): Promise<void> {
    const { rm } = await import('node:fs/promises');
    const dir = join(this.workspacesDir, channelId);
    await rm(dir, { recursive: true, force: true });
  }

  async saveSessionId(channelId: string, sessionId: string): Promise<void> {
    const filePath = join(this.workspacesDir, channelId, 'session.json');
    await writeFile(filePath, JSON.stringify({ sessionId }));
  }

  async loadSessionId(channelId: string): Promise<string | null> {
    const filePath = join(this.workspacesDir, channelId, 'session.json');
    try {
      await access(filePath);
      const data = JSON.parse(await readFile(filePath, 'utf-8'));
      return data.sessionId ?? null;
    } catch {
      return null;
    }
  }

  getWorkspacePath(channelId: string): string {
    return join(this.workspacesDir, channelId);
  }

  get paths() {
    return {
      workspaces: this.workspacesDir,
      archives: this.archivesDir,
      longTerm: this.longTermDir,
    };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/session/workspace.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/workspace.ts src/session/workspace.test.ts
git commit -m "feat: workspace 모듈 구현"
```

---

## Task 4: Message Formatter

**Files:**
- Create: `src/message/formatter.ts`
- Create: `src/message/formatter.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/message/formatter.test.ts
import { describe, it, expect } from 'vitest';
import { formatResponse } from './formatter.js';

describe('formatResponse', () => {
  it('2000자 이하: 단일 메시지', () => {
    const result = formatResponse('짧은 메시지');
    expect(result.type).toBe('text');
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toBe('짧은 메시지');
  });

  it('2000자 초과: 문단 경계에서 분할', () => {
    const paragraph = 'a'.repeat(1500);
    const content = `${paragraph}\n\n${paragraph}`;
    const result = formatResponse(content);
    expect(result.type).toBe('text');
    expect(result.chunks.length).toBeGreaterThan(1);
    result.chunks.forEach(chunk => {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    });
  });

  it('코드블록을 자르지 않음', () => {
    const code = '```typescript\n' + 'const x = 1;\n'.repeat(100) + '```';
    const content = 'before\n\n' + code + '\n\nafter';
    const result = formatResponse(content);
    const codeChunk = result.chunks.find(c => c.includes('```typescript'));
    if (codeChunk) {
      const opens = (codeChunk.match(/```/g) || []).length;
      expect(opens % 2).toBe(0);
    }
  });

  it('5개 이상 분할: 파일 첨부', () => {
    const content = Array(10).fill('a'.repeat(1800)).join('\n\n');
    const result = formatResponse(content);
    expect(result.type).toBe('file');
    expect(result.filename).toMatch(/\.md$/);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/message/formatter.test.ts
```

Expected: FAIL

- [ ] **Step 3: 구현**

```typescript
// src/message/formatter.ts
const MAX_LENGTH = 2000;
const MAX_CHUNKS = 5;

export interface TextMessage {
  type: 'text';
  chunks: string[];
}

export interface FileMessage {
  type: 'file';
  summary: string;
  content: string;
  filename: string;
}

export type FormattedMessage = TextMessage | FileMessage;

export function formatResponse(content: string): FormattedMessage {
  if (content.length <= MAX_LENGTH) {
    return { type: 'text', chunks: [content] };
  }

  const chunks = splitContent(content);

  if (chunks.length >= MAX_CHUNKS) {
    return {
      type: 'file',
      summary: content.slice(0, 200) + '...',
      content,
      filename: `response-${Date.now()}.md`,
    };
  }

  return { type: 'text', chunks };
}

function splitContent(content: string): string[] {
  // 문단 경계 분할
  const paragraphs = content.split('\n\n');
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;

    if (candidate.length <= MAX_LENGTH) {
      current = candidate;
    } else if (current) {
      chunks.push(current);
      // 단일 문단이 MAX_LENGTH 초과 시 줄바꿈 기준 분할
      if (para.length > MAX_LENGTH) {
        chunks.push(...splitByNewline(para));
        current = '';
      } else {
        current = para;
      }
    } else {
      chunks.push(...splitByNewline(para));
      current = '';
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitByNewline(text: string): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= MAX_LENGTH) {
      current = candidate;
    } else {
      if (current) chunks.push(current);
      current = line.length > MAX_LENGTH ? line.slice(0, MAX_LENGTH) : line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/message/formatter.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/message/
git commit -m "feat: message formatter 구현"
```

---

## Task 5: Bot Guards

**Files:**
- Create: `src/bot/guards.ts`
- Create: `src/bot/guards.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/bot/guards.test.ts
import { describe, it, expect } from 'vitest';
import { isClaudeCategory, hasRequiredRole } from './guards.js';

describe('isClaudeCategory', () => {
  it('카테고리명 일치 시 true', () => {
    const channel = { parent: { name: 'claude' } } as any;
    expect(isClaudeCategory(channel, 'claude')).toBe(true);
  });

  it('카테고리명 불일치 시 false', () => {
    const channel = { parent: { name: 'general' } } as any;
    expect(isClaudeCategory(channel, 'claude')).toBe(false);
  });

  it('parent가 null이면 false', () => {
    const channel = { parent: null } as any;
    expect(isClaudeCategory(channel, 'claude')).toBe(false);
  });
});

describe('hasRequiredRole', () => {
  it('역할 보유 시 true', () => {
    const member = {
      roles: { cache: new Map([['1', { name: 'admin' }]]) },
    } as any;
    expect(hasRequiredRole(member, 'admin')).toBe(true);
  });

  it('역할 미보유 시 false', () => {
    const member = {
      roles: { cache: new Map([['1', { name: 'user' }]]) },
    } as any;
    expect(hasRequiredRole(member, 'admin')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
pnpm test src/bot/guards.test.ts
```

Expected: FAIL

- [ ] **Step 3: 구현**

```typescript
// src/bot/guards.ts
import type { GuildChannel, GuildMember } from 'discord.js';

export function isClaudeCategory(
  channel: GuildChannel,
  categoryName: string,
): boolean {
  return channel.parent?.name === categoryName;
}

export function hasRequiredRole(
  member: GuildMember,
  roleName: string,
): boolean {
  return member.roles.cache.some(role => role.name === roleName);
}

export function canUseSession(
  channel: GuildChannel,
  member: GuildMember,
  categoryName: string,
  roleName: string,
): boolean {
  return isClaudeCategory(channel, categoryName) && hasRequiredRole(member, roleName);
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
pnpm test src/bot/guards.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/
git commit -m "feat: bot guards 구현"
```

---

## Task 6: Storage 모듈 (Archive + Retention)

**Files:**
- Create: `src/storage/archive.ts`
- Create: `src/storage/retention.ts`
- Create: `src/storage/retention.test.ts`

- [ ] **Step 1: archive.ts 작성**

archive는 Workspace.archive()에 위임하는 thin wrapper이므로 별도 테스트 없이 구현한다.

```typescript
// src/storage/archive.ts
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
```

- [ ] **Step 2: retention 테스트 작성**

```typescript
// src/storage/retention.test.ts
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

    await moveExpiredArchives(
      join(baseDir, 'archives'),
      join(baseDir, 'long-term'),
      30,
    );

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

    await moveExpiredArchives(
      join(baseDir, 'archives'),
      join(baseDir, 'long-term'),
      30,
    );

    const archives = await readdir(join(baseDir, 'archives'));
    expect(archives).toContain('ch-new_2000');
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
pnpm test src/storage/retention.test.ts
```

Expected: FAIL

- [ ] **Step 4: retention.ts 구현**

```typescript
// src/storage/retention.ts
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
  // 시작 시 즉시 1회
  moveExpiredArchives(archivesDir, longTermDir, retentionDays);

  // 약 24시간 간격
  return setInterval(
    () => moveExpiredArchives(archivesDir, longTermDir, retentionDays),
    24 * 60 * 60 * 1000,
  );
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
pnpm test src/storage/retention.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/storage/
git commit -m "feat: storage 모듈 구현 (archive + retention)"
```

---

## Task 7: Message Sender

**Files:**
- Create: `src/message/sender.ts`

- [ ] **Step 1: 구현**

Discord API와 직접 상호작용하므로 단위 테스트 대신 통합 테스트에서 검증한다.

```typescript
// src/message/sender.ts
import {
  type TextChannel,
  type Message,
  AttachmentBuilder,
} from 'discord.js';
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
```

- [ ] **Step 2: Commit**

```bash
git add src/message/sender.ts
git commit -m "feat: message sender 구현"
```

---

## Task 8: Session Manager

**Files:**
- Create: `src/session/manager.ts`

- [ ] **Step 1: 구현**

SDK와 Discord 모두 의존하므로 통합 수준에서 검증한다.

```typescript
// src/session/manager.ts
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
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
  activeQuery: { close: () => void } | null;
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
        sessionId = message.session_id ?? '';
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
```

- [ ] **Step 2: Commit**

```bash
git add src/session/manager.ts
git commit -m "feat: session manager 구현"
```

---

## Task 9: Bot Client + Events

**Files:**
- Create: `src/bot/client.ts`
- Create: `src/bot/events.ts`

- [ ] **Step 1: client.ts 구현**

```typescript
// src/bot/client.ts
import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
  });
}
```

- [ ] **Step 2: events.ts 구현**

```typescript
// src/bot/events.ts
import type { Client, TextChannel, GuildChannel, GuildMember } from 'discord.js';
import { ChannelType } from 'discord.js';
import type { SessionManager } from '../session/manager.js';
import type { Config } from '../config/index.js';
import { isClaudeCategory, hasRequiredRole } from './guards.js';

export function registerEvents(
  client: Client,
  sessionManager: SessionManager,
  config: Config,
): void {
  client.on('channelCreate', async (channel) => {
    if (!isGuildTextChannel(channel)) return;
    if (!isClaudeCategory(channel, config.categoryName)) return;

    // channelCreate 이벤트에서는 생성자 정보가 제공되지 않으므로
    // 세션만 생성하고, 역할 검증은 messageCreate에서 수행한다.
    try {
      await sessionManager.create(channel.id);
      await channel.send('Claude Code 세션이 연결되었습니다.');
    } catch (err) {
      console.error(`세션 생성 실패 (${channel.id}):`, err);
      await channel.send('세션 연결에 실패했습니다.').catch(() => {});
    }
  });

  client.on('channelDelete', async (channel) => {
    if (!sessionManager.has(channel.id)) return;

    try {
      await sessionManager.close(channel.id, (channel as any).name);
    } catch (err) {
      console.error(`세션 종료 실패 (${channel.id}):`, err);
    }
  });

  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const channel = message.channel;
    if (!isGuildTextChannel(channel)) return;
    if (!isClaudeCategory(channel, config.categoryName)) return;

    const member = message.member;
    if (!member || !hasRequiredRole(member, config.requiredRole)) return;

    if (!sessionManager.has(channel.id)) {
      await channel.send('세션이 연결되지 않았습니다. 채널을 다시 생성해주세요.');
      return;
    }

    sessionManager.enqueue(channel.id, message.content, channel);
  });

  client.once('ready', async () => {
    console.log(`봇 로그인 완료: ${client.user?.tag}`);
    await recoverSessions(client, sessionManager, config);
  });
}

async function recoverSessions(
  client: Client,
  sessionManager: SessionManager,
  config: Config,
): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const channels = guild.channels.cache.filter(
      (ch) => isGuildTextChannel(ch) && isClaudeCategory(ch, config.categoryName),
    );

    for (const [, channel] of channels) {
      if (sessionManager.has(channel.id)) continue;
      try {
        await sessionManager.restore(channel.id);
        await (channel as TextChannel).send('세션이 재연결되었습니다.').catch(() => {});
      } catch (err) {
        console.error(`세션 복구 실패 (${channel.id}):`, err);
      }
    }
  }
}

function isGuildTextChannel(channel: any): channel is TextChannel {
  return channel.type === ChannelType.GuildText;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/bot/client.ts src/bot/events.ts
git commit -m "feat: bot client 및 event handler 구현"
```

---

## Task 10: 진입점 + Graceful Shutdown

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: 구현**

```typescript
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

  // Graceful shutdown
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
```

- [ ] **Step 2: 빌드 확인**

```bash
pnpm build
```

Expected: `dist/index.js` 정상 생성

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: 진입점 및 graceful shutdown 구현"
```

---

## Task 11: 전체 테스트 + 빌드 검증

- [ ] **Step 1: 전체 테스트 실행**

```bash
pnpm test
```

Expected: 모든 테스트 PASS

- [ ] **Step 2: 빌드 검증**

```bash
pnpm build
```

Expected: `dist/index.js` 생성, 에러 없음

- [ ] **Step 3: .env 파일 생성 및 수동 확인**

```bash
cp .env.example .env
# .env 파일에 실제 값 입력 후
node dist/index.js
```

Expected: "봇 로그인 완료: ..." 메시지 출력

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: 전체 테스트 및 빌드 검증 완료"
```
