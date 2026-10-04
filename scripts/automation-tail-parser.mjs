// Wrangler emits adjacent, pretty-printed JSON objects. Never retain raw events
// outside this bounded parser: callers must whitelist fields before persisting.
export function classifyTailEncoder(url) {
  const path = url?.pathname ?? '';
  if (path.startsWith('/diagnostic/glyphs/')) return 'atlas_diagnostic';
  if (path.startsWith('/lean/') || /atlas_lean(?:800|720)$/.test(path)) return 'atlas_lean';
  if (path.startsWith('/optimized/') || /atlas_optimized(?:800|720)$/.test(path))
    return 'atlas_optimized';
  if (path.startsWith('/pipeline/') || path.endsWith('/atlas_pipeline')) return 'atlas_pipeline';
  if (path.startsWith('/glyphs/')) return 'atlas_chunks';
  if (path.startsWith('/band/')) return 'bands';
  return (
    ['wasm', 'native', 'fast', 'bands', 'atlas', 'atlas_chunks'].find(
      (name) => url?.searchParams.get('encoder') === name || path.endsWith(`/${name}`),
    ) ?? 'wasm'
  );
}

export function createTailParser(onEvent, stats, limit = 1000000) {
  let buffered = '';
  return {
    push(chunk) {
      buffered += chunk;
      stats.pending_characters = buffered.trim().length;
      if (buffered.length > limit) {
        stats.buffer_discards++;
        stats.discarded_characters += buffered.length;
        buffered = '';
        stats.pending_characters = 0;
        return;
      }
      let start = buffered.indexOf('{');
      while (start >= 0) {
        let depth = 0,
          quoted = false,
          escaped = false,
          end = -1;
        for (let index = start; index < buffered.length; index++) {
          const character = buffered[index];
          if (quoted) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') quoted = false;
          } else if (character === '"') quoted = true;
          else if (character === '{') depth++;
          else if (character === '}' && --depth === 0) {
            end = index + 1;
            break;
          }
        }
        if (end < 0) break;
        const raw = buffered.slice(start, end);
        buffered = buffered.slice(end);
        let event;
        try {
          event = JSON.parse(raw);
        } catch {
          stats.invalid_json++;
        }
        if (event) onEvent(event);
        start = buffered.indexOf('{');
      }
      stats.pending_characters = buffered.trim().length;
    },
    pendingCharacters() {
      return buffered.trim().length;
    },
  };
}
