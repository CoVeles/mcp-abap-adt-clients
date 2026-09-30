/**
 * AdtExecutorLegacy — executors for legacy SAP systems (BASIS < 7.50).
 *
 * One executor differs: running ABAP Unit, whose endpoint and answer are not
 * the modern ones (see `ClassTestRunnerLegacy`). The rest is inherited.
 */

import type {
  classTestRunnerDocuments,
  IClassTestRunnerResults,
} from '../executors/class/ClassTestRunner';
import { ClassTestRunnerLegacy } from '../executors/class/ClassTestRunnerLegacy';
import { AdtExecutor } from './AdtExecutor';

export class AdtExecutorLegacy extends AdtExecutor {
  override getClassTestRunner<
    R extends IClassTestRunnerResults = typeof classTestRunnerDocuments,
  >(results?: R): ClassTestRunnerLegacy<R> {
    return new ClassTestRunnerLegacy<R>(this.connection, this.logger, results);
  }
}
