/**
 * AdtExecutorLegacy — executors for legacy SAP systems (BASIS < 7.50).
 *
 * Two executors differ, both ABAP Unit: a class's tests run on the legacy
 * endpoint (`ClassTestRunnerLegacy`), and a report's are refused
 * (`ProgramTestRunnerLegacy`). The rest is inherited.
 */

import type {
  classTestRunnerDocuments,
  IClassTestRunnerResults,
} from '../executors/class/ClassTestRunner';
import { ClassTestRunnerLegacy } from '../executors/class/ClassTestRunnerLegacy';
import type {
  IProgramTestRunnerResults,
  programTestRunnerDocuments,
} from '../executors/program/ProgramTestRunner';
import { ProgramTestRunnerLegacy } from '../executors/program/ProgramTestRunnerLegacy';
import { AdtExecutor } from './AdtExecutor';

export class AdtExecutorLegacy extends AdtExecutor {
  override getClassTestRunner<
    R extends IClassTestRunnerResults = typeof classTestRunnerDocuments,
  >(results?: R): ClassTestRunnerLegacy<R> {
    return new ClassTestRunnerLegacy<R>(this.connection, this.logger, results);
  }

  override getProgramTestRunner<
    R extends IProgramTestRunnerResults = typeof programTestRunnerDocuments,
  >(results?: R): ProgramTestRunnerLegacy<R> {
    return new ProgramTestRunnerLegacy<R>(
      this.connection,
      this.logger,
      results,
    );
  }
}
