/**
 * One external debugging conversation, end to end, through this package.
 *
 * Two sessions, because that is what external debugging is: the debugger's
 * own, stateful for the whole conversation, and a second one that runs the
 * code. The class is started over `oo/classrun` in the second session while
 * the first is listening; the first catches it, reads it, steps it and lets
 * it go.
 *
 *   npx ts-node scripts/probe-debugger.ts ZCL_SOME_CLASSRUN 32 34
 *
 * The class must implement `if_oo_adt_classrun` and nobody else may run it
 * while the probe listens: an external breakpoint stops **every** request of
 * the user. The two numbers are lines in its `source/main` — where to stop,
 * and where to run to. `PROBE_DEBUG_CONDITION` adds an ABAP condition.
 *
 * What it does to the system: one listener and one breakpoint for the user,
 * both removed at the end, also when a step fails.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import {
  closeOwnTestConnection,
  createTestConnection,
} from '../src/__tests__/helpers/sessionConfig';
import { createConnectionLogger } from '../src/__tests__/helpers/testLogger';
import { AdtExecutor } from '../src/clients/AdtExecutor';
import { AdtRuntimeClient } from '../src/clients/AdtRuntimeClient';

const envPath = process.env.MCP_ENV_PATH || path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

const [className, stopLine, runToLine] = process.argv.slice(2);
if (!className || !stopLine || !runToLine) {
  process.stdout.write(
    'usage: npx ts-node scripts/probe-debugger.ts <CLASS> <stop line> <run-to line>\n',
  );
  process.exit(2);
}
const user = process.env.SAP_USERNAME ?? '';
const source = `/sap/bc/adt/oo/classes/${className.toLowerCase()}/source/main`;

function say(step: string, answer: { ok: boolean } & object, note = ''): void {
  const a = answer as {
    ok: boolean;
    getResult?: () => { value: unknown };
    getError?: () => { message: string; response?: { status?: number } };
  };
  const what = a.ok
    ? `ok ${String(a.getResult?.().value ?? '').length}b`
    : `failed ${a.getError?.().response?.status ?? ''} ${a.getError?.().message ?? ''}`;
  process.stdout.write(`${step.padEnd(22)} ${what} ${note}\n`);
}

async function main(): Promise<void> {
  const logger = createConnectionLogger();
  const debugging = await createTestConnection(logger, { ownSession: true });
  const running = await createTestConnection(logger, { ownSession: true });
  // The debuggee is attached to the session that attached it; every request
  // of the conversation has to come from that one ABAP session.
  debugging.setSessionType('stateful');
  const dbg = new AdtRuntimeClient(debugging, logger).getDebugger();
  try {
    const condition = process.env.PROBE_DEBUG_CONDITION;
    say(
      'setBreakpoints',
      await dbg.setBreakpoints({
        user,
        breakpoints: [
          { kind: 'line', uri: source, line: Number(stopLine), condition },
        ],
      }),
    );

    const run = new Promise((resolve) => setTimeout(resolve, 4000)).then(() =>
      new AdtExecutor(running, logger).getClassExecutor().run({ className }),
    );
    const heard = await dbg.listen({ user, timeout: 60 });
    say('listen', heard);
    const debuggeeId = heard.ok
      ? /<DEBUGGEE_ID>([^<]+)</.exec(String(heard.getResult().value))?.[1]
      : undefined;
    if (!debuggeeId) {
      process.stdout.write('nobody stopped within 60 s\n');
      await run;
      return;
    }

    say('attach', await dbg.attach({ debuggeeId, user }));
    const stack = await dbg.getStack();
    const top = stack.ok
      ? /<stackEntry [^>]*?line="(\d+)"[^>]*?eventName="([^"]*)"/.exec(
          String(stack.getResult().value),
        )
      : null;
    say('getStack', stack, top ? `top ${top[2]}:${top[1]}` : '');
    say('getChildVariables', await dbg.getChildVariables(['@ROOT']));
    say('stepOver', await dbg.stepOver());
    say(
      'stepRunToLine',
      await dbg.stepRunToLine(`${source}#start=${runToLine}`),
    );
    const after = await dbg.getStack();
    const line = after.ok
      ? /<stackEntry [^>]*?line="(\d+)"/.exec(
          String(after.getResult().value),
        )?.[1]
      : undefined;
    say('getStack', after, line ? `top line ${line}` : '');
    say(
      'stepContinue',
      await dbg.stepContinue(),
      '(debuggeeEnded = it ran to the end)',
    );
    const ran = await run;
    say(
      'classrun',
      ran,
      ran.ok ? JSON.stringify(String(ran.getResult().value).trim()) : '',
    );
  } finally {
    say('stopListener', await dbg.stopListener(user));
    say(
      'clear breakpoints',
      await dbg.setBreakpoints({ user, breakpoints: [] }),
    );
    await closeOwnTestConnection(debugging);
    await closeOwnTestConnection(running);
  }
}

main().catch((error: unknown) => {
  process.stdout.write(`probe failed: ${String(error)}\n`);
  process.exit(1);
});
