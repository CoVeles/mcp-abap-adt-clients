/**
 * ABAP Unit probe — how does ADT run the tests of a program?
 *
 * The class runner addresses `CLAS` only. A report's test classes live in the
 * report itself or, the usual shape, in an include the report pulls in. This
 * probe builds exactly that — a `$TMP` report whose local test class sits in
 * its own include — and asks ADT to run it four ways:
 *
 *  1. `/abapunit/runs`, `osl:object type="PROG/P"` naming the report;
 *  2. `/abapunit/runs`, `osl:object type="PROG/I"` naming the include;
 *  3. `/abapunit/testruns`, `objectReference` URI of the report;
 *  4. `/abapunit/testruns`, `objectReference` URI of the include.
 *
 * For every async start that answers a run id, the status and the result are
 * fetched too. Nothing is interpreted: every response is written whole, and
 * both objects are deleted afterwards whatever happened.
 *
 * Usage:
 *   MCP_ENV_PATH=~/.config/mcp-abap-adt/sessions/<system>.env \
 *     npx ts-node scripts/probe-abapunit-program.ts [--out=DIR] [--program=NAME]
 *
 * `--program=NAME` runs an existing report instead of building one: variants
 * 1 and 3 only, nothing created and nothing deleted.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import {
  createTestConnection,
  releaseTestConnection,
} from '../src/__tests__/helpers/sessionConfig';
import { createConnectionLogger } from '../src/__tests__/helpers/testLogger';
import { AdtClient } from '../src/clients/AdtClient';
import {
  ACCEPT_UNIT_TEST_RESULT,
  ACCEPT_UNIT_TEST_STATUS,
  CT_UNIT_TEST_RUN,
} from '../src/constants/contentTypes';

const envPath = process.env.MCP_ENV_PATH || path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

const PROGRAM = 'ZMCP_AUNIT_PRB';
const INCLUDE = 'ZMCP_AUNIT_PRB_T';
const PACKAGE = '$TMP';

const INCLUDE_SOURCE = `CLASS lcl_probe DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS passes FOR TESTING.
ENDCLASS.

CLASS lcl_probe IMPLEMENTATION.
  METHOD passes.
    cl_abap_unit_assert=>assert_equals( act = 1 exp = 1 ).
  ENDMETHOD.
ENDCLASS.
`;

/**
 * `--inline` is the control: the same test class in the report's own source,
 * so an empty result there blames the build, and a full one blames the include.
 */
const INLINE = process.argv.includes('--inline');
const PROGRAM_SOURCE = INLINE
  ? `REPORT ${PROGRAM.toLowerCase()}.\n\n${INCLUDE_SOURCE}`
  : `REPORT ${PROGRAM.toLowerCase()}.\n\nINCLUDE ${INCLUDE.toLowerCase()}.\n`;

const INCLUDE_URI = `/sap/bc/adt/programs/includes/${INCLUDE.toLowerCase()}`;

function runsBody(name: string, type: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><aunit:run xmlns:aunit="http://www.sap.com/adt/api/aunit" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:osl="http://www.sap.com/api/osl" title="probe" context="probe">
  <aunit:options>
    <aunit:scope ownTests="true" foreignTests="false" addForeignTestsAsPreview="true"/>
    <aunit:riskLevel harmless="true" dangerous="true" critical="true"/>
    <aunit:duration short="true" medium="true" long="true"/>
  </aunit:options>
  <osl:objectSet xsi:type="osl:flatObjectSet">
    <osl:object name="${name}" type="${type}"/>
  </osl:objectSet>
</aunit:run>`;
}

function testrunsBody(uri: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><aunit:runConfiguration xmlns:aunit="http://www.sap.com/adt/aunit">
  <external>
    <coverage active="false"/>
  </external>
  <adtcore:objectSets xmlns:adtcore="http://www.sap.com/adt/core">
    <objectSet kind="inclusive">
      <adtcore:objectReferences>
        <adtcore:objectReference adtcore:uri="${uri}"/>
      </adtcore:objectReferences>
    </objectSet>
  </adtcore:objectSets>
</aunit:runConfiguration>`;
}

interface IRecord {
  label: string;
  method: string;
  url: string;
  requestBody?: string;
  status?: number;
  headers?: Record<string, unknown>;
  body?: string;
  error?: string;
}

