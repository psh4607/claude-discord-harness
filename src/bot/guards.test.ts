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
