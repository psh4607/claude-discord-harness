# v2 SDK 리팩토링 설계 문서

Discord 봇을 Claude Agent SDK v2 (`SDKSession`) 기반으로 리팩토링하여, Claude Code 하네스 위에 올라타는 얇은 Transport Layer로 재설계한다.

## 핵심 원칙

**봇은 3가지만 한다:**
1. Discord 이벤트를 Claude Code 세션으로 전달
2. Claude Code 세션의 응답을 Discord로 전달
3. Claude에게 Discord API를 custom tool로 제공

나머지(컨텍스트 관리, compact, 도구 사용, 세션 영속성)는 전부 Claude Code 하네스가 처리한다.

## 아키텍처

### Transport Layer 패턴

```
Discord ←→ Transport Layer ←→ Claude Code Session
            (봇: ~300줄)         (하네스가 전부 처리)
```

### 디렉토리 구조

```
src/
  index.ts              # 진입점 (봇 초기화 + 세션 옵션 구성)
  bot/
    client.ts           # Discord.js 클라이언트 (기존 유지)
    events.ts           # 이벤트 핸들러 (v2 세션 연동으로 단순화)
    guards.ts           # 역할/카테고리 검증 (기존 유지)
    commands.ts         # Discord 슬래시 커맨드 등록 및 핸들링
  session/
    bridge.ts           # v2 SDKSession 래퍼 (send/stream + Discord 연동)
    pool.ts             # 채널별 세션 풀 관리 (create/get/close)
    options.ts          # SDKSessionOptions 팩토리 (hooks, tools, 모델 등)
  tools/
    discord.ts          # Claude용 Discord custom tools 정의
  message/
    formatter.ts        # 기존 유지
    sender.ts           # 기존 유지 (hooks에서도 재사용)
  storage/
    archive.ts          # 기존 유지
    retention.ts        # 기존 유지
  config/
    index.ts            # 환경변수 (모델명 등 추가)
```

### 변경 요약

| 모듈 | 변경 |
|------|------|
| `session/manager.ts` (227줄) | 삭제 → `bridge.ts` + `pool.ts`로 대체 |
| `session/workspace.ts` | 삭제 — 세션 ID 추적 불필요, 워크스페이스는 단순 디렉토리 |
| `storage/archive.ts`, `retention.ts` | 유지 |
| `bot/events.ts` | 단순화 — bridge에 위임 |
| `tools/discord.ts` | 신규 — Claude에게 Discord 풀 컨트롤 |
| `bot/commands.ts` | 신규 — 슬래시 커맨드로 제어 API |
| `session/options.ts` | 신규 — 세션 옵션 구성 |

## Session Bridge

### session/bridge.ts — 세션 1개의 생명주기

하나의 Discord 채널과 하나의 Claude Code 세션을 연결하는 래퍼.

```typescript
class SessionBridge {
  private session: SDKSession;
  private channel: TextChannel;

  async send(message: string): Promise<void> {
    await this.session.send(message);
    for await (const msg of this.session.stream()) {
      if (msg.type === 'result' && msg.subtype === 'success') {
        await this.sender.sendResponse(channel, formatResponse(msg.result));
      }
    }
  }

  close(): void {
    this.session.close();
  }
}
```

현재 `SessionManager`가 하던 것 vs Bridge:

| 현재 (직접 구현) | Bridge (하네스 위임) |
|----------------|-------------------|
| 세션 ID 추적 + session.json 영속화 | `SDKSession.sessionId` — 하네스가 관리 |
| 메시지 큐 + 동시성 제어 | `send()` → `stream()` 직렬 호출로 자연스럽게 해결 |
| resume 옵션으로 세션 이어가기 | `SDKSession`이 살아있는 한 자동 유지 |
| resume 실패 시 새 세션 폴백 | `unstable_v2_resumeSession()`으로 단순화 |
| `Query.close()`로 중단 | `session.close()` |

### session/pool.ts — 채널별 세션 관리

```typescript
class SessionPool {
  private bridges = new Map<string, SessionBridge>();

  create(channelId, channel, options) → SessionBridge
  get(channelId) → SessionBridge | undefined
  close(channelId) → archive 후 제거
  shutdown() → 전체 종료
}
```

### session/options.ts — 세션 옵션 팩토리

```typescript
function createSessionOptions(config, channel, client): SDKSessionOptions {
  return {
    model: config.model,
    permissionMode: 'bypassPermissions',
    hooks: createHooks(channel, sender),
  };
}
```

## Custom Tools — Claude에게 Discord 능력 부여

### tools/discord.ts

SDK의 `tool()` 함수로 Claude가 직접 호출할 수 있는 Discord 도구들을 정의한다.

**채널 관리:**

