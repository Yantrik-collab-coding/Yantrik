/**
 * HOW TO INTEGRATE ChatPanel into ProjectPage.tsx
 * ─────────────────────────────────────────────────
 * 1. Add this import at the top of ProjectPage.tsx:
 *
 *    import ChatPanel from '../components/ChatPanel'
 *
 * 2. Find the entire right-side chat div in ProjectPage.tsx
 *    (the one starting with the comment "── Right: Chat panel ──")
 *    and REPLACE it with the <ChatPanel /> usage below.
 *
 * 3. The `member` avatar_color lookup must happen before render.
 *    Add this helper inside ProjectPage (above the return):
 */

// ─── Add this inside ProjectPage, before the return statement ────────────────

/*
  // Enrich messages with avatar_color from project members before passing to ChatPanel
  const enrichedMessages = messages.map(msg => {
    if (msg.is_agent || msg.type === 'system' || msg.type === 'agent_error') return msg
    const member = project?.members.find(m => m.username === msg.author_name)
    return { ...msg, avatar_color: msg.avatar_color || member?.avatar_color }
  })
*/

// ─── Replace the entire right panel div with this ────────────────────────────

/*
  {/* Resize handle: middle | chat ── already exists, keep it *\/}
  <ResizeHandle direction="horizontal" onMouseDown={chat.handleMouseDown} />

  {/* Right: Chat panel *\/}
  <div style={{
    width: chat.size,
    flexShrink: 0,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column'
  }}>
    <ChatPanel
      messages={enrichedMessages}
      agentTyping={agentTyping}
      activeJobs={activeJobs}
      connected={connected}
      project={project}
      currentUserId={user?.id}
      models={models}
      noKeyBanner={noKeyBanner}
      input={input}
      onInputChange={setInput}
      onSend={sendMessage}
      onReviewDiff={(diffId) => { setReviewDiffId(diffId); setShowDiffPanel(true) }}
      onDismissBanner={() => setNoKeyBanner(null)}
      onNavigateProfile={() => navigate('/profile')}
      inputRef={inputRef}
    />
  </div>
*/

// ─── Also remove from ProjectPage ────────────────────────────────────────────
// Remove the activePanel / Panel type state — ChatPanel handles its own layout.
// Remove the noKeyBanner JSX that was inline in the old chat div.
// Remove the <style> typing-dot block if it was inline — ChatPanel injects its own.
// The sendMessage() function stays in ProjectPage as-is.
// The inputRef stays in ProjectPage as-is (passed down as a prop).
