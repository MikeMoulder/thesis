import { MalformedOutputError } from './types';

/**
 * Pull a JSON object out of a model response.
 *
 * Models wrap JSON in prose or fences even when told not to. Rather than
 * failing the whole run on a formatting habit, recover the object — but never
 * guess at content, only at where the object starts and ends.
 */
export function extractJson<T = unknown>(raw: string): T {
  const candidates = [raw, stripFence(raw), sliceOutermostObject(raw)];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next strategy
    }
  }

  throw new MalformedOutputError('Model response did not contain parseable JSON', raw);
}

function stripFence(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  return fenced?.[1]?.trim() ?? null;
}

/**
 * Take the span from the first `{` to its matching `}`, respecting strings and
 * escapes so a brace inside a quoted value does not end the object early.
 */
function sliceOutermostObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}
