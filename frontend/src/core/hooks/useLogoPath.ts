import { useMemo } from 'react';
import { useLogoAssets } from '@app/hooks/useLogoAssets';

/**
 * Hook to get the correct logo path based on app config (logo style)
 *
 * Logo styles:
 * - classic: classic S logo stored in /classic-logo
 * - modern: minimalist logo stored in /modern-logo
 *
 * @returns The path to the appropriate logo SVG file
 */
export function useLogoPath(): string {
  const { folderPath } = useLogoAssets();

  return useMemo(() => {
    return `${folderPath}/Logo_principal_dark.svg`;
  }, [folderPath]);
}
