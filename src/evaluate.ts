// File-system helpers used to read directories and files during evaluation
import { readdir, readFile } from "node:fs/promises";
// Path helper to join directory + filename
import { join } from "node:path";

// Directories to compare: actual model outputs and expected fixture outputs
const outputDirectory = "C:\\ailearning\\ai-doc-extraction-tool\\output";
const expectedDirectory =
  "C:\\ailearning\\ai-doc-extraction-tool\\test\\data\\expected_output";

// Lightweight JSON value type used by the evaluator to represent parsed files
type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

// Helper to present a readable path for nested JSON fields in error messages
function formatPath(path: string): string {
  return path || "<root>";
}

// Deep-diff routine that walks two JSON values and returns the first
// human-readable difference found. It is intentionally simple and deterministic
// so failures are easy to inspect; it reports missing/extra fields, array
// length mismatches, and primitive mismatches with a path to the value.
function findDifference(
  actual: JsonValue,
  expected: JsonValue,
  path = "",
): string | undefined {
  // Treat two nulls as equal; otherwise a single null is a mismatch.
  if (actual === null && expected === null) {
    return undefined;
  }

  if (actual === null || expected === null) {
    return `at ${formatPath(path)}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`;
  }

  // If types differ (after ruling out null), report a mismatch.
  if (typeof actual !== typeof expected) {
    return `at ${formatPath(path)}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`;
  }

  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      return `at ${formatPath(path)}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`;
    }

    if (actual.length !== expected.length) {
      return `at ${formatPath(path)}: expected ${expected.length} items, received ${actual.length}`;
    }

    for (let index = 0; index < actual.length; index += 1) {
      const actualValue = actual[index];
      const expectedValue = expected[index];
      if (actualValue === undefined || expectedValue === undefined) {
        return `at ${formatPath(path)}: array item ${index} is missing`;
      }

      const difference = findDifference(actualValue, expectedValue, `${path}[${index}]`);
      if (difference) {
        return difference;
      }
    }

    return undefined;
  }

  if (typeof actual === "object" && typeof expected === "object") {
    const actualKeys = Object.keys(actual);
    const expectedKeys = Object.keys(expected);
    const allKeys = new Set([...actualKeys, ...expectedKeys]);

    for (const key of allKeys) {
      if (!(key in actual) || !(key in expected)) {
        return `at ${formatPath(path)}: property "${key}" is ${
          key in expected ? "missing from actual output" : "unexpected"
        }`;
      }

      const actualValue = actual[key];
      const expectedValue = expected[key];
      if (actualValue === undefined || expectedValue === undefined) {
        return `at ${formatPath(path)}: property "${key}" is missing`;
      }

      const difference = findDifference(actualValue, expectedValue, path ? `${path}.${key}` : key);
      if (difference) {
        return difference;
      }
    }
  }

  if (actual !== expected) {
    return `at ${formatPath(path)}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`;
  }

  return undefined;
}

// Read and parse a JSON file from disk into the JsonValue type
async function readJsonFile(directory: string, fileName: string): Promise<JsonValue> {
  const filePath = join(directory, fileName);
  return JSON.parse(await readFile(filePath, "utf8")) as JsonValue;
}

