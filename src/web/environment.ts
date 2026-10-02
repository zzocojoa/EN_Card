export const integratedStudio = import.meta.env.VITE_HARU_STUDIO === 'true';
export function endpoint(path: string): string {
  return integratedStudio ? `/api/card-studio${path}` : path;
}
