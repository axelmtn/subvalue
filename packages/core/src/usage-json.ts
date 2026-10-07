import type { Provider } from './types.ts';

// These are the fields consumed by the provider adapters. Conversation text,
// instructions, working directories and tool content have no selected path.
type Fields = { readonly [key: string]: Fields | 'text' | 'number' };
type Selection = Fields | 'text' | 'number' | undefined;
const counters: Fields = {
  input_tokens: 'number',
  cached_input_tokens: 'number',
  cache_write_input_tokens: 'number',
  output_tokens: 'number',
  reasoning_output_tokens: 'number',
  total_tokens: 'number',
};
const fields: Record<Provider, Fields> = {
  codex: {
    type: 'text',
    timestamp: 'text',
    ordinal: 'number',
    payload: {
      type: 'text',
      id: 'text',
      model: 'text',
      subagent_history_start_ordinal: 'number',
      info: { total_token_usage: counters, last_token_usage: counters },
    },
  },
  claude: {
    type: 'text',
    timestamp: 'text',
    sessionId: 'text',
    requestId: 'text',
    message: {
      id: 'text',
      model: 'text',
      usage: {
        input_tokens: 'number',
        cache_read_input_tokens: 'number',
        cache_creation_input_tokens: 'number',
        output_tokens: 'number',
        cache_creation: {
          ephemeral_5m_input_tokens: 'number',
          ephemeral_1h_input_tokens: 'number',
        },
        service_tier: 'text',
        speed: 'text',
        server_tool_use: { web_search_requests: 'number', web_fetch_requests: 'number' },
      },
    },
  },
};

/** Validate one JSONL line and decode only whitelisted metadata scalars.
 * Skipped strings remain bytes: no prompt/response strings or objects are built.
 * The line's byte buffer is discarded by the scanner after processing.
 */
export function usageMetadata(bytes: Buffer, provider: Provider): any {
  let at = 0;
  const fail = (): never => {
    throw new SyntaxError('Invalid usage JSON');
  };
  const space = () => {
    while (
      at < bytes.length &&
      (bytes[at] === 32 || bytes[at] === 9 || bytes[at] === 10 || bytes[at] === 13)
    )
      at++;
  };
  const string = (): number => {
    const buffer = bytes;
    let i = at + 1;
    for (; i < buffer.length; i++) {
      const byte = buffer[i];
      if (byte === 34) {
        at = i + 1;
        return at;
      }
      if (byte < 32) fail();
      if (byte === 92) {
        const escaped = buffer[++i];
        if (escaped === 117) {
          for (let j = 0; j < 4; j++) {
            const hex = buffer[++i];
            if (!(
              (hex >= 48 && hex <= 57) ||
              (hex >= 65 && hex <= 70) ||
              (hex >= 97 && hex <= 102)
            ))
              fail();
          }
        } else if (![34, 92, 47, 98, 102, 110, 114, 116].includes(escaped)) fail();
      }
    }
    return fail();
  };
  const number = () => {
    if (bytes[at] === 45) at++;
    if (bytes[at] === 48) at++;
    else {
      if (!(bytes[at] >= 49 && bytes[at] <= 57)) fail();
      while (bytes[at] >= 48 && bytes[at] <= 57) at++;
    }
    if (bytes[at] === 46) {
      at++;
      if (!(bytes[at] >= 48 && bytes[at] <= 57)) fail();
      while (bytes[at] >= 48 && bytes[at] <= 57) at++;
    }
    if (bytes[at] === 101 || bytes[at] === 69) {
      at++;
      if (bytes[at] === 43 || bytes[at] === 45) at++;
      if (!(bytes[at] >= 48 && bytes[at] <= 57)) fail();
      while (bytes[at] >= 48 && bytes[at] <= 57) at++;
    }
  };
  const value = (selected: Selection, depth: number): any => {
    if (depth > 512) fail();
    space();
    const start = at,
      byte = bytes[at];
    if (byte === 123) {
      at++;
      space();
      const object: Record<string, unknown> | undefined =
        selected && typeof selected === 'object' ? {} : undefined;
      if (bytes[at] === 125) {
        at++;
        return object ?? (selected ? null : undefined);
      }
      while (at < bytes.length) {
        if (bytes[at] !== 34) fail();
        const keyStart = at;
        string();
        let child: Selection = undefined,
          key = '';
        // All selected keys are short ASCII names; escaped spellings are allowed.
        if (object && at - keyStart <= 192) {
          key = JSON.parse(bytes.toString('utf8', keyStart, at));
          if (selected && typeof selected === 'object' && Object.hasOwn(selected, key))
            child = selected[key];
        }
        space();
        if (bytes[at++] !== 58) fail();
        const result = value(child, depth + 1);
        if (child) object![key] = result;
        space();
        const next = bytes[at++];
        if (next === 125) return object ?? (selected ? null : undefined);
        if (next !== 44) fail();
        space();
      }
      return fail();
    }
    if (byte === 91) {
      at++;
      space();
      if (bytes[at] === 93) {
        at++;
        return selected && typeof selected === 'object' ? [] : selected ? null : undefined;
      }
      while (at < bytes.length) {
        value(undefined, depth + 1);
        space();
        const next = bytes[at++];
        if (next === 93)
          return selected && typeof selected === 'object' ? [] : selected ? null : undefined;
        if (next !== 44) fail();
      }
      return fail();
    }
    if (byte === 34) string();
    else if (byte === 45 || (byte >= 48 && byte <= 57)) number();
    else {
      const literal =
        byte === 116 ? 'true' : byte === 102 ? 'false' : byte === 110 ? 'null' : fail();
      for (let i = 0; i < literal.length; i++) if (bytes[at++] !== literal.charCodeAt(i)) fail();
    }
    if (!selected) return undefined;
    if (!(
      (selected === 'text' && byte === 34) ||
      (selected === 'number' && (byte === 45 || (byte >= 48 && byte <= 57)))
    ))
      return null;
    // Oversized metadata scalars cannot be valid identifiers/counters. Never
    // materialize a conversation disguised as an allowed metadata value.
    if (at - start > 1024) return null;
    return JSON.parse(bytes.toString('utf8', start, at));
  };
  const result = value(fields[provider], 0);
  space();
  if (at !== bytes.length) fail();
  return result;
}
