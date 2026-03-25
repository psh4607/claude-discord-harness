import { readdir, readFile, access } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

export interface SkillEntry {
  name: string;
  namespace: string;
  description: string;
  fullName: string;
  source: 'user' | 'project' | 'plugin';
}

export function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);

  return {
    ...(nameMatch ? { name: nameMatch[1].trim() } : {}),
    ...(descriptionMatch ? { description: descriptionMatch[1].trim() } : {}),
  };
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function scanCommandDir(dir: string): Promise<SkillEntry[]> {
  const entries: SkillEntry[] = [];
  let files: string[];

  try {
    files = await readdir(dir);
  } catch {
    return entries;
  }

  for (const file of files) {
    if (!file.endsWith('.md')) continue;

    try {
      const content = await readFile(join(dir, file), 'utf-8');
      const { name, description } = parseFrontmatter(content);

      if (!name) continue;

      entries.push({
        name,
        namespace: '',
        description: description ?? '',
        fullName: name,
        source: 'user',
      });
    } catch {
      // 파싱 실패 시 건너뜀
    }
  }

  return entries;
}

async function findSkillMdFiles(dir: string): Promise<string[]> {
  const results: string[] = [];

  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSkillMdFiles(fullPath);
      results.push(...nested);
    } else if (entry.name === 'SKILL.md') {
      results.push(fullPath);
    }
  }

  return results;
}

function extractNamespace(_pluginDir: string, skillMdPath: string): string {
  // 경로 패턴: .../{plugin-name}/[{version}/]skills/{skill-name}/SKILL.md
  // skills 위쪽으로 올라가며, 버전 패턴(숫자.숫자)은 건너뛰고 plugin-name을 찾는다
  const parts = skillMdPath.split('/');
  const skillsIdx = parts.lastIndexOf('skills');
  if (skillsIdx < 1) return '';

  // skills 위쪽으로 올라가며 버전이 아닌 첫 번째 이름을 반환
  for (let i = skillsIdx - 1; i >= 0; i--) {
    const segment = parts[i];
    if (/^\d+\.\d+/.test(segment)) continue; // 버전 패턴 건너뜀
    if (segment === 'cache' || segment === 'plugins' || segment === '.claude') continue;
    return segment;
  }
  return '';
}

async function scanPluginDir(dir: string): Promise<SkillEntry[]> {
  if (!(await dirExists(dir))) return [];

  const skillMdFiles = await findSkillMdFiles(dir);
  const entries: SkillEntry[] = [];

  for (const skillMdPath of skillMdFiles) {
    try {
      const content = await readFile(skillMdPath, 'utf-8');
      const { name, description } = parseFrontmatter(content);

      if (!name) continue;

      const namespace = extractNamespace(dir, skillMdPath);
      const fullName = namespace ? `${namespace}:${name}` : name;

      entries.push({
        name,
        namespace,
        description: description ?? '',
        fullName,
        source: 'plugin',
      });
    } catch {
      // 파싱 실패 시 건너뜀
    }
  }

  return entries;
}

export async function scanSkillFiles(
  commandDirs: string[],
  pluginDirs: string[]
): Promise<SkillEntry[]> {
  const commandEntries = await Promise.all(
    commandDirs.filter(Boolean).map((dir) => scanCommandDir(dir))
  );

  const pluginEntries = await Promise.all(
    pluginDirs.filter(Boolean).map((dir) => scanPluginDir(dir))
  );

  return [...commandEntries.flat(), ...pluginEntries.flat()];
}
