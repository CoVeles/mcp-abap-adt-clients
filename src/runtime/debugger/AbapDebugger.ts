import type {
  IAdtAnalyseOptions,
  IAdtError,
  IAdtResponse,
  IResultStrategy,
} from '@mcp-abap-adt/interfaces-adt';
import type { IAbapConnection } from '@mcp-abap-adt/interfaces-adt-connection';
import type { ILogger } from '@mcp-abap-adt/interfaces-utils';
import { answering } from '../../utils/adtResponse';
import { nothing, rawDocument } from '../../utils/resultStrategy';
import {
  attach,
  getBreakpoints,
  getChildVariables,
  getStack,
  getVariables,
  goToFrame,
  listen,
  setBreakpoints,
  step,
  stepRunToLine,
  stopListener,
} from './requests';
import type {
  IDebuggerAttachOptions,
  IDebuggerBreakpointSet,
  IDebuggerIdentity,
  IDebuggerListenOptions,
  IDebuggerResults,
} from './types';

/**
 * The shipped default: every member answers its document as it arrived.
 *
 * `satisfies`, never an annotation — see `classDocuments` for why.
 */
export const debuggerDocuments = {
  breakpoints: rawDocument,
  debuggees: rawDocument,
  attach: rawDocument,
  stack: rawDocument,
  variables: rawDocument,
  step: rawDocument,
  none: nothing,
} satisfies IDebuggerResults;

type Answer<
  R extends IDebuggerResults,
  K extends keyof IDebuggerResults,
  E extends IAdtError,
> = Promise<IAdtResponse<ReturnType<R[K]>, E>>;

/**
 * External ABAP debugging of one user's requests, one member per request.
 *
 * **The connection must be stateful and dedicated** to this debugger from the
 * first `listen` until the debuggee is released: SAP attaches the debuggee to
 * the ABAP session that attached it, and answers any other session
 * `noSessionAttached`. No member changes the session type — that is the
 * caller's, like every other session decision in this library.
 *
 * A debugging conversation is the caller's sequence:
 *
 * ```typescript
 * await dbg.setBreakpoints({ user, breakpoints: [{ kind: 'line', uri, line }] });
 * const heard = await dbg.listen({ user, timeout: 60 });    // the code runs elsewhere
 * // read DEBUGGEE_ID from the answer, then at once:
 * await dbg.attach({ debuggeeId, user });
 * await dbg.getStack();
 * await dbg.getChildVariables(['@ROOT']);
 * await dbg.stepOver();
 * await dbg.stepContinue();                                 // releases the program
 * await dbg.stopListener(user);                             // and its breakpoints
 * ```
 */
export class AbapDebugger<
  R extends IDebuggerResults = typeof debuggerDocuments,
> {
  readonly kind = 'abapDebugger' as const;
  constructor(
    private readonly connection: IAbapConnection,
    private readonly logger: ILogger,
    // The one cast in this file, and it is on the default. See AdtClass.
    private readonly results: R = debuggerDocuments as unknown as R,
  ) {}

  private strategy<K extends keyof IDebuggerResults>(
    key: K,
  ): IResultStrategy<ReturnType<R[K]>> {
    return this.results[key] as IResultStrategy<ReturnType<R[K]>>;
  }

  async setBreakpoints<E extends IAdtError = IAdtError>(
    set: IDebuggerBreakpointSet,
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'breakpoints', E> {
    return answering(
      () => setBreakpoints(this.connection, set),
      this.strategy('breakpoints'),
      options?.analyse,
    );
  }

  async getBreakpoints<E extends IAdtError = IAdtError>(
    identity: IDebuggerIdentity,
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'breakpoints', E> {
    return answering(
      () => getBreakpoints(this.connection, identity),
      this.strategy('breakpoints'),
      options?.analyse,
    );
  }

  async listen<E extends IAdtError = IAdtError>(
    listenOptions: IDebuggerListenOptions,
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'debuggees', E> {
    return answering(
      () => listen(this.connection, listenOptions),
      this.strategy('debuggees'),
      options?.analyse,
    );
  }

  async stopListener<E extends IAdtError = IAdtError>(
    user: string,
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'none', E> {
    return answering(
      () => stopListener(this.connection, user),
      this.strategy('none'),
      options?.analyse,
    );
  }

  async attach<E extends IAdtError = IAdtError>(
    attachOptions: IDebuggerAttachOptions,
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'attach', E> {
    return answering(
      () => attach(this.connection, attachOptions),
      this.strategy('attach'),
      options?.analyse,
    );
  }

  async getStack<E extends IAdtError = IAdtError>(
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'stack', E> {
    return answering(
      () => getStack(this.connection),
      this.strategy('stack'),
      options?.analyse,
    );
  }

  async goToFrame<E extends IAdtError = IAdtError>(
    stackUri: string,
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'none', E> {
    return answering(
      () => goToFrame(this.connection, stackUri),
      this.strategy('none'),
      options?.analyse,
    );
  }

  async getVariables<E extends IAdtError = IAdtError>(
    ids: readonly string[],
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'variables', E> {
    return answering(
      () => getVariables(this.connection, ids),
      this.strategy('variables'),
      options?.analyse,
    );
  }

  async getChildVariables<E extends IAdtError = IAdtError>(
    parentIds: readonly string[],
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'variables', E> {
    return answering(
      () => getChildVariables(this.connection, parentIds),
      this.strategy('variables'),
      options?.analyse,
    );
  }

  async stepInto<E extends IAdtError = IAdtError>(
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'step', E> {
    return answering(
      () => step(this.connection, 'stepInto'),
      this.strategy('step'),
      options?.analyse,
    );
  }

  async stepOver<E extends IAdtError = IAdtError>(
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'step', E> {
    return answering(
      () => step(this.connection, 'stepOver'),
      this.strategy('step'),
      options?.analyse,
    );
  }

  async stepReturn<E extends IAdtError = IAdtError>(
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'step', E> {
    return answering(
      () => step(this.connection, 'stepReturn'),
      this.strategy('step'),
      options?.analyse,
    );
  }

  /**
   * Releases the program. When it then runs to its end, SAP answers
   * `500 AdiFailed` with subtype `debuggeeEnded`: that is the continue having
   * worked, which is the caller's to read with `analyse`.
   */
  async stepContinue<E extends IAdtError = IAdtError>(
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'step', E> {
    return answering(
      () => step(this.connection, 'stepContinue'),
      this.strategy('step'),
      options?.analyse,
    );
  }

  /** `uri`: the target's source URI with `#start=<line>`. */
  async stepRunToLine<E extends IAdtError = IAdtError>(
    uri: string,
    options?: IAdtAnalyseOptions<E>,
  ): Answer<R, 'step', E> {
    return answering(
      () => stepRunToLine(this.connection, uri),
      this.strategy('step'),
      options?.analyse,
    );
  }
}
