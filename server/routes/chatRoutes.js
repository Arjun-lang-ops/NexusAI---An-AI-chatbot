import express from "express";

import {
  createConversation,
  getConversations,
  getMessages,
  sendMessage,
  deleteConversation,
} from "../controllers/chatController.js";

const router = express.Router();

router.post("/conversations", createConversation);

router.get("/conversations", getConversations);

router.delete("/conversations/:id", deleteConversation);

router.get(
  "/conversations/:id/messages",
  getMessages
);

router.post("/chat", sendMessage);

export default router;