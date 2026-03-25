import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFrontmatter, scanSkillFiles } from './scanner.js';

describe('parseFrontmatter', () => {
  it('name과 description을 추출한다', () => {
    const content = `---
name: brainstorming
description: 아이디어를 브레인스토밍하는 스킬
---

# Brainstorming
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe('brainstorming');
    expect(result.description).toBe('아이디어를 브레인스토밍하는 스킬');
  });

  it('frontmatter가 없으면 빈 객체를 반환한다', () => {
    const content = `# Some Skill

No frontmatter here.
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBeUndefined();
    expect(result.description).toBeUndefined();
  });

  it('여러 줄 description을 추출한다', () => {
    const content = `---
name: my-skill
description: 첫 번째 줄 설명
---
`;
    const result = parseFrontmatter(content);
    expect(result.description).toBe('첫 번째 줄 설명');
  });

  it('name만 있는 frontmatter를 처리한다', () => {
    const content = `---
name: only-name
---
`;
    const result = parseFrontmatter(content);
    expect(result.name).toBe('only-name');
    expect(result.description).toBeUndefined();
  });
});

describe('scanSkillFiles', () => {
  let baseDir: string;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'skills-test-'));
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it('commands 디렉토리의 .md 파일을 namespace 없이 스캔한다', async () => {
    const commandsDir = join(baseDir, 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(
      join(commandsDir, 'backlog.md'),
      `---
name: backlog
description: 백로그 관리 스킬
---
`
    );

    const entries = await scanSkillFiles([commandsDir], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('backlog');
    expect(entries[0].namespace).toBe('');
    expect(entries[0].fullName).toBe('backlog');
    expect(entries[0].description).toBe('백로그 관리 스킬');
    expect(entries[0].source).toBe('user');
  });

  it('plugins 디렉토리를 재귀 스캔하여 SKILL.md에서 namespace를 추출한다', async () => {
    const pluginsDir = join(baseDir, 'plugins');
    const skillDir = join(pluginsDir, 'superpowers', '5.0.5', 'skills', 'brainstorming');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: brainstorming
description: 창의적 아이디어 생성
---
`
    );

    const entries = await scanSkillFiles([], [pluginsDir]);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('brainstorming');
    expect(entries[0].namespace).toBe('superpowers');
    expect(entries[0].fullName).toBe('superpowers:brainstorming');
    expect(entries[0].description).toBe('창의적 아이디어 생성');
    expect(entries[0].source).toBe('plugin');
  });

  it('oh-my-claudecode namespace를 올바르게 추출한다', async () => {
    const pluginsDir = join(baseDir, 'plugins');
    const skillDir = join(pluginsDir, 'oh-my-claudecode', 'skills', 'ralph');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: ralph
description: Ralph 스킬
---
`
    );

    const entries = await scanSkillFiles([], [pluginsDir]);
    expect(entries).toHaveLength(1);
    expect(entries[0].namespace).toBe('oh-my-claudecode');
    expect(entries[0].fullName).toBe('oh-my-claudecode:ralph');
  });

  it('frontmatter 파싱 실패 파일은 건너뛴다', async () => {
    const commandsDir = join(baseDir, 'commands');
    await mkdir(commandsDir, { recursive: true });
    await writeFile(join(commandsDir, 'no-name.md'), `# 이름 없는 스킬\n\nfrontmatter 없음\n`);
    await writeFile(
      join(commandsDir, 'valid.md'),
      `---
name: valid-skill
description: 유효한 스킬
---
`
    );

    const entries = await scanSkillFiles([commandsDir], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('valid-skill');
  });

  it('존재하지 않는 디렉토리는 건너뛴다', async () => {
    const nonExistent = join(baseDir, 'does-not-exist');
    const entries = await scanSkillFiles([nonExistent], [nonExistent]);
    expect(entries).toHaveLength(0);
  });

  it('commands와 plugins를 함께 스캔한다', async () => {
    const commandsDir = join(baseDir, 'commands');
    const pluginsDir = join(baseDir, 'plugins');
    const skillDir = join(pluginsDir, 'myplugin', 'skills', 'myskill');

    await mkdir(commandsDir, { recursive: true });
    await mkdir(skillDir, { recursive: true });

    await writeFile(
      join(commandsDir, 'user-skill.md'),
      `---
name: user-skill
description: 사용자 스킬
---
`
    );
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: myskill
description: 플러그인 스킬
---
`
    );

    const entries = await scanSkillFiles([commandsDir], [pluginsDir]);
    expect(entries).toHaveLength(2);

    const userSkill = entries.find((e) => e.source === 'user');
    const pluginSkill = entries.find((e) => e.source === 'plugin');

    expect(userSkill?.name).toBe('user-skill');
    expect(pluginSkill?.namespace).toBe('myplugin');
  });
});