// Main evaluation entrypoint: compares every JSON file in output with the
// corresponding expected fixture. Reports passes/failures and sets a non-zero
// exit code when any comparison fails to integrate with CI.
async function main() {
  const [outputEntries, expectedEntries] = await Promise.all([
    readdir(outputDirectory, { withFileTypes: true }),
    readdir(expectedDirectory, { withFileTypes: true }),
  ]);
  const outputFiles = new Set(
    outputEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name),
  );
  const expectedFiles = new Set(
    expectedEntries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name),
  );
  const allFiles = [...new Set([...outputFiles, ...expectedFiles])].sort();
  let failures = 0;

  for (const fileName of allFiles) {
    if (!outputFiles.has(fileName)) {
      console.error(`FAIL ${fileName}: missing from output`);
      failures += 1;
      continue;
    }

    if (!expectedFiles.has(fileName)) {
      console.error(`FAIL ${fileName}: missing expected fixture`);
      failures += 1;
      continue;
    }

    const [actual, expected] = await Promise.all([
      readJsonFile(outputDirectory, fileName),
      readJsonFile(expectedDirectory, fileName),
    ]);
      const difference = findDifference(actual, expected);

    if (difference) {
        // Count this file as failed (at least one mismatch) for CI purposes.
      failures += 1;
        // Also print the first difference to help debugging.
        // console.error(`${fileName}: ${difference}`);
    }

      // Compute per-file field-level stats and update global stats as a side-effect.
      const fileStats = accumulateFieldStats(actual, expected);
      const filePct = fileStats.total === 0 ? 100 : Math.round((fileStats.matches / fileStats.total) * 10000) / 100;

      // Print a single-line accuracy summary for the file instead of PASS/FAIL.
      console.log(`${fileName}: ${fileStats.matches}/${fileStats.total} fields correct (${filePct}%)`);
    }

    // After comparing all files, print a per-field accuracy report.
    console.log("\nPer-field accuracy report:");
    const entries = Array.from(stats.entries()).sort((a, b) => b[1].matches / b[1].total - a[1].matches / a[1].total);
    for (const [path, { matches, total }] of entries) {
      const pct = total === 0 ? 0 : Math.round((matches / total) * 10000) / 100;
      console.log(`${path}: ${matches}/${total} (${pct}%)`);
    }

    // Compute overall accuracy across all tracked fields and report it as a percentage
  let totalMatches = 0;
  let totalFields = 0;
  for (const { matches, total } of stats.values()) {
    totalMatches += matches;
    totalFields += total;
  }
  const overallPct = totalFields === 0 ? 100 : Math.round((totalMatches / totalFields) * 10000) / 100;
  console.log(`\nEvaluated ${allFiles.length} document(s). Overall accuracy: ${totalMatches}/${totalFields} fields matched (${overallPct}%)`);

    if (failures > 0) {
      process.exitCode = 1;
    }
}

main();

// --- Field statistics helpers -------------------------------------------------

type Stat = { matches: number; total: number };
const stats: Map<string, Stat> = new Map();

function normalizePath(path: string): string {
    // Replace numeric indices with [] so array positions are aggregated.
    return path.replace(/\[\d+\]/g, "[]");
}

function recordStat(path: string, match: boolean) {
    const key = normalizePath(path);
    const cur = stats.get(key) ?? { matches: 0, total: 0 };
    cur.total += 1;
    if (match) cur.matches += 1;
    stats.set(key, cur);
}

function areEqual(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
    // Treat undefined and missing as mismatch; treat both null as equal.
    if (a === null && b === null) return true;
    if (a === undefined || b === undefined) return false;
    return a === b;
}

function accumulateFieldStats(actualAny: any, expectedAny: any, path = ""): Stat {
    // Walk expected (ground truth) and compare corresponding actual values.
    const expected = expectedAny as JsonValue | undefined;
    const actual = actualAny as JsonValue | undefined;

    let matches = 0;
    let total = 0;

    // If expected is undefined (shouldn't happen for fixture), skip.
    if (expected === undefined) return { matches: 0, total: 0 };

    if (expected === null) {
      // Primitive null field
      const match = areEqual(actual, expected);
      recordStat(path || "<root>", match);
      return { matches: match ? 1 : 0, total: 1 };
    }

    if (Array.isArray(expected)) {
      // For arrays, compare each expected element with actual's element at same index.
      for (let i = 0; i < expected.length; i++) {
        const childPath = `${path}[${i}]`;
        const aVal = Array.isArray(actual) ? actual[i] : undefined;
        const sub = accumulateFieldStats(aVal, expected[i], childPath);
        matches += sub.matches;
        total += sub.total;
      }
      return { matches, total };
    }

    if (typeof expected === "object") {
      // For objects, iterate expected keys and recurse.
      for (const key of Object.keys(expected)) {
        const childPath = path ? `${path}.${key}` : key;
        const aVal = actual && typeof actual === "object" ? (actual as any)[key] : undefined;
        const sub = accumulateFieldStats(aVal, (expected as any)[key], childPath);
        matches += sub.matches;
        total += sub.total;
      }
      return { matches, total };
    }

    // Primitive (string/number/boolean)
    const match = areEqual(actual, expected);
    recordStat(path || "<root>", match);
    return { matches: match ? 1 : 0, total: 1 };
}
