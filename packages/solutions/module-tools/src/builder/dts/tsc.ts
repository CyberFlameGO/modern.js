import type { ChildProcess } from 'child_process';
import { execa, logger } from '@modern-js/utils';
import { addDtsFiles } from '../../utils/print';
import type {
  BundlelessGeneratorDtsConfig,
  PluginAPI,
  ModuleTools,
} from '../../types';
import {
  generatorTsConfig,
  getTscBinPath,
  printOrThrowDtsErrors,
  resolveAlias,
} from '../../utils/dts';
import { watchSectionTitle } from '../../utils/log';
import {
  BundlelessDtsLogPrefix,
  SectionTitleStatus,
} from '../../constants/log';
import { watchDoneText } from '../../constants/dts';

const resolveLog = async (
  childProgress: ChildProcess,
  options: {
    watch: boolean;
    watchFn: () => Promise<void>;
  },
) => {
  const { watch = false, watchFn = async () => undefined } = options;

  /**
   * tsc 所有的log信息都是从stdout data 事件中获取
   * 正常模式下，如果有报错信息，交给 resolveLog 后面的逻辑来处理
   * watch 模式下，则使用这里的信息
   */
  childProgress.stdout?.on('data', async data => {
    if (watch) {
      logger.info(
        await watchSectionTitle(BundlelessDtsLogPrefix, SectionTitleStatus.Log),
      );
      logger.info(data.toString());
      if (data.toString().includes(watchDoneText)) {
        await watchFn();
      }
    }
  });
  // 正常以下内容都不会触发，因为tsc 不会产生以下类型的log信息，不过防止意外情况
  childProgress.stdout?.on('error', error => {
    logger.error(error.message);
  });
  childProgress.stderr?.on('data', chunk => {
    logger.error(chunk.toString());
  });
};

const generatorDts = async (
  api: PluginAPI<ModuleTools>,
  config: BundlelessGeneratorDtsConfig,
) => {
  const { appDirectory, watch = false, abortOnError = true } = config;

  const { userTsconfig, generatedTsconfig: result } = await generatorTsConfig(
    config,
  );

  const tscBinFile = await getTscBinPath(appDirectory);

  const watchParams = watch ? ['-w'] : [];
  const childProgress = execa(
    tscBinFile,
    [
      '-p',
      result.tempTsconfigPath,
      /* Required parameter, use it stdout have color */
      '--pretty',
      // https://github.com/microsoft/TypeScript/issues/21824
      '--preserveWatchOutput',
      ...watchParams,
    ],
    {
      stdio: 'pipe',
      cwd: appDirectory,
    },
  );

  const runner = api.useHookRunners();
  resolveLog(childProgress, {
    watch,
    watchFn: async () => {
      await resolveAlias(config, { ...result, userTsconfig });
      runner.buildWatchDts({ buildType: 'bundleless' });
    },
  });

  try {
    await childProgress;
  } catch (e) {
    await printOrThrowDtsErrors(e, { abortOnError, buildType: 'bundleless' });
  }

  return { ...result, userTsconfig };
};

export const runTsc = async (
  api: PluginAPI<ModuleTools>,
  config: BundlelessGeneratorDtsConfig,
) => {
  const result = await generatorDts(api, config);
  await resolveAlias(config, result);
  await addDtsFiles(config.distAbsPath, config.appDirectory);
};
