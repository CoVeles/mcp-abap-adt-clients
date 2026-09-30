/**
 * ClassTestRunner — running the ABAP Unit tests of a class, and asking about
 * the run.
 *
 * A unit test is not an object type. It is a local test class, and it lives in
 * the `testclasses` include of a global class — the class under test, or a
 * container written for the purpose, which is what a CDS view's tests need
 * because a view cannot hold a class. Writing that include is
 * `AdtClient.getLocalTestClass()`; creating a container is `getClass()`. What
 * is left is executing it, and executing is an executor's, beside the class's
 * other executor (`ClassExecutor`, which runs `if_oo_adt_classrun`).
 *
 * Until 24.0.0 this was `AdtClient.getUnitTest()` and `getCdsUnitTest()`: two
 * handlers named after something that is not an object, re-exporting the local
 * test class's CRUD and the class's create under a second name, with two
 * byte-identical copies of the run module behind them.
 *
 * Every member answers `IAdtResponse<T>`, where T is what the result set given
 * at construction makes of that endpoint's answer.
 */

import type {
  IAdtAnalyseOptions,
  IAdtError,
  IAdtResponse,
  IAdtRunnable,
  IClassUnitTestDefinition,
  IClassUnitTestRunOptions,
  IResultStrategy,
  ITestRunInformation,
  IUnitTestResultOptions,
} from '@mcp-abap-adt/interfaces-adt';
import type { IAbapConnection } from '@mcp-abap-adt/interfaces-adt-connection';
import type { ILogger } from '@mcp-abap-adt/interfaces-utils';
import {
  getClassUnitTestResult,
  getClassUnitTestStatus,
  startClassUnitTestRun,
  startClassUnitTestRunByObject,
} from '../../core/class/run';
import { answering } from '../../utils/adtResponse';
import { rawDocument } from '../../utils/resultStrategy';

/**
 * What a run is given: named test classes in their containers, or one class
 * whose every test class runs.
 */
export type IClassTestRunTarget = IClassUnitTestDefinition[] | string;

/** One strategy per distinct answer: starting a run, polling it, its result. */
export interface IClassTestRunnerResults {
  /** What starting a run answers. `unitTestRunId` in adt-strategies reads the id. */
  readonly run: IResultStrategy<unknown>;
  /** What polling a run answers. */
  readonly status: IResultStrategy<unknown>;
  /** What a finished run's result document answers. */
  readonly result: IResultStrategy<unknown>;
}

/**
 * The shipped default: documents as they arrived. A run's id is in a header of
 * the start's answer, not its body, so a caller who wants it passes
 * `unitTestRunId` from @mcp-abap-adt/adt-strategies for `run`.
 *
 * `satisfies`, never an annotation — see `classDocuments` for why.
 */
export const classTestRunnerDocuments = {
  run: rawDocument,
  status: rawDocument,
  result: rawDocument,
} satisfies IClassTestRunnerResults;

export class ClassTestRunner<
  R extends IClassTestRunnerResults = typeof classTestRunnerDocuments,
> implements
    IAdtRunnable<
      IClassTestRunTarget,
      ReturnType<R['run']>,
      IClassUnitTestRunOptions
    >,
    ITestRunInformation<ReturnType<R['status']>, ReturnType<R['result']>>
{
  protected readonly connection: IAbapConnection;
  protected readonly logger?: ILogger;
  protected readonly results: R;

  constructor(
    connection: IAbapConnection,
    logger?: ILogger,
    // The one cast in this file, and it is on the default. See AdtClass.
    results: R = classTestRunnerDocuments as unknown as R,
  ) {
    this.connection = connection;
    this.logger = logger;
    this.results = results;
  }

  /**
   * Run the tests. One POST.
   *
   * Needs no write before it: the tests may have been in the class for years.
   * A class name runs every test class in it, by object; an array runs the
   * named test classes in their containers. The run's id is in a header of the
   * answer — construct this with `unitTestRunId` from
   * @mcp-abap-adt/adt-strategies for `run` to be answered the id, and pass
   * `analyseUnitTestStart` to have an id-less answer read as a failure.
   */
  async run<E extends IAdtError = IAdtError>(
    target: IClassTestRunTarget,
    options?: IClassUnitTestRunOptions & IAdtAnalyseOptions<E>,
  ): Promise<IAdtResponse<ReturnType<R['run']>, E>> {
    return answering(
      () =>
        typeof target === 'string'
          ? startClassUnitTestRunByObject(this.connection, target, options)
          : startClassUnitTestRun(this.connection, target, options),
      this.results.run as IResultStrategy<ReturnType<R['run']>>,
      options?.analyse,
    );
  }

  /**
   * Poll a run. Takes the run it is about: nothing here remembers the last one
   * started, because ADT does not either — any holder of the id may ask.
   */
  async getStatus<E extends IAdtError = IAdtError>(
    runId: string,
    withLongPolling: boolean | undefined = true,
    options?: IAdtAnalyseOptions<E>,
  ): Promise<IAdtResponse<ReturnType<R['status']>, E>> {
    return answering(
      () =>
        getClassUnitTestStatus(this.connection, runId, withLongPolling ?? true),
      this.results.status as IResultStrategy<ReturnType<R['status']>>,
      options?.analyse,
    );
  }

  /** The result document of a finished run. */
  async getResult<E extends IAdtError = IAdtError>(
    runId: string,
    options?: IUnitTestResultOptions & IAdtAnalyseOptions<E>,
  ): Promise<IAdtResponse<ReturnType<R['result']>, E>> {
    return answering(
      () => getClassUnitTestResult(this.connection, runId, options),
      this.results.result as IResultStrategy<ReturnType<R['result']>>,
      options?.analyse,
    );
  }
}
