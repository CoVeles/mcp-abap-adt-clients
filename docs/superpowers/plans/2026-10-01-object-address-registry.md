# Object Address Registry (Step 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every ADT object address in `src/` is built by one internal module, `src/endpoints/objects.ts`, one record per kind. Each path is confirmed on E19 and the trial.

**Architecture:** A static module of records. Each record declares its kind's literal full paths (`collection`, `validation`) and builder functions (`uri(...)` with exactly the arguments the address needs). Shared tails (`sourceUri`, `versionsUri`, `transportUri`) are functions of an address. `seg(name)` is the only way a name enters an address. A parser-based unit test forbids any declared path outside the module. Migration goes kind by kind, and each kind's enforcement is switched on in the same commit.

**Tech Stack:** TypeScript (strict, CommonJS), Jest, Biome, the `typescript` compiler API for the enforcement test, `scripts/adt-nc.ts` (PR #194) for measurement.

**Spec:** `docs/superpowers/specs/2026-10-01-object-address-registry-design.md`.

## Global Constraints

- The registry is internal: nothing from `src/endpoints/` is exported from `src/index.ts`. `src/__tests__/unit/publicApiSurface.test.ts` must stay green unchanged.
- Literal full paths in each record. `validation` is stated per kind, never derived.
- `seg(name) = encodeURIComponent(name.toLowerCase())`, unless the measurement in Task 3 finds a kind case-sensitive. That kind then gets its own `seg` with the measurement in a comment.
- No `lockUri`: `?_action=…` query strings stay in the modules unchanged. Only the address comes from the registry.
- Do not change query strings, headers, methods or bodies, except to replace an embedded object address with the registry's.
- The enforcement test reads `src/` excluding `src/__tests__/`. It fails on any string or template literal outside `src/endpoints/` that **contains** a path a record declares (boundary-aware).
- Comments explain why, not what. English only. Biome: single quotes, semicolons, 2 spaces. No `console.*` in `src/`.
- One SAP-touching run at a time. No edits to `src/` while a run is in flight.
- Never change `package.json` version. CHANGELOG version is asked from the owner at the end.
- Work in a worktree: `../adt-clients-address-registry`, branch `refactor/object-address-registry`.

## Review Focus

1. **Namespaced names** (`/ABC/ZCL_X`): `seg` must give `%2fabc%2fzcl_x`, never a raw `/`. Pinned in Task 1.
2. **Case sensitivity per kind:** a kind whose ADT path is case-sensitive would break silently once `seg` lowercases it. Measured in Task 3 before any switch. Pinned by the Task 3 matrix result.
3. **A name containing characters `encodeURIComponent` keeps** (`$TMP`, `*`): `seg('$TMP')` must be `%24tmp`. Pinned in Task 1.
4. **Boundary false positives in the enforcement test:** `/sap/bc/adt/programs/programs` must not match `/sap/bc/adt/programs/programrun`, and `/sap/bc/adt/ddic/tables` must not match a longer sibling segment. Pinned in Task 2.
5. **A function module without a group:** after Task 15 it throws before any request instead of using the module's name as the group. Pinned in Task 15.

---

## Prerequisites (before Task 1)

- [ ] **PR #194 (`scripts/adt-nc.ts`) is merged.** Task 3 imports its connection code.
- [ ] **PR #192 is merged** (it touches `src/clients/AdtClientLegacy.ts` and adds `src/clients/absentOnLegacy.ts`, which name object paths).
- [ ] **An E19 `test-config.yaml` exists** for the baseline and after runs: `system: "onprem"`, `default_master_system: "E19"`, `shared_dependencies.super_package: "TEST_MCP"`, `shared_dependencies.package: "TEST_AC_SHR_PKG"`, `shared_dependencies.software_component: "LOCAL"` (values from issue #130). `default_package`, `default_transport` and `transport_layer` come from the owner. Keep it at `~/.config/mcp-abap-adt/test-config.e19.yaml`, never in the repo. Swap it in for the E19 runs only.
- [ ] The E19 tunnel is up: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8000/sap/public/info` prints `200`.

## Kind-to-file inventory

Counted with the TypeScript parser at `8dfbc578`. Line numbers will have shifted by the time a task runs. **The enforcement test (Task 2) is the authority on what remains**, and this list is a map, not a checklist. Literals *inside* request bodies (16 payloads) and five error messages are not in these counts. The enforcement test (Task 2, "contains") reports them in the task of their kind.

- **ACCESS_CONTROL**: 14 literals, 11 files
- **AUTHORIZATION_FIELD**: 9 literals, 9 files
- **BEHAVIOR_DEFINITION**: 16 literals, 12 files
- **CLASS**: 31 literals, 22 files
- **DATA_ELEMENT**: 14 literals, 12 files
- **DDIC_VIEW**: 1 literals, 1 files
- **DDL_SOURCE**: 16 literals, 14 files
- **DOMAIN**: 15 literals, 13 files
- **ENHANCEMENT**: 2 literals, 2 files
- **FEATURE_TOGGLE**: 14 literals, 14 files
- **FUNCTION_GROUP**: 45 literals, 35 files
- **INTERFACE**: 15 literals, 13 files
- **MESSAGE_CLASS**: 8 literals, 8 files
- **METADATA_EXTENSION**: 15 literals, 13 files
- **PACKAGE**: 15 literals, 12 files
- **PROGRAM**: 17 literals, 13 files
- **PROGRAM_INCLUDE**: 4 literals, 4 files
- **SCALAR_FUNCTION**: 12 literals, 10 files
- **SCALAR_FUNCTION_IMPLEMENTATION**: 13 literals, 11 files
- **SERVICE_BINDING**: 15 literals, 4 files
- **SERVICE_DEFINITION**: 14 literals, 11 files
- **STRUCTURE**: 26 literals, 21 files
- **TABLE**: 17 literals, 15 files
- **TABLE_TYPE**: 17 literals, 13 files
- **TRANSFORMATION**: 13 literals, 10 files
- **TRANSPORT_REQUEST**: 6 literals, 6 files

---

### Task 0: Worktree

- [ ] **Step 1: Create the worktree from current main**

```bash
cd /home/okyslytsia/prj/mcp-abap-adt-clients
git fetch -q && git worktree add -b refactor/object-address-registry ../adt-clients-address-registry origin/main
cd ../adt-clients-address-registry && npm ci && npm run build -w packages/adt-strategies
```

- [ ] **Step 2: Confirm a green start**

Run: `MCP_ENV_PATH=/tmp/nonexistent-env npx jest src/__tests__/unit > unit-start.log 2>&1; echo $?`
Expected: `0`. Read `unit-start.log`: `Test Suites: N passed`.

---

### Task 1: The registry and its builders

**Files:**
- Create: `src/endpoints/objects.ts`
- Test: `src/__tests__/unit/endpoints/objects.test.ts`

**Interfaces:**
- Produces (used by every later task):
  - `seg(name: string): string`
  - `sourceUri(objectUri: string): string`: appends `/source/main`
  - `versionsUri(resourceUri: string): string`: appends `/versions`
  - `transportUri(objectUri: string): string`: appends `/transport`
  - `type ClassIncludeKind = 'definitions' | 'implementations' | 'macros' | 'testclasses' | 'main'`
  - records: `PROGRAM`, `PROGRAM_INCLUDE`, `CLASS`, `CLASS_INCLUDE`, `INTERFACE`, `FUNCTION_GROUP`, `FUNCTION_MODULE`, `FUNCTION_INCLUDE`, `PACKAGE`, `DDL_SOURCE`, `DDIC_VIEW`, `TABLE`, `STRUCTURE`, `DOMAIN`, `DATA_ELEMENT`, `TABLE_TYPE`, `BEHAVIOR_DEFINITION`, `SERVICE_DEFINITION`, `SERVICE_BINDING`, `ACCESS_CONTROL`, `METADATA_EXTENSION`, `TRANSFORMATION`, `MESSAGE_CLASS`, `FEATURE_TOGGLE`, `AUTHORIZATION_FIELD`, `ENHANCEMENT`, `SCALAR_FUNCTION`, `SCALAR_FUNCTION_IMPLEMENTATION`, `TRANSPORT_REQUEST`, `TRANSPORT_REQUEST_LEGACY`
  - `RECORDS: Record<string, object>`, every record by name, read by the enforcement test.

- [ ] **Step 1: Write the failing test**

`src/__tests__/unit/endpoints/objects.test.ts`:

```ts
/**
 * Each builder against the exact address it must produce. The expectations are
 * written out, not computed from the registry — a test that took them from the
 * registry would compare it with itself.
 */
import {
  CLASS,
  CLASS_INCLUDE,
  ENHANCEMENT,
  FEATURE_TOGGLE,
  FUNCTION_GROUP,
  FUNCTION_INCLUDE,
  FUNCTION_MODULE,
  PACKAGE,
  PROGRAM,
  PROGRAM_INCLUDE,
  RECORDS,
  SERVICE_BINDING,
  TRANSPORT_REQUEST,
  TRANSPORT_REQUEST_LEGACY,
  seg,
  sourceUri,
  transportUri,
  versionsUri,
} from '../../../endpoints/objects';

describe('seg', () => {
  it('lowercases and percent-encodes', () => {
    expect(seg('ZCL_X')).toBe('zcl_x');
  });
  it('encodes a namespace, never a raw slash', () => {
    expect(seg('/ABC/ZCL_X')).toBe('%2fabc%2fzcl_x');
  });
  it('encodes $ in local packages', () => {
    expect(seg('$TMP')).toBe('%24tmp');
  });
});

describe('records', () => {
  it('program', () => {
    expect(PROGRAM.collection).toBe('/sap/bc/adt/programs/programs');
    expect(PROGRAM.validation).toBe('/sap/bc/adt/programs/validation');
    expect(PROGRAM.uri('ZREP')).toBe('/sap/bc/adt/programs/programs/zrep');
  });
  it('program include', () => {
    expect(PROGRAM_INCLUDE.collection).toBe('/sap/bc/adt/programs/includes');
    expect(PROGRAM_INCLUDE.validation).toBe('/sap/bc/adt/includes/validation');
    expect(PROGRAM_INCLUDE.uri('ZREP_TOP')).toBe(
      '/sap/bc/adt/programs/includes/zrep_top',
    );
  });
  it('function include needs its group', () => {
    expect(FUNCTION_INCLUDE.uri('ZFG', 'LZFGTOP')).toBe(
      '/sap/bc/adt/functions/groups/zfg/includes/lzfgtop',
    );
  });
  it('function module needs its group', () => {
    expect(FUNCTION_MODULE.collection('ZFG')).toBe(
      '/sap/bc/adt/functions/groups/zfg/fmodules',
    );
    expect(FUNCTION_MODULE.uri('ZFG', 'Z_FM')).toBe(
      '/sap/bc/adt/functions/groups/zfg/fmodules/z_fm',
    );
    expect(FUNCTION_MODULE.validation).toBe('/sap/bc/adt/functions/validation');
    expect(FUNCTION_GROUP.validation).toBe('/sap/bc/adt/functions/validation');
  });
  it('class include needs its class and kind', () => {
    expect(CLASS_INCLUDE.uri('ZCL_X', 'testclasses')).toBe(
      '/sap/bc/adt/oo/classes/zcl_x/includes/testclasses',
    );
    expect(CLASS.validation).toBe('/sap/bc/adt/oo/validation/objectname');
  });
  it('package', () => {
    expect(PACKAGE.uri('$TMP')).toBe('/sap/bc/adt/packages/%24tmp');
  });
  it('enhancement takes its subtype as a segment', () => {
    expect(ENHANCEMENT.uri('enhoxh', 'ZENH')).toBe(
      '/sap/bc/adt/enhancements/enhoxh/zenh',
    );
  });
  it('service binding and its jobs', () => {
    expect(SERVICE_BINDING.uri('ZUI_B')).toBe(
      '/sap/bc/adt/businessservices/bindings/zui_b',
    );
    expect(SERVICE_BINDING.publishJobs('odatav2')).toBe(
      '/sap/bc/adt/businessservices/odatav2/publishjobs',
    );
    expect(SERVICE_BINDING.unpublishJobs('odatav4')).toBe(
      '/sap/bc/adt/businessservices/odatav4/unpublishjobs',
    );
  });
  it('feature toggle tails', () => {
    expect(FEATURE_TOGGLE.check('ZFT')).toBe('/sap/bc/adt/sfw/featuretoggles/zft/check');
    expect(FEATURE_TOGGLE.states('ZFT')).toBe('/sap/bc/adt/sfw/featuretoggles/zft/states');
    expect(FEATURE_TOGGLE.toggle('ZFT')).toBe('/sap/bc/adt/sfw/featuretoggles/zft/toggle');
  });
  it('transport request has a legacy address of its own', () => {
    expect(TRANSPORT_REQUEST.collection).toBe('/sap/bc/adt/cts/transportrequests');
    expect(TRANSPORT_REQUEST_LEGACY.collection).toBe('/sap/bc/cts/transportrequests');
  });
  it('tails are functions of an address', () => {
    const p = PROGRAM.uri('ZREP');
    expect(sourceUri(p)).toBe('/sap/bc/adt/programs/programs/zrep/source/main');
    expect(versionsUri(sourceUri(p))).toBe(
      '/sap/bc/adt/programs/programs/zrep/source/main/versions',
    );
    expect(transportUri(p)).toBe('/sap/bc/adt/programs/programs/zrep/transport');
  });
  it('every record is listed in RECORDS', () => {
    expect(Object.keys(RECORDS).sort()).toEqual(
      [
        'ACCESS_CONTROL', 'AUTHORIZATION_FIELD', 'BEHAVIOR_DEFINITION', 'CLASS',
        'CLASS_INCLUDE', 'DATA_ELEMENT', 'DDIC_VIEW', 'DDL_SOURCE', 'DOMAIN',
        'ENHANCEMENT', 'FEATURE_TOGGLE', 'FUNCTION_GROUP', 'FUNCTION_INCLUDE',
        'FUNCTION_MODULE', 'INTERFACE', 'MESSAGE_CLASS', 'METADATA_EXTENSION',
        'PACKAGE', 'PROGRAM', 'PROGRAM_INCLUDE', 'SCALAR_FUNCTION',
        'SCALAR_FUNCTION_IMPLEMENTATION', 'SERVICE_BINDING', 'SERVICE_DEFINITION',
        'STRUCTURE', 'TABLE', 'TABLE_TYPE', 'TRANSFORMATION', 'TRANSPORT_REQUEST',
        'TRANSPORT_REQUEST_LEGACY',
      ].sort(),
    );
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `MCP_ENV_PATH=/tmp/nonexistent-env npx jest src/__tests__/unit/endpoints > t1.log 2>&1; echo $?`
Expected: non-zero; `t1.log` says `Cannot find module '../../../endpoints/objects'`.

- [ ] **Step 3: Write the registry**

`src/endpoints/objects.ts`:

```ts
/**
 * Where each kind of ADT object lives — the one place an object address is
 * built.
 *
 * Every module used to build its own: 369 literals in 237 files, and five
 * type-to-address tables that had drifted apart (an enhancement sent to the
 * XSLT collection, an interface known by a type code ADT does not use). A
 * record per kind, with exactly the arguments its address needs, is what keeps
 * a program include, a function include and a class include from being taken
 * for one another — ATC finds a function include under its group and not under
 * `/programs/includes/`, measured on E19 and the trial (2026-10-01).
 *
 * Paths are written out in full on purpose: the enforcement test reads every
 * string field of every record and forbids it anywhere else in `src/`.
 * `validation` is stated per kind because it is not derivable from the
 * collection. There is no lock builder: the `_action` query differs by module
 * and is not an address.
 *
 * Internal. Nothing here is exported from the package.
 */

import type { EnhancementType } from '@mcp-abap-adt/interfaces-adt';

/**
 * The only way a name enters an address: lowercased and percent-encoded, as in
 * the addresses ADT itself answers with. A namespace `/ABC/` becomes
 * `%2fabc%2f`.
 */
export function seg(name: string): string {
  return encodeURIComponent(name.toLowerCase());
}

export const sourceUri = (objectUri: string): string =>
  `${objectUri}/source/main`;
export const versionsUri = (resourceUri: string): string =>
  `${resourceUri}/versions`;
export const transportUri = (objectUri: string): string =>
  `${objectUri}/transport`;

export type ClassIncludeKind =
  | 'definitions'
  | 'implementations'
  | 'macros'
  | 'testclasses'
  | 'main';

export type ODataServiceType = 'odatav2' | 'odatav4';

export const PROGRAM = {
  collection: '/sap/bc/adt/programs/programs',
  validation: '/sap/bc/adt/programs/validation',
  uri: (name: string) => `/sap/bc/adt/programs/programs/${seg(name)}`,
} as const;

export const PROGRAM_INCLUDE = {
  collection: '/sap/bc/adt/programs/includes',
  validation: '/sap/bc/adt/includes/validation',
  uri: (name: string) => `/sap/bc/adt/programs/includes/${seg(name)}`,
} as const;

export const CLASS = {
  collection: '/sap/bc/adt/oo/classes',
  validation: '/sap/bc/adt/oo/validation/objectname',
  uri: (name: string) => `/sap/bc/adt/oo/classes/${seg(name)}`,
} as const;

export const CLASS_INCLUDE = {
  uri: (className: string, kind: ClassIncludeKind) =>
    `${CLASS.uri(className)}/includes/${kind}`,
} as const;

export const INTERFACE = {
  collection: '/sap/bc/adt/oo/interfaces',
  validation: '/sap/bc/adt/oo/validation/objectname',
  uri: (name: string) => `/sap/bc/adt/oo/interfaces/${seg(name)}`,
} as const;

export const FUNCTION_GROUP = {
  collection: '/sap/bc/adt/functions/groups',
  validation: '/sap/bc/adt/functions/validation',
  uri: (name: string) => `/sap/bc/adt/functions/groups/${seg(name)}`,
} as const;

export const FUNCTION_MODULE = {
  validation: '/sap/bc/adt/functions/validation',
  collection: (group: string) => `${FUNCTION_GROUP.uri(group)}/fmodules`,
  uri: (group: string, name: string) =>
    `${FUNCTION_GROUP.uri(group)}/fmodules/${seg(name)}`,
} as const;

export const FUNCTION_INCLUDE = {
  collection: (group: string) => `${FUNCTION_GROUP.uri(group)}/includes`,
  uri: (group: string, name: string) =>
    `${FUNCTION_GROUP.uri(group)}/includes/${seg(name)}`,
} as const;

export const PACKAGE = {
  collection: '/sap/bc/adt/packages',
  validation: '/sap/bc/adt/packages/validation',
  uri: (name: string) => `/sap/bc/adt/packages/${seg(name)}`,
} as const;

export const DDL_SOURCE = {
  collection: '/sap/bc/adt/ddic/ddl/sources',
  validation: '/sap/bc/adt/ddic/ddl/validation',
  uri: (name: string) => `/sap/bc/adt/ddic/ddl/sources/${seg(name)}`,
} as const;

/** A classic DDIC view (`VIEW/DV`) — group operations address it here. */
export const DDIC_VIEW = {
  collection: '/sap/bc/adt/ddic/views',
  uri: (name: string) => `/sap/bc/adt/ddic/views/${seg(name)}`,
} as const;

export const TABLE = {
  collection: '/sap/bc/adt/ddic/tables',
  validation: '/sap/bc/adt/ddic/tables/validation',
  uri: (name: string) => `/sap/bc/adt/ddic/tables/${seg(name)}`,
} as const;

/** Structures, append structures included — ADT keeps both in one collection. */
export const STRUCTURE = {
  collection: '/sap/bc/adt/ddic/structures',
  validation: '/sap/bc/adt/ddic/structures/validation',
  uri: (name: string) => `/sap/bc/adt/ddic/structures/${seg(name)}`,
} as const;

export const DOMAIN = {
  collection: '/sap/bc/adt/ddic/domains',
  validation: '/sap/bc/adt/ddic/domains/validation',
  uri: (name: string) => `/sap/bc/adt/ddic/domains/${seg(name)}`,
} as const;

export const DATA_ELEMENT = {
  collection: '/sap/bc/adt/ddic/dataelements',
  validation: '/sap/bc/adt/ddic/dataelements/validation',
  uri: (name: string) => `/sap/bc/adt/ddic/dataelements/${seg(name)}`,
} as const;

export const TABLE_TYPE = {
  collection: '/sap/bc/adt/ddic/tabletypes',
  validation: '/sap/bc/adt/ddic/tabletypes/validation',
  uri: (name: string) => `/sap/bc/adt/ddic/tabletypes/${seg(name)}`,
} as const;

export const BEHAVIOR_DEFINITION = {
  collection: '/sap/bc/adt/bo/behaviordefinitions',
  validation: '/sap/bc/adt/bo/behaviordefinitions/validation',
  uri: (name: string) => `/sap/bc/adt/bo/behaviordefinitions/${seg(name)}`,
} as const;

export const SERVICE_DEFINITION = {
  collection: '/sap/bc/adt/ddic/srvd/sources',
  validation: '/sap/bc/adt/ddic/srvd/sources/validation',
  uri: (name: string) => `/sap/bc/adt/ddic/srvd/sources/${seg(name)}`,
} as const;

export const SERVICE_BINDING = {
  collection: '/sap/bc/adt/businessservices/bindings',
  bindingTypes: '/sap/bc/adt/businessservices/bindings/bindingtypes',
  uri: (name: string) => `/sap/bc/adt/businessservices/bindings/${seg(name)}`,
  publishJobs: (type: ODataServiceType) =>
    `/sap/bc/adt/businessservices/${type}/publishjobs`,
  unpublishJobs: (type: ODataServiceType) =>
    `/sap/bc/adt/businessservices/${type}/unpublishjobs`,
  /** The published OData service a binding exposes. Case: see Task 3. */
  odataService: (type: ODataServiceType, name: string) =>
    `/sap/bc/adt/businessservices/${type}/${seg(name)}`,
} as const;

export const ACCESS_CONTROL = {
  collection: '/sap/bc/adt/acm/dcl/sources',
  validation: '/sap/bc/adt/acm/dcl/validation',
  uri: (name: string) => `/sap/bc/adt/acm/dcl/sources/${seg(name)}`,
} as const;

export const METADATA_EXTENSION = {
  collection: '/sap/bc/adt/ddic/ddlx/sources',
  validation: '/sap/bc/adt/ddic/ddlx/sources/validation',
  uri: (name: string) => `/sap/bc/adt/ddic/ddlx/sources/${seg(name)}`,
} as const;

export const TRANSFORMATION = {
  collection: '/sap/bc/adt/xslt/transformations',
  validation: '/sap/bc/adt/xslt/validation',
  uri: (name: string) => `/sap/bc/adt/xslt/transformations/${seg(name)}`,
} as const;

export const MESSAGE_CLASS = {
  collection: '/sap/bc/adt/messageclass',
  validation: '/sap/bc/adt/messageclass/validation',
  uri: (name: string) => `/sap/bc/adt/messageclass/${seg(name)}`,
} as const;

export const FEATURE_TOGGLE = {
  collection: '/sap/bc/adt/sfw/featuretoggles',
  validation: '/sap/bc/adt/sfw/featuretoggles/validation',
  uri: (name: string) => `/sap/bc/adt/sfw/featuretoggles/${seg(name)}`,
  check: (name: string) => `${FEATURE_TOGGLE.uri(name)}/check`,
  states: (name: string) => `${FEATURE_TOGGLE.uri(name)}/states`,
  toggle: (name: string) => `${FEATURE_TOGGLE.uri(name)}/toggle`,
} as const;

export const AUTHORIZATION_FIELD = {
  collection: '/sap/bc/adt/aps/iam/auth',
  validation: '/sap/bc/adt/aps/iam/auth/validation',
  uri: (name: string) => `/sap/bc/adt/aps/iam/auth/${seg(name)}`,
} as const;

/** The subtype is a path segment: `/enhancements/enhoxh/<name>`. */
export const ENHANCEMENT = {
  root: '/sap/bc/adt/enhancements',
  collection: (type: EnhancementType) => `/sap/bc/adt/enhancements/${type}`,
  uri: (type: EnhancementType, name: string) =>
    `/sap/bc/adt/enhancements/${type}/${seg(name)}`,
} as const;

export const SCALAR_FUNCTION = {
  collection: '/sap/bc/adt/ddic/dsfd/sources',
  validation: '/sap/bc/adt/ddic/dsfd/sources/validation',
  uri: (name: string) => `/sap/bc/adt/ddic/dsfd/sources/${seg(name)}`,
} as const;

export const SCALAR_FUNCTION_IMPLEMENTATION = {
  collection: '/sap/bc/adt/ddic/dsfi',
  validation: '/sap/bc/adt/ddic/dsfi/validation',
  uri: (name: string) => `/sap/bc/adt/ddic/dsfi/${seg(name)}`,
} as const;

export const TRANSPORT_REQUEST = {
  collection: '/sap/bc/adt/cts/transportrequests',
  uri: (number: string) => `/sap/bc/adt/cts/transportrequests/${seg(number)}`,
} as const;

/**
 * Below BASIS 7.50 the CTS endpoint sits outside `/sap/bc/adt/`. The one kind
 * whose address differs on legacy — so it is a record of its own, never a
 * substitution inside `TRANSPORT_REQUEST`.
 */
export const TRANSPORT_REQUEST_LEGACY = {
  collection: '/sap/bc/cts/transportrequests',
} as const;

/** Every record by name — what the enforcement test reads. */
export const RECORDS = {
  PROGRAM,
  PROGRAM_INCLUDE,
  CLASS,
  CLASS_INCLUDE,
  INTERFACE,
  FUNCTION_GROUP,
  FUNCTION_MODULE,
  FUNCTION_INCLUDE,
  PACKAGE,
  DDL_SOURCE,
  DDIC_VIEW,
  TABLE,
  STRUCTURE,
  DOMAIN,
  DATA_ELEMENT,
  TABLE_TYPE,
  BEHAVIOR_DEFINITION,
  SERVICE_DEFINITION,
  SERVICE_BINDING,
  ACCESS_CONTROL,
  METADATA_EXTENSION,
  TRANSFORMATION,
  MESSAGE_CLASS,
  FEATURE_TOGGLE,
  AUTHORIZATION_FIELD,
  ENHANCEMENT,
  SCALAR_FUNCTION,
  SCALAR_FUNCTION_IMPLEMENTATION,
  TRANSPORT_REQUEST,
  TRANSPORT_REQUEST_LEGACY,
} as const;
```

**Before writing `TRANSPORT_REQUEST.uri`, read `src/core/transport/read.ts` and check how the request number enters the URL today.** If it is sent as given (uppercase, `E19K900001`), keep `uri` exactly as written above and let Task 3 measure whether lowercase is accepted. Do not change it on assumption.

- [ ] **Step 4: Run the test**

Run: `MCP_ENV_PATH=/tmp/nonexistent-env npx jest src/__tests__/unit/endpoints > t1.log 2>&1; echo $?`
Expected: `0`. Read `t1.log` for the pass count.

- [ ] **Step 5: Lint, type-check, commit**

```bash
npx biome check --write src/endpoints src/__tests__/unit/endpoints
npx tsc --noEmit -p tsconfig.json
git add src/endpoints src/__tests__/unit/endpoints
git commit -m "refactor(endpoints): the object address registry, one record per kind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The enforcement test

**Files:**
- Create: `src/__tests__/unit/endpoints/noHardcodedObjectAddresses.test.ts`

**Interfaces:**
- Consumes: `RECORDS` from Task 1.
- Produces: the constant `ENFORCED` (an array of record names) at the top of the test file. **Every migration task adds its kinds to it in the same commit.** Task 17 replaces it with "all records".

- [ ] **Step 1: Write the test, with the detector tested on its own first**

```ts
/**
 * No object address outside src/endpoints/.
 *
 * Reads src/ with the TypeScript parser (decision 3: a checker reads code with
 * a parser, not with a pattern), skipping src/__tests__/ — a test states the
 * wire string it expects. Fails on any string or template literal that
 * CONTAINS a path a registry record declares: a literal that merely started
 * with one would miss the sixteen payloads embedding an address
 * (`adtcore:uri="/sap/bc/adt/…"`) and the error messages naming one.
 *
 * `ENFORCED` grows kind by kind while the modules move over; the last task of
 * the migration replaces it with every record.
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { RECORDS } from '../../../endpoints/objects';

const ENFORCED: readonly (keyof typeof RECORDS)[] = [];

const ROOT = path.resolve(__dirname, '../../../..');

/** Every string-valued field of the named records. */
function declaredPaths(names: readonly (keyof typeof RECORDS)[]): string[] {
  const paths = new Set<string>();
  for (const name of names) {
    for (const value of Object.values(RECORDS[name])) {
      if (typeof value === 'string') paths.add(value);
    }
  }
  return [...paths];
}

/**
 * Whether `text` contains `p` as a whole path: what follows must end the path
 * or start the next segment, so `/programs/programs` does not match
 * `/programs/programrun`.
 */
export function containsPath(text: string, p: string): boolean {
  let from = 0;
  for (;;) {
    const at = text.indexOf(p, from);
    if (at < 0) return false;
    const next = text.charAt(at + p.length);
    if (next === '' || '/?#"\'$`\\ <'.includes(next)) return true;
    from = at + 1;
  }
}

/** Text of a literal; a template's substitutions become `${}`. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans.map((s) => `\${}${s.literal.text}`).join('')
    );
  }
  return null;
}

function violations(paths: string[]): string[] {
  const files = execSync("git ls-files 'src/**/*.ts'", {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter((f) => !f.startsWith('src/__tests__/') && !f.startsWith('src/endpoints/'));
  const found: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(path.join(ROOT, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      const text = literalText(node);
      if (text !== null) {
        const hit = paths.find((p) => containsPath(text, p));
        if (hit) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          found.push(`${file}:${line + 1}  ${hit}`);
        }
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe('containsPath', () => {
  it('matches a whole path and what may follow it', () => {
    expect(containsPath('/sap/bc/adt/programs/programs/zrep', '/sap/bc/adt/programs/programs')).toBe(true);
    expect(containsPath('/sap/bc/adt/programs/programs?x=1', '/sap/bc/adt/programs/programs')).toBe(true);
    expect(containsPath('uri="/sap/bc/adt/ddic/tables"/>', '/sap/bc/adt/ddic/tables')).toBe(true);
    expect(containsPath('/sap/bc/adt/programs/programs${}', '/sap/bc/adt/programs/programs')).toBe(true);
  });
  it('does not match a longer sibling segment', () => {
    expect(containsPath('/sap/bc/adt/programs/programrun/zrep', '/sap/bc/adt/programs/programs')).toBe(false);
    expect(containsPath('/sap/bc/adt/ddic/tablesettings', '/sap/bc/adt/ddic/tables')).toBe(false);
  });
});

describe('object addresses come from src/endpoints/ only', () => {
  it('no enforced path is written anywhere else in src/', () => {
    expect(violations(declaredPaths(ENFORCED))).toEqual([]);
  });
});
```

- [ ] **Step 2: Prove the check finds what it should**

Temporarily set `ENFORCED = ['PROGRAM']`, run, and confirm it fails listing the program files from the inventory below. Then set it back to `[]`.

Run: `MCP_ENV_PATH=/tmp/nonexistent-env npx jest src/__tests__/unit/endpoints/noHardcoded > t2.log 2>&1; echo $?`
Expected with `['PROGRAM']`: non-zero; `t2.log` lists `src/core/program/…` lines. With `[]`: `0`.

- [ ] **Step 3: Commit**

```bash
npx biome check --write src/__tests__/unit/endpoints
git add src/__tests__/unit/endpoints/noHardcodedObjectAddresses.test.ts
git commit -m "test(endpoints): no object address outside the registry, kind by kind

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Measure before switching: the `adt-nc` matrix

**Files:**
- Create: `scripts/lib/adtTarget.ts` (connection code moved out of `scripts/adt-nc.ts`: `resolveTarget`, `connectionFor`, `answerOf`, `ITarget`)
- Modify: `scripts/adt-nc.ts` (imports from `scripts/lib/adtTarget.ts`, no behaviour change)
- Create: `scripts/address-matrix.ts`
- Not tracked: the objects file, e.g. `~/.config/mcp-abap-adt/address-matrix.objects.json` (names objects on concrete systems)

**Interfaces:**
- Consumes: `RECORDS`, `sourceUri`, `versionsUri` (Task 1); `resolveTarget`, `connectionFor`, `answerOf` (this task, Step 1).
- Produces: `address-matrix.md`, a table per target. It is pasted into the PR description and read in Step 4 to decide each kind's `seg`.

- [ ] **Step 1: Move the connection code**

Cut `resolveTarget`, `configOf`, `connectionFor`, `answerOf`, `clean`, `ITarget`, `SystemKind` out of `scripts/adt-nc.ts` into `scripts/lib/adtTarget.ts`, exported. `adt-nc.ts` imports them. Re-run the #194 check to prove nothing changed:

Run: `npx ts-node scripts/adt-nc.ts --to e19-tunnel --to trial:cloud GET /sap/bc/adt/programs/programs/rsparam -H 'Accept: application/vnd.sap.adt.programs.programs.v2+xml' > t3a.log 2>&1; echo $?`
Expected: `0`; `t3a.log` ends `--- e19-tunnel: 200 | trial: 200`.

- [ ] **Step 2: Write the objects file (outside the repo)**

One real object per kind and target. Arguments are in the record's `uri` order. Known on 2026-10-01: E19 `PROGRAM: ZAC_SHR_PROG`, `PROGRAM_INCLUDE: ZABER_ALV_REPORT_TOP`, `FUNCTION_GROUP: ZAC_SHR_FUGR`, `FUNCTION_INCLUDE: [ZAC_SHR_FUGR, LZAC_SHR_FUGRZ02]`, `FUNCTION_MODULE: [ZAC_SHR_FUGR, Z_AC_SHR_FM01]`, `CLASS: ZAC_SHR_ATC_DIRTY`, `CLASS_INCLUDE: [ZAC_SHR_ATC_DIRTY, implementations]`. Trial: `FUNCTION_GROUP: ZFG_MATH`, `FUNCTION_INCLUDE: [ZFG_MATH, LZFG_MATHTOP]`, `CLASS: Z011_TEST`. For the remaining kinds, list objects with:

```bash
npx ts-node scripts/adt-nc.ts --to e19-tunnel POST '/sap/bc/adt/repository/nodestructure?parent_type=DEVC/K&parent_name=TEST_AC_SHR_PKG&withShortDescriptions=false' -H 'Accept: application/vnd.sap.as+xml'
```

Shape:

```json
{
  "e19-tunnel": { "PROGRAM": [["ZAC_SHR_PROG"]], "FUNCTION_INCLUDE": [["ZAC_SHR_FUGR", "LZAC_SHR_FUGRZ02"]] },
  "trial:cloud": { "FUNCTION_INCLUDE": [["ZFG_MATH", "LZFG_MATHTOP"]] }
}
```

A kind with no object on a target is left out. The script reports it as **not measured there**, never as passed.

- [ ] **Step 3: Write `scripts/address-matrix.ts`**

Reads only (GET). `validation` is measured from the integration runs' wire log (Tasks 4 and 18), not here. One connection per target, not one per request.

```ts
/**
 * address-matrix — read every registry address on real systems, in the case
 * the registry sends (lowercase, through `seg`) and in the case a caller gives
 * (as written), and say whether the two answers agree.
 *
 *   npx ts-node scripts/address-matrix.ts --objects <file.json> \
 *     --to e19-tunnel --to trial:cloud --out address-matrix.md
 *
 * The objects file names real objects on concrete systems, so it lives outside
 * the repository.
 */
import * as fs from 'node:fs';
import type { ILogger } from '@mcp-abap-adt/interfaces-utils';
import {
  RECORDS,
  sourceUri,
  versionsUri,
} from '../src/endpoints/objects';
import { answerOf, connectionFor, resolveTarget } from './lib/adtTarget';

type Args = string[];
type Objects = Record<string, Record<string, Args[]>>;

const WITH_SOURCE = new Set([
  'PROGRAM', 'PROGRAM_INCLUDE', 'CLASS', 'INTERFACE', 'FUNCTION_MODULE',
  'FUNCTION_INCLUDE', 'DDL_SOURCE', 'TABLE', 'STRUCTURE', 'TABLE_TYPE',
  'BEHAVIOR_DEFINITION', 'SERVICE_DEFINITION', 'ACCESS_CONTROL',
  'METADATA_EXTENSION', 'TRANSFORMATION', 'SCALAR_FUNCTION',
  'SCALAR_FUNCTION_IMPLEMENTATION',
]);

/** Arguments that are names (lowercased by `seg`); the rest are kinds/subtypes. */
const NAME_ARGS: Record<string, number[]> = {
  CLASS_INCLUDE: [0],
  ENHANCEMENT: [1],
};

const silent = {} as ILogger;

function asGiven(uri: string, args: Args, kind: string): string {
  let out = uri;
  for (const i of NAME_ARGS[kind] ?? args.map((_, n) => n)) {
    const arg = args[i];
    out = out.replace(
      `/${encodeURIComponent(arg.toLowerCase())}`,
      `/${encodeURIComponent(arg)}`,
    );
  }
  return out;
}

async function get(
  connection: ReturnType<typeof connectionFor>,
  url: string,
  accept: string,
) {
  try {
    const r = await connection.makeAdtRequest({
      url, method: 'GET', timeout: 60_000, headers: { Accept: accept },
    });
    return { status: r.status, body: String(r.data ?? '') };
  } catch (error) {
    const a = answerOf(error);
    return 'status' in a
      ? { status: a.status, body: String(a.data ?? '') }
      : { status: 0, body: a.error };
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opt = (k: string) => argv[argv.indexOf(k) + 1];
  const objects = JSON.parse(fs.readFileSync(opt('--objects'), 'utf8')) as Objects;
  const targets = argv.flatMap((a, i) => (a === '--to' ? [argv[i + 1]] : []));
  const lines: string[] = ['| target | kind | request | status | agrees |', '|---|---|---|---|---|'];
  let failed = false;

  for (const spec of targets) {
    const target = resolveTarget(spec);
    const connection = connectionFor(target, silent);
    await connection.connect();
    try {
      for (const [kind, argLists] of Object.entries(objects[spec] ?? {})) {
        const record = RECORDS[kind as keyof typeof RECORDS] as {
          uri: (...a: string[]) => string;
        };
        for (const args of argLists) {
          const lower = record.uri(...args);
          const upper = asGiven(lower, args, kind);
          const a = await get(connection, lower, '*/*');
          const b = await get(connection, upper, '*/*');
          const agrees = a.status === b.status && a.body === b.body;
          if (a.status !== 200 || !agrees) failed = true;
          lines.push(`| ${target.label} | ${kind} | GET ${lower} | ${a.status} | ${agrees ? 'yes' : `NO — as given: ${b.status}`} |`);
          if (WITH_SOURCE.has(kind)) {
            const src = await get(connection, sourceUri(lower), 'text/plain');
            const ver = await get(connection, versionsUri(sourceUri(lower)), 'application/atom+xml;type=feed');
            if (src.status !== 200 || ver.status !== 200) failed = true;
            lines.push(`| ${target.label} | ${kind} | GET …/source/main | ${src.status} | |`);
            lines.push(`| ${target.label} | ${kind} | GET …/source/main/versions | ${ver.status} | |`);
          }
        }
      }
      for (const kind of Object.keys(RECORDS)) {
        if (!(objects[spec] ?? {})[kind]) {
          lines.push(`| ${target.label} | ${kind} | — | not measured here | |`);
        }
      }
    } finally {
      void Promise.resolve(connection.disconnect()).catch(() => undefined);
    }
  }
  fs.writeFileSync(opt('--out'), `${lines.join('\n')}\n`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error: unknown) => {
  process.stderr.write(`address-matrix: ${String(error)}\n`);
  process.exitCode = 2;
});
```

`CLASS_INCLUDE` with kind `testclasses` on a class without test classes answers 404: pick a class include that exists. Check with `adt-nc` first.

Run: `npx ts-node scripts/address-matrix.ts --objects ~/.config/mcp-abap-adt/address-matrix.objects.json --to e19-tunnel --to trial:cloud --out address-matrix.md > t3.log 2>&1; echo $?`
Expected: `0` if every measured row is 200 and agrees, `1` otherwise. Read `address-matrix.md` whole.

- [ ] **Step 4: Act on the result before any module moves**

For a kind where (1) and (2) differ: give its record its own name encoding (`encodeURIComponent(name)`, case kept), with a comment quoting the measured statuses. Add a test line in `objects.test.ts` pinning it. For `SERVICE_BINDING.odataService` (sent uppercase today): same rule. Re-run Step 3 until it exits `0`.

- [ ] **Step 5: Commit**

```bash
npx biome check --write scripts src/endpoints
git add scripts/lib/adtTarget.ts scripts/adt-nc.ts scripts/address-matrix.ts src/endpoints src/__tests__/unit/endpoints
git commit -m "test(scripts): address matrix — every registry path read on E19 and the trial

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

`address-matrix.md` is not committed. It goes into the PR description in Task 18.

---

### Task 4: Baseline integration runs, before any switch

- [ ] **Step 1: Trial, with the wire logged**

```bash
cp ~/.config/mcp-abap-adt/sessions/trial.env .env
WIRE_LOG=$PWD/wire-baseline-trial.txt npm run test:detached
```
Wait for the run to finish (it writes `test-run.log`, ~27 minutes). Then `cp test-run.log baseline-trial.log`. Read `baseline-trial.log`: record the `Tests:` line and every failing test name in `baseline-failures.md`.

- [ ] **Step 2: E19, with the wire logged**

Swap in the E19 config and env:
```bash
cp src/__tests__/helpers/test-config.yaml /tmp/test-config.trial.yaml
cp ~/.config/mcp-abap-adt/test-config.e19.yaml src/__tests__/helpers/test-config.yaml
cp ~/.config/mcp-abap-adt/sessions/e19-tunnel.env .env
WIRE_LOG=$PWD/wire-baseline-e19.txt npm run test:detached
```
After it finishes: `cp test-run.log baseline-e19.log`, record as in Step 1, then restore the trial config: `cp /tmp/test-config.trial.yaml src/__tests__/helpers/test-config.yaml`.

- [ ] **Step 3: Read every validation request out of the wire logs**

The flow calls `validate()` for every kind with its own config. `BaseTester` skips the step on `404`/`405`/`501`, so the test result says nothing; the log does:

```bash
for s in trial e19; do
  awk '/^(GET|POST|PUT|DELETE) /{req=$0; next} /^  <- /{ if (req ~ /validation/) print req "  " $0; req="" }' wire-baseline-$s.txt | sort | uniq -c > validation-baseline-$s.txt
done
```
Read both files. Any `<- 404`, or a validation request whose logged body says `No URI-Mapping`, is a wrong path **before** the switch. List it in `baseline-failures.md` as a pre-existing defect: the registry's record for it must be corrected in its migration task, and the PR says so.

- [ ] **Step 4: Nothing to commit**

The logs are gitignored artefacts. `baseline-failures.md` stays in the worktree for Task 18.

---
### Migration rules (Tasks 5–14)

These rules apply in every migration task. A task's own section lists only its kinds and files.

| Before (any of these spellings) | After |
|---|---|
| `` `/sap/bc/adt/<collection>/${encodeSapObjectName(x)}` ``, with or without `.toLowerCase()` before or after encoding; `` `/sap/bc/adt/<collection>/${encodedName}` `` where `encodedName` was computed above | `KIND.uri(x)`. Delete the now-unused `encodedName` variable. |
| `` `/sap/bc/adt/<collection>` `` (POST create) or `'/sap/bc/adt/<collection>'` | `KIND.collection` |
| `` `${…}/source/main${query}` `` | `` `${sourceUri(KIND.uri(x))}${query}` `` |
| `` `…/source/main/versions` `` | `versionsUri(sourceUri(KIND.uri(x)))` |
| `` `…/includes/<kind>/versions` `` (class) | `versionsUri(CLASS_INCLUDE.uri(c, '<kind>'))` |
| `` `…/transport${query}` `` | `` `${transportUri(KIND.uri(x))}${query}` `` |
| `` `${objectUri}?_action=LOCK…` `` | keep the query, take only the address: `` `${KIND.uri(x)}?_action=LOCK…` `` |
| `'/sap/bc/adt/<…>/validation'` | `KIND.validation` |
| `adtcore:uri="/sap/bc/adt/<collection>/${n}"` inside a payload | `` adtcore:uri="${KIND.uri(n)}" `` |
| an error message naming a path | interpolate the record's field |

- Keep query strings, headers, methods and bodies byte-identical apart from the address.
- `encodeSapObjectName` stays in `src/utils/internalUtils.ts` for query parameters. Only its address uses go.
- If a module receives an already-built address (`objectUri` parameter), leave the parameter and fix the caller that builds it.

Each migration task has the same five steps:

1. Add the task's kinds to `ENFORCED` in `src/__tests__/unit/endpoints/noHardcodedObjectAddresses.test.ts`.
2. Run `MCP_ENV_PATH=/tmp/nonexistent-env npx jest src/__tests__/unit/endpoints > tN.log 2>&1; echo $?`. Expected: non-zero, with `tN.log` listing every remaining literal of these kinds (`file:line  path`). This list, not the inventory, is the work.
3. Rewrite each listed site by the table above, importing from `src/endpoints/objects` (relative path, e.g. `../../endpoints/objects`).
4. Run, each to its own log, and read each log:
   - `MCP_ENV_PATH=/tmp/nonexistent-env npx jest src/__tests__/unit > tN-unit.log 2>&1`: all pass, the enforcement test included;
   - `npx tsc --noEmit -p tsconfig.json > tN-tsc.log 2>&1`: empty;
   - `npm run lint:check > tN-lint.log 2>&1`: clean.

   A unit test asserting an old uppercase or mixed-case address is updated to the lowercase one **only if** Task 3's matrix shows that kind case-insensitive. Otherwise the record was given its own encoding in Task 3 and the test stands.
5. Commit, with the kinds in the subject.

---

### Task 5: Programs and program includes

**Kinds:** `PROGRAM`, `PROGRAM_INCLUDE`

**Interfaces:**
- Consumes: `PROGRAM`, `PROGRAM_INCLUDE`, `seg`, `sourceUri`, `versionsUri`, `transportUri` from `src/endpoints/objects.ts`; `ENFORCED` from Task 2.
- Produces: no new names. The modules below build no address of these kinds themselves.

**Inventory at `8dfbc578`** (the enforcement test's list in Step 2 is the authority):

**PROGRAM**: 17 literals, 13 files
  - `src/core/program/AdtProgramLegacy.ts` (lines 32)
  - `src/core/program/activation.ts` (lines 20)
  - `src/core/program/create.ts` (lines 88)
  - `src/core/program/delete.ts` (lines 29, 63)
  - `src/core/program/lock.ts` (lines 25)
  - `src/core/program/read.ts` (lines 75)
  - `src/core/program/unlock.ts` (lines 21)
  - `src/core/program/update.ts` (lines 23)
  - `src/core/program/validation.ts` (lines 34)
  - `src/core/program/versions.ts` (lines 23)
  - `src/core/shared/objectWire.ts` (lines 135, 233)
  - `src/utils/activationUtils.ts` (lines 39, 42, 63)
  - `src/utils/checkRun.ts` (lines 26)
**PROGRAM_INCLUDE**: 4 literals, 4 files
  - `src/core/include/create.ts` (lines 48)
  - `src/core/include/lock.ts` (lines 18)
  - `src/core/shared/include.ts` (lines 35)
  - `src/utils/activationUtils.ts` (lines 66)

- [ ] **Step 1:** add 'PROGRAM', 'PROGRAM_INCLUDE' to `ENFORCED`.
- [ ] **Step 2:** run the enforcement test; it fails with the list.
- [ ] **Step 3:** rewrite every listed site by the migration rules.
- [ ] **Step 4:** unit, `tsc`, `lint:check`, each to its log, each read.
- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(program/program_include): addresses from the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Classes, class includes, interfaces

**Kinds:** `CLASS`, `INTERFACE`, `CLASS_INCLUDE`

**Interfaces:**
- Consumes: `CLASS`, `INTERFACE`, `CLASS_INCLUDE`, `seg`, `sourceUri`, `versionsUri`, `transportUri` from `src/endpoints/objects.ts`; `ENFORCED` from Task 2.
- Produces: no new names. The modules below build no address of these kinds themselves.

**Inventory at `8dfbc578`** (the enforcement test's list in Step 2 is the authority):

**CLASS**: 31 literals, 22 files
  - `src/core/behaviorImplementation/read.ts` (lines 82)
  - `src/core/behaviorImplementation/update.ts` (lines 31)
  - `src/core/behaviorImplementation/validation.ts` (lines 52)
  - `src/core/behaviorImplementation/versions.ts` (lines 26)
  - `src/core/class/AdtClassLegacy.ts` (lines 57)
  - `src/core/class/activation.ts` (lines 22)
  - `src/core/class/check.ts` (lines 212)
  - `src/core/class/create.ts` (lines 35)
  - `src/core/class/delete.ts` (lines 29, 62)
  - `src/core/class/includes.ts` (lines 134)
  - `src/core/class/lock.ts` (lines 27)
  - `src/core/class/read.ts` (lines 82, 113, 147, 181, 215)
  - `src/core/class/testclasses.ts` (lines 30, 54)
  - `src/core/class/unlock.ts` (lines 24)
  - `src/core/class/update.ts` (lines 36, 68)
  - `src/core/class/validation.ts` (lines 48)
  - `src/core/class/versions.ts` (lines 31)
  - `src/core/interface/validation.ts` (lines 46)
  - `src/core/shared/objectWire.ts` (lines 132, 230)
  - `src/runtime/atc/run.ts` (lines 49)
  - `src/utils/activationUtils.ts` (lines 37, 59)
  - `src/utils/checkRun.ts` (lines 24)
**INTERFACE**: 15 literals, 13 files
  - `src/core/interface/AdtInterfaceLegacy.ts` (lines 32)
  - `src/core/interface/activation.ts` (lines 20)
  - `src/core/interface/create.ts` (lines 67)
  - `src/core/interface/delete.ts` (lines 29, 62)
  - `src/core/interface/lock.ts` (lines 26)
  - `src/core/interface/read.ts` (lines 76)
  - `src/core/interface/unlock.ts` (lines 29)
  - `src/core/interface/update.ts` (lines 26)
  - `src/core/interface/versions.ts` (lines 23)
  - `src/core/shared/objectWire.ts` (lines 138, 236)
  - `src/runtime/atc/run.ts` (lines 50)
  - `src/utils/activationUtils.ts` (lines 123)
  - `src/utils/checkRun.ts` (lines 28)

Class includes: `src/core/class/*` builds `/includes/<kind>` addresses (`definitions`, `implementations`, `macros`, `testclasses`) on the class address. Each becomes `CLASS_INCLUDE.uri(className, '<kind>')`. `src/core/class/run.ts` and `src/executors/class/ClassExecutor.ts` address `/oo/classrun/`, which is a service endpoint (step 2) and is left alone.

- [ ] **Step 1:** add 'CLASS', 'INTERFACE', 'CLASS_INCLUDE' to `ENFORCED`.
- [ ] **Step 2:** run the enforcement test; it fails with the list.
- [ ] **Step 3:** rewrite every listed site by the migration rules.
- [ ] **Step 4:** unit, `tsc`, `lint:check`, each to its log, each read.
- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(class/interface): addresses from the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Function groups, modules, includes

**Kinds:** `FUNCTION_GROUP`, `FUNCTION_MODULE`, `FUNCTION_INCLUDE`

**Interfaces:**
- Consumes: `FUNCTION_GROUP`, `FUNCTION_MODULE`, `FUNCTION_INCLUDE`, `seg`, `sourceUri`, `versionsUri`, `transportUri` from `src/endpoints/objects.ts`; `ENFORCED` from Task 2.
- Produces: no new names. The modules below build no address of these kinds themselves.

**Inventory at `8dfbc578`** (the enforcement test's list in Step 2 is the authority):

**FUNCTION_GROUP**: 45 literals, 35 files
  - `src/core/functionGroup/AdtFunctionGroupLegacy.ts` (lines 32)
  - `src/core/functionGroup/activation.ts` (lines 19)
  - `src/core/functionGroup/create.ts` (lines 29)
  - `src/core/functionGroup/delete.ts` (lines 29, 62)
  - `src/core/functionGroup/lock.ts` (lines 30, 52)
  - `src/core/functionGroup/read.ts` (lines 24, 47)
  - `src/core/functionGroup/update.ts` (lines 39)
  - `src/core/functionGroup/validation.ts` (lines 38)
  - `src/core/functionInclude/activation.ts` (lines 22)
  - `src/core/functionInclude/check.ts` (lines 33)
  - `src/core/functionInclude/create.ts` (lines 29)
  - `src/core/functionInclude/delete.ts` (lines 27)
  - `src/core/functionInclude/lock.ts` (lines 30)
  - `src/core/functionInclude/read.ts` (lines 36)
  - `src/core/functionInclude/readSource.ts` (lines 24)
  - `src/core/functionInclude/unlock.ts` (lines 25)
  - `src/core/functionInclude/update.ts` (lines 42)
  - `src/core/functionInclude/updateSource.ts` (lines 36)
  - `src/core/functionInclude/validation.ts` (lines 31)
  - `src/core/functionInclude/versions.ts` (lines 30)
  - `src/core/functionModule/AdtFunctionModuleLegacy.ts` (lines 36)
  - `src/core/functionModule/activation.ts` (lines 23)
  - `src/core/functionModule/check.ts` (lines 30)
  - `src/core/functionModule/create.ts` (lines 29)
  - `src/core/functionModule/delete.ts` (lines 30, 65)
  - `src/core/functionModule/lock.ts` (lines 29)
  - `src/core/functionModule/read.ts` (lines 86)
  - `src/core/functionModule/unlock.ts` (lines 24)
  - `src/core/functionModule/update.ts` (lines 36)
  - `src/core/functionModule/validation.ts` (lines 34)
  - `src/core/functionModule/versions.ts` (lines 26)
  - `src/core/shared/objectWire.ts` (lines 142, 164, 240)
  - `src/runtime/atc/run.ts` (lines 51)
  - `src/utils/activationUtils.ts` (lines 71, 73, 88, 94)
  - `src/utils/checkRun.ts` (lines 31, 43)

Function modules and includes are addressed under their group: `FUNCTION_MODULE.uri(group, name)` and `FUNCTION_INCLUDE.uri(group, name)`. Create uses `FUNCTION_MODULE.collection(group)`. The function-module create payload (`src/core/functionModule/create.ts:41`) and the function-include payload (`src/core/functionInclude/xmlBuilder.ts:39`) embed the group's address: use `FUNCTION_GROUP.uri(group)` there.

- [ ] **Step 1:** add 'FUNCTION_GROUP', 'FUNCTION_MODULE', 'FUNCTION_INCLUDE' to `ENFORCED`.
- [ ] **Step 2:** run the enforcement test; it fails with the list.
- [ ] **Step 3:** rewrite every listed site by the migration rules.
- [ ] **Step 4:** unit, `tsc`, `lint:check`, each to its log, each read.
- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(function_group): addresses from the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Packages and transport requests

**Kinds:** `PACKAGE`, `TRANSPORT_REQUEST`, `TRANSPORT_REQUEST_LEGACY`

**Interfaces:**
- Consumes: `PACKAGE`, `TRANSPORT_REQUEST`, `TRANSPORT_REQUEST_LEGACY`, `seg`, `sourceUri`, `versionsUri`, `transportUri` from `src/endpoints/objects.ts`; `ENFORCED` from Task 2.
- Produces: no new names. The modules below build no address of these kinds themselves.

**Inventory at `8dfbc578`** (the enforcement test's list in Step 2 is the authority):

**PACKAGE**: 15 literals, 12 files
  - `src/core/package/check.ts` (lines 34)
  - `src/core/package/create.ts` (lines 21)
  - `src/core/package/delete.ts` (lines 30, 63)
  - `src/core/package/lock.ts` (lines 28)
  - `src/core/package/read.ts` (lines 30, 59)
  - `src/core/package/unlock.ts` (lines 24)
  - `src/core/package/update.ts` (lines 37)
  - `src/core/package/validation.ts` (lines 29, 61)
  - `src/core/shared/objectWire.ts` (lines 167)
  - `src/runtime/atc/run.ts` (lines 52)
  - `src/utils/activationUtils.ts` (lines 55)
  - `src/utils/checkRun.ts` (lines 64)
**TRANSPORT_REQUEST**: 6 literals, 6 files
  - `src/core/transport/create.ts` (lines 44)
  - `src/core/transport/delete.ts` (lines 28)
  - `src/core/transport/list.ts` (lines 38)
  - `src/core/transport/objects.ts` (lines 46)
  - `src/core/transport/read.ts` (lines 20)
  - `src/core/transport/update.ts` (lines 38)

Legacy: `src/core/transport/readLegacy.ts` sends `'/sap/bc/cts/transportrequests'` and becomes `TRANSPORT_REQUEST_LEGACY.collection`. The three messages in `src/core/transport/AdtRequestLegacy.ts` (lines 72, 139, 151) that name it interpolate the same field. Unmeasured on a legacy system; say so in the commit.

- [ ] **Step 1:** add 'PACKAGE', 'TRANSPORT_REQUEST', 'TRANSPORT_REQUEST_LEGACY' to `ENFORCED`.
- [ ] **Step 2:** run the enforcement test; it fails with the list.
- [ ] **Step 3:** rewrite every listed site by the migration rules.
- [ ] **Step 4:** unit, `tsc`, `lint:check`, each to its log, each read.
- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(package/transport_request): addresses from the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: DDL sources, DDIC views, metadata extensions, access controls

**Kinds:** `DDL_SOURCE`, `DDIC_VIEW`, `METADATA_EXTENSION`, `ACCESS_CONTROL`

**Interfaces:**
- Consumes: `DDL_SOURCE`, `DDIC_VIEW`, `METADATA_EXTENSION`, `ACCESS_CONTROL`, `seg`, `sourceUri`, `versionsUri`, `transportUri` from `src/endpoints/objects.ts`; `ENFORCED` from Task 2.
- Produces: no new names. The modules below build no address of these kinds themselves.

**Inventory at `8dfbc578`** (the enforcement test's list in Step 2 is the authority):

**DDL_SOURCE**: 16 literals, 14 files
  - `src/core/ddl/AdtDdlLegacy.ts` (lines 32)
  - `src/core/ddl/activation.ts` (lines 19)
  - `src/core/ddl/create.ts` (lines 27)
  - `src/core/ddl/delete.ts` (lines 29, 62)
  - `src/core/ddl/lock.ts` (lines 22)
  - `src/core/ddl/read.ts` (lines 69)
  - `src/core/ddl/unlock.ts` (lines 20)
  - `src/core/ddl/update.ts` (lines 29)
  - `src/core/ddl/validation.ts` (lines 35)
  - `src/core/ddl/versions.ts` (lines 23)
  - `src/core/shared/objectWire.ts` (lines 146, 244)
  - `src/runtime/atc/run.ts` (lines 53)
  - `src/utils/activationUtils.ts` (lines 107)
  - `src/utils/checkRun.ts` (lines 53)
**DDIC_VIEW**: 1 literals, 1 files
  - `src/utils/activationUtils.ts` (lines 111)
**METADATA_EXTENSION**: 15 literals, 13 files
  - `src/clients/AdtClientLegacy.ts` (lines 302)
  - `src/core/metadataExtension/AdtMetadataExtension.ts` (lines 312)
  - `src/core/metadataExtension/activate.ts` (lines 34)
  - `src/core/metadataExtension/create.ts` (lines 38)
  - `src/core/metadataExtension/delete.ts` (lines 34)
  - `src/core/metadataExtension/lock.ts` (lines 29)
  - `src/core/metadataExtension/read.ts` (lines 43, 89, 120)
  - `src/core/metadataExtension/unlock.ts` (lines 36)
  - `src/core/metadataExtension/update.ts` (lines 50)
  - `src/core/metadataExtension/validation.ts` (lines 34)
  - `src/core/metadataExtension/versions.ts` (lines 27)
  - `src/utils/activationUtils.ts` (lines 140)
  - `src/utils/checkRun.ts` (lines 56)
**ACCESS_CONTROL**: 14 literals, 11 files
  - `src/clients/AdtClientLegacy.ts` (lines 254)
  - `src/core/accessControl/create.ts` (lines 18)
  - `src/core/accessControl/delete.ts` (lines 25, 58)
  - `src/core/accessControl/lock.ts` (lines 29)
  - `src/core/accessControl/read.ts` (lines 35, 70, 96)
  - `src/core/accessControl/unlock.ts` (lines 20)
  - `src/core/accessControl/update.ts` (lines 27)
  - `src/core/accessControl/validation.ts` (lines 24)
  - `src/core/accessControl/versions.ts` (lines 28)
  - `src/utils/activationUtils.ts` (lines 153)
  - `src/utils/checkRun.ts` (lines 79)

- [ ] **Step 1:** add 'DDL_SOURCE', 'DDIC_VIEW', 'METADATA_EXTENSION', 'ACCESS_CONTROL' to `ENFORCED`.
- [ ] **Step 2:** run the enforcement test; it fails with the list.
- [ ] **Step 3:** rewrite every listed site by the migration rules.
- [ ] **Step 4:** unit, `tsc`, `lint:check`, each to its log, each read.
- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(ddl_source/ddic_view/metadata_extension/access_control): addresses from the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Tables, structures, table types

**Kinds:** `TABLE`, `STRUCTURE`, `TABLE_TYPE`

**Interfaces:**
- Consumes: `TABLE`, `STRUCTURE`, `TABLE_TYPE`, `seg`, `sourceUri`, `versionsUri`, `transportUri` from `src/endpoints/objects.ts`; `ENFORCED` from Task 2.
- Produces: no new names. The modules below build no address of these kinds themselves.

**Inventory at `8dfbc578`** (the enforcement test's list in Step 2 is the authority):

**TABLE**: 17 literals, 15 files
  - `src/clients/AdtClientLegacy.ts` (lines 243)
  - `src/core/shared/objectWire.ts` (lines 152, 250)
  - `src/core/table/activation.ts` (lines 19)
  - `src/core/table/check.ts` (lines 29)
  - `src/core/table/create.ts` (lines 36)
  - `src/core/table/delete.ts` (lines 29, 62)
  - `src/core/table/lock.ts` (lines 25)
  - `src/core/table/read.ts` (lines 69)
  - `src/core/table/unlock.ts` (lines 21)
  - `src/core/table/update.ts` (lines 27)
  - `src/core/table/validation.ts` (lines 28)
  - `src/core/table/versions.ts` (lines 23)
  - `src/runtime/atc/run.ts` (lines 54)
  - `src/utils/activationUtils.ts` (lines 98)
  - `src/utils/checkRun.ts` (lines 47)
**STRUCTURE**: 26 literals, 21 files
  - `src/clients/AdtClientLegacy.ts` (lines 238)
  - `src/core/appendStructure/create.ts` (lines 29)
  - `src/core/appendStructure/delete.ts` (lines 16)
  - `src/core/appendStructure/lock.ts` (lines 27)
  - `src/core/appendStructure/read.ts` (lines 30, 50, 69)
  - `src/core/appendStructure/unlock.ts` (lines 14)
  - `src/core/appendStructure/update.ts` (lines 24)
  - `src/core/appendStructure/validation.ts` (lines 16)
  - `src/core/appendStructure/versions.ts` (lines 28)
  - `src/core/shared/objectWire.ts` (lines 149, 247)
  - `src/core/structure/activation.ts` (lines 19)
  - `src/core/structure/create.ts` (lines 23)
  - `src/core/structure/delete.ts` (lines 33, 67)
  - `src/core/structure/lock.ts` (lines 23)
  - `src/core/structure/read.ts` (lines 75)
  - `src/core/structure/unlock.ts` (lines 22)
  - `src/core/structure/update.ts` (lines 27)
  - `src/core/structure/validation.ts` (lines 28)
  - `src/core/structure/versions.ts` (lines 24)
  - `src/utils/activationUtils.ts` (lines 103)
  - `src/utils/checkRun.ts` (lines 50, 76)
**TABLE_TYPE**: 17 literals, 13 files
  - `src/clients/AdtClientLegacy.ts` (lines 248)
  - `src/core/shared/objectWire.ts` (lines 155, 253)
  - `src/core/tabletype/activation.ts` (lines 19)
  - `src/core/tabletype/check.ts` (lines 29)
  - `src/core/tabletype/create.ts` (lines 38)
  - `src/core/tabletype/delete.ts` (lines 29, 62)
  - `src/core/tabletype/lock.ts` (lines 22)
  - `src/core/tabletype/read.ts` (lines 32, 94, 134)
  - `src/core/tabletype/unlock.ts` (lines 21)
  - `src/core/tabletype/update.ts` (lines 40)
  - `src/core/tabletype/validation.ts` (lines 28)
  - `src/core/tabletype/versions.ts` (lines 24)
  - `src/utils/activationUtils.ts` (lines 128)

- [ ] **Step 1:** add 'TABLE', 'STRUCTURE', 'TABLE_TYPE' to `ENFORCED`.
- [ ] **Step 2:** run the enforcement test; it fails with the list.
- [ ] **Step 3:** rewrite every listed site by the migration rules.
- [ ] **Step 4:** unit, `tsc`, `lint:check`, each to its log, each read.
- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(table/structure/table_type): addresses from the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Domains and data elements

**Kinds:** `DOMAIN`, `DATA_ELEMENT`

**Interfaces:**
- Consumes: `DOMAIN`, `DATA_ELEMENT`, `seg`, `sourceUri`, `versionsUri`, `transportUri` from `src/endpoints/objects.ts`; `ENFORCED` from Task 2.
- Produces: no new names. The modules below build no address of these kinds themselves.

**Inventory at `8dfbc578`** (the enforcement test's list in Step 2 is the authority):

**DOMAIN**: 15 literals, 13 files
  - `src/clients/AdtClientLegacy.ts` (lines 227)
  - `src/core/domain/activation.ts` (lines 22)
  - `src/core/domain/check.ts` (lines 41)
  - `src/core/domain/create.ts` (lines 27)
  - `src/core/domain/delete.ts` (lines 29, 62)
  - `src/core/domain/lock.ts` (lines 26)
  - `src/core/domain/read.ts` (lines 29, 56)
  - `src/core/domain/unlock.ts` (lines 25)
  - `src/core/domain/update.ts` (lines 40)
  - `src/core/domain/validation.ts` (lines 36)
  - `src/core/shared/objectWire.ts` (lines 158)
  - `src/utils/activationUtils.ts` (lines 119)
  - `src/utils/checkRun.ts` (lines 58)
**DATA_ELEMENT**: 14 literals, 12 files
  - `src/clients/AdtClientLegacy.ts` (lines 232)
  - `src/core/dataElement/check.ts` (lines 41)
  - `src/core/dataElement/create.ts` (lines 31)
  - `src/core/dataElement/delete.ts` (lines 29, 62)
  - `src/core/dataElement/lock.ts` (lines 29)
  - `src/core/dataElement/read.ts` (lines 27, 52)
  - `src/core/dataElement/unlock.ts` (lines 25)
  - `src/core/dataElement/update.ts` (lines 36)
  - `src/core/dataElement/validation.ts` (lines 36)
  - `src/core/shared/objectWire.ts` (lines 161)
  - `src/utils/activationUtils.ts` (lines 115)
  - `src/utils/checkRun.ts` (lines 61)

- [ ] **Step 1:** add 'DOMAIN', 'DATA_ELEMENT' to `ENFORCED`.
- [ ] **Step 2:** run the enforcement test; it fails with the list.
- [ ] **Step 3:** rewrite every listed site by the migration rules.
- [ ] **Step 4:** unit, `tsc`, `lint:check`, each to its log, each read.
- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(domain/data_element): addresses from the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Behavior definitions, service definitions, service bindings

**Kinds:** `BEHAVIOR_DEFINITION`, `SERVICE_DEFINITION`, `SERVICE_BINDING`

**Interfaces:**
- Consumes: `BEHAVIOR_DEFINITION`, `SERVICE_DEFINITION`, `SERVICE_BINDING`, `seg`, `sourceUri`, `versionsUri`, `transportUri` from `src/endpoints/objects.ts`; `ENFORCED` from Task 2.
- Produces: no new names. The modules below build no address of these kinds themselves.

**Inventory at `8dfbc578`** (the enforcement test's list in Step 2 is the authority):

**BEHAVIOR_DEFINITION**: 16 literals, 12 files
  - `src/clients/AdtClientLegacy.ts` (lines 286, 295)
  - `src/core/behaviorDefinition/activation.ts` (lines 35)
  - `src/core/behaviorDefinition/create.ts` (lines 67)
  - `src/core/behaviorDefinition/delete.ts` (lines 39, 86)
  - `src/core/behaviorDefinition/lock.ts` (lines 41)
  - `src/core/behaviorDefinition/read.ts` (lines 46, 89, 119)
  - `src/core/behaviorDefinition/unlock.ts` (lines 37)
  - `src/core/behaviorDefinition/update.ts` (lines 63)
  - `src/core/behaviorDefinition/validation.ts` (lines 52)
  - `src/core/behaviorDefinition/versions.ts` (lines 26)
  - `src/runtime/atc/run.ts` (lines 55)
  - `src/utils/activationUtils.ts` (lines 149)
**SERVICE_DEFINITION**: 14 literals, 11 files
  - `src/clients/AdtClientLegacy.ts` (lines 260)
  - `src/core/serviceDefinition/create.ts` (lines 23)
  - `src/core/serviceDefinition/delete.ts` (lines 29, 62)
  - `src/core/serviceDefinition/lock.ts` (lines 26)
  - `src/core/serviceDefinition/read.ts` (lines 39, 74, 103)
  - `src/core/serviceDefinition/unlock.ts` (lines 25)
  - `src/core/serviceDefinition/update.ts` (lines 31)
  - `src/core/serviceDefinition/validation.ts` (lines 28)
  - `src/core/serviceDefinition/versions.ts` (lines 26)
  - `src/utils/activationUtils.ts` (lines 132)
  - `src/utils/checkRun.ts` (lines 67)
**SERVICE_BINDING**: 15 literals, 4 files
  - `src/clients/AdtClientLegacy.ts` (lines 268, 277)
  - `src/core/service/AdtService.ts` (lines 161, 199, 257, 717, 785, 804, 902, 923, 966, 1010, 1046)
  - `src/core/service/lock.ts` (lines 34)
  - `src/utils/activationUtils.ts` (lines 136)

Service bindings: `AdtServiceBinding.encodeName` (`src/core/service/AdtService.ts:114`) is exactly `seg` and goes. The publish and unpublish jobs become `SERVICE_BINDING.publishJobs(type)` / `unpublishJobs(type)`, and the OData service addresses (`AdtService.ts:966`, `:1010`) become `SERVICE_BINDING.odataService(type, name)`, with the encoding Task 3 settled. `/sap/bc/adt/businessservices/release` is a service endpoint and is left alone. The deletion-check payload at `AdtService.ts:736` embeds the binding's address: use `SERVICE_BINDING.uri(name)`.

- [ ] **Step 1:** add 'BEHAVIOR_DEFINITION', 'SERVICE_DEFINITION', 'SERVICE_BINDING' to `ENFORCED`.
- [ ] **Step 2:** run the enforcement test; it fails with the list.
- [ ] **Step 3:** rewrite every listed site by the migration rules.
- [ ] **Step 4:** unit, `tsc`, `lint:check`, each to its log, each read.
- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(behavior_definition/service_definition/service_binding): addresses from the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Transformations, message classes, feature toggles, authorization fields, enhancements

**Kinds:** `TRANSFORMATION`, `MESSAGE_CLASS`, `FEATURE_TOGGLE`, `AUTHORIZATION_FIELD`, `ENHANCEMENT`

**Interfaces:**
- Consumes: `TRANSFORMATION`, `MESSAGE_CLASS`, `FEATURE_TOGGLE`, `AUTHORIZATION_FIELD`, `ENHANCEMENT`, `seg`, `sourceUri`, `versionsUri`, `transportUri` from `src/endpoints/objects.ts`; `ENFORCED` from Task 2.
- Produces: no new names. The modules below build no address of these kinds themselves.

**Inventory at `8dfbc578`** (the enforcement test's list in Step 2 is the authority):

**TRANSFORMATION**: 13 literals, 10 files
  - `src/core/transformation/create.ts` (lines 18)
  - `src/core/transformation/delete.ts` (lines 25, 58)
  - `src/core/transformation/lock.ts` (lines 21)
  - `src/core/transformation/read.ts` (lines 35, 70, 96)
  - `src/core/transformation/unlock.ts` (lines 20)
  - `src/core/transformation/update.ts` (lines 27)
  - `src/core/transformation/validation.ts` (lines 28)
  - `src/core/transformation/versions.ts` (lines 26)
  - `src/utils/activationUtils.ts` (lines 164)
  - `src/utils/checkRun.ts` (lines 82)
**MESSAGE_CLASS**: 8 literals, 8 files
  - `src/core/messageClass/AdtMessageClass.ts` (lines 52)
  - `src/core/messageClass/AdtMessageClassMessage.ts` (lines 59)
  - `src/core/messageClass/create.ts` (lines 13)
  - `src/core/messageClass/delete.ts` (lines 25)
  - `src/core/messageClass/lock.ts` (lines 14)
  - `src/core/messageClass/read.ts` (lines 12)
  - `src/core/messageClass/unlock.ts` (lines 12)
  - `src/core/messageClass/update.ts` (lines 13)
**FEATURE_TOGGLE**: 14 literals, 14 files
  - `src/core/featureToggle/check.ts` (lines 31)
  - `src/core/featureToggle/checkState.ts` (lines 31)
  - `src/core/featureToggle/create.ts` (lines 22)
  - `src/core/featureToggle/delete.ts` (lines 20)
  - `src/core/featureToggle/getState.ts` (lines 23)
  - `src/core/featureToggle/lock.ts` (lines 22)
  - `src/core/featureToggle/read.ts` (lines 21)
  - `src/core/featureToggle/readSource.ts` (lines 17)
  - `src/core/featureToggle/switch.ts` (lines 26)
  - `src/core/featureToggle/unlock.ts` (lines 16)
  - `src/core/featureToggle/update.ts` (lines 33)
  - `src/core/featureToggle/updateSource.ts` (lines 26)
  - `src/core/featureToggle/validation.ts` (lines 34)
  - `src/utils/activationUtils.ts` (lines 171)
**AUTHORIZATION_FIELD**: 9 literals, 9 files
  - `src/core/authorizationField/check.ts` (lines 34)
  - `src/core/authorizationField/create.ts` (lines 26)
  - `src/core/authorizationField/delete.ts` (lines 24)
  - `src/core/authorizationField/lock.ts` (lines 27)
  - `src/core/authorizationField/read.ts` (lines 32)
  - `src/core/authorizationField/unlock.ts` (lines 23)
  - `src/core/authorizationField/update.ts` (lines 41)
  - `src/core/authorizationField/validation.ts` (lines 30)
  - `src/utils/activationUtils.ts` (lines 167)
**ENHANCEMENT**: 2 literals, 2 files
  - `src/clients/AdtClientLegacy.ts` (lines 308)
  - `src/core/enhancement/types.ts` (lines 39)

Enhancements: `getEnhancementBaseUrl`/`getEnhancementUri` in `src/core/enhancement/types.ts` become thin calls to `ENHANCEMENT.collection(type)` / `ENHANCEMENT.uri(type, name)` (they are imported elsewhere; keep the names). `src/clients/AdtClientLegacy.ts` names `/sap/bc/adt/enhancements` in its refusal: use `ENHANCEMENT.root`. The other refusals there name the collections of the kinds they refuse: use each record's `collection`.

- [ ] **Step 1:** add 'TRANSFORMATION', 'MESSAGE_CLASS', 'FEATURE_TOGGLE', 'AUTHORIZATION_FIELD', 'ENHANCEMENT' to `ENFORCED`.
- [ ] **Step 2:** run the enforcement test; it fails with the list.
- [ ] **Step 3:** rewrite every listed site by the migration rules.
- [ ] **Step 4:** unit, `tsc`, `lint:check`, each to its log, each read.
- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(transformation/message_class/feature_toggle/authorization_field/enhancement): addresses from the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Scalar functions and their implementations

**Kinds:** `SCALAR_FUNCTION`, `SCALAR_FUNCTION_IMPLEMENTATION`

**Interfaces:**
- Consumes: `SCALAR_FUNCTION`, `SCALAR_FUNCTION_IMPLEMENTATION`, `seg`, `sourceUri`, `versionsUri`, `transportUri` from `src/endpoints/objects.ts`; `ENFORCED` from Task 2.
- Produces: no new names. The modules below build no address of these kinds themselves.

**Inventory at `8dfbc578`** (the enforcement test's list in Step 2 is the authority):

**SCALAR_FUNCTION**: 12 literals, 10 files
  - `src/core/scalarFunction/create.ts` (lines 29)
  - `src/core/scalarFunction/delete.ts` (lines 16)
  - `src/core/scalarFunction/lock.ts` (lines 19)
  - `src/core/scalarFunction/read.ts` (lines 30, 50, 69)
  - `src/core/scalarFunction/unlock.ts` (lines 14)
  - `src/core/scalarFunction/update.ts` (lines 21)
  - `src/core/scalarFunction/validation.ts` (lines 19)
  - `src/core/scalarFunction/versions.ts` (lines 26)
  - `src/utils/activationUtils.ts` (lines 156)
  - `src/utils/checkRun.ts` (lines 70)
**SCALAR_FUNCTION_IMPLEMENTATION**: 13 literals, 11 files
  - `src/core/scalarFunctionImplementation/create.ts` (lines 48)
  - `src/core/scalarFunctionImplementation/delete.ts` (lines 16)
  - `src/core/scalarFunctionImplementation/lock.ts` (lines 19)
  - `src/core/scalarFunctionImplementation/read.ts` (lines 30, 50, 71)
  - `src/core/scalarFunctionImplementation/unlock.ts` (lines 14)
  - `src/core/scalarFunctionImplementation/update.ts` (lines 24)
  - `src/core/scalarFunctionImplementation/updateMetadata.ts` (lines 19)
  - `src/core/scalarFunctionImplementation/validation.ts` (lines 23)
  - `src/core/scalarFunctionImplementation/versions.ts` (lines 26)
  - `src/utils/activationUtils.ts` (lines 159)
  - `src/utils/checkRun.ts` (lines 73)

- [ ] **Step 1:** add 'SCALAR_FUNCTION', 'SCALAR_FUNCTION_IMPLEMENTATION' to `ENFORCED`.
- [ ] **Step 2:** run the enforcement test; it fails with the list.
- [ ] **Step 3:** rewrite every listed site by the migration rules.
- [ ] **Step 4:** unit, `tsc`, `lint:check`, each to its log, each read.
- [ ] **Step 5: Commit**

```bash
git add src
git commit -m "refactor(scalar_function/scalar_function_implementation): addresses from the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 15: The five type → address tables, and defects 1–3 and 5

**Files:**
- Modify: `src/utils/activationUtils.ts` (`buildObjectUri`)
- Modify: `src/utils/checkRun.ts` (`getObjectUri`)
- Modify: `src/core/shared/objectWire.ts` (`getObjectMetadataUri`, `getObjectSourceUri`)
- Modify: `src/runtime/atc/run.ts` (`URI_TEMPLATES`, `buildAtcObjectUri`)
- Test: `src/__tests__/unit/endpoints/typeTables.test.ts` (new); update `src/__tests__/unit/shared/buildObjectUriMatchesActivate.test.ts` and `src/__tests__/unit/shared/checkRunObjectUri.test.ts` where they assert an old case.

**Interfaces:**
- Consumes: all records from Task 1.
- Produces: the same five functions with unchanged signatures. Each case now returns a registry builder's result.

- [ ] **Step 1: Write the failing tests for the defects**

`src/__tests__/unit/endpoints/typeTables.test.ts`:

```ts
/**
 * The type-to-address tables answer from the registry, and the four defects the
 * duplication produced are gone (spec, "What the duplication has already
 * produced", 1–3 and 5).
 */
import { getObjectMetadataUri, getObjectSourceUri } from '../../../core/shared/objectWire';
import { buildAtcObjectUri } from '../../../runtime/atc/run';
import { buildObjectUri } from '../../../utils/activationUtils';
import { getObjectUri } from '../../../utils/checkRun';

describe('defect 1: ENHO/ENH is not a transformation', () => {
  it('XSLT/VT is', () => {
    expect(buildObjectUri('ZX', 'XSLT/VT')).toBe('/sap/bc/adt/xslt/transformations/zx');
  });
  it('ENHO/ENH no longer reaches the XSLT collection', () => {
    expect(() => buildObjectUri('ZENH', 'ENHO/ENH')).toThrow();
  });
});

describe("defect 2: an interface by ADT's own code", () => {
  it('INTF/OI reads', () => {
    expect(getObjectMetadataUri('INTF/OI' as never, 'ZIF_X')).toBe('/sap/bc/adt/oo/interfaces/zif_x');
    expect(getObjectSourceUri('INTF/OI' as never, 'ZIF_X')).toBe('/sap/bc/adt/oo/interfaces/zif_x/source/main');
  });
});

describe('defect 3: a data element by DTEL/DE', () => {
  it('DTEL/DE reads', () => {
    expect(getObjectMetadataUri('DTEL/DE' as never, 'ZDE')).toBe('/sap/bc/adt/ddic/dataelements/zde');
  });
});

describe('defect 5: a function module needs its group', () => {
  it('with the group', () => {
    expect(buildObjectUri('Z_FM', 'FUGR/FF', 'ZFG')).toBe('/sap/bc/adt/functions/groups/zfg/fmodules/z_fm');
  });
  it('without it, throws before any request', () => {
    expect(() => buildObjectUri('Z_FM', 'FUGR/FF')).toThrow(/function group/i);
  });
});

describe('the include kinds are told apart', () => {
  it('program include, function include', () => {
    expect(buildObjectUri('ZREP_TOP', 'PROG/I')).toBe('/sap/bc/adt/programs/includes/zrep_top');
    expect(buildObjectUri('LZFGTOP', 'FUGR/I', 'ZFG')).toBe('/sap/bc/adt/functions/groups/zfg/includes/lzfgtop');
  });
});

describe('every table agrees on a class', () => {
  it('one address', () => {
    const expected = '/sap/bc/adt/oo/classes/zcl_x';
    expect(buildObjectUri('ZCL_X', 'CLAS/OC')).toBe(expected);
    expect(getObjectUri('class', 'ZCL_X')).toBe(expected);
    expect(getObjectMetadataUri('class' as never, 'ZCL_X')).toBe(expected);
    expect(buildAtcObjectUri('class', 'ZCL_X')).toBe(expected);
  });
});
```

- [ ] **Step 2: Run, see it fail**

Run: `MCP_ENV_PATH=/tmp/nonexistent-env npx jest src/__tests__/unit/endpoints/typeTables > t15.log 2>&1; echo $?`
Expected: non-zero. Read `t15.log`: the `ENHO/ENH`, `INTF/OI`, `DTEL/DE`, missing-group and ATC-case expectations fail.

- [ ] **Step 3: Rewrite the tables over the records**

In each function, every `case` returns a registry builder, keeping today's accepted spellings as aliases and adding ADT's own codes:
- `buildObjectUri`: remove `'ENHO/ENH'` from the XSLT cases. `FUGR/FF` without `parentName` throws `new Error(\`A function module (FUGR/FF) is addressed under its function group; pass the group as parentName for ${name}\`)`, the same wording as the existing `FUGR/I` case. Add `PROG/I` → `PROGRAM_INCLUDE.uri`, keep `FUGR/I` → `FUNCTION_INCLUDE.uri`, add `VIEW/DV` → `DDIC_VIEW.uri`. Leave the `default` branch as it is: Task 16 owns it.
- `getObjectMetadataUri` / `getObjectSourceUri`: add `'intf/oi'` beside `'intf/if'`, and `'dtel/de'` beside `'dtel'`. Comment that the old spellings stay accepted because callers pass them.
- `getObjectUri` (check run): each case returns the record's `uri`.
- `buildAtcObjectUri`: `URI_TEMPLATES` becomes a map from `AtcObjectType` to a record's `uri`, keeping the `Partial` and the runtime throw. The name now goes through `seg` (lowercase).

- [ ] **Step 4: Measure ATC with a lowercase reference before trusting it**

Task 3 measured GETs, not ATC, and the ATC builder used to uppercase. Run the class case once on each system:

```bash
# trial: variant ABAP_CLOUD_DEVELOPMENT_DEFAULT, class Z011_TEST, reference /sap/bc/adt/oo/classes/z011_test
# E19:   variant DEFAULT,                        class ZAC_SHR_ATC_DIRTY, reference /sap/bc/adt/oo/classes/zac_shr_atc_dirty
```
Sequence per system with `adt-nc`:
1. `POST /sap/bc/adt/atc/worklists?checkVariant=<v>` with `Content-Type: text/plain`, `Accept: text/plain`, `-d ''`. The body is the worklist id.
2. `POST /sap/bc/adt/atc/runs?worklistId=<id>&clientWait=true` with the run payload naming the lowercase reference.
3. `GET /sap/bc/adt/atc/worklists/<id>?includeExemptedFindings=false` with `Accept: application/atc.worklist.v1+xml, application/vnd.sap.atc.worklist.v1+xml`.

Expected: the worklist lists `CLAS` with the class name, as it did for the uppercase reference on 2026-10-01 (memory `reference_atc_checks_the_master_object`). **If it does not**, give the ATC map its own uppercase encoding with that measurement in a comment, and pin it in `typeTables.test.ts`.

- [ ] **Step 5: Update the two existing tests that assert an old case**

Only where Task 3 or Step 4 showed the kind case-insensitive. Change the expected strings to lowercase.

- [ ] **Step 6: Run, verify, commit**

Run, each to its log, each read:
- `MCP_ENV_PATH=/tmp/nonexistent-env npx jest src/__tests__/unit > t15-unit.log 2>&1`
- `npx tsc --noEmit -p tsconfig.json > t15-tsc.log 2>&1`
- `npm run lint:check > t15-lint.log 2>&1`

```bash
git add src
git commit -m "fix(addresses): the five type tables answer from the registry

ENHO/ENH no longer reaches the XSLT collection; INTF/OI and DTEL/DE read;
a function module without its group throws before any request instead of
using its own name as the group.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: An unknown or missing type throws instead of inventing an address

**Files:**
- Modify: `src/utils/activationUtils.ts` (`buildObjectUri`: the `default` branch and the name-prefix guess when `type` is omitted)
- Test: `src/__tests__/unit/endpoints/typeTables.test.ts`

**Behaviour change, called out in the PR:** a call that used to send a request to an address that exists nowhere now throws before any request. Decision 15 allows this, since the cause is a caller's argument.

The name-prefix guess for a missing `type` (`ZCL_` → class, otherwise program) is the same mistake as the `default` branch. It is included here and listed in the PR as a second behaviour change, for the owner to confirm at review.

- [ ] **Step 1: Failing tests**

Append to `typeTables.test.ts`:

```ts
describe('no invented address', () => {
  it('an unknown type throws', () => {
    expect(() => buildObjectUri('ZX', 'ABCD/XY')).toThrow(/ABCD\/XY/);
  });
  it('a missing type throws rather than guessing from the name', () => {
    expect(() => buildObjectUri('ZCL_X')).toThrow(/type/i);
  });
});
```

- [ ] **Step 2: Run, see them fail**

Run: `MCP_ENV_PATH=/tmp/nonexistent-env npx jest src/__tests__/unit/endpoints/typeTables > t16.log 2>&1; echo $?`
Expected: non-zero; the two new tests fail (an address came back).

- [ ] **Step 3: Implement**

`default:` →

```ts
    default:
      // Used to build `/sap/bc/adt/<type lowercased>/<name>` — right only when
      // the ADT path happened to be the type code, and a 200 carrying ADT's
      // complaint otherwise (`DEVC/K` showed it). A type this library has no
      // record for is the caller's argument, so it is refused before a request.
      throw new Error(
        `No ADT address is known for object type '${type}' (${name}); pass one of the codes this library maps, e.g. CLAS/OC, PROG/P, PROG/I, FUGR/I.`,
      );
```

The missing-`type` branch:

```ts
  if (!type) {
    // The name does not say what an object is: ZCL_ is a convention, not a
    // type, and every other name was taken for a program.
    throw new Error(`buildObjectUri needs the object type for ${name}`);
  }
```

Then grep the callers (`src/core/shared/groupActivation.ts`, `groupDeletion.ts`, `whereUsed.ts`, `AdtUtilsLegacy.ts`) for a call without `type`, and report each in the PR. Do not change their signatures.

- [ ] **Step 4: Run, verify, commit**

Unit, `tsc`, `lint:check`, each to its log and read; then:

```bash
git add src
git commit -m "fix(addresses): an unknown or missing object type is refused before a request

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Enforce every record; documentation

**Files:**
- Modify: `src/__tests__/unit/endpoints/noHardcodedObjectAddresses.test.ts`
- Modify: `docs/architecture/ARCHITECTURE.md`, `CLAUDE.md` (Architecture → Core Modules)

- [ ] **Step 1: Every record**

Replace the `ENFORCED` array with `Object.keys(RECORDS) as (keyof typeof RECORDS)[]`, and delete the "grows kind by kind" sentence from the header comment.

Run: `MCP_ENV_PATH=/tmp/nonexistent-env npx jest src/__tests__/unit > t17.log 2>&1; echo $?`
Expected: `0`. If a site remains, it is listed: fix it by the migration rules and re-run.

- [ ] **Step 2: Documentation**

`docs/architecture/ARCHITECTURE.md`, a new short section after the client list:

```markdown
## Object addresses

Every ADT object address is built in `src/endpoints/objects.ts`: one record per
kind, with its full `collection` and `validation` paths and a `uri(...)` that
takes exactly what the address needs (a function include needs its group, a
class include its class and kind). `seg(name)` is the only way a name enters an
address. `src/__tests__/unit/endpoints/noHardcodedObjectAddresses.test.ts`
fails on any of those paths written anywhere else in `src/`. Service endpoints
(activation, check runs, ATC, discovery) are not in the registry yet.
```

`CLAUDE.md`, under "Core Modules", one bullet:

```markdown
- **Object addresses** (`src/endpoints/objects.ts`): the one place an object's ADT address is built — never write `/sap/bc/adt/<collection>/…` in a module; a parser test enforces it.
```

- [ ] **Step 3: Verify and commit**

`npm run lint:check > t17-lint.log 2>&1` clean (it includes `check:docs`).

```bash
git add src docs CLAUDE.md
git commit -m "test(endpoints): every registry path enforced; docs name the registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: After-runs, comparison, PR

- [ ] **Step 1: Re-run the matrix on the migrated code**

Same command as Task 3 Step 3, output `address-matrix-after.md`. Expected exit `0`.

- [ ] **Step 2: Trial, then E19, the wire logged**

Exactly as Task 4, with `wire-after-trial.txt` / `wire-after-e19.txt` and `after-trial.log` / `after-e19.log`.

- [ ] **Step 3: Compare with the baseline**

- Failures: every failing test in `after-*.log` must also be in `baseline-failures.md`. A new one is read and fixed before going further. It is not waved through as flaky.
- Wire: the request lines must agree apart from the name's case.

```bash
for s in trial e19; do
  grep -oE '(GET|POST|PUT|DELETE) /sap/bc/[^ ]+' wire-baseline-$s.txt | tr 'A-Z' 'a-z' | sed -E 's/lockhandle=[^&]+/lockhandle=X/; s/(worklistid|corrnr)=[^&]+/\1=X/' | sort -u > base-$s.urls
  grep -oE '(GET|POST|PUT|DELETE) /sap/bc/[^ ]+' wire-after-$s.txt    | tr 'A-Z' 'a-z' | sed -E 's/lockhandle=[^&]+/lockhandle=X/; s/(worklistid|corrnr)=[^&]+/\1=X/' | sort -u > after-$s.urls
  diff base-$s.urls after-$s.urls > urls-$s.diff; echo "$s: $(wc -l < urls-$s.diff) differing lines"
done
```
Read each `urls-*.diff`. Every line must be explained by a deliberate change: a fixed defect, a run-generated name (timestamps or generated object names differ between runs; check against the test's own naming), or a test that ran in one run and not the other. Write the explanation per line into the PR.

- [ ] **Step 4: Validation, from the after-run wire logs**

Same `awk` as Task 4 Step 3 over `wire-after-*.txt`, into `validation-after-*.txt`. Every kind's `validation` path appears with the endpoint's own verdict. No `404` or `No URI-Mapping` answer is allowed. A kind absent from both logs is listed as unconfirmed.

- [ ] **Step 5: Writing paths, named**

For each writing path (`?_action=LOCK`/`UNLOCK` on each kind, `transportUri`, `publishJobs`, `unpublishJobs`, `FEATURE_TOGGLE.toggle`/`states`), find its request in `wire-after-*.txt` and name the integration test that sent it. A path found in neither run is listed as **unconfirmed**.

- [ ] **Step 6: Push and open the PR**

PR body sections:
- what changed;
- the two behaviour changes from Task 16;
- `address-matrix-after.md` in full, and `validation-after-*.txt` beside `validation-baseline-*.txt`;
- the wire comparison with each difference explained;
- the writing paths with their tests, and the unconfirmed ones;
- "Legacy (E77) unmeasured", with run instructions for the other machine:
  ```bash
  SAPNWRFC_HOME=… npm run test:detached -- integration/core/transport
  ```
- `Refs #109`, and that it is the prerequisite for fr0ster/mcp-abap-adt#250.

Ask the owner for the CHANGELOG version. Do not bump `package.json`.

- [ ] **Step 7: Delete the plan and the spec once merged**

Per `CLAUDE.md` ("Plans and Specs"), after merge: `git rm` both files, committed to main.
