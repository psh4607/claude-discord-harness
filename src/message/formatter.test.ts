import { describe, it, expect } from 'vitest';
import { formatResponse } from './formatter.js';

describe('formatResponse', () => {
  it('2000자 이하: 단일 메시지', () => {
    const result = formatResponse('짧은 메시지');
    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0]).toBe('짧은 메시지');
    }
  });

  it('2000자 초과: 문단 경계에서 분할', () => {
    const paragraph = 'a'.repeat(1500);
    const content = `${paragraph}\n\n${paragraph}`;
    const result = formatResponse(content);
    expect(result.type).toBe('text');
    if (result.type === 'text') {
      expect(result.chunks.length).toBeGreaterThan(1);
      result.chunks.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(2000);
      });
    }
  });

  it('코드블록을 자르지 않음', () => {
    const code = '```typescript\n' + 'const x = 1;\n'.repeat(100) + '```';
    const content = 'before\n\n' + code + '\n\nafter';
    const result = formatResponse(content);
    if (result.type === 'text') {
      const codeChunk = result.chunks.find(c => c.includes('```typescript'));
      if (codeChunk) {
        const opens = (codeChunk.match(/```/g) || []).length;
        expect(opens % 2).toBe(0);
      }
    }
  });

  it('5개 이상 분할: 파일 첨부', () => {
    const content = Array(10).fill('a'.repeat(1800)).join('\n\n');
    const result = formatResponse(content);
    expect(result.type).toBe('file');
    if (result.type === 'file') {
      expect(result.filename).toMatch(/\.md$/);
    }
  });
});