async function main(): Promise<void> {
  const out = (
    process.argv.find((a) => a.startsWith('--out='))?.slice(6) ??
    'abapunit-program-probe'
  ).replace(/^~/, process.env.HOME ?? '~');
  fs.mkdirSync(out, { recursive: true });

  const existing = process.argv
    .find((a) => a.startsWith('--program='))
    ?.slice('--program='.length)
    .toUpperCase();
  const program = existing ?? PROGRAM;
  const programUri = `/sap/bc/adt/programs/programs/${program.toLowerCase()}`;

  const connection = await createTestConnection(createConnectionLogger());
  const client = new AdtClient(connection);
  const records: IRecord[] = [];

  const ask = async (
    label: string,
    method: string,
    url: string,
    headers: Record<string, string>,
    data?: string,
  ): Promise<IRecord> => {
    const record: IRecord = { label, method, url, requestBody: data };
    try {
      const response = await connection.makeAdtRequest({
        url,
        method,
        timeout: 120_000,
        headers,
        data,
      });
      record.status = response.status;
      record.headers = response.headers as Record<string, unknown>;
      record.body = String(response.data ?? '');
    } catch (error) {
      const e = error as {
        message?: string;
        response?: { status?: number; headers?: unknown; data?: unknown };
      };
      record.error = e.message;
      record.status = e.response?.status;
      record.headers = e.response?.headers as Record<string, unknown>;
      record.body = String(e.response?.data ?? '');
    }
    records.push(record);
    console.log(
      `${label}: ${record.status ?? 'no answer'} ${record.error ?? ''}`,
    );
    return record;
  };

  const setupStep = async (label: string, answer: { ok: boolean }) => {
    const r = answer as {
      ok: boolean;
      getError?: () => { message?: string };
      getResult?: () => { value?: unknown };
    };
    console.log(
      `setup ${label}: ${r.ok ? 'ok' : `FAILED ${r.getError?.().message}`}`,
    );
    records.push({
      label: `setup ${label}`,
      method: '',
      url: '',
      body: r.ok ? '' : String(r.getError?.().message),
    });
    return r;
  };

  try {
    if (!existing) {
      // --- Build: include with the test class, report that includes it -------
      await setupStep(
        'create include',
        await client.getInclude().create({
          includeName: INCLUDE,
          packageName: PACKAGE,
          description: 'ABAP Unit probe include',
        }),
      );
      const incLock = await setupStep(
        'lock include',
        await client.getInclude().lock({ includeName: INCLUDE }),
      );
      if (incLock.ok) {
        const handle = String(incLock.getResult?.().value);
        await setupStep(
          'update include',
          await client
            .getInclude()
            .update(
              { includeName: INCLUDE },
              { lockHandle: handle, source: INCLUDE_SOURCE },
            ),
        );
        await client.getInclude().unlock({ includeName: INCLUDE }, handle);
      }

      await setupStep(
        'create program',
        await client.getProgram().create({
          programName: PROGRAM,
          packageName: PACKAGE,
          description: 'ABAP Unit probe program',
        }),
      );
      const progLock = await setupStep(
        'lock program',
        await client.getProgram().lock({ programName: PROGRAM }),
      );
      if (progLock.ok) {
        const handle = String(progLock.getResult?.().value);
        await setupStep(
          'update program',
          await client
            .getProgram()
            .update(
              { programName: PROGRAM },
              { lockHandle: handle, source: PROGRAM_SOURCE },
            ),
        );
        await client.getProgram().unlock({ programName: PROGRAM }, handle);
      }
      await setupStep(
        'activate include',
        await client.getInclude().activate({ includeName: INCLUDE }),
      );
      await setupStep(
        'activate program',
        await client.getProgram().activate({ programName: PROGRAM }),
      );
      // What is active now, read back: an activation answered 200 is not proof.
      await ask(
        'active program source',
        'GET',
        `/sap/bc/adt/programs/programs/${PROGRAM.toLowerCase()}/source/main?version=active`,
        { Accept: 'text/plain' },
      );
      await ask(
        'active include source',
        'GET',
        `${INCLUDE_URI}/source/main?version=active`,
        { Accept: 'text/plain' },
      );
    }

    // --- Ask ----------------------------------------------------------------
    const followRun = async (label: string, start: IRecord) => {
      const headers = (start.headers ?? {}) as Record<string, string>;
      const location =
        headers.location ??
        headers['content-location'] ??
        headers['sap-adt-location'];
      const runId = location?.split('/').pop();
      if (!runId) return;
      await ask(
        `${label} → status`,
        'GET',
        `/sap/bc/adt/abapunit/runs/${runId}?withLongPolling=true`,
        { Accept: ACCEPT_UNIT_TEST_STATUS },
      );
      await ask(
        `${label} → result`,
        'GET',
        `/sap/bc/adt/abapunit/results/${runId}`,
        { Accept: ACCEPT_UNIT_TEST_RESULT },
      );
    };

    for (const [label, name, type] of [
      ['1 runs PROG/P program', program, 'PROG/P'],
      ['1b runs PROG program (as Eclipse types it)', program, 'PROG'],
      ['2 runs PROG/I include', INCLUDE, 'PROG/I'],
    ] as const) {
      if (existing && type === 'PROG/I') continue;
      const start = await ask(
        label,
        'POST',
        '/sap/bc/adt/abapunit/runs',
        { 'Content-Type': CT_UNIT_TEST_RUN },
        runsBody(name, type),
      );
      await followRun(label, start);
    }
    for (const [label, uri] of [
      ['3 testruns program URI', programUri],
      ['4 testruns include URI', INCLUDE_URI],
    ] as const) {
      if (existing && uri === INCLUDE_URI) continue;
      await ask(
        label,
        'POST',
        '/sap/bc/adt/abapunit/testruns',
        { 'Content-Type': 'application/xml', Accept: 'application/xml' },
        testrunsBody(uri),
      );
    }
  } finally {
    // --- Clean up, whatever happened ---------------------------------------
    if (!existing) {
      await setupStep(
        'delete program',
        await client.getProgram().delete({ programName: PROGRAM }),
      ).catch(() => undefined);
      await setupStep(
        'delete include',
        await client.getInclude().delete({ includeName: INCLUDE }),
      ).catch(() => undefined);
    }

    fs.writeFileSync(
      path.join(out, 'records.json'),
      JSON.stringify(records, null, 2),
    );
    console.log(`written: ${path.join(out, 'records.json')}`);
    await releaseTestConnection(connection);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
