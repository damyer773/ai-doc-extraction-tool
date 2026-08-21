import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const outputDirectory = "C:\\ailearning\\ai-doc-extraction-tool\\output";
const expectedDirectory =
  "C:\\ailearning\\ai-doc-extraction-tool\\test\\data\\expected_output";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

function formatPath(path: string): string {
  return path || "<root>";
}

function findDifference(
  actual: JsonValue,
  expected: JsonValue,
  path = "",
): string | undefined {
  if (typeof actual !== typeof expected || actual === null || expected === null) {
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

async function readJsonFile(directory: string, fileName: string): Promise<JsonValue> {
  const filePath = join(directory, fileName);
  return JSON.parse(await readFile(filePath, "utf8")) as JsonValue;
}

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
      console.error(`FAIL ${fileName} ${difference}`);
      failures += 1;
    } else {
      console.log(`PASS ${fileName}`);
    }
  }

  console.log(`\nEvaluated ${allFiles.length} file(s): ${allFiles.length - failures} passed, ${failures} failed.`);

  if (failures > 0) {
    process.exitCode = 1;
  }
}

main();
