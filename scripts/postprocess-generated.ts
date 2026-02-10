import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Post-processing for OpenAPI-generated TypeScript files.
 *
 * Why this exists:
 * The ChurchTools OpenAPI 3.1 document currently triggers several known
 * `typescript-fetch` generator issues (missing helper models, broken re-exports,
 * invalid helper calls, missing instance guards for type aliases, duplicate date
 * serialization branches).
 *
 * This script applies deterministic, file-based fixes after each generation run.
 * It is intentionally idempotent: running it multiple times should not create
 * additional diffs once files are in the expected shape.
 */
const generatedRoot = 'src/generated/openapi';
const apisDir = join(generatedRoot, 'apis');
const modelsDir = join(generatedRoot, 'models');

/**
 * Reads a UTF-8 file from disk.
 */
const readText = (filePath: string): string => readFileSync(filePath, 'utf8');

/**
 * Writes the file only when content changed.
 *
 * @returns `true` if a write happened, otherwise `false`.
 */
const writeIfChanged = (filePath: string, next: string): boolean => {
  const previous = readText(filePath);
  if (previous === next) {
    return false;
  }
  writeFileSync(filePath, next, 'utf8');
  return true;
};

/**
 * Returns all `.ts` files of a directory sorted for deterministic processing.
 */
const listTsFiles = (dirPath: string): string[] =>
  readdirSync(dirPath)
    .filter((fileName) => fileName.endsWith('.ts'))
    .sort();

/**
 * Escapes user text for safe usage in dynamic regular expressions.
 */
const escapeForRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Ensures a generated `Null` model exists.
 *
 * Background:
 * Some generated models import `./Null`, but the generator does not emit the file.
 * We provide a minimal, schema-compatible implementation.
 *
 * @returns number of modified files (0 or 1)
 */
const ensureNullModel = (): number => {
  const nullModelPath = join(modelsDir, 'Null.ts');
  if (!existsSync(nullModelPath)) {
    const nullModelContent = `/* tslint:disable */
/* eslint-disable */

export type Null = null;

export function instanceOfNull(value: unknown): value is Null {
  return value === null;
}

export function NullFromJSON(_json: unknown): Null {
  return null;
}

export function NullFromJSONTyped(_json: unknown, _ignoreDiscriminator: boolean): Null {
  return null;
}

export function NullToJSON(_value: Null): null {
  return null;
}

export function NullToJSONTyped(_value: Null | null | undefined, _ignoreDiscriminator: boolean): null {
  return null;
}
`;
    writeFileSync(nullModelPath, nullModelContent, 'utf8');
    return 1;
  }
  return 0;
};

/**
 * Ensures the generated model barrel exports `Null`.
 *
 * @returns number of modified files (0 or 1)
 */
const ensureNullExportInModelIndex = (): number => {
  const modelIndexPath = join(modelsDir, 'index.ts');
  const content = readText(modelIndexPath);
  const exportLine = "export * from './Null';";
  if (content.includes(exportLine)) {
    return 0;
  }
  const next = `${content.trimEnd()}\n${exportLine}\n`;
  writeFileSync(modelIndexPath, next, 'utf8');
  return 1;
};

/**
 * Rewrites `apis/index.ts` to avoid duplicate `export *` conflicts.
 *
 * Strategy:
 * - Scan each API file for `export class ... extends BaseAPI`.
 * - Export only class symbols from the barrel (instead of wildcard exports).
 *
 * This avoids name collisions for duplicated request type aliases across APIs.
 *
 * @returns number of modified files (0 or 1)
 */
const rewriteApisIndex = (): number => {
  const apiFiles = listTsFiles(apisDir).filter(
    (fileName) => fileName !== 'index.ts',
  );
  const exports: string[] = [];

  for (const fileName of apiFiles) {
    const filePath = join(apisDir, fileName);
    const content = readText(filePath);
    const classMatches = content.matchAll(
      /export class (\w+)\s+extends\s+(?:runtime\.)?BaseAPI/g,
    );
    for (const classMatch of classMatches) {
      const className = classMatch[1];
      const moduleName = fileName.replace(/\.ts$/, '');
      exports.push(`export { ${className} } from './${moduleName}';`);
    }
  }

  const next = `/* tslint:disable */
/* eslint-disable */
// Auto-maintained by scripts/postprocess-generated.ts
${exports.join('\n')}
`;

  const apiIndexPath = join(apisDir, 'index.ts');
  return writeIfChanged(apiIndexPath, next) ? 1 : 0;
};

