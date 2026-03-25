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
  const paragraphs = content.split('\n\n');
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;

    if (candidate.length <= MAX_LENGTH) {
      current = candidate;
    } else if (current) {
      chunks.push(current);
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
