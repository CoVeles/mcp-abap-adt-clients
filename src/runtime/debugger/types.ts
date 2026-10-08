/**
 * Types of the ABAP debugger, declared here and not in `@mcp-abap-adt/interfaces`.
 *
 * `IDebugger` left the contract packages in 30.0.0 because its endpoints had not
 * been measured. These types describe what was measured (see
 * `docs/research/debugger-endpoints.md`); they move to the contracts once the
 * shapes have been confirmed on more than one release.
 */

import type { IResultStrategy } from '@mcp-abap-adt/interfaces-adt';

/**
 * Whose requests the debugger is for, and which client it speaks as.
 *
 * SAP keys the breakpoint set by all three: a client that changes `terminalId`
 * or `ideId` between calls no longer sees the breakpoints it set.
 */
export interface IDebuggerIdentity {
  /** The SAP user whose requests stop. Sent upper-cased: SAP stores it so. */
  readonly user: string;
  /** Any stable 32-character value. Defaults to {@link DEBUGGER_TERMINAL_ID}. */
  readonly terminalId?: string;
  /** Any stable name of the client. Defaults to {@link DEBUGGER_IDE_ID}. */
  readonly ideId?: string;
}

/** The terminal id this library speaks as unless told otherwise. */
export const DEBUGGER_TERMINAL_ID = '4D43504142414454000000000000DB01';

/** The IDE id this library speaks as unless told otherwise. */
export const DEBUGGER_IDE_ID = 'mcp-abap-adt';

/** A line breakpoint: the source URI of the object plus the line in it. */
export interface IDebuggerLineBreakpoint {
  readonly kind: 'line';
  /**
   * The object's source URI, e.g. `/sap/bc/adt/oo/classes/zcl_x/source/main`.
   * The line counts in that source as ADT reads it — for a class, its whole
   * `source/main`, not the method include.
   */
  readonly uri: string;
  readonly line: number;
  /** An ABAP condition; SAP evaluates it when the line is reached. */
  readonly condition?: string;
}

/** Stops at every execution of an ABAP statement, e.g. `CALL FUNCTION`. */
export interface IDebuggerStatementBreakpoint {
  readonly kind: 'statement';
  readonly statement: string;
  readonly condition?: string;
}

/**
 * Stops where an exception class is raised, e.g. `CX_SY_ZERODIVIDE` — also when
 * it is caught. SAP accepts any name without checking it, so a misspelled
 * class is placed and never stops.
 */
export interface IDebuggerExceptionBreakpoint {
  readonly kind: 'exception';
  readonly exceptionClass: string;
  readonly condition?: string;
}

/**
 * Stops where a message is raised, `MESSAGE ... INTO` included. All three of
 * id, number and type are required: without the type SAP refuses the whole set
 * with `400 Attribute 'msgTy' expected`.
 */
export interface IDebuggerMessageBreakpoint {
  readonly kind: 'message';
  /** Message class, e.g. `00`. */
  readonly msgId: string;
  /** Message number, e.g. `001`. */
  readonly msgNo: string;
  /** Message type: `A`, `E`, `I`, `S`, `W` or `X`. */
  readonly msgTy: string;
  readonly condition?: string;
}

export type IDebuggerBreakpoint =
  | IDebuggerLineBreakpoint
  | IDebuggerStatementBreakpoint
  | IDebuggerExceptionBreakpoint
  | IDebuggerMessageBreakpoint;

/** The whole set of external breakpoints for one identity. */
export interface IDebuggerBreakpointSet extends IDebuggerIdentity {
  /**
   * The complete set. SAP **replaces** what it holds with what is sent, so
   * adding one breakpoint means sending the others with it, and an empty list
   * clears them all.
   */
  readonly breakpoints: readonly IDebuggerBreakpoint[];
  /**
   * Without it, breakpoints in SAP standard code are accepted, get an id, and
   * never stop.
   */
  readonly systemDebugging?: boolean;
}

export interface IDebuggerListenOptions extends IDebuggerIdentity {
  /**
   * Seconds the server waits for a debuggee before it answers empty. SAP's own
   * default is 240. The HTTP request is given this plus a margin, whatever the
   * library-wide timeout is: aborting it client-side does not end it on the
   * server, and everything after it on the session waits behind it.
   */
  readonly timeout?: number;
}

export interface IDebuggerAttachOptions {
  /** `DEBUGGEE_ID` from the listen answer. Attach right after the listen. */
  readonly debuggeeId: string;
  readonly user: string;
}

/** One strategy per distinct answer of the debugger resources. */
export interface IDebuggerResults {
  /** `setBreakpoints` and `getBreakpoints`: a `dbg:breakpoints` document. */
  readonly breakpoints: IResultStrategy<unknown>;
  /** `listen`: an `asx:abap` debuggee list, or empty when nobody stopped. */
  readonly debuggees: IResultStrategy<unknown>;
  /** `attach`: a `dbg:attach` document. */
  readonly attach: IResultStrategy<unknown>;
  /** `getStack`: a `dbg:stack` document. */
  readonly stack: IResultStrategy<unknown>;
  /** `getVariables` and `getChildVariables`: `asx:abap` variable documents. */
  readonly variables: IResultStrategy<unknown>;
  /** The step members: a `dbg:step` document. */
  readonly step: IResultStrategy<unknown>;
  /** `stopListener` and `goToFrame`: nothing to read. */
  readonly none: IResultStrategy<unknown>;
}
