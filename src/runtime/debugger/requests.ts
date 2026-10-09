/**
 * The ADT debugger, one function per request.
 *
 * Every request here must go over **one stateful session**, from the listen to
 * the last step: the debuggee is attached to the ABAP session that attached
 * it, and a request from any other session is answered `noSessionAttached`.
 * These functions do not set the session type; the caller gives them a
 * connection that is already stateful and keeps it for the whole conversation.
 *
 * Measured shapes and refusals: `docs/research/debugger-endpoints.md`.
 */

import type {
  IAbapConnection,
  IAdtWireResponse,
} from '@mcp-abap-adt/interfaces-adt-connection';
import { getTimeout } from '../../utils/timeouts';
import {
  DEBUGGER_IDE_ID,
  DEBUGGER_TERMINAL_ID,
  type IDebuggerAttachOptions,
  type IDebuggerBreakpoint,
  type IDebuggerBreakpointSet,
  type IDebuggerIdentity,
  type IDebuggerListenOptions,
} from './types';

const DEBUGGER = '/sap/bc/adt/debugger';
const AS_XML = 'application/vnd.sap.as+xml';

/**
 * `*` for every resource but the listener and the variables. ADT matches a
 * resource on its URI **and** the media type it can produce; a concrete Accept
 * it cannot produce is answered 404 "No suitable resource found", not 406, so
 * Accept negotiation never gets a chance to correct it.
 */
const ANY = '*/*';

/** What the server waits for, by default, when no timeout is given. */
const SAP_LISTEN_DEFAULT_SECONDS = 240;

/** Room for the answer to travel once the server has stopped waiting. */
const LISTEN_MARGIN_MS = 30_000;

// Attributes are double-quoted, so an apostrophe needs no escape — and ABAP
// conditions are full of them (`LV_X = 'A'`).
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

function identityParams(identity: IDebuggerIdentity): Record<string, string> {
  return {
    debuggingMode: 'user',
    requestUser: identity.user.toUpperCase(),
    terminalId: identity.terminalId ?? DEBUGGER_TERMINAL_ID,
    ideId: identity.ideId ?? DEBUGGER_IDE_ID,
  };
}

function breakpointXml(bp: IDebuggerBreakpoint): string {
  const condition =
    bp.condition !== undefined ? ` condition="${escapeXml(bp.condition)}"` : '';
  switch (bp.kind) {
    case 'line':
      return `<breakpoint kind="line" enabled="true" adtcore:uri="${escapeXml(bp.uri)}#start=${bp.line}"${condition}/>`;
    case 'statement':
      return `<breakpoint kind="statement" enabled="true" statement="${escapeXml(bp.statement)}"${condition}/>`;
    case 'exception':
      return `<breakpoint kind="exception" enabled="true" exceptionClass="${escapeXml(bp.exceptionClass)}"${condition}/>`;
    case 'message':
      return `<breakpoint kind="message" enabled="true" msgId="${escapeXml(bp.msgId)}" msgNo="${escapeXml(bp.msgNo)}" msgTy="${escapeXml(bp.msgTy)}"${condition}/>`;
  }
}

/** The `dbg:breakpoints` document `setBreakpoints` sends. */
export function buildBreakpointsXml(set: IDebuggerBreakpointSet): string {
  const id = identityParams(set);
  const system = set.systemDebugging ? ' systemDebugging="true"' : '';
  const items = set.breakpoints.map(breakpointXml);
  const body = items.length ? `\n  ${items.join('\n  ')}\n` : '';
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<dbg:breakpoints xmlns:dbg="http://www.sap.com/adt/debugger" xmlns:adtcore="http://www.sap.com/adt/core"' +
    ` debuggingMode="user" scope="external" requestUser="${escapeXml(id.requestUser)}"` +
    ` terminalId="${escapeXml(id.terminalId)}" ideId="${escapeXml(id.ideId)}"${system}>` +
    `${body}</dbg:breakpoints>`
  );
}

