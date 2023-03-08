import * as path from 'path';

import {
  BuilderTarget,
  getBrowserslistWithDefault,
  logger,
  setConfig,
} from '@modern-js/builder-shared';
import type {
  BuilderPlugin,
  BuilderPluginAPI,
  NormalizedConfig,
  RspackConfig,
} from '../types';

/**
 * Provide some swc configs of rspack
 */
export const builderPluginSwc = (): BuilderPlugin => ({
  name: 'builder-plugin-swc',

  setup(api) {
    const getPolyfillEntry = () => {
      return path.resolve(api.context.cachePath, 'polyfill.js');
    };

    api.onBeforeCreateCompiler(async () => {
      const config = api.getNormalizedConfig();
      if (config.output.polyfill === 'entry') {
        const fs = await import('fs');
        fs.writeFileSync(getPolyfillEntry(), "import 'core-js'");
      }
    });

    api.modifyBuilderConfig(async config => {
      const mode = config?.output?.polyfill ?? 'entry';
      if (mode !== 'entry') {
        return;
      }

      config.source ??= {};
      config.source.preEntry ??= [];
      config.source.preEntry = ensureArray(config.source.preEntry);
      config.source.preEntry.push(getPolyfillEntry());
    });

    api.modifyRspackConfig(async (rspackConfig, { target }) => {
      const builderConfig = api.getNormalizedConfig();

      // Apply decorator and presetEnv
      await applyDefaultConfig(rspackConfig, builderConfig, api, target);
    });
  },
});

async function applyDefaultConfig(
  rspackConfig: RspackConfig,
  builderConfig: NormalizedConfig,
  api: BuilderPluginAPI,
  target: BuilderTarget,
) {
  /**
   * Swc only enable latestDecorator for JS module, not TS module.
   */
  setConfig(rspackConfig, 'builtins.decorator', {
    legacy: !builderConfig.output.enableLatestDecorators,
  });

  rspackConfig.builtins ??= {};
  rspackConfig.builtins.presetEnv ??= {};

  await setBrowserslist(
    api.context.rootPath,
    builderConfig,
    target,
    rspackConfig,
  );

  /**
   * Enable preset-env polyfill: set rspackConfig.target === 'browserslist'
   */
  if (isWebTarget(target)) {
    const polyfillMode = builderConfig.output.polyfill;

    // TODO: remove this when rspack support `usage` mode
    if (polyfillMode === 'usage') {
      logger.warn(
        'Cannot use `usage` mode polyfill for now, rspack will support it soon',
      );
      rspackConfig.builtins.presetEnv.mode = undefined;
      return;
    }

    if (polyfillMode === 'off' || polyfillMode === 'ua') {
      rspackConfig.builtins.presetEnv.mode = undefined;
    } else {
      rspackConfig.builtins.presetEnv.mode = polyfillMode;
      /* Apply core-js version and path alias */
      await applyCoreJs(rspackConfig);
    }
  }
}

async function setBrowserslist(
  rootPath: string,
  builderConfig: NormalizedConfig,
  target: BuilderTarget,
  rspackConfig: RspackConfig,
) {
  const browserslist = await getBrowserslistWithDefault(
    rootPath,
    builderConfig,
    target,
  );

  if (browserslist) {
    rspackConfig.builtins!.presetEnv!.targets = browserslist;
  }
}

function isWebTarget(target: BuilderTarget): boolean {
  return ['modern-web', 'web'].some(t => target === t);
}

async function applyCoreJs(rspackConfig: RspackConfig) {
  const { getCoreJsVersion } = await import('@modern-js/utils');
  const coreJsPath = require.resolve('core-js/package.json');
  const version = getCoreJsVersion(coreJsPath);

  rspackConfig.builtins!.presetEnv!.coreJs = version;

  rspackConfig.resolve ??= {};
  rspackConfig.resolve.alias ??= {};
  rspackConfig.resolve.alias['core-js'] = path.dirname(coreJsPath);
}

function ensureArray<T>(data: T | Array<T>): Array<T> {
  if (!Array.isArray(data)) {
    return [data];
  } else {
    return data;
  }
}
