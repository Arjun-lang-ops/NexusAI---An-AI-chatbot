import { z } from "zod";

export const chatRequestSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(4000, "Message is too long"),

  conversationId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .optional(),
});

export const metadataSchema = z
  .object({
    topic: z.string().min(1).max(100).catch("General"),

    intent: z
      .enum([
        "question",
        "explanation",
        "coding",
        "summarization",
        "greeting",
        "other",
      ])
      .catch("other"),

    sentiment: z.enum(["positive", "neutral", "negative"]).catch("neutral"),
  })
  .passthrough();

export const aiResponseSchema = z
  .object({
    answer: z.string().min(1).max(20000),
    metadata: metadataSchema.optional().default({
      topic: "General",
      intent: "other",
      sentiment: "neutral",
    }),
  });
