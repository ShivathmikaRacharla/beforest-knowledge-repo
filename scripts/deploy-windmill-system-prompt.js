/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");

function readEnv(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index),
          line.slice(index + 1).replace(/^"|"$/g, ""),
        ];
      }),
  );
}

function required(value, name) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

const defaultSystemPrompt = `You are Ask Beforest, a clear and helpful internal knowledge assistant for Beforest.

Answer the user's question using only the approved knowledge excerpts below.

Response style:
- Be direct, natural, and professional.
- Start with the answer, not with caveats.
- Use short paragraphs.
- Use bullet points when the information has multiple items.
- Explain internal terms simply.
- Do not sound robotic.
- Do not mention the excerpts, retrieved chunks, context, Qdrant, Windmill, Gemini, or backend systems.
- Do not use citation markers like [Source 1]; the app shows sources separately.
- If the answer is not present in the approved knowledge, say: "I couldn't find that in the approved knowledge base."

Accuracy rules:
- Use only the information present in the approved knowledge excerpts.
- Do not invent facts.
- Do not add external knowledge.
- If the data is incomplete, say what is available and what is missing.`;

function updateContent(content) {
  let next = content;

  next = next.replace(
    /export async function main\(question: string, matches: Match\[\], document_count\?: number, documents: Match\[\] = \[\](?:, system_prompt\?: string)?\) \{/,
    "export async function main(question: string, matches: Match[], document_count?: number, documents: Match[] = [], system_prompt?: string) {",
  );

  if (!next.includes("system_prompt?: string")) {
    throw new Error("Could not update Windmill function signature.");
  }

  if (next.includes("const responseGuide = system_prompt?.trim() || defaultSystemPrompt")) {
    return next;
  }

  const promptBlock = [
    "  const defaultSystemPrompt = " + JSON.stringify(defaultSystemPrompt),
    "  const responseGuide = system_prompt?.trim() || defaultSystemPrompt",
    "  const prompt = `${responseGuide}\\n\\n${inventory}Question: ${question}\\n\\nApproved knowledge:\\n${context}`",
  ].join("\n");

  const promptPattern = /  const prompt = `[\s\S]*?\$\{context\}`/;
  if (!promptPattern.test(next)) {
    throw new Error("Could not find the existing prompt block in Windmill script.");
  }

  return next.replace(promptPattern, promptBlock);
}

async function main() {
  const env = readEnv(".env");
  const base = required(env.BASE_URL || env.WINDMILL_BASE_URL, "BASE_URL").replace(/\/$/, "");
  const workspace = required(env.WM_WORKSPACE || env.WINDMILL_WORKSPACE, "WM_WORKSPACE");
  const token = required(env.WM_TOKEN || env.WINDMILL_TOKEN, "WM_TOKEN");
  const scriptPath = "f/kms/generate_grounded_answer_gemini";
  const headers = { authorization: `Bearer ${token}` };

  const getUrl = `${base}/api/w/${encodeURIComponent(workspace)}/scripts/get/p/${scriptPath}`;
  const currentResponse = await fetch(getUrl, { headers });
  if (!currentResponse.ok) {
    throw new Error(`Could not read Windmill script: HTTP ${currentResponse.status}`);
  }
  const current = await currentResponse.json();
  const content = updateContent(current.content || "");

  if (content === current.content) {
    console.log("Windmill script already supports system_prompt.");
    return;
  }

  const updateUrl = `${base}/api/w/${encodeURIComponent(workspace)}/scripts/update/${encodeURIComponent(scriptPath)}`;
  const updateResponse = await fetch(updateUrl, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      path: scriptPath,
      summary: current.summary || "",
      description: current.description || "",
      content,
      language: current.language || "deno",
      kind: current.kind || "script",
      tag: current.tag || undefined,
      auto_parent: true,
      deployment_message: "Allow app Settings to control Gemini system prompt",
    }),
  });
  const updateText = await updateResponse.text();
  if (!updateResponse.ok) {
    throw new Error(`Could not update Windmill script: HTTP ${updateResponse.status} ${updateText.slice(0, 500)}`);
  }
  console.log(`Windmill update accepted: ${updateResponse.status}`);

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const pollResponse = await fetch(getUrl, { headers });
    const latest = await pollResponse.json();
    if (latest.lock_error_logs) {
      throw new Error(`Windmill lock failed: ${latest.lock_error_logs}`);
    }
    if (latest.lock && latest.content?.includes("system_prompt?: string")) {
      console.log("Windmill script is runnable with system_prompt.");
      return;
    }
    console.log(`Waiting for Windmill lock... ${attempt}/12`);
  }

  console.log("Windmill update was accepted, but the runnable lock is still pending.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
