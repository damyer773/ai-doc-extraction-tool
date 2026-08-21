import "dotenv/config";
import OpenAI from "openai";

const endpoint = "https://sar-doc-extract-resource.services.ai.azure.com/openai/v1";
const deploymentName = "gpt-5-mini-1";
const apiKey = process.env.AZURE_API_KEY;

if (!apiKey) {
    throw new Error("AZURE_API_KEY is not set. Add it to your .env file.");
}

const openai = new OpenAI({
    baseURL: endpoint,
    apiKey
});

async function main() {
  const response = await openai.responses.create({
    model: deploymentName,
    input: "solve 8x + 31 = 2",
  });

  console.log(response.output_text);



    // Event streaming logic
    //   const runner = openai.responses
    //     .stream({
    //       model: deploymentName,
    //       input: 'solve 8x + 31 = 2',
    //     })
    //     .on('event', (event) => console.log(event))
    //     .on('response.output_text.delta', (diff) => process.stdout.write(diff.delta));

    //   for await (const event of runner) {
    //     console.log('event', event);
    //   }

    //   const result = await runner.finalResponse();
    //   console.log(result);

}

main();