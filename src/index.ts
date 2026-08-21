import "dotenv/config";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join } from "node:path";
import OpenAI from "openai";

// Keep service configuration in one place so the extraction workflow is easy to
// point at a different Azure OpenAI deployment or document directories.
const endpoint = "https://ai-doc-extract-resource.services.ai.azure.com/openai/v1";
const deploymentName = process.env.AZURE_MODEL_DEPLOYMENT ?? "gpt-5-mini-1";
const apiKey = process.env.AZURE_API_KEY;
const inputDirectory = "C:\\ailearning\\ai-doc-extraction-tool\\input";
const outputDirectory = "C:\\ailearning\\ai-doc-extraction-tool\\output";
const schemaPath =
  "C:\\ailearning\\ai-doc-extraction-tool\\schema\\document-extraction.schema.json";

if (!apiKey) {
  throw new Error("AZURE_API_KEY is not set. Add it to your .env file.");
}

// The OpenAI-compatible client sends requests to the configured Azure endpoint.
const openai = new OpenAI({
  baseURL: endpoint,
  apiKey,
});

async function main() {
  // Load the schema once and reuse it for every document in this batch.
  const schemaText = await readFile(schemaPath, "utf8");
  const extractionSchema = JSON.parse(schemaText);
  const inputFiles = await readdir(inputDirectory, { withFileTypes: true });

  // Outputs represent the current batch
  // Remove old results before starting.
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  for (const inputFile of inputFiles) {
    // Directory entries are ignored; only files are sent to the model.
    if (!inputFile.isFile()) {
      continue;
    }

    const documentPath = join(inputDirectory, inputFile.name);
    const documentText = await readFile(documentPath, "utf8");

    console.log(`Extracting data from ${inputFile.name}...`);

    // Strict structured output keeps each extraction aligned with the shared schema.
    const response = await openai.responses.create({
      model: deploymentName,
      instructions:
        "Extract every customer, dollar amount, and address from the document. " +
        "Return only JSON that conforms to the supplied JSON Schema. " +
        "For each dollar amount, assign a concise category such as rental amount, principal, or security deposit. " +
        "Ignore banks or businesses; do not extract them as customer. " +
        "Use null only where the schema permits it; do not invent values.",
      input: documentText,
      text: {
        format: {
          type: "json_schema",
          name: "document_extraction",
          strict: true,
          schema: extractionSchema,
        },
      },
    });

    // Parse the model response before writing it so the output is valid JSON.
    const output = JSON.parse(response.output_text);
    const outputFileName = `${basename(inputFile.name, extname(inputFile.name))}.json`;
    const outputPath = join(outputDirectory, outputFileName);

    // Preserve the input filename while changing its extension for traceability.
    await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
    console.log(`Completed. Output saved to ${outputFileName}`);
  }
}

main();