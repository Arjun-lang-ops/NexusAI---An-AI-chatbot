import { useEffect, useRef, useState } from "react";
import "./App.css";

const API = "/api";

function App() {
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function loadConversations() {
    try {
      const response = await fetch(`${API}/conversations`);
      if (!response.ok) throw new Error("Failed to load conversations");
      const data = await response.json();
      setConversations(data);
    } catch (err) {
      setError(err.message);
    }
  }

  async function openConversation(id) {
    if (loading) return;
    try {
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

  async function deleteConversation(id, e) {
    e.stopPropagation();
    try {
      const response = await fetch(`${API}/conversations/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete conversation");

      setConversations((prev) => prev.filter((c) => c._id !== id));
      if (conversationId === id) {
        setConversationId(null);
        setMessages([]);
      }
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

    try {
      if (!activeConversationId) {
        const createRes = await fetch(`${API}/conversations`, { method: "POST" });
        if (!createRes.ok) throw new Error("Failed to create conversation");
        const newConv = await createRes.json();
        activeConversationId = newConv._id;
        newConv.title = message.slice(0, 75);
        setConversationId(activeConversationId);
        setConversations((prev) => [newConv, ...prev]);
      } else {
        // Immediately show the question in the sidebar if it was untitled/new
        setConversations((prev) =>
          prev.map((c) =>
            c._id === activeConversationId &&
            (!c.title || c.title === "New conversation")
              ? { ...c, title: message.slice(0, 75), updatedAt: new Date().toISOString() }
              : c
          )
        );
      }

      setMessages((prev) => [...prev, { role: "user", content: message }]);

      const response = await fetch(`${API}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, conversationId: activeConversationId }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || data.error || "Failed to generate AI response");
      }

      const data = await response.json();
      setMessages((prev) => [...prev, data.message]);
      await loadConversations();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
    return "New chat (ask anything)";
  }

  function copyToClipboard(text, id) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
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

  const filteredConversations = conversations.filter((c) => {
    if (!searchQuery.trim()) return true;
    const title = getConversationPreview(c).toLowerCase();
    return title.includes(searchQuery.toLowerCase());
  });

  const suggestions = [
    "Explain how neural networks learn in plain English",
    "Help me write a clean Express route with validation",
    "What are top 5 strategies to improve website performance?",
    "Generate a weekly study schedule for machine learning",
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
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
          >
            ‹
          </button>
        </div>

        <button className="new-chat-btn" onClick={createConversation}>
          <span className="plus-icon">+</span>
          <span>New Chat</span>
        </button>

        {/* Search Bar */}
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="search-input"
            placeholder="Search questions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="clear-search-btn"
              onClick={() => setSearchQuery("")}
            >
              ✕
            </button>
          )}
        </div>

        <div className="conversations-section">
          <div className="section-label-row">
            <span className="section-label">Recent Questions</span>
            <span className="conv-count">{filteredConversations.length}</span>
          </div>

          <div className="conversation-list">
            {filteredConversations.length === 0 ? (
              <p className="empty-hint">
                {searchQuery ? "No matching chats found" : "No chats yet. Start one!"}
              </p>
            ) : (
              filteredConversations.map((conversation) => (
                <div
                  key={conversation._id}
                  className={`conversation-item ${
                    conversation._id === conversationId ? "active" : ""
                  }`}
                  onClick={() => openConversation(conversation._id)}
                >
                  <div className="conv-icon">
                    💬
                  </div>
                  <div className="conv-body">
                    <span className="conv-title" title={getConversationPreview(conversation)}>
                      {getConversationPreview(conversation)}
                    </span>
                    <span className="conv-time">
                      {formatTime(conversation.updatedAt || conversation.createdAt)}
                    </span>
                  </div>
                  <button
                    className="delete-conv-btn"
                    title="Delete chat"
                    onClick={(e) => deleteConversation(conversation._id, e)}
                    aria-label="Delete chat"
                  >
                    🗑
                  </button>
                </div>
              ))
            )}
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
          <div className="header-title-box">
            <h2 className="header-title">
              {activeConversation
                ? getConversationPreview(activeConversation)
                : "New Discussion"}
            </h2>
            <span className="header-subtitle">
              {activeConversation ? "Active session" : "Ask any question to begin"}
            </span>
          </div>

          <div className="header-status">
            <div className={`status-dot ${loading ? "thinking" : "ready"}`}></div>
            <span className="status-label">{loading ? "Generating…" : "Online"}</span>
          </div>
        </header>

        <section className="messages" aria-label="Chat messages">
          {messages.length === 0 && !loading && (
            <div className="welcome-screen">
              <div className="welcome-icon">✦</div>
              <h1 className="welcome-title">What's on your mind?</h1>
              <p className="welcome-sub">
                Ask questions, explore topics, or pick an idea below to begin.
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
                    <span className="chip-arrow">↳</span>
                    <span>{s}</span>
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
                {message.role === "user" ? "You" : "✦"}
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
                  {message.role === "assistant" && (
                    <button
                      className="copy-btn"
                      onClick={() =>
                        copyToClipboard(message.content, message._id || index)
                      }
                      title="Copy response"
                    >
                      {copiedId === (message._id || index) ? "✓ Copied" : "📋 Copy"}
                    </button>
                  )}
                </div>
                <div className="message-content">
                  <p>{message.content}</p>
                </div>
                {message.metadata && (
                  <div className="metadata-pills">
                    {message.metadata.topic && (
                      <span className="meta-tag topic">
                        Topic: {message.metadata.topic}
                      </span>
                    )}
                    {message.metadata.intent && (
                      <span className="meta-tag intent">
                        Intent: {message.metadata.intent}
                      </span>
                    )}
                    {message.metadata.sentiment && (
                      <span className="meta-tag sentiment">
                        Tone: {message.metadata.sentiment}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </article>
          ))}

          {loading && (
            <article className="message assistant">
              <div className="message-avatar pulse-avatar">✦</div>
              <div className="message-body">
                <div className="message-meta">
                  <span className="message-author">NexusAI</span>
                  <span className="message-time">Thinking...</span>
                </div>
                <div className="message-content">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            </article>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <span className="error-icon">⚠</span>
              <span className="error-text">{error}</span>
              <button
                className="error-dismiss"
                onClick={() => setError("")}
                title="Dismiss"
              >
                ✕
              </button>
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
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize(e);
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask your question… (Press Enter to send, Shift+Enter for new line)"
                disabled={loading}
                rows={1}
                className="chat-input"
                aria-label="Message input"
              />
              <button
                type="submit"
                className={`send-btn ${input.trim() && !loading ? "active" : ""}`}
                disabled={loading || !input.trim()}
                aria-label="Send message"
                title="Send message"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              </button>
            </div>
            <div className="input-footer">
              <span className="input-hint">Enter to send · Shift+Enter for new line</span>
              {input.length > 0 && (
                <span className="char-count">{input.length} characters</span>
              )}
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

export default App;

