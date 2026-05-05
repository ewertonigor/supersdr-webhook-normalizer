import OpenAI from "openai";
import { z } from "zod";
import { config } from "../config.js";
import { INTENT_SYSTEM_PROMPT, INTENT_TAXONOMY, type IntentLabel } from "./prompts.js";

/**
 * OpenAI structured-output intent classifier.
 *
 * Why structured output (response_format: json_schema) instead of free-text
 * prompting + parsing?
 *  - The model returns valid JSON every time, never a half-formed string.
 *  - The same Zod schema validates compile-time types AND runtime payload.
 *  - Refusals come back as a typed `refusal` field — no scraping prose.
 *
 * Failure modes the caller must handle:
 *  - Network / API error → throws (retried by the processor)
 *  - Refusal → throws with a descriptive message (logged, message keeps
 *    intent_classified_at = null)
 *  - Confidence < 0.4 → returned as-is; the caller can decide whether to act
 */

const IntentResponse = z.object({
  intent: z.enum(INTENT_TAXONOMY),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500).optional(),
});

export type Intent = {
  label: IntentLabel;
  confidence: number;
  reasoning?: string;
};

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return client;
}

export async function classifyIntent(args: { content: string }): Promise<Intent> {
  if (!args.content.trim()) {
    return { label: "outro", confidence: 0.3 };
  }

  const completion = await getClient().chat.completions.create({
    model: config.OPENAI_MODEL,
    temperature: 0.1, // determinism > creativity for classification
    max_tokens: 200,
    messages: [
      { role: "system", content: INTENT_SYSTEM_PROMPT },
      { role: "user", content: args.content },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "intent_classification",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            intent: { type: "string", enum: [...INTENT_TAXONOMY] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reasoning: { type: "string" },
          },
          required: ["intent", "confidence", "reasoning"],
        },
      },
    },
  });

  const choice = completion.choices[0];
  if (!choice) throw new Error("OpenAI returned no choice");

  if (choice.message.refusal) {
    throw new Error(`OpenAI refused classification: ${choice.message.refusal}`);
  }

  const raw = choice.message.content;
  if (!raw) throw new Error("OpenAI returned empty content");

  const parsed = IntentResponse.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`OpenAI response did not match schema: ${parsed.error.message}`);
  }

  return {
    label: parsed.data.intent,
    confidence: parsed.data.confidence,
    reasoning: parsed.data.reasoning,
  };
}
