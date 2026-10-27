import mongoose from "mongoose";

import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

import {
  chatRequestSchema,
  aiResponseSchema,
} from "../validators/chatSchemas.js";

import { generateChatResponse } from "../services/aiService.js";

export async function createConversation(req, res) {
  try {
    const conversation = await Conversation.create({
      title: "New conversation",
    });

    return res.status(201).json(conversation);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Failed to create conversation",
    });
  }
}

export async function getConversations(req, res) {
  try {
    const conversations = await Conversation.find()
      .sort({ updatedAt: -1 })
      .limit(50)
      .lean();

    // For any conversation still titled "New conversation", find its first user message
    const populated = await Promise.all(
      conversations.map(async (conv) => {
        if (!conv.title || conv.title === "New conversation") {
          const firstMsg = await Message.findOne({
            conversationId: conv._id,
            role: "user",
          })
            .sort({ createdAt: 1 })
            .lean();

          if (firstMsg && firstMsg.content) {
            const questionTitle = firstMsg.content.trim().slice(0, 80);
            Conversation.updateOne({ _id: conv._id }, { title: questionTitle }).catch(() => {});
            return { ...conv, title: questionTitle };
          }
        }
        return conv;
      })
    );

    return res.json(populated);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Failed to load conversations",
    });
  }
}

export async function getMessages(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        error: "Invalid conversation ID",
      });
    }

    const conversation = await Conversation.findById(id);

    if (!conversation) {
      return res.status(404).json({
        error: "Conversation not found",
      });
    }

    const messages = await Message.find({
      conversationId: id,
    })
      .sort({ createdAt: 1 })
      .lean();

    return res.json(messages);
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Failed to load messages",
    });
  }
}

export async function sendMessage(req, res) {
  try {
    const validation = chatRequestSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: validation.error.issues,
      });
    }

    const { message, conversationId } = validation.data;

    let conversation;

    if (conversationId) {
      conversation = await Conversation.findById(conversationId);

      if (!conversation) {
        return res.status(404).json({
          error: "Conversation not found",
        });
      }

      // If conversation still has default placeholder title, set it to the user's question
      if (!conversation.title || conversation.title === "New conversation") {
        conversation.title = message.trim().slice(0, 80);
      }
    } else {
      conversation = await Conversation.create({
        title: message.trim().slice(0, 80),
      });
    }

    const userMessage = await Message.create({
      conversationId: conversation._id,
      role: "user",
      content: message,
    });

    const history = await Message.find({
      conversationId: conversation._id,
    })
      .sort({ createdAt: 1 })
      .lean();

    const modelMessages = history.map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content,
    }));

    // Setup Server-Sent Events (SSE) headers for real-time streaming
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    // Emit initial event with conversation ID and user message info
    res.write(
      `data: ${JSON.stringify({
        type: "start",
        conversationId: conversation._id,
        userMessage,
      })}\n\n`
    );

    const result = await generateChatResponse(modelMessages, req.signal);

    let streamedAnswer = "";
    let streamedMetadata = null;

    try {
      for await (const partial of result.partialOutputStream) {
        if (req.signal?.aborted) break;

        if (partial?.answer !== undefined && partial.answer !== streamedAnswer) {
          const delta = partial.answer.slice(streamedAnswer.length);
          streamedAnswer = partial.answer;

          if (partial.metadata) {
            streamedMetadata = partial.metadata;
          }

          res.write(
            `data: ${JSON.stringify({
              type: "delta",
              delta,
              accumulated: streamedAnswer,
              metadata: streamedMetadata,
            })}\n\n`
          );
        }
      }
    } catch (streamErr) {
      console.warn("Partial stream iteration note:", streamErr.message);
    }

    let finalAnswer = streamedAnswer;
    let finalMetadata = streamedMetadata;

    try {
      const generated = await result.output;
      if (generated?.answer) finalAnswer = generated.answer;
      if (generated?.metadata) finalMetadata = generated.metadata;
    } catch (outputErr) {
      console.warn("Final output parsed from stream fallback:", outputErr.message);
    }

    if (!finalMetadata) {
      finalMetadata = {
        topic: "General",
        intent: "other",
        sentiment: "neutral",
      };
    }

    const assistantMessage = await Message.create({
      conversationId: conversation._id,
      role: "assistant",
      content: finalAnswer || "No response generated.",
      metadata: finalMetadata,
    });

    conversation.updatedAt = new Date();
    await conversation.save();

    res.write(
      `data: ${JSON.stringify({
        type: "done",
        conversationId: conversation._id,
        message: assistantMessage,
      })}\n\n`
    );

    return res.end();
  } catch (error) {
    console.error("Chat generation error:", error);

    const errorMessage =
      error.statusCode === 429 ||
      error.data?.error?.code === "credit_balance_exhausted" ||
      error.data?.error?.type === "insufficient_quota"
        ? "AI service is temporarily unavailable. Please try again later."
        : error.message || "Failed to generate AI response.";

    if (res.headersSent) {
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error: errorMessage,
        })}\n\n`
      );
      return res.end();
    }

    return res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
}

export async function deleteConversation(req, res) {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        error: "Invalid conversation ID",
      });
    }

    await Message.deleteMany({ conversationId: id });
    await Conversation.findByIdAndDelete(id);

    return res.json({ success: true, message: "Conversation deleted" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Failed to delete conversation" });
  }
}

