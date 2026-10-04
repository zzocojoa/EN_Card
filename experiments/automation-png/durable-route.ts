// Kept independent of schema/font modules so the normal Free Worker stays tiny.
export function durableRoute(
  path: string,
): { slot: number; action: 'render' | 'image'; job?: string } | null {
  const match = /^\/durable\/([0-3])\/(render|image)(?:\/([a-z][a-z0-9_-]{0,47}))?$/.exec(path);
  if (!match || (match[2] === 'render' ? match[3] !== undefined : !match[3])) return null;
  return {
    slot: Number(match[1]),
    action: match[2] as 'render' | 'image',
    ...(match[3] ? { job: match[3] } : {}),
  };
}
