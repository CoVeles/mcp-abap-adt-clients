import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IAbapConnection,
  IAbapRequestOptions,
} from '@mcp-abap-adt/interfaces-adt-connection';
import { AbapDebugger } from '../../../runtime/debugger/AbapDebugger';

/**
 * Every request is checked against the one recorded from a real system
 * (`corpus/adt/debugger-*`): what this library sends is what SAP was measured
 * to answer.
 */
const CORPUS = join(__dirname, '../../../../corpus/adt');
const USER = 'SAPUSER01';
const CLASS_SOURCE = '/sap/bc/adt/oo/classes/zcl_cv_dbg_measure/source/main';

interface IRecorded {
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
  };
  response: { status: number; bodyFile: string | null };
}

function recorded(name: string): IRecorded {
  return JSON.parse(readFileSync(join(CORPUS, `${name}.json`), 'utf8'));
}

function recordedBody(name: string): string {
  const file = recorded(name).response.bodyFile;
  return file ? readFileSync(join(CORPUS, file), 'utf8') : '';
}

/** A connection that answers with a recorded body and refuses session changes. */
function connectionAnswering(body = '') {
  const makeAdtRequest = jest.fn(async (_options: IAbapRequestOptions) => ({
    status: 200,
    statusText: 'OK',
    headers: {},
    data: body,
  }));
  const setSessionType = jest.fn(() => {
    throw new Error('a debugger member changed the session type');
  });
  return {
    connection: {
      makeAdtRequest,
      setSessionType,
    } as unknown as IAbapConnection,
    sent: () => makeAdtRequest.mock.calls[0][0],
  };
}

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