function asXmlEnvelope(data: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA>${data}</DATA></asx:values></asx:abap>`;
}

/** The body of `getVariables`: one `STPDA_ADT_VARIABLE` per id. */
export function buildVariablesXml(ids: readonly string[]): string {
  return asXmlEnvelope(
    ids
      .map(
        (id) =>
          `<STPDA_ADT_VARIABLE><ID>${escapeXml(id)}</ID></STPDA_ADT_VARIABLE>`,
      )
      .join(''),
  );
}

/** The body of `getChildVariables`: one hierarchy entry per parent id. */
export function buildChildVariablesXml(parentIds: readonly string[]): string {
  return asXmlEnvelope(
    `<HIERARCHIES>${parentIds
      .map(
        (id) =>
          `<STPDA_ADT_VARIABLE_HIERARCHY><PARENT_ID>${escapeXml(id)}</PARENT_ID></STPDA_ADT_VARIABLE_HIERARCHY>`,
      )
      .join('')}</HIERARCHIES>`,
  );
}

/**
 * Replaces the identity's whole set of external breakpoints.
 *
 * A breakpoint SAP refuses comes back with only its kind and `errorMessage`,
 * and not in the order it was sent (measured: the refused one first). A placed
 * one echoes what identifies it — uri and line, statement, exception class, or
 * message id, number and type — so the refused ones are those sent that do not
 * come back placed.
 */
export async function setBreakpoints(
  connection: IAbapConnection,
  set: IDebuggerBreakpointSet,
): Promise<IAdtWireResponse> {
  return connection.makeAdtRequest({
    url: `${DEBUGGER}/breakpoints`,
    method: 'POST',
    timeout: getTimeout('default'),
    data: buildBreakpointsXml(set),
    headers: { 'Content-Type': 'application/xml', Accept: ANY },
  });
}

/**
 * Reads the identity's breakpoints. Measured: 200 with an **empty body** on
 * every release tried, so the set that was sent is the caller's to keep.
 */
export async function getBreakpoints(
  connection: IAbapConnection,
  identity: IDebuggerIdentity,
): Promise<IAdtWireResponse> {
  return connection.makeAdtRequest({
    url: `${DEBUGGER}/breakpoints?${query({ ...identityParams(identity), scope: 'external' })}`,
    method: 'GET',
    timeout: getTimeout('default'),
    headers: { Accept: ANY },
  });
}

/**
 * Waits until a request of `user` stops at one of its breakpoints, or until
 * `timeout` seconds pass (200 with an empty body).
 *
 * Another listener for the same user — an Eclipse debugging that user — is
 * refused with subtype `conflictDetected`.
 */
export async function listen(
  connection: IAbapConnection,
  options: IDebuggerListenOptions,
): Promise<IAdtWireResponse> {
  const seconds = options.timeout ?? SAP_LISTEN_DEFAULT_SECONDS;
  return connection.makeAdtRequest({
    url: `${DEBUGGER}/listeners?${query({ ...identityParams(options), timeout: String(seconds) })}`,
    method: 'POST',
    timeout: seconds * 1000 + LISTEN_MARGIN_MS,
    headers: { Accept: AS_XML },
  });
}

/**
 * Removes the user's listener registration — and with it the user's external
 * breakpoints.
 *
 * Named by the user only: in user mode SAP stores the listener with the user as
 * its IDE id and `%_USER` as its terminal, so a DELETE that also names this
 * client's ids matches nothing and the registration stays.
 */
export async function stopListener(
  connection: IAbapConnection,
  user: string,
): Promise<IAdtWireResponse> {
  return connection.makeAdtRequest({
    url: `${DEBUGGER}/listeners?${query({ debuggingMode: 'user', requestUser: user.toUpperCase() })}`,
    method: 'DELETE',
    timeout: getTimeout('default'),
    headers: { Accept: ANY },
  });
}

/**
 * Takes the stopped request. It is attachable only while it waits, so this
 * belongs straight after the listen; later it answers `invalidDebuggee`.
 */
export async function attach(
  connection: IAbapConnection,
  options: IDebuggerAttachOptions,
): Promise<IAdtWireResponse> {
  return connection.makeAdtRequest({
    url: `${DEBUGGER}?${query({
      method: 'attach',
      debuggeeId: options.debuggeeId,
      dynproDebugging: 'true',
      debuggingMode: 'user',
      requestUser: options.user.toUpperCase(),
    })}`,
    method: 'POST',
    timeout: getTimeout('default'),
    headers: { Accept: ANY },
  });
}

/**
 * The call stack of the attached debuggee, innermost first. Each entry's
 * `adtcore:uri` carries the line in the object's source (`#start=L,C`); the
 * listen answer's `LINE_CURR` is the line in the include, which differs for
 * a class method.
 */
export async function getStack(
  connection: IAbapConnection,
): Promise<IAdtWireResponse> {
  return connection.makeAdtRequest({
    url: `${DEBUGGER}/stack?${query({ method: 'getStack', emode: '_', semanticURIs: 'true' })}`,
    method: 'GET',
    timeout: getTimeout('default'),
    headers: { Accept: ANY },
  });
}

/** Makes a stack entry the current frame; `stackUri` as the stack gave it. */
export async function goToFrame(
  connection: IAbapConnection,
  stackUri: string,
): Promise<IAdtWireResponse> {
  return connection.makeAdtRequest({
    url: stackUri,
    method: 'PUT',
    timeout: getTimeout('default'),
    headers: { Accept: ANY },
  });
}

/** Values of variables by id (`LV_X`, `LS_ROW-NAME`, `LT_ROWS[2]-ID`). */
export async function getVariables(
  connection: IAbapConnection,
  ids: readonly string[],
): Promise<IAdtWireResponse> {
  return connection.makeAdtRequest({
    url: `${DEBUGGER}?method=getVariables`,
    method: 'POST',
    timeout: getTimeout('default'),
    data: buildVariablesXml(ids),
    headers: {
      Accept: AS_XML,
      'Content-Type': `${AS_XML};charset=UTF-8;dataname=com.sap.adt.debugger.Variables`,
    },
  });
}

/**
 * Children of variable-tree nodes: `@ROOT` gives the scopes (`@LOCALS`,
 * `@PARAMETERS`, `ME`, …), a structure gives its components. An internal table
 * answers with an empty body; its rows are asked for by subscript,
 * `LT_ROWS[1]`, `LT_ROWS[2]`, ….
 */
export async function getChildVariables(
  connection: IAbapConnection,
  parentIds: readonly string[],
): Promise<IAdtWireResponse> {
  return connection.makeAdtRequest({
    url: `${DEBUGGER}?method=getChildVariables`,
    method: 'POST',
    timeout: getTimeout('default'),
    data: buildChildVariablesXml(parentIds),
    headers: {
      Accept: AS_XML,
      'Content-Type': `${AS_XML};charset=UTF-8;dataname=com.sap.adt.debugger.ChildVariables`,
    },
  });
}

export type DebuggerStepMethod =
  | 'stepInto'
  | 'stepOver'
  | 'stepReturn'
  | 'stepContinue';

/**
 * One step. `stepContinue` that lets the program finish is answered
 * `500 AdiFailed`, subtype `debuggeeEnded`: the program ran to its end.
 */
export async function step(
  connection: IAbapConnection,
  method: DebuggerStepMethod,
): Promise<IAdtWireResponse> {
  return connection.makeAdtRequest({
    url: `${DEBUGGER}?method=${method}`,
    method: 'POST',
    timeout: getTimeout('default'),
    headers: { Accept: ANY },
  });
}

/**
 * Runs to a line. `uri` is the target's source URI with the line, e.g.
 * `/sap/bc/adt/oo/classes/zcl_x/source/main#start=34`.
 *
 * It is a parameter of its own and not optional because of what SAP does
 * without it: `400 Parameter uri could not be found` — and the debuggee runs
 * on to the end in the same moment, so the stop is lost.
 */
export async function stepRunToLine(
  connection: IAbapConnection,
  uri: string,
): Promise<IAdtWireResponse> {
  return connection.makeAdtRequest({
    url: `${DEBUGGER}?${query({ method: 'stepRunToLine', uri })}`,
    method: 'POST',
    timeout: getTimeout('default'),
    headers: { Accept: ANY },
  });
}