| Tool | 설명 |
|------|------|
| `list_channels` | 서버 채널 목록 조회 (카테고리별 필터) |
| `create_channel` | 채널 생성 (카테고리 지정, 토픽 설정) |
| `delete_channel` | 채널 삭제 |
| `set_channel_topic` | 채널 토픽 변경 |

**메시지:**

| Tool | 설명 |
|------|------|
| `send_message` | 특정 채널에 메시지 전송 |
| `read_messages` | 특정 채널의 최근 메시지 읽기 |
| `create_thread` | 스레드 생성 |
| `add_reaction` | 메시지에 리액션 추가 |
| `pin_message` | 메시지 고정 |

**서버 관리:**

| Tool | 설명 |
|------|------|
| `list_members` | 멤버 목록 조회 |
| `get_member_info` | 특정 멤버 정보 (역할, 닉네임 등) |
| `assign_role` | 멤버에게 역할 부여 |
| `remove_role` | 멤버에서 역할 제거 |

**구현 패턴:**

```typescript
import { tool } from '@anthropic-ai/claude-agent-sdk';

function createDiscordTools(client: Client) {
  return [
    tool(
      'send_message',
      '특정 Discord 채널에 메시지를 전송합니다',
      { channelId: z.string(), content: z.string() },
      async ({ channelId, content }) => {
        const channel = await client.channels.fetch(channelId);
        await channel.send(content);
        return { content: [{ type: 'text', text: '전송 완료' }] };
      }
    ),
  ];
}
```

## Hooks — 실시간 Discord 피드백

### 누적 로그 방식

도구 사용 기록을 삭제하지 않고 실행 로그로 남긴다:

```
┌ 실행 로그 ─────────────────────
│ 📖 src/bot/events.ts (1~50줄) 읽음
│ 🔎 "SDKSession" in src/ 검색
│ ✏️ src/session/bridge.ts 수정
│ ⚡ `pnpm test` → ✅ 18 passed
└ 4개 도구 사용 · 8초 소요
```

하나의 메시지를 누적 edit하다가, 완료 시 최종 요약으로 확정한다.

### 구현 방식

```typescript
function createHooks(channel, sender) {
  return {
    PreToolUse: [{
      callback: async (input) => {
        const label = toolLabel(input.tool_name, input.tool_input);
        await sender.sendStatusUpdate(channel, label);
      }
    }],
    PostToolUse: [{
      callback: async (input) => {
        // 도구 완료 시 결과(성공/실패) 업데이트
      }
    }],
  };
}

function toolLabel(name: string, input: unknown): string {
  const labels: Record<string, (input: any) => string> = {
    Read:  (i) => `📖 ${basename(i.file_path)}${i.offset ? ` (${i.offset}~${i.offset + (i.limit ?? 2000)}줄)` : ''} 읽는 중...`,
    Edit:  (i) => `✏️ ${basename(i.file_path)} 수정 중...`,
    Write: (i) => `📝 ${basename(i.file_path)} 작성 중...`,
    Bash:  (i) => `⚡ \`${i.description ?? truncate(i.command, 40)}\` 실행 중...`,
    Grep:  (i) => `🔎 "${truncate(i.pattern, 30)}" ${i.path ? `in ${basename(i.path)}` : ''} 검색 중...`,
    Glob:  (i) => `🔍 ${i.pattern} 탐색 중...`,
    Agent: ()  => `🤖 서브에이전트 실행 중...`,
  };
  return labels[name]?.(input) ?? `🔧 ${name} 실행 중...`;
}
```

## Discord 슬래시 커맨드 — 동적 등록

### 2계층 구조

**자동 등록 (Claude Code 하네스에서 동적 조회):**

세션 초기화 시 `session.initializationResult()`로 지원 명령어/모델/에이전트를 조회하여 Discord 슬래시 커맨드로 자동 등록한다. Claude Code가 업데이트되면 봇 재시작만으로 새 기능이 Discord에 반영된다.

```typescript
async function registerCommands(session, guild) {
  const init = await session.initializationResult();
  const claudeCommands = init.commands.map(cmd => ({
    name: cmd.name,
    description: cmd.description,
    options: cmd.argumentHint
      ? [{ name: 'args', description: cmd.argumentHint, type: 'STRING' }]
      : [],
  }));
  await guild.commands.set([...claudeCommands, ...botCommands]);
}
```

**봇 전용 (Discord 특화, 직접 정의):**

| 커맨드 | 설명 |
|--------|------|
| `/stop` | 현재 실행 중단 (interrupt control API) |
| `/status` | 세션 + MCP 상태 종합 |
| `/mcp add/toggle/list` | MCP 서버 동적 관리 |
| `/new` | 세션 초기화 (새 세션) |
| `/history` | 대화 로그 조회 (chat-history 활용) |
| `/instructions <text>` | 채널 CLAUDE.md 수정 |

## 워크스페이스 구조 & 활동 로그

### `.discord/` 디렉토리

```
data/workspaces/{channelId}/
  .discord/
    session.json              # 세션 메타 (ID, 채널명, 생성일시)
    chat-history/
      2026-03-25.md           # 일별 대화 + 도구 사용 통합 로그
      2026-03-26.md
  CLAUDE.md                   # 채널별 행동 지시 (선택)
  ... (Claude가 작업하는 파일들)