/**
 * Fixes broken `objectToJSON(...)` usage in generated API files.
 *
 * The generator sometimes emits unbound `objectToJSON` calls in form-data paths.
 * We normalize these snippets to plain JSON serialization without helper calls.
 *
 * @returns number of modified files
 */
const patchObjectToJsonCalls = (): number => {
  let changes = 0;
  const apiFiles = listTsFiles(apisDir).filter(
    (fileName) => fileName !== 'index.ts',
  );

  for (const fileName of apiFiles) {
    const filePath = join(apisDir, fileName);
    const content = readText(filePath);
    if (!content.includes('objectToJSON(')) {
      continue;
    }

    let next = content;
    next = next.replace(
      /JSON\.stringify\(\s*(?:runtime\.)?objectToJSON\(([^()]*)\)\s*\)/g,
      'JSON.stringify($1)',
    );
    next = next.replace(/(?:runtime\.)?objectToJSON\(([^()]*)\)/g, '$1');

    if (next !== content) {
      writeFileSync(filePath, next, 'utf8');
      changes += 1;
    }
  }

  return changes;
};

/**
 * Ensures `instanceOf<ModelName>` exists for generated alias models.
 *
 * Problem:
 * Some union conversions expect these guards to be present, but they are not
 * consistently emitted for alias-based models.
 *
 * Tradeoff:
 * The generated guard is intentionally generic (`object` and non-null). This is
 * sufficient for the generated control-flow checks and keeps the patch stable.
 *
 * @returns number of modified files
 */
const ensureInstanceOfForAliasModels = (): number => {
  let changes = 0;
  const modelFiles = listTsFiles(modelsDir).filter(
    (fileName) => fileName !== 'index.ts',
  );

  for (const fileName of modelFiles) {
    const modelName = fileName.replace(/\.ts$/, '');
    const filePath = join(modelsDir, fileName);
    const content = readText(filePath);

    if (!content.includes(`export type ${modelName} =`)) {
      continue;
    }

    if (content.includes(`export function instanceOf${modelName}(`)) {
      continue;
    }

    const typePattern = new RegExp(
      `export type ${escapeForRegex(modelName)} =[\\s\\S]*?;`,
    );
    const typeMatch = content.match(typePattern);
    if (!typeMatch) {
      continue;
    }

    const instanceOfFn = `
export function instanceOf${modelName}(value: unknown): value is ${modelName} {
  return typeof value === 'object' && value !== null;
}
`;

    const next = content.replace(typePattern, `${typeMatch[0]}${instanceOfFn}`);
    if (next !== content) {
      writeFileSync(filePath, next, 'utf8');
      changes += 1;
    }
  }

  return changes;
};

/**
 * Patches duplicated date serialization branches in generated model files.
 *
 * Problem:
 * Some alias date models emit two consecutive `if (value instanceof Date)` blocks
 * which can lead to unreachable/invalid paths in TypeScript analysis.
 *
 * Fix:
 * Replace both blocks with one deterministic `value.toISOString()` branch.
 *
 * @returns number of modified files
 */
const patchDuplicateDateSerializationBlocks = (): number => {
  let changes = 0;
  const modelFiles = listTsFiles(modelsDir).filter(
    (fileName) => fileName !== 'index.ts',
  );

  for (const fileName of modelFiles) {
    const filePath = join(modelsDir, fileName);
    const content = readText(filePath);
    const next = content.replace(
      /if \(value instanceof Date\) \{\s*return value == null \? undefined : \(\(value\)\.toISOString\(\)\);\s*\}\s*if \(value instanceof Date\) \{\s*return \(\(value\)\.toISOString\(\)\.substring\(0,\s*10\)\);\s*\}/g,
      `if (value instanceof Date) {
        return value.toISOString();
    }`,
    );

    if (next !== content) {
      writeFileSync(filePath, next, 'utf8');
      changes += 1;
    }
  }

  return changes;
};

/**
 * Verifies the expected generated directory layout before patching.
 */
const ensureGeneratedLayout = (): void => {
  if (!existsSync(apisDir) || !existsSync(modelsDir)) {
    throw new Error(
      `Generated OpenAPI sources not found under '${generatedRoot}'. Run 'bun run generate' first.`,
    );
  }
};

// Fail fast when generation output does not exist.
ensureGeneratedLayout();

// Apply all deterministic fix-up steps and aggregate the changed file count.
const changeCount =
  ensureNullModel() +
  ensureNullExportInModelIndex() +
  rewriteApisIndex() +
  patchObjectToJsonCalls() +
  ensureInstanceOfForAliasModels() +
  patchDuplicateDateSerializationBlocks();

console.log(
  `[postprocess-generated] completed with ${changeCount} file updates.`,
);
