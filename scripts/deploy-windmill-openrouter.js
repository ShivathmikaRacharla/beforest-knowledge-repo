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
        return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")];
      }),
  );
}

function required(value, name) {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function updateContent(content) {
  let next = content;
  next = next.replace(/const apiKey = await variable\('GEMINI_API_KEY'\)/, "const apiKey = await variable('OPENROUTER_API_KEY')");
  next = next.replace(/const model = \(await variable\('GEMINI_CHAT_MODEL'\)\) \|\| 'gemini-2\.5-flash'/, "const model = await variable('OPENROUTER_MODEL')");
  next = next.replace(/if \(!apiKey\) throw new Error\('GEMINI_API_KEY is not configured'\)/, "if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured')\n  if (!model) throw new Error('OPENROUTER_MODEL is not configured')");

  const newRequest = [
    "  const openrouterBaseUrl = (await variable('OPENROUTER_BASE_URL').catch(() => '')) || 'https://openrouter.ai/api/v1/chat/completions'",
    "  const response = await fetch(openrouterBaseUrl, {",
    "    method: 'POST',",
    "    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },",
    "    body: JSON.stringify({ model, messages: [{ role: 'system', content: responseGuide }, { role: 'user', content: `${inventory}Question: ${question}\\n\\nApproved knowledge:\\n${context}` }] }),",
    "  })",
    "  if (!response.ok) {",
    "    const detail = await response.text()",
    "    throw new Error(`OpenRouter answer generation failed: HTTP ${response.status}${detail ? ` - ${detail.slice(0, 500)}` : ''}`)",
    "  }",
    "  const data = await response.json()",
    "  const answer = typeof data.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content.trim() : ''",
  ].join("\n");
  const requestStart = next.indexOf("  const response = await fetch(`https://generativelanguage.googleapis.com");
  const requestEnd = next.indexOf("  const appKey = await variable", requestStart);
  if (requestStart < 0 || requestEnd < 0) throw new Error("Could not find the existing Gemini request block.");
  next = next.slice(0, requestStart) + newRequest + "\n" + next.slice(requestEnd);
  next = next.replaceAll("Gemini", "OpenRouter");
  return next;
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
  if (!currentResponse.ok) throw new Error(`Could not read Windmill script: HTTP ${currentResponse.status}`);
  const current = await currentResponse.json();
  const content = updateContent(current.content || "");
  if (content === current.content) {
    console.log("Windmill answer script already uses OpenRouter.");
    return;
  }
  const updateResponse = await fetch(`${base}/api/w/${encodeURIComponent(workspace)}/scripts/update/${encodeURIComponent(scriptPath)}`, {
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
      deployment_message: "Switch answer generation from Gemini to OpenRouter without changing embeddings",
    }),
  });
  const updateText = await updateResponse.text();
  if (!updateResponse.ok) throw new Error(`Could not update Windmill script: HTTP ${updateResponse.status} ${updateText.slice(0, 500)}`);
  console.log(`Windmill OpenRouter update accepted: ${updateResponse.status}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