```

### chat-history 로그 형식

```markdown
# 세션 로그 — my-project
채널: #my-project | 시작: 2026-03-25 19:00

---

### [19:00:05] 👤 완두콩
이 프로젝트 구조 분석해줘

#### 실행 로그
- 📖 Read: src/index.ts (1~44줄)
- 📖 Read: src/bot/events.ts (1~88줄)
- 🔍 Glob: src/**/*.ts
- 🔎 Grep: "import" in src/config/

### [19:00:18] 🤖 Claude
이 프로젝트는 Discord 봇으로, 구조는 다음과 같습니다...
```

### 기록 방식

| 시점 | 기록 내용 |
|------|---------|
| `bridge.send()` 호출 시 | `### [시간] 👤 사용자명` + 메시지 내용 |
| `PreToolUse` hook | 실행 로그에 도구명 + 입력 추가 |
| `PostToolUse` hook | 결과 (성공/실패) 업데이트 |
| `result` 메시지 수신 시 | `### [시간] 🤖 Claude` + 응답 내용 |

### 로그 로테이션

일별 로테이션: `chat-history/YYYY-MM-DD.md` 파일로 자동 분리. 아카이브 시 `.discord/` 디렉토리가 그대로 보존된다.

## CLAUDE.md — 채널별 행동 커스터마이징

각 채널의 워크스페이스에 `CLAUDE.md`를 두면 채널별로 Claude의 행동을 선언적으로 제어할 수 있다. Claude Code 하네스가 세션 시작 시 `cwd` 기준으로 자동 로드한다.

채널 생성 시 기본 템플릿을 자동 생성하고, `/instructions` 슬래시 커맨드로 수정할 수 있다.

## 에러 처리

| 상황 | 처리 |
|------|------|
| `stream()`에서 에러 발생 | catch → Discord에 에러 메시지 + activity.md에 기록 |
| 세션 프로세스 죽음 | `resumeSession()`으로 재연결 시도 → 실패 시 새 세션 |
| Discord API 에러 | discord.js 내장 핸들링 의존 |
| Rate limit | `SDKRateLimitEvent` 메시지를 stream에서 감지 → Discord에 안내 |
| 봇 재시작 후 복구 | 채널 스캔 → `.discord/session.json`에서 ID 로드 → `resumeSession()` |

## Graceful Shutdown

```typescript
const shutdown = async () => {
  console.log('종료 시작...');
  pool.shutdown();     // 모든 bridge.close() → 세션 정리
  sender.cleanup();    // 타이핑 인디케이터 정리
  client.destroy();    // Discord 연결 종료
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
```

## 환경변수 변경

| 변수 | 설명 | 변경 |
|------|------|------|
| `DISCORD_TOKEN` | Discord 봇 토큰 | 유지 |
| `DISCORD_CATEGORY_NAME` | 관리할 카테고리명 (기본: claude) | 유지 |
| `DISCORD_REQUIRED_ROLE` | 봇 사용 역할 (미설정 시 전체 허용) | 유지 |
| `DATA_DIR` | 데이터 저장 경로 (기본: ./data) | 유지 |
| `ARCHIVE_RETENTION_DAYS` | 아카이브 보존 기간 (기본: 30) | 유지 |
| `CLAUDE_MODEL` | 세션 모델 (기본: claude-sonnet-4-6) | 신규 |

## 데이터 흐름

```
채널 생성 (claude 카테고리)
  → guards: 카테고리 확인
  → pool.create(): workspace 디렉토리 생성 + .discord/ 초기화
  → unstable_v2_createSession(options): 세션 시작
  → session.initializationResult(): 지원 명령어 조회 → 슬래시 커맨드 등록
  → 채널에 환영 메시지 전송

메시지 수신
  → guards: 카테고리/역할 확인
  → bridge.send(message): 세션에 메시지 전달
    → PreToolUse hook: Discord에 도구 사용 실시간 표시 + chat-history에 기록
    → PostToolUse hook: 결과 업데이트
    → result: formatter → sender로 응답 전송 + chat-history에 기록

슬래시 커맨드
  → Claude Code 명령어: session.send('/' + command)
  → 봇 전용 명령어: bridge/pool의 해당 메서드 호출

채널 삭제
  → pool.close(): bridge.close() → archive → Map 제거

봇 재시작
  → claude 카테고리 채널 스캔
  → .discord/session.json에서 sessionId 복원
  → unstable_v2_resumeSession()으로 재연결
  → 실패 시 새 세션 생성
```
