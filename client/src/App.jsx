import { useEffect, useRef, useState } from "react";
import "./App.css";

const API = "/api";

const DEFAULT_TITLE = "New conversation";
const isDefaultTitle = (t) => !t || t === DEFAULT_TITLE;
const makeTitle = (text) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 40 ? clean.slice(0, 40).trimEnd() + "…" : clean;
};

function App() {
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const abortControllerRef = useRef(null);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  function stopGeneration() {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.isStreaming ? { ...msg, isStreaming: false } : msg
      )
    );
  }

  async function loadConversations() {
    try {
      const response = await fetch(`${API}/conversations`);
      if (!response.ok) throw new Error("Failed to load conversations");
      const data = await response.json();
      setConversations((prev) =>
        data.map((c) => {
          if (!isDefaultTitle(c.title)) return c;
          const local = prev.find((p) => p._id === c._id);
          return local && !isDefaultTitle(local.title)
            ? { ...c, title: local.title }
            : c;
        })
      );
    } catch (err) {
      setError(err.message);
    }
  }

  async function openConversation(id) {
    try {
      stopGeneration();
      setError("");
      const response = await fetch(`${API}/conversations/${id}/messages`);
      if (!response.ok) throw new Error("Failed to load messages");
      const data = await response.json();
      setConversationId(id);
      setMessages(data);
      inputRef.current?.focus();
    } catch (err) {
      setError(err.message);
    }
  }

  async function createConversation() {
    try {
      stopGeneration();
      const response = await fetch(`${API}/conversations`, { method: "POST" });
      if (!response.ok) throw new Error("Failed to create conversation");
      const conversation = await response.json();
      setConversations((prev) => [conversation, ...prev]);
      setConversationId(conversation._id);
      setMessages([]);
      inputRef.current?.focus();
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendMessage(event) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || loading) return;

    setError("");
    setInput("");
    setLoading(true);

    let activeConversationId = conversationId;
    const tempAssistantId = "temp-" + Date.now();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: message, createdAt: new Date().toISOString() },
        {
          _id: tempAssistantId,
          role: "assistant",
          content: "",
          isStreaming: true,
          createdAt: new Date().toISOString(),
        },
      ]);

      if (activeConversationId) {
        setConversations((prev) =>
          prev.map((c) =>
            c._id === activeConversationId && isDefaultTitle(c.title)
              ? { ...c, title: makeTitle(message) }
              : c
          )
        );
      }

      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, conversationId: activeConversationId }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || data.error || "Failed to generate AI response");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          const trimmed = block.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.replace(/^data:\s*/, "");
          if (!jsonStr) continue;

          try {
            const eventData = JSON.parse(jsonStr);

            if (eventData.type === "start") {
              if (eventData.conversationId) {
                activeConversationId = eventData.conversationId;
                setConversationId(eventData.conversationId);
                setConversations((prev) => {
                  const exists = prev.some((c) => c._id === eventData.conversationId);
                  if (!exists) {
                    return [
                      {
                        _id: eventData.conversationId,
                        title: makeTitle(message),
                        updatedAt: new Date().toISOString(),
                      },
                      ...prev,
                    ];
                  }
                  return prev.map((c) =>
                    c._id === eventData.conversationId && isDefaultTitle(c.title)
                      ? { ...c, title: makeTitle(message) }
                      : c
                  );
                });
              }
            } else if (eventData.type === "delta") {
              setMessages((prev) =>
                prev.map((m) =>
                  m._id === tempAssistantId
                    ? {
                        ...m,
                        content: eventData.accumulated,
                        metadata: eventData.metadata || m.metadata,
                      }
                    : m
                )
              );
            } else if (eventData.type === "done") {
              setMessages((prev) =>
                prev.map((m) => (m._id === tempAssistantId ? eventData.message : m))
              );
              await loadConversations();
            } else if (eventData.type === "error") {
              throw new Error(eventData.error || "Generation error");
            }
          } catch (parseErr) {
            if (parseErr.message !== "Generation error") {
              console.warn("SSE parse error:", parseErr);
            } else {
              throw parseErr;
            }
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") {
        // Stop generation requested by user
      } else {
        setError(err.message || "Failed to generate AI response");
        setMessages((prev) =>
          prev.filter((m) => m._id !== tempAssistantId || m.content)
        );
      }
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
      setMessages((prev) =>
        prev.map((m) =>
          m.isStreaming ? { ...m, isStreaming: false } : m
        )
      );
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function autoResize(e) {
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }

  function getConversationPreview(conversation) {
    if (conversation.title && conversation.title !== "New conversation") {
      return conversation.title;
    }
    return "New conversation";
  }

  function formatTime(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMins = Math.floor((now - date) / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function formatMessageTime(dateStr) {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  const activeConversation = conversations.find((c) => c._id === conversationId);

  const suggestions = [
    "Explain quantum computing simply",
    "Write a Python web scraper",
    "What are the best productivity tips?",
    "Summarize the history of the internet",
  ];

  return (
    <div className={`app ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <span className="brand-icon">✦</span>
            <span className="brand-name">NexusAI</span>
          </div>
          <button
            className="icon-btn"
            onClick={() => setSidebarOpen(false)}
            title="Close sidebar"
            aria-label="Close sidebar"
          >
            ‹
          </button>
        </div>

        <button className="new-chat-btn" onClick={createConversation}>
          <span>+</span>
          <span>New Chat</span>
        </button>

        <div className="conversations-section">
          <p className="section-label">Recent Chats</p>
          <div className="conversation-list">
            {conversations.length === 0 && (
              <p className="empty-hint">No conversations yet.</p>
            )}
            {conversations.map((conversation) => (
              <button
                key={conversation._id}
                className={`conversation-item ${conversation._id === conversationId ? "active" : ""}`}
                onClick={() => openConversation(conversation._id)}
              >
                <div className="conv-icon">
                  {conversation.title && conversation.title !== "New conversation"
                    ? conversation.title.charAt(0).toUpperCase()
                    : "✦"}
                </div>
                <div className="conv-body">
                  <span className="conv-title">{getConversationPreview(conversation)}</span>
                  <span className="conv-time">{formatTime(conversation.updatedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Chat */}
      <main className="chat">
        <header className="chat-header">
          {!sidebarOpen && (
            <button
              className="icon-btn open-sidebar-btn"
              onClick={() => setSidebarOpen(true)}
              title="Open sidebar"
              aria-label="Open sidebar"
            >
              ›
            </button>
          )}
          <div className="header-title">
            {activeConversation
              ? getConversationPreview(activeConversation)
              : "NexusAI Chat"}
          </div>
          <div className="header-status">
            <div className={`status-dot ${loading ? "thinking" : "ready"}`}></div>
            <span className="status-label">{loading ? "Streaming…" : "Ready"}</span>
          </div>
        </header>

        <section className="messages" aria-label="Chat messages">
          {messages.length === 0 && !loading && (
            <div className="welcome-screen">
              <div className="welcome-icon">✦</div>
              <h1 className="welcome-title">How can I help you?</h1>
              <p className="welcome-sub">
                Ask me anything — I remember our conversation context.
              </p>
              <div className="suggestion-grid">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    className="suggestion-chip"
                    onClick={() => {
                      setInput(s);
                      inputRef.current?.focus();
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <article
              className={`message ${message.role}`}
              key={message._id || index}
            >
              <div className="message-avatar">
                {message.role === "user" ? "U" : "✦"}
              </div>
              <div className="message-body">
                <div className="message-meta">
                  <span className="message-author">
                    {message.role === "user" ? "You" : "NexusAI"}
                  </span>
                  {message.createdAt && (
                    <span className="message-time">
                      {formatMessageTime(message.createdAt)}
                    </span>
                  )}
                </div>
                <div className="message-content">
                  {message.isStreaming && !message.content ? (
                    <div className="typing-indicator">
                      <span></span><span></span><span></span>
                    </div>
                  ) : (
                    <p>
                      {message.content}
                      {message.isStreaming && (
                        <span className="streaming-cursor" aria-hidden="true">▍</span>
                      )}
                    </p>
                  )}
                </div>
                {message.metadata && (
                  <div className="metadata-pills">
                    {message.metadata.topic && (
                      <span className="meta-tag topic">{message.metadata.topic}</span>
                    )}
                    {message.metadata.intent && (
                      <span className="meta-tag intent">{message.metadata.intent}</span>
                    )}
                    {message.metadata.sentiment && (
                      <span className="meta-tag sentiment">{message.metadata.sentiment}</span>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}

          {error && (
            <div className="error-banner" role="alert">
              <span>⚠ {error}</span>
              <button className="error-dismiss" onClick={() => setError("")}>✕</button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </section>

        <div className="input-area">
          <form onSubmit={sendMessage} className="input-form">
            <div className="input-wrapper">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); autoResize(e); }}
                onKeyDown={handleKeyDown}
                placeholder="Message NexusAI… (Shift+Enter for new line)"
                rows={1}
                className="chat-input"
                aria-label="Message input"
              />
              {loading ? (
                <button
                  type="button"
                  className="send-btn stop-btn active"
                  onClick={stopGeneration}
                  aria-label="Stop generating"
                  title="Stop generating"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  className={`send-btn ${input.trim() ? "active" : ""}`}
                  disabled={!input.trim()}
                  aria-label="Send message"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              )}
            </div>
            <p className="input-hint">Enter to send · Shift+Enter for new line</p>
          </form>
        </div>
      </main>
    </div>
  );
}

export default App;
