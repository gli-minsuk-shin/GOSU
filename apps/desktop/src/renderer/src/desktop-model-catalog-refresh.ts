import { startModelCatalogAutoRefresh, type ModelCatalogRefreshPlatform } from '@gosu/contracts';

import type { CodexModel } from './connections-view';

/** Refresh only the catalog: explicit selections and running provider sessions are untouched. */
export function startDesktopModelCatalogRefresh(
  options: {
    listModels: () => Promise<CodexModel[]>;
    publishModels: (models: CodexModel[]) => void;
    isReconnecting: () => boolean;
  },
  platform?: ModelCatalogRefreshPlatform,
) {
  return startModelCatalogAutoRefresh(
    {
      refresh: async (signal) => {
        if (options.isReconnecting()) return;
        const models = await options.listModels();
        if (!signal.aborted && !options.isReconnecting()) options.publishModels(models);
      },
    },
    platform,
  );
}
