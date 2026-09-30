/**
 * ProgramTestRunnerLegacy — a report's ABAP Unit tests on a legacy system
 * (BASIS < 7.50), which has no `/abapunit/runs`.
 *
 * Refused without a request. The legacy endpoint, `/abapunit/testruns`, was
 * given a report's URI on premise (2026-09-30) and answered an empty result for
 * a report whose tests `/abapunit/runs` found — so sending it would answer "no
 * tests" where there are some. It stays refused until a legacy system is
 * measured.
 */

import type { IAdtError, IAdtResponse } from '@mcp-abap-adt/interfaces-adt';
import { AdtObjectErrorCodes } from '@mcp-abap-adt/interfaces-adt';
import { failed } from '../../utils/adtResponse';
import {
  type IProgramTestRunnerResults,
  ProgramTestRunner,
  type programTestRunnerDocuments,
} from './ProgramTestRunner';

function refusal<T, E extends IAdtError>(): IAdtResponse<T, E> {
  return failed<T, E>({
    origin: 'refusal',
    code: AdtObjectErrorCodes.UNSUPPORTED_OPERATION,
    message:
      "Running a report's ABAP Unit tests is not supported below BASIS 7.50: the legacy endpoint answered no tests for a report that has them.",
  } as E);
}

export class ProgramTestRunnerLegacy<
  R extends IProgramTestRunnerResults = typeof programTestRunnerDocuments,
> extends ProgramTestRunner<R> {
  override async run<E extends IAdtError = IAdtError>(): Promise<
    IAdtResponse<ReturnType<R['run']>, E>
  > {
    return refusal<ReturnType<R['run']>, E>();
  }

  override async getStatus<E extends IAdtError = IAdtError>(): Promise<
    IAdtResponse<ReturnType<R['status']>, E>
  > {
    return refusal<ReturnType<R['status']>, E>();
  }

  override async getResult<E extends IAdtError = IAdtError>(): Promise<
    IAdtResponse<ReturnType<R['result']>, E>
  > {
    return refusal<ReturnType<R['result']>, E>();
  }
}
