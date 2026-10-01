# Object address registry — step 1 of removing hardcoded ADT paths

Status: approved design, 2026-10-01. Step 2 (service endpoints) is a separate
inventory and analysis, not part of this spec.

## Why

Every module builds the address of the object it works on by hand. Counted with
the TypeScript parser over `src/` (tests excluded), 2026-10-01:

- **546** string literals starting `/sap/bc/adt/`, in **298** files;
- **369** of them are object addresses, in **237** files, across 25 object
  kinds — `functions/groups` alone 43 times in 33 files, `oo/classes` 28 in 19;
- **186** distinct address shapes;
- five separate type → address tables that have drifted apart:
  `buildObjectUri` (`src/utils/activationUtils.ts`), `getObjectUri`
  (`src/utils/checkRun.ts`), `getObjectMetadataUri` and `getObjectSourceUri`
  (`src/core/shared/objectWire.ts`), `URI_TEMPLATES` (`src/runtime/atc/run.ts`).

What the duplication has already produced:

1. `ENHO/ENH` falls through to `/sap/bc/adt/xslt/transformations/` in
   `buildObjectUri`.
2. `objectWire` knows an interface as `intf/if`; ADT calls it `INTF/OI`, so
   `readObjectMetadata('INTF/OI', …)` throws `Unsupported object type`.
3. `objectWire` knows a data element only as `dtel`; `DTEL/DE` — the code in the
   recorded ADT answers — is refused.
4. `buildObjectUri`'s `default` invents `/sap/bc/adt/<type lowercased>/<name>`
   for a type it does not know.
5. `buildObjectUri` uses a function module's own name as its group when no
   group is passed.
6. Each table knows a different set of kinds. `PROG/I` and `FUGR/I` exist only
   in `buildObjectUri`; no table knows a class include; check run, `objectWire`
   and ATC know no include at all.
7. The name's case differs by module: ~164 sites lowercase it, 3 (ATC)
   uppercase it, ~182 send it as the caller gave it.

