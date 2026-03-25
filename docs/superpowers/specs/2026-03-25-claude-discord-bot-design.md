# Claude Discord Bot 설계 문서

Discord 채널과 Claude Code 세션을 1:1로 매핑하여, 채널 메시지로 Claude Code와 대화할 수 있는 봇.

## 개요

- "claude" 카테고리 하위에 채널을 생성하면 Claude Code 세션이 자동 연결
- 채널에 메시지를 보내면 Claude Code가 응답
- 채널을 삭제하면 세션이 종료되고 작업물이 아카이브됨

## 요구사항

| 항목 | 결정 |
|------|------|
| 세션 관리 | `@anthropic-ai/claude-agent-sdk` |
| 작업 디렉토리 | 채널별 임시 디렉토리 자동 생성 (프로젝트 내 `data/`) |
| 데이터 보관 | 아카이브 → 30일 후 장기보관 이동 |
| 권한 | Discord Role 기반 제한 |
| 메시지 포맷 | 메시지 우선, 긴 응답은 `.md` 파일 첨부 |
| 진행 상태 | 타이핑 인디케이터 + 중간 상태 메시지 (edit 방식) |
| 배포 | dalpha-mac 원격 서버에 데몬 실행 |
| Claude Code 권한 | 전체 허용 (`permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true`) |

## 기술 스택

- **Runtime:** Node.js + TypeScript
- **Discord:** discord.js v14
- **Claude Code:** @anthropic-ai/claude-agent-sdk
- **빌드:** tsup

## 아키텍처

### 디렉토리 구조

```
claude-discord-bot/
├── src/
│   ├── index.ts              # 진입점, 봇 초기화
│   ├── bot/
│   │   ├── client.ts         # Discord.js 클라이언트 설정
│   │   ├── events.ts         # channelCreate, channelDelete, messageCreate 핸들러
│   │   └── guards.ts         # 역할 검증, 카테고리 필터링
│   ├── session/
│   │   ├── manager.ts        # 세션 생성/종료/조회 + 채널별 메시지 큐
│   │   └── workspace.ts      # 임시 디렉토리 생성/관리
│   ├── message/
│   │   ├── formatter.ts      # 마크다운 변환, 메시지 분할
│   │   └── sender.ts         # 메시지/파일 전송, 타이핑 인디케이터
│   ├── storage/
│   │   ├── archive.ts        # 채널 삭제 시 아카이브
│   │   └── retention.ts      # 30일 후 장기보관 이동
│   └── config/
│       └── index.ts          # 환경변수, 설정값
├── data/                     # .gitignore에 추가
│   ├── workspaces/           # 활성 세션 작업 디렉토리
│   ├── archives/             # 아카이브 (채널 삭제 후)
│   └── long-term/            # 장기보관 (30일 경과)
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── .env.example
├── .gitignore
└── CLAUDE.md
```

## 모듈 상세 설계

### Bot 모듈

#### bot/client.ts

Discord.js Client를 생성하고 필요한 Intent를 설정한다.

- `Guilds` — 서버 정보
- `GuildMessages` — 메시지 수신
- `MessageContent` — 메시지 내용 접근

Partials 설정:
- `Partials.Channel` — channelDelete 이벤트에서 부분 데이터 수신 허용

#### bot/events.ts

3개의 핵심 이벤트를 처리한다.

**channelCreate:**
1. guards로 "claude" 카테고리 하위인지 확인
2. sessionManager.create(channel.id) 호출
3. 채널에 환영 메시지 전송
   - Discord API의 channelCreate 이벤트에서는 생성자 정보를 제공하지 않으므로, 역할 검증은 messageCreate에서만 수행한다.

**channelDelete:**
1. sessions Map에 channelId가 존재하는지 확인 (카테고리 정보 대신)
2. 존재하면 sessionManager.close(channel.id) 호출

**messageCreate:**
1. 봇 메시지 무시
2. guards로 카테고리/역할 확인
3. sessionManager에서 해당 세션 조회
4. sessionManager.enqueue(channel.id, prompt)로 메시지 큐에 추가
5. 큐가 순차 처리: 타이핑 → query() → 응답 전송

#### bot/guards.ts

