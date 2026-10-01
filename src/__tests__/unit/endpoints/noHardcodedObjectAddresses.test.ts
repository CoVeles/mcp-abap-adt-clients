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

const ENFORCED: readonly (keyof typeof RECORDS)[] = [
  'PROGRAM',
  'PROGRAM_INCLUDE',
  'CLASS',
  'CLASS_INCLUDE',
  'INTERFACE',
  'FUNCTION_GROUP',
  'FUNCTION_MODULE',
  'FUNCTION_INCLUDE',
  'PACKAGE',
  'TRANSPORT_REQUEST',
  'TRANSPORT_REQUEST_LEGACY',
  'DDL_SOURCE',
  'DDIC_VIEW',
  'METADATA_EXTENSION',
  'ACCESS_CONTROL',
  'TABLE',
  'STRUCTURE',
  'TABLE_TYPE',
  'DOMAIN',
  'DATA_ELEMENT',
  'BEHAVIOR_DEFINITION',
  'SERVICE_DEFINITION',
  'SERVICE_BINDING',
  'TRANSFORMATION',
  'MESSAGE_CLASS',
  'FEATURE_TOGGLE',
  'AUTHORIZATION_FIELD',
  'ENHANCEMENT',
  'SCALAR_FUNCTION',
  'SCALAR_FUNCTION_IMPLEMENTATION',
];

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
function containsPath(text: string, p: string): boolean {
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

/**
 * Every literal in a source text, nested ones included: a template's
 * substitutions are expressions and may hold literals of their own —
 * `${'/sap/bc/adt/programs/programs'}/${name}` must not slip through because
 * its outer template reads as `${}/${}`.
 */
function literalsIn(
  fileName: string,
  text: string,
): { line: number; text: string }[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    const literal = literalText(node);
    if (literal !== null) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      out.push({ line: line + 1, text: literal });
      if (ts.isTemplateExpression(node)) {
        for (const span of node.templateSpans) visit(span.expression);
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

function violations(paths: string[]): string[] {
  const files = execSync("git ls-files 'src/**/*.ts'", {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(
      (f) => !f.startsWith('src/__tests__/') && !f.startsWith('src/endpoints/'),
    );
  const found: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    for (const literal of literalsIn(file, text)) {
      const hit = paths.find((p) => containsPath(literal.text, p));
      if (hit) found.push(`${file}:${literal.line}  ${hit}`);
    }
  }
  return found;
}

describe('containsPath', () => {
  it('matches a whole path and what may follow it', () => {
    expect(
      containsPath(
        '/sap/bc/adt/programs/programs/zrep',
        '/sap/bc/adt/programs/programs',
      ),
    ).toBe(true);
    expect(
      containsPath(
        '/sap/bc/adt/programs/programs?x=1',
        '/sap/bc/adt/programs/programs',
      ),
    ).toBe(true);
    expect(
      containsPath(
        'uri="/sap/bc/adt/ddic/tables"/>',
        '/sap/bc/adt/ddic/tables',
      ),
    ).toBe(true);
    expect(
      containsPath(
        '/sap/bc/adt/programs/programs${}',
        '/sap/bc/adt/programs/programs',
      ),
    ).toBe(true);
  });
  it('does not match a longer sibling segment', () => {
    expect(
      containsPath(
        '/sap/bc/adt/programs/programrun/zrep',
        '/sap/bc/adt/programs/programs',
      ),
    ).toBe(false);
    expect(
      containsPath('/sap/bc/adt/ddic/tablesettings', '/sap/bc/adt/ddic/tables'),
    ).toBe(false);
  });
});

describe('literalsIn', () => {
  it('reaches a literal inside a template substitution', () => {
    const texts = literalsIn(
      'x.ts',
      "const u = `${'/sap/bc/adt/programs/programs'}/${name}`;",
    ).map((l) => l.text);
    expect(texts).toContain('/sap/bc/adt/programs/programs');
  });
  it('reaches a literal nested two templates deep', () => {
    const texts = literalsIn(
      'x.ts',
      'const u = `a${`b${"/sap/bc/adt/ddic/tables"}`}`;',
    ).map((l) => l.text);
    expect(texts).toContain('/sap/bc/adt/ddic/tables');
  });
});

describe('every builder lands under a declared path', () => {
  // A function-valued field is invisible to declaredPaths(). Each one must build
  // an address under some string path the record family declares, or a literal
  // spelling that address elsewhere would pass the check unseen.
  const sample: Record<string, string[]> = {
    CLASS_INCLUDE: ['zcl_x', 'testclasses'],
    ENHANCEMENT: ['enhoxh', 'zenh'],
    SERVICE_BINDING: ['odatav2', 'zui_b'],
  };
  const all = declaredPaths(Object.keys(RECORDS) as (keyof typeof RECORDS)[]);
  for (const [name, record] of Object.entries(RECORDS)) {
    for (const [field, value] of Object.entries(record)) {
      if (typeof value !== 'function') continue;
      it(`${name}.${field}`, () => {
        const args = sample[name] ?? ['zz1', 'zz2'];
        const built = (value as (...a: string[]) => string)(...args);
        expect(all.some((p) => containsPath(built, p))).toBe(true);
      });
    }
  }
});

describe('object addresses come from src/endpoints/ only', () => {
  it('no enforced path is written anywhere else in src/', () => {
    expect(violations(declaredPaths(ENFORCED))).toEqual([]);
  });
});
