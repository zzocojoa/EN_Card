export const integratedStudio = import.meta.env.VITE_HARU_STUDIO === 'true';
export function endpoint(path: string): string {
  if (integratedStudio && /^\/api\/automation(?:\/|$)/.test(path))
    return `/api/card-studio${path.slice(4)}`;
  return integratedStudio ? `/api/card-studio${path}` : path;
}