- `isClaudeCategory(channel)` — channel.parent?.name이 설정된 카테고리명과 일치하는지 확인
- `hasRequiredRole(member)` — 설정된 역할 보유 여부 확인
- `canUseSession(channel, member)` — 위 두 조건의 조합

### Session 모듈

#### session/manager.ts

```typescript
interface SessionEntry {
  channelId: string;
  sessionId: string;         // Claude Agent SDK 세션 ID
  workspacePath: string;
  createdAt: Date;
  status: 'active' | 'closing';
}
```

- `sessions: Map<string, SessionEntry>` — channelId를 키로 세션 관리
- `queues: Map<string, Queue>` — channelId를 키로 메시지 큐 관리

**핵심 메서드:**

```typescript
create(channelId: string): Promise<SessionEntry>
  // 1. workspace 디렉토리 생성
  // 2. query()로 초기 세션 시작, sessionId 캡처
  // 3. sessionId를 data/workspaces/{channelId}/session.json에 영속화
  // 4. Map에 등록

enqueue(channelId: string, prompt: string, channel: TextChannel): void
  // 1. 메시지를 채널별 큐에 추가
  // 2. 큐가 비어있었으면 processQueue() 시작

close(channelId: string): Promise<ArchiveResult>
  // 1. 진행 중인 query가 있으면 Query.close()로 중단
  // 2. 아카이브 수행
  // 3. Map + 큐에서 제거
```

**큐 처리 (동시성 제어):**

```typescript
private async processQueue(channelId: string): Promise<void>
  // 큐에서 메시지를 하나씩 꺼내 순차 처리
  // 이전 query() 완료 후 다음 메시지 처리
  // 같은 채널의 동시 query() 호출 방지
```

#### Claude Agent SDK 사용 방식

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

// 세션 최초 생성 시
const result = query({
  prompt: '새 세션이 시작되었습니다.',
  options: {
    cwd: workspacePath,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  }
});

for await (const message of result) {
  if (message.type === 'result') {
    // message.session_id를 캡처하여 저장
    sessionEntry.sessionId = message.session_id;
  }
}

// 이후 메시지 전달 시 (컨텍스트 유지)
const result = query({
  prompt: userMessage,
  options: {
    cwd: workspacePath,
    resume: sessionEntry.sessionId,  // 이전 세션 이어가기
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  }
});

for await (const message of result) {
  // 스트리밍 처리
  if (message.type === 'assistant') {
    // 중간 상태 메시지 업데이트
  }
  if (message.type === 'result') {
    // 최종 응답 추출
  }
}
```

#### session/workspace.ts

- `create(channelId)` — `data/workspaces/{channelId}/` 디렉토리 생성, 경로 반환
- `archive(channelId)` — `data/workspaces/` → `data/archives/{channelId}_{timestamp}/` 이동
- `cleanup(channelId)` — 활성 디렉토리 제거
- `saveSessionId(channelId, sessionId)` — `session.json`에 sessionId 영속화
- `loadSessionId(channelId)` — `session.json`에서 sessionId 복원

### Message 모듈

#### message/formatter.ts

Discord의 2000자 제한을 처리한다.

분할 전략:
1. 2000자 이하 → 그대로 메시지 전송
2. 2000자 초과 → 코드블록/문단 경계에서 분할
3. 분할이 5개 이상 → 전체를 `.md` 파일로 첨부 + 요약 메시지

분할 규칙:
- 코드블록(```) 중간에서 자르지 않음
- 문단(`\n\n`) 경계 우선 분할
- 그래도 2000자 초과 시 줄바꿈(`\n`) 기준 분할

#### message/sender.ts

- `sendTyping(channel)` — 10초마다 타이핑 인디케이터 갱신
- `sendStatusUpdate(channel, status)` — 상태 메시지 생성/edit (하나만 유지)
- `sendResponse(channel, formatted)` — 텍스트 메시지 또는 파일 첨부 전송
- 최종 응답 전송 후 상태 메시지 삭제

### Storage 모듈

#### storage/archive.ts

채널 삭제 시 호출된다.

- `archive(workspacePath, channelId)` — workspaces → archives로 디렉토리 이동
- 이동 시 `metadata.json` 생성:

