import { generateText } from "ai";
import { google } from "@ai-sdk/google";
import { MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH } from "@/lib/api-security";

export type AiAction = "summarize" | "rewrite" | "title";

// Stable Flash model as of mid-2026; override via GEMINI_MODEL without a deploy.
const MODEL_ID = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";

/** Cap prompt size so we never send huge docs to the model. */
const PROMPT_CONTENT_LIMIT = Math.min(MAX_CONTENT_LENGTH, 40_000);

function clipContent(content: string) {
  if (content.length <= PROMPT_CONTENT_LIMIT) return content;
  return `${content.slice(0, PROMPT_CONTENT_LIMIT)}\n\n[…truncated…]`;
}

function promptFor(action: AiAction, content: string) {
  const body = clipContent(content);
  switch (action) {
    case "summarize":
      return [
        "Summarize the following document in 3–5 concise bullet points.",
        "Keep the original language (Hindi, English, or mixed).",
        "Return only the bullet list, no preamble.",
        "",
        body,
      ].join("\n");
    case "rewrite":
      return [
        "Rewrite the following document to improve clarity and grammar.",
        "Preserve the original meaning, structure, and language (Hindi, English, or mixed).",
        "Do not add a title or commentary. Return only the rewritten document text.",
        "",
        body,
      ].join("\n");
    case "title":
      return [
        "Generate a short document title from the following content.",
        "Maximum 8 words. No quotes, no trailing punctuation.",
        "Keep the language of the document.",
        "Return only the title.",
        "",
        body,
      ].join("\n");
  }
}

export async function runDocumentAi(action: AiAction, content: string) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()) {
    throw new Error("AI is not configured. Set GOOGLE_GENERATIVE_AI_API_KEY.");
  }

  const { text } = await generateText({
    model: google(MODEL_ID),
    prompt: promptFor(action, content),
    temperature: action === "title" ? 0.4 : 0.5,
  });

  const cleaned = text.trim();
  if (!cleaned) {
    throw new Error("AI returned an empty response");
  }

  if (action === "title") {
    return cleaned
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/\s+/g, " ")
      .slice(0, MAX_TITLE_LENGTH);
  }

  if (action === "rewrite") {
    return cleaned.slice(0, MAX_CONTENT_LENGTH);
  }

  return cleaned;
}