The direct trigger is fr0ster/mcp-abap-adt#250 (RunATC for programs and
includes). Measured on E19 and the trial with `scripts/adt-nc.ts` (#194): ATC
accepts a program and all three include kinds and checks the whole master
object, and **the include's own kind of address matters** — a function include
is found under `/functions/groups/<G>/includes/<I>` and not under
`/programs/includes/<I>`. "One path for `include`" would be wrong. The kinds
must be told apart where the address is built, and that is not possible while
the address is built in 237 places.

## Decided

**A static internal module of address builders**: `src/endpoints/objects.ts`.
Not exported from the package, not a contract in `interfaces-adt`.

Rejected: an address table injected into every implementation the way
`contentTypes` is. Object addresses barely depend on the system — among the
legacy implementations only the transport request is addressed differently —
and injecting would settle a step-2 question before step 2's analysis.
Revisited only if that analysis says endpoint substitution belongs in data.

### 1. One record per kind, full paths

```ts
export const PROGRAM = {
  collection: '/sap/bc/adt/programs/programs',
  validation: '/sap/bc/adt/programs/validation',
  uri: (name: string) => `${PROGRAM.collection}/${seg(name)}`,
} as const;

export const PROGRAM_INCLUDE = {
  collection: '/sap/bc/adt/programs/includes',
  uri: (name: string) => `${PROGRAM_INCLUDE.collection}/${seg(name)}`,
} as const;

export const FUNCTION_INCLUDE = {
  uri: (group: string, name: string) =>
    `${FUNCTION_GROUP.uri(group)}/includes/${seg(name)}`,
} as const;

export const CLASS_INCLUDE = {
  uri: (className: string, kind: ClassIncludeKind) =>
    `${CLASS.uri(className)}/includes/${kind}`,
} as const;
```

- **A record per kind, with the arguments the address needs.** A program
  include, a function include and a class include are three records with three
  signatures; the wrong kind does not type-check.
- **Literal full paths** in each record: `collection`, and `validation` where
  the kind has one. `validation` is not derivable from the collection —
  `/programs/validation`, `/oo/validation/objectname`, `/functions/validation`,
  `/ddic/ddl/validation`, but `/ddic/ddlx/sources/validation` — so it is stated
  per kind.
- **Tails shared by many kinds are functions of an address**, not literals in
  modules: `sourceUri(uri)` (`/source/main`), `versionsUri(…)`,
  `transportUri(uri)`, `lockUri(uri)`. A tail one kind alone has (`publishjobs`,
  `unpublishjobs`, `/check`, `/states`, `/toggle`) lives in that kind's record.
- **A kind addressed differently on legacy gets two explicit records** —
  `TRANSPORT_REQUEST` (`/sap/bc/adt/cts/transportrequests`) and
  `TRANSPORT_REQUEST_LEGACY` (`/sap/bc/cts/transportrequests`). The legacy
  implementation takes its own; nothing is unified that differs.
- Kinds covered (from the inventory): program, program include, class, class
  include (`definitions`, `implementations`, `macros`, `testclasses`, `main`),
  interface, function group, function module, function include, package, DDL
  source, DDIC view (`/ddic/views`, `buildObjectUri` only), table, structure
  (append structures included), domain, data element, table type, behavior
  definition, service definition, service binding, access control, metadata
  extension, XSLT transformation, message class, feature toggle, authorization
  field, enhancement (subtype is a path segment: `/enhancements/<subtype>/…`),
  scalar function, scalar function implementation, transport request.

**Step 1's boundary:** a kind's collection, its object address, the
sub-resources of that address, and its `validation`. Service endpoints —
`activation`, `checkruns`, `deletion`, `atc`, `programrun`, `classrun`,
`discovery`, runtime — are step 2.

### 2. The name in an address

`seg(name)` is the only way a name enters an address:
`encodeURIComponent(name.toLowerCase())`. A namespace `/ABC/` becomes
`%2fabc%2f`, as in the addresses ADT itself answers with
(`/sap/bc/adt/programs/includes/zaber_alv_report_cli`, E19, 2026-10-01).
Address-building calls to `encodeSapObjectName` go.

Case-insensitivity of the address is **an assumption until measured**. Before
any module switches, every kind is read with `adt-nc` on E19 and the trial
twice — lowercase and uppercase name, same object — and the two answers are
compared on status and body. A kind found case-sensitive gets its own `seg`
in its record, with the measurement in a comment.

Names in request bodies and in query parameters (`?checkVariant=`,
`?parent_name=`, …) are not addresses and are out of scope.

### 3. Migration, enforcement, verification

**Order**, one commit per stage:

1. The registry and its unit tests — each builder against the exact string it
   must produce. No module touched.
2. **A baseline integration run before any switch**: the trial, then E19, one at
   a time (`npm run test:detached`). Without it a failure afterwards has nothing
   to be compared with.
3. Kind by kind, `src/core/<kind>/*` takes its addresses from the registry, with
   `seg()`. One commit per kind.
4. The five type → address tables become thin switches over registry records,
   and defects 1–3 and 5 above are fixed there.
5. `buildObjectUri`'s `default` stops inventing an address: an unknown type is
   thrown before any request — a caller's argument, which decision 15 allows to
   throw. **Behaviour change**: a call that used to send a request to an address
   that exists nowhere now throws.

**Enforcement**: a unit test reads `src/` with the TypeScript parser (decision 3)
and fails on any string or template literal outside `src/endpoints/` that starts
with **any path a registry record declares** — every string-valued field of every
record: `collection`, `validation`, the legacy collections. Collection roots alone
are not enough: `validation` often sits under a different prefix
(`/sap/bc/adt/programs/validation` against `/sap/bc/adt/programs/programs`, also
`/oo/validation/objectname`, `/functions/validation`, `/ddic/ddl/validation`) and
would pass unseen. The list is taken from the registry, so a new kind — or a new
path on an existing one — is enforced the moment it is added.

Not "every `/sap/bc/adt/` literal with an allow-list": until step 2 the ~177
service-endpoint literals stay in their modules on purpose, and listing them as
exceptions would be step 2 done backwards. Step 2 decides whether the check
widens to every ADT path.

**Verification on real systems:**

- **`adt-nc` matrix**, E19 and the trial, per kind: GET of the address, of
  `source/main` where the kind has one, of `versions` where it has one, in lower
  and upper case; all three include kinds. The measured statuses go into the PR
  description.
- **A full integration run after the switch**, the trial then E19, one at a
  time, compared with the baseline. No new failure is accepted; every
  difference is read, not waved through.
- **Legacy (E77) is not reachable from this machine.** The legacy transport
  record is unchanged. The PR says legacy is unmeasured and gives the run
  instructions for the other machine.

## Out of scope

- ATC for programs and includes, fr0ster/mcp-abap-adt#250, and widening
  `AtcObjectType` in `interfaces-adt` — after step 1, once include addresses are
  unambiguous.
- Step 2 — a separate document listing the ~177 service-endpoint literals, which
  of them legacy substitutes, and the consequences, before any code.
- Changing any public API. The registry is internal; consumers see only the
  behaviour change in step 3.5 and the fixed defects.

## Success criteria

- No object-address literal in `src/` outside `src/endpoints/`, enforced by the
  parser test.
- The five tables take every address from the registry; defects 1–5 fixed.
- Every registry record confirmed by a request on E19 and the trial (legacy
  records stated as unmeasured).
- The integration run after the switch has no failure the baseline did not have.