```json
{
  "channelId": "123456",
  "channelName": "my-task",
  "createdAt": "2026-03-25T10:00:00Z",
  "archivedAt": "2026-03-26T15:30:00Z",
  "movedToLongTermAt": null
}
```

#### storage/retention.ts

`setInterval`로 약 24시간 간격 실행한다 (봇 시작 시 1회 즉시 실행).

- `archives/` 내 30일 경과 항목을 `long-term/`으로 이동
- `metadata.json`의 `movedToLongTermAt` 필드 갱신

### Config 모듈

#### config/index.ts

환경변수 기반 설정:

```
DISCORD_TOKEN          — Discord 봇 토큰
DISCORD_CATEGORY_NAME  — 감시할 카테고리명 (기본: "claude")
DISCORD_REQUIRED_ROLE  — 필요 역할명
ANTHROPIC_API_KEY      — Claude API 키 (SDK에서 사용)
DATA_DIR               — 데이터 디렉토리 경로 (기본: ./data)
ARCHIVE_RETENTION_DAYS — 아카이브 보관 기간 (기본: 30)
```

## 데이터 흐름

```
채널 생성 (claude 카테고리)
  → guards: 역할 확인
  → workspace: data/workspaces/{channelId}/ 생성
  → manager: query() 최초 호출 → sessionId 캡처 → session.json 영속화
  → 채널에 환영 메시지 전송

메시지 수신
  → guards: 카테고리/역할 확인
  → manager: 채널별 큐에 메시지 추가
  → 큐 순차 처리:
    → sender: 타이핑 + 상태 메시지
    → query({ prompt, options: { resume: sessionId, cwd } })
    → for await: 스트리밍 응답 수신, 상태 메시지 업데이트
    → formatter: 최종 응답 분할/변환
    → sender: 메시지 또는 파일 전송, 상태 메시지 삭제

채널 삭제
  → sessions Map에서 channelId 확인
  → 진행 중 query가 있으면 Query.close()로 중단
  → archive: data/archives/{channelId}_{timestamp}/ 로 이동 + metadata.json
  → Map + 큐에서 제거

약 24시간 간격 (setInterval, 봇 시작 시 즉시 1회)
  → retention: 30일 경과 아카이브 → long-term/ 이동

봇 종료 (SIGTERM/SIGINT)
  → 모든 활성 query에 abort signal 전달
  → 타이핑 인디케이터 중단
  → Discord 클라이언트 정리 종료
```

## 에러 처리

| 상황 | 처리 |
|------|------|
| Claude SDK query() 오류 | 채널에 에러 메시지 전송, 세션 유지 |
| Claude API rate limit (429) | 채널에 "잠시 후 다시 시도해주세요" 안내 |
| 세션 없는 채널에 메시지 | "세션이 연결되지 않았습니다" 안내 |
| 봇 재시작 | claude 카테고리 채널 스캔 → session.json에서 sessionId 복원 → resume으로 컨텍스트 유지 |
| resume 실패 (세션 만료/손상) | session.json 삭제 → 새 세션 생성 → 채널에 "새 세션으로 시작합니다" 안내 |
| 디스크 공간 부족 | 아카이브 실패 시 로그 + 채널 알림 |
| Discord API rate limit | discord.js 내장 핸들링 의존 |

봇 재시작 시:
- "claude" 카테고리 하위 채널 목록 조회
- 각 채널에 대해 `data/workspaces/{channelId}/session.json` 확인
- session.json 존재 시 `sessionId`를 복원하여 대화 컨텍스트 유지
- session.json 없으면 새 세션 생성
- 채널에 "세션이 재연결되었습니다" 알림 전송

## Graceful Shutdown

PM2의 SIGTERM 수신 시 순서:
1. 새 메시지 큐 추가 중단
2. 모든 활성 query에 Query.close() 호출
3. 진행 중인 상태 메시지 삭제
4. Discord 클라이언트 destroy()
5. 프로세스 종료

## 배포

- dalpha-mac 원격 서버에서 데몬으로 실행
- PM2로 프로세스 관리 (`pm2 start dist/index.js --name claude-discord-bot`)
- 빌드: `tsup`으로 번들링 → `node dist/index.js`로 실행