function header(
  options: IAbapRequestOptions,
  name: string,
): string | undefined {
  const entry = Object.entries(options.headers ?? {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return entry?.[1];
}

/** The request as sent, held against the recorded one. */
function expectSentAsRecorded(
  options: IAbapRequestOptions,
  name: string,
): void {
  const { request } = recorded(name);
  expect(options.method).toBe(request.method);
  expect(options.url).toBe(request.url);
  expect(header(options, 'accept')).toBe(request.headers.Accept);
  if (request.body !== null) {
    expect(options.data).toBe(request.body);
    expect(header(options, 'content-type')).toBe(
      request.headers['Content-Type'],
    );
  } else {
    expect(options.data).toBeUndefined();
  }
}

describe('AbapDebugger — requests as measured', () => {
  it('setBreakpoints sends the whole set, a condition with apostrophes unescaped', async () => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).setBreakpoints({
      user: 'sapuser01',
      breakpoints: [
        {
          kind: 'line',
          uri: CLASS_SOURCE,
          line: 32,
          condition: "LV_MARKER = 'CVDBG-7Q4'",
        },
        { kind: 'line', uri: CLASS_SOURCE, line: 1 },
      ],
    });
    expectSentAsRecorded(sent(), 'debugger-conversation--01-breakpoints-set');
  });

  it.each([
    [
      'a statement',
      { kind: 'statement', statement: 'MESSAGE' },
      'debugger-kinds-and-exception--01-kind-statement-message',
    ],
    [
      'a message, with all three of id, number and type',
      { kind: 'message', msgId: 'ZCV', msgNo: '777', msgTy: 'S' },
      'debugger-message-and-objects--03-message-bp-set',
    ],
    [
      'a message with a condition',
      {
        kind: 'message',
        msgId: 'ZCV',
        msgNo: '777',
        msgTy: 'S',
        condition: "LV_MARKER = 'CVDBG-7Q4'",
      },
      'debugger-kinds-and-exception--04-kind-message-with-condition',
    ],
    [
      'an exception with a condition',
      {
        kind: 'exception',
        exceptionClass: 'CX_SY_ZERODIVIDE',
        condition: "LV_MARKER = 'CVDBG-7Q4'",
      },
      'debugger-kinds-and-exception--05-kind-exception-with-condition',
    ],
  ] as const)('setBreakpoints builds %s as SAP accepted it', async (_what, breakpoint, name) => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).setBreakpoints({
      user: USER,
      breakpoints: [breakpoint],
    });
    expectSentAsRecorded(sent(), name);
  });

  it('an empty set is the clear', async () => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).setBreakpoints({
      user: USER,
      breakpoints: [],
    });
    expectSentAsRecorded(sent(), 'debugger-conversation--32-breakpoints-clear');
  });

  it('getBreakpoints names the identity and the external scope', async () => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).getBreakpoints({ user: USER });
    expectSentAsRecorded(sent(), 'debugger-conversation--02-breakpoints-get');
  });

  it('listen gives the HTTP request the server wait plus a margin', async () => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).listen({
      user: USER,
      timeout: 60,
    });
    expectSentAsRecorded(sent(), 'debugger-conversation--04-listen');
    expect(sent().timeout).toBe(90_000);
  });

  it('listen without a timeout waits as long as SAP does by default', async () => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).listen({ user: USER });
    expect(sent().url).toContain('timeout=240');
    expect(sent().timeout).toBe(270_000);
  });

  it('attach names the debuggee from the listen answer', async () => {
    const debuggeeId = /<DEBUGGEE_ID>([^<]+)</.exec(
      recordedBody('debugger-conversation--04-listen'),
    )?.[1] as string;
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).attach({
      debuggeeId,
      user: USER,
    });
    expectSentAsRecorded(sent(), 'debugger-conversation--05-attach');
  });

  it('getStack', async () => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).getStack();
    expectSentAsRecorded(sent(), 'debugger-conversation--06-stack');
  });

  it('goToFrame puts to the stackUri the stack gave', async () => {
    const stackUri = /stackUri="([^"]+)"/g;
    const uris = [
      ...recordedBody('debugger-conversation--06-stack').matchAll(stackUri),
    ];
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).goToFrame(uris[1][1]);
    expectSentAsRecorded(sent(), 'debugger-conversation--15-go-to-frame-2');
  });

  it('getVariables by name', async () => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).getVariables([
      'LV_MARKER',
      'LV_COUNTER',
      'LT_ROWS',
      'LS_ROW',
      'SY-SUBRC',
      'ME',
    ]);
    expectSentAsRecorded(sent(), 'debugger-conversation--10-variables-by-name');
  });

  it('getChildVariables of @ROOT and of table rows by subscript', async () => {
    const root = connectionAnswering();
    await new AbapDebugger(root.connection, logger).getChildVariables([
      '@ROOT',
    ]);
    expectSentAsRecorded(
      root.sent(),
      'debugger-conversation--07-children-root',
    );

    const rows = connectionAnswering();
    await new AbapDebugger(rows.connection, logger).getChildVariables([
      'LT_ROWS[1]',
      'LT_ROWS[2]',
      'LT_ROWS[120]',
    ]);
    expectSentAsRecorded(
      rows.sent(),
      'debugger-conversation--13-children-lt-rows-1-2-120',
    );
  });

  it.each([
    ['stepInto', 'debugger-conversation--17-stepinto'],
    ['stepReturn', 'debugger-conversation--20-stepreturn'],
    ['stepOver', 'debugger-conversation--22-stepover'],
    ['stepContinue', 'debugger-run-to-line--08-stepcontinue'],
  ] as const)('%s', async (member, name) => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger)[member]();
    expectSentAsRecorded(sent(), name);
  });

  it('stepRunToLine always carries the target uri', async () => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).stepRunToLine(
      `${CLASS_SOURCE}#start=34`,
    );
    expectSentAsRecorded(sent(), 'debugger-run-to-line--05-stepruntoline');
  });

  it('stopListener names the user and nothing else', async () => {
    const { connection, sent } = connectionAnswering();
    await new AbapDebugger(connection, logger).stopListener('sapuser01');
    expectSentAsRecorded(sent(), 'debugger-conversation--31-listener-delete');
  });
});

describe('AbapDebugger — answers', () => {
  it('answers the document as it arrived by default', async () => {
    const body = recordedBody('debugger-conversation--06-stack');
    const { connection } = connectionAnswering(body);
    const answer = await new AbapDebugger(connection, logger).getStack();
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.getResult().value).toBe(body);
  });

  it('an empty listen answer — nobody stopped — is a success with an empty document', async () => {
    const { connection } = connectionAnswering('');
    const answer = await new AbapDebugger(connection, logger).listen({
      user: USER,
      timeout: 5,
    });
    expect(answer.ok).toBe(true);
    if (answer.ok) expect(answer.getResult().value).toBe('');
  });

  it('debuggeeEnded after a continue comes back as a failure carrying the document', async () => {
    const name = 'debugger-run-to-line--08-stepcontinue';
    const body = recordedBody(name);
    const response = {
      status: recorded(name).response.status,
      statusText: '',
      headers: {},
      data: body,
    };
    const connection = {
      makeAdtRequest: jest.fn().mockRejectedValue(
        Object.assign(new Error('Request failed with status code 500'), {
          response,
        }),
      ),
    } as unknown as IAbapConnection;
    const answer = await new AbapDebugger(connection, logger).stepContinue();
    expect(answer.ok).toBe(false);
    if (!answer.ok) {
      expect(answer.getError().response?.status).toBe(500);
      expect(String(answer.getError().response?.data)).toContain(
        'debuggeeEnded',
      );
    }
  });
});
