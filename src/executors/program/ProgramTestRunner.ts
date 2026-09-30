/**
 * ProgramTestRunner — running the ABAP Unit tests of a report, and asking about
 * the run.
 *
 * A report's test classes are local classes in the report's own source or in
 * an include it pulls in; writing them is `getProgram().update()` or
 * `getInclude().update()`. What is left is executing them, and executing is an
 * executor's, beside the report's other executor (`ProgramExecutor`, which
 * runs the report itself through `programrun`).
 *
 * Measured on premise (2026-09-30): one `POST /abapunit/runs` naming the report
 * as `osl:object type="PROG"` runs its test classes wherever they sit — own
 * source or include. `/abapunit/testruns` given the report's URI answered an
 * empty result for the same report, so the legacy runner refuses rather than
 * send it (`ProgramTestRunnerLegacy`).
 *
 * Every member answers `IAdtResponse<T>`, where T is what the result set given
 * at construction makes of that endpoint's answer.
 */

import type {
  IAdtAnalyseOptions,
  IAdtError,
  IAdtResponse,
  IAdtRunnable,
  IClassUnitTestRunOptions,
  IResultStrategy,
  ITestRunInformation,
  IUnitTestResultOptions,
} from '@mcp-abap-adt/interfaces-adt';
import type { IAbapConnection } from '@mcp-abap-adt/interfaces-adt-connection';
import type { ILogger } from '@mcp-abap-adt/interfaces-utils';
import {
  getUnitTestRunResult,
  getUnitTestRunStatus,
  startUnitTestRunByObject,
} from '../../core/shared/abapUnit';
import { answering } from '../../utils/adtResponse';
import { rawDocument } from '../../utils/resultStrategy';

/** One strategy per distinct answer: starting a run, polling it, its result. */
export interface IProgramTestRunnerResults {
  /** What starting a run answers. `unitTestRunId` in adt-strategies reads the id. */
  readonly run: IResultStrategy<unknown>;
  /** What polling a run answers. */
  readonly status: IResultStrategy<unknown>;
  /** What a finished run's result document answers. */
  readonly result: IResultStrategy<unknown>;
}

/**
 * The shipped default: documents as they arrived.
 *
 * `satisfies`, never an annotation — see `classDocuments` for why.
 */
export const programTestRunnerDocuments = {
  run: rawDocument,
  status: rawDocument,
  result: rawDocument,
} satisfies IProgramTestRunnerResults;

export class ProgramTestRunner<
  R extends IProgramTestRunnerResults = typeof programTestRunnerDocuments,
> implements
    IAdtRunnable<string, ReturnType<R['run']>, IClassUnitTestRunOptions>,
    ITestRunInformation<ReturnType<R['status']>, ReturnType<R['result']>>
{
  protected readonly connection: IAbapConnection;
  protected readonly logger?: ILogger;
  protected readonly results: R;

  constructor(
    connection: IAbapConnection,
    logger?: ILogger,
    // The one cast in this file, and it is on the default. See AdtClass.
    results: R = programTestRunnerDocuments as unknown as R,
  ) {
    this.connection = connection;
    this.logger = logger;
    this.results = results;
  }

  /**
   * Run every test class of the report. One POST; the run's id is in a header
   * of the answer — pass `unitTestRunId` from @mcp-abap-adt/adt-strategies in
   * the result set to be answered it.
   */
  async run<E extends IAdtError = IAdtError>(
    programName: string,
    options?: IClassUnitTestRunOptions & IAdtAnalyseOptions<E>,
  ): Promise<IAdtResponse<ReturnType<R['run']>, E>> {
    return answering(
      () =>
        startUnitTestRunByObject(
          this.connection,
          { name: programName, type: 'PROG' },
          options,
        ),
      this.results.run as IResultStrategy<ReturnType<R['run']>>,
      options?.analyse,
    );
  }

  /** Poll a run, by its id. */
  async getStatus<E extends IAdtError = IAdtError>(
    runId: string,
    withLongPolling: boolean | undefined = true,
    options?: IAdtAnalyseOptions<E>,
  ): Promise<IAdtResponse<ReturnType<R['status']>, E>> {
    return answering(
      () =>
        getUnitTestRunStatus(this.connection, runId, withLongPolling ?? true),
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
      () => getUnitTestRunResult(this.connection, runId, options),
      this.results.result as IResultStrategy<ReturnType<R['result']>>,
      options?.analyse,
    );
  }
}
