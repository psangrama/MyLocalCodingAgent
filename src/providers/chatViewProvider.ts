import * as vscode from 'vscode';
import { streamChat, listModels, Message } from '../services/ollamaService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'localCodingAgent.chatView';

  private _view?: vscode.WebviewView;
  private _abortController?: AbortController;
  private _isReady = false;
  private _pendingMessages: string[] = [];

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    this._isReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._buildHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          this._isReady = true;
          for (const content of this._pendingMessages) {
            this._post({ type: 'sendMessage', content });
          }
          this._pendingMessages = [];
          break;

        case 'sendMessage':
          await this._handleChat(msg.history as Message[]);
          break;

        case 'stopGeneration':
          this._abortController?.abort();
          break;

        case 'getModels':
          await this._sendModels();
          break;

        case 'setModel':
          await vscode.workspace
            .getConfiguration('localCodingAgent')
            .update('model', msg.model as string, vscode.ConfigurationTarget.Global);
          break;

        case 'insertCode':
          await this._insertCode(msg.code as string);
          break;

        case 'openSettings':
          await vscode.commands.executeCommand('workbench.action.openSettings', 'localCodingAgent');
          break;
      }
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this._sendModels();
      }
    });
  }

  /** Called from extension commands to auto-submit a prompt into the chat. */
  public sendPrompt(content: string): void {
    if (this._view && this._isReady) {
      this._post({ type: 'sendMessage', content });
    } else {
      this._pendingMessages.push(content);
    }
  }

  public clearChat(): void {
    this._post({ type: 'clearChat' });
  }

  private _post(msg: object): void {
    this._view?.webview.postMessage(msg);
  }

  private async _sendModels(): Promise<void> {
    const currentModel = vscode.workspace
      .getConfiguration('localCodingAgent')
      .get<string>('model', 'codellama');
    const list = await listModels();
    this._post({ type: 'models', list, current: currentModel });
  }

  private async _handleChat(history: Message[]): Promise<void> {
    this._abortController = new AbortController();
    this._post({ type: 'startMessage' });

    let hadError = false;

    await streamChat(
      history,
      (text) => this._post({ type: 'appendChunk', content: text }),
      (message) => {
        hadError = true;
        this._post({ type: 'error', message });
      },
      this._abortController.signal,
    );

    if (!hadError) {
      this._post({ type: 'endMessage' });
    }
  }

  private async _insertCode(code: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('No active editor — open a file and place your cursor first.');
      return;
    }
    await editor.edit((eb) => {
      if (editor.selection.isEmpty) {
        eb.insert(editor.selection.active, code);
      } else {
        eb.replace(editor.selection, code);
      }
    });
    await vscode.window.showTextDocument(editor.document);
  }

  private _buildHtml(): string {
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
*{box-sizing:border-box;margin:0;padding:0}

body{
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size);
  color:var(--vscode-foreground);
  background:var(--vscode-sideBar-background,#1e1e1e);
  height:100vh;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}

/* ── Header ── */
#header{
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding:6px 10px;
  background:var(--vscode-sideBarSectionHeader-background);
  border-bottom:1px solid var(--vscode-sideBarSectionHeader-border,#333);
  flex-shrink:0;
  gap:6px;
}
#model-info{display:flex;align-items:center;gap:5px;min-width:0;flex:1}
#model-label{font-size:11px;color:var(--vscode-descriptionForeground);white-space:nowrap}
#model-select{
  background:var(--vscode-dropdown-background);
  color:var(--vscode-dropdown-foreground);
  border:1px solid var(--vscode-dropdown-border,#555);
  border-radius:3px;
  padding:2px 4px;
  font-size:11px;
  min-width:0;
  flex:1;
  cursor:pointer;
}
.header-btn{
  background:transparent;
  border:1px solid transparent;
  color:var(--vscode-descriptionForeground);
  cursor:pointer;
  padding:3px 7px;
  border-radius:3px;
  font-size:11px;
  white-space:nowrap;
  flex-shrink:0;
}
.header-btn:hover{background:var(--vscode-toolbar-hoverBackground);color:var(--vscode-foreground)}

/* ── Messages ── */
#messages{
  flex:1;
  overflow-y:auto;
  padding:10px 10px 0;
  display:flex;
  flex-direction:column;
  gap:10px;
}
.message{display:flex;flex-direction:column;gap:3px}
.role-label{
  font-size:10px;
  font-weight:700;
  text-transform:uppercase;
  letter-spacing:.6px;
}
.message.user .role-label{color:var(--vscode-charts-blue,#569cd6)}
.message.assistant .role-label{color:var(--vscode-charts-green,#4ec9b0)}
.message.error-msg .role-label{color:var(--vscode-errorForeground)}

.msg-body{line-height:1.55;word-break:break-word;font-size:13px}
.message.user .msg-body{
  background:var(--vscode-input-background);
  border-left:2px solid var(--vscode-charts-blue,#569cd6);
  border-radius:0 4px 4px 0;
  padding:7px 10px;
  white-space:pre-wrap;
}
.message.error-msg .msg-body{
  background:var(--vscode-inputValidation-errorBackground);
  border:1px solid var(--vscode-inputValidation-errorBorder);
  border-radius:4px;
  padding:7px 10px;
}

/* ── Markdown elements ── */
p{margin:4px 0}
p:first-child{margin-top:0}
p:last-child{margin-bottom:0}
h1,h2,h3,h4{margin:8px 0 4px;line-height:1.3}
h1{font-size:1.25em}h2{font-size:1.15em}h3{font-size:1.05em}
ul,ol{padding-left:18px;margin:4px 0}
li{margin:2px 0}
strong{font-weight:600}
em{font-style:italic}
hr{border:none;border-top:1px solid var(--vscode-editorWidget-border,#444);margin:8px 0}

code{
  font-family:var(--vscode-editor-font-family,'Courier New',monospace);
  font-size:.88em;
  background:var(--vscode-textCodeBlock-background,#2d2d2d);
  padding:1px 4px;
  border-radius:3px;
}

/* ── Code blocks ── */
.code-block{
  margin:6px 0;
  border:1px solid var(--vscode-editorWidget-border,#3c3c3c);
  border-radius:5px;
  overflow:hidden;
}
.code-header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:3px 10px;
  background:var(--vscode-editorGroupHeader-tabsBackground,#2d2d2d);
  font-size:11px;
  color:var(--vscode-descriptionForeground);
}
.code-btns{display:flex;gap:4px}
.cbtn{
  background:transparent;
  border:1px solid var(--vscode-button-secondaryBorder,#555);
  color:var(--vscode-descriptionForeground);
  cursor:pointer;
  padding:2px 8px;
  border-radius:3px;
  font-size:11px;
}
.cbtn:hover{background:var(--vscode-button-secondaryHoverBackground);color:var(--vscode-foreground)}
pre{
  margin:0;
  padding:10px 12px;
  overflow-x:auto;
  background:var(--vscode-editor-background,#1e1e1e);
}
pre code{
  background:none;
  padding:0;
  font-family:var(--vscode-editor-font-family,'Courier New',monospace);
  font-size:var(--vscode-editor-font-size,13px);
  line-height:1.5;
}

/* ── Thinking dots ── */
.thinking{display:flex;gap:5px;padding:6px 0;align-items:center}
.dot{width:7px;height:7px;border-radius:50%;background:var(--vscode-charts-green,#4ec9b0);animation:blink 1.2s infinite}
.dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.2;transform:scale(.75)}40%{opacity:1;transform:scale(1)}}

/* ── Empty state ── */
#empty-state{
  display:flex;
  flex-direction:column;
  align-items:center;
  justify-content:center;
  text-align:center;
  gap:8px;
  padding:24px 16px;
  color:var(--vscode-descriptionForeground);
  height:100%;
}
#empty-state h3{color:var(--vscode-foreground);font-size:15px;font-weight:600}
#empty-state p{font-size:12px;line-height:1.55;max-width:280px}
.chips{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin-top:8px}
.chip{
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
  border:1px solid var(--vscode-button-secondaryBorder,#555);
  padding:4px 10px;
  border-radius:12px;
  font-size:11px;
  cursor:pointer;
}
.chip:hover{background:var(--vscode-button-secondaryHoverBackground)}

/* ── Input area ── */
#input-area{
  padding:8px 10px 10px;
  border-top:1px solid var(--vscode-sideBarSectionHeader-border,#333);
  display:flex;
  flex-direction:column;
  gap:5px;
  flex-shrink:0;
  background:var(--vscode-sideBar-background);
}
#input{
  width:100%;
  min-height:58px;
  max-height:180px;
  background:var(--vscode-input-background);
  color:var(--vscode-input-foreground);
  border:1px solid var(--vscode-input-border,#555);
  border-radius:4px;
  padding:7px 9px;
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size);
  resize:vertical;
  line-height:1.4;
}
#input:focus{outline:none;border-color:var(--vscode-focusBorder)}
#input-row{display:flex;justify-content:space-between;align-items:center}
#input-hint{font-size:11px;color:var(--vscode-descriptionForeground)}
#btn-row{display:flex;gap:5px}
#send-btn,#stop-btn{
  padding:4px 14px;
  border:none;
  border-radius:3px;
  cursor:pointer;
  font-size:12px;
  font-weight:500;
}
#send-btn{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}
#send-btn:hover{background:var(--vscode-button-hoverBackground)}
#send-btn:disabled{opacity:.5;cursor:default}
#stop-btn{
  background:var(--vscode-statusBarItem-errorBackground,#c72e0f);
  color:#fff;
  display:none;
}
#stop-btn:hover{opacity:.88}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--vscode-scrollbarSlider-background);border-radius:3px}
::-webkit-scrollbar-thumb:hover{background:var(--vscode-scrollbarSlider-hoverBackground)}
</style>
</head>
<body>

<div id="header">
  <div id="model-info">
    <span id="model-label">Model</span>
    <select id="model-select" title="Select Ollama model"></select>
  </div>
  <button class="header-btn" id="settings-btn" title="Open settings">⚙</button>
  <button class="header-btn" id="new-chat-btn" title="New chat">＋ New</button>
</div>

<div id="messages">
  <div id="empty-state">
    <h3>Local Coding Agent</h3>
    <p>Ask questions about code, or select code in the editor and right-click for quick actions.</p>
    <div class="chips">
      <span class="chip" data-prompt="Explain the selected code in detail.">Explain code</span>
      <span class="chip" data-prompt="Find and fix all bugs or issues in this code.">Fix bugs</span>
      <span class="chip" data-prompt="Write unit tests for this code.">Write tests</span>
      <span class="chip" data-prompt="How can I improve and optimise this code?">Improve code</span>
    </div>
  </div>
</div>

<div id="input-area">
  <textarea id="input" placeholder="Ask anything… (Enter to send, Shift+Enter for new line)"></textarea>
  <div id="input-row">
    <span id="input-hint">⏎ Send  ⇧⏎ New line</span>
    <div id="btn-row">
      <button id="stop-btn" title="Stop generation">■ Stop</button>
      <button id="send-btn" title="Send message">Send</button>
    </div>
  </div>
</div>

<script>
(function() {
  const vscode = acquireVsCodeApi();

  // ── DOM refs ──
  const messagesEl  = document.getElementById('messages');
  const inputEl     = document.getElementById('input');
  const sendBtn     = document.getElementById('send-btn');
  const stopBtn     = document.getElementById('stop-btn');
  const newChatBtn  = document.getElementById('new-chat-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const modelSelect = document.getElementById('model-select');
  const emptyState  = document.getElementById('empty-state');

  // ── State ──
  let history = [];        // [{role, content}]
  let streaming = false;
  let currentMsgBody = null;
  let currentRaw = '';

  // ── Init ──
  vscode.postMessage({ type: 'ready' });
  vscode.postMessage({ type: 'getModels' });

  // ── Event listeners ──
  inputEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!streaming) send(); }
  });
  inputEl.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
  });
  sendBtn.addEventListener('click', send);
  stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stopGeneration' }));
  newChatBtn.addEventListener('click', clearChat);
  settingsBtn.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
  modelSelect.addEventListener('change', () => vscode.postMessage({ type: 'setModel', model: modelSelect.value }));

  // Suggestion chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      inputEl.value = chip.dataset.prompt;
      send();
    });
  });

  // Code block action delegation
  messagesEl.addEventListener('click', e => {
    const target = e.target;
    if (!target.classList.contains('cbtn')) return;
    const block = target.closest('.code-block');
    if (!block) return;
    const codeEl = block.querySelector('pre code');
    const text = codeEl ? codeEl.textContent : '';

    if (target.dataset.action === 'copy') {
      navigator.clipboard.writeText(text).then(() => {
        const orig = target.textContent;
        target.textContent = 'Copied!';
        setTimeout(() => { target.textContent = orig; }, 1400);
      });
    } else if (target.dataset.action === 'insert') {
      vscode.postMessage({ type: 'insertCode', code: text });
    }
  });

  // ── Core functions ──
  function send() {
    const content = inputEl.value.trim();
    if (!content || streaming) return;

    inputEl.value = '';
    inputEl.style.height = '';
    hideEmptyState();

    addUserMessage(content);
    history.push({ role: 'user', content });
    vscode.postMessage({ type: 'sendMessage', history: history.slice() });
    setStreaming(true);
  }

  function clearChat() {
    history = [];
    streaming = false;
    currentMsgBody = null;
    currentRaw = '';
    messagesEl.innerHTML = '';
    messagesEl.appendChild(emptyState);
    emptyState.style.display = 'flex';
    setStreaming(false);
  }

  function hideEmptyState() {
    if (emptyState.parentNode) emptyState.style.display = 'none';
  }

  function setStreaming(on) {
    streaming = on;
    sendBtn.disabled = on;
    stopBtn.style.display = on ? 'inline-block' : 'none';
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ── Message rendering ──
  function addUserMessage(content) {
    const el = makeMessageEl('user');
    el.querySelector('.msg-body').textContent = content;
    messagesEl.appendChild(el);
    scrollBottom();
  }

  function makeMessageEl(role) {
    const wrap = document.createElement('div');
    wrap.className = 'message ' + role;
    const lbl = document.createElement('div');
    lbl.className = 'role-label';
    lbl.textContent = role === 'user' ? 'You' : role === 'assistant' ? 'Assistant' : 'Error';
    const body = document.createElement('div');
    body.className = 'msg-body';
    wrap.appendChild(lbl);
    wrap.appendChild(body);
    return wrap;
  }

  // ── Markdown renderer ──
  function renderMarkdown(raw) {
    if (!raw) return thinkingDots();

    let result = '';

    // Manual split to handle both closed and unclosed code blocks
    const segments = splitCodeBlocks(raw);
    for (const seg of segments) {
      if (seg.type === 'text') {
        result += renderText(seg.value);
      } else {
        result += renderCodeBlock(seg.lang, seg.code);
      }
    }
    return result || thinkingDots();
  }

  function splitCodeBlocks(text) {
    const segments = [];
    let i = 0;
    while (i < text.length) {
      const tick = text.indexOf('\`\`\`', i);
      if (tick === -1) {
        segments.push({ type: 'text', value: text.slice(i) });
        break;
      }
      if (tick > i) segments.push({ type: 'text', value: text.slice(i, tick) });

      // Find end of first line (language identifier)
      const nl = text.indexOf('\\n', tick + 3);
      const lang = nl === -1 ? text.slice(tick + 3).trim() : text.slice(tick + 3, nl).trim();

      const codeStart = nl === -1 ? text.length : nl + 1;
      const closeTickIdx = text.indexOf('\`\`\`', codeStart);

      if (closeTickIdx === -1) {
        // Unclosed — rest of text is code (streaming)
        segments.push({ type: 'code', lang, code: text.slice(codeStart) });
        i = text.length;
      } else {
        segments.push({ type: 'code', lang, code: text.slice(codeStart, closeTickIdx) });
        i = closeTickIdx + 3;
      }
    }
    return segments;
  }

  function renderText(text) {
    // HTML escape first
    let h = esc(text);

    // Bold + italic
    h = h.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
    h = h.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    h = h.replace(/__(.+?)__/g, '<strong>$1</strong>');
    h = h.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
    h = h.replace(/_(.+?)_/g, '<em>$1</em>');

    // Inline code (backtick was escaped to &amp; — use original)
    // We need to handle this on raw text before esc, so let's replace inline code first
    // Actually, we already HTML-escaped, so backticks are still literal. Safe:
    h = h.replace(/\`([^\`\\n]+?)\`/g, '<code>$1</code>');

    // Headers
    h = h.replace(/^#{4}\\s+(.+)$/gm, '<h4>$1</h4>');
    h = h.replace(/^#{3}\\s+(.+)$/gm, '<h3>$1</h3>');
    h = h.replace(/^#{2}\\s+(.+)$/gm, '<h2>$1</h2>');
    h = h.replace(/^#\\s+(.+)$/gm, '<h1>$1</h1>');

    // Horizontal rule
    h = h.replace(/^[-*_]{3,}$/gm, '<hr>');

    // Unordered lists (gather consecutive items)
    h = h.replace(/^[ \\t]*[-*+]\\s+(.+)$/gm, '<li>$1</li>');
    h = h.replace(/(<li>[\\s\\S]*?<\\/li>\\n?)+/g, m => '<ul>' + m + '</ul>');

    // Ordered lists
    h = h.replace(/^[ \\t]*\\d+\\.\\s+(.+)$/gm, '<li>$1</li>');

    // Paragraphs
    const blocks = h.split(/\\n{2,}/);
    h = blocks.map(b => {
      b = b.trim();
      if (!b) return '';
      if (/^<(h[1-6]|ul|ol|li|hr|pre|div)/.test(b)) return b;
      return '<p>' + b.replace(/\\n/g, '<br>') + '</p>';
    }).filter(Boolean).join('');

    return h;
  }

  function renderCodeBlock(lang, code) {
    const langLabel = esc(lang || 'code');
    const escapedCode = esc(code);
    return \`<div class="code-block">
  <div class="code-header">
    <span>\${langLabel}</span>
    <div class="code-btns">
      <button class="cbtn" data-action="copy">Copy</button>
      <button class="cbtn" data-action="insert">Insert</button>
    </div>
  </div>
  <pre><code>\${escapedCode}</code></pre>
</div>\`;
  }

  function thinkingDots() {
    return '<div class="thinking"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>';
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Extension → webview messages ──
  window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.type) {

      case 'sendMessage': {
        // Triggered by a code-action command in the editor
        inputEl.value = msg.content;
        send();
        break;
      }

      case 'startMessage': {
        currentRaw = '';
        const el = makeMessageEl('assistant');
        currentMsgBody = el.querySelector('.msg-body');
        currentMsgBody.innerHTML = thinkingDots();
        hideEmptyState();
        messagesEl.appendChild(el);
        scrollBottom();
        break;
      }

      case 'appendChunk': {
        currentRaw += msg.content;
        if (currentMsgBody) {
          currentMsgBody.innerHTML = renderMarkdown(currentRaw);
          scrollBottom();
        }
        break;
      }

      case 'endMessage': {
        if (currentMsgBody && currentRaw) {
          currentMsgBody.innerHTML = renderMarkdown(currentRaw);
          history.push({ role: 'assistant', content: currentRaw });
        }
        currentMsgBody = null;
        currentRaw = '';
        setStreaming(false);
        scrollBottom();
        break;
      }

      case 'error': {
        if (currentMsgBody) {
          currentMsgBody.closest('.message').className = 'message error-msg';
          currentMsgBody.closest('.message').querySelector('.role-label').textContent = 'Error';
          currentMsgBody.textContent = msg.message;
        } else {
          const el = makeMessageEl('error-msg');
          el.querySelector('.role-label').textContent = 'Error';
          el.querySelector('.msg-body').textContent = msg.message;
          hideEmptyState();
          messagesEl.appendChild(el);
        }
        currentMsgBody = null;
        currentRaw = '';
        setStreaming(false);
        scrollBottom();
        break;
      }

      case 'clearChat': {
        clearChat();
        break;
      }

      case 'models': {
        const current = msg.current || 'codellama';
        modelSelect.innerHTML = '';
        const models = msg.list && msg.list.length > 0 ? msg.list : [current];
        models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m;
          opt.textContent = m;
          if (m === current) opt.selected = true;
          modelSelect.appendChild(opt);
        });
        // If current isn't in list, add it
        if (models.indexOf(current) === -1) {
          const opt = document.createElement('option');
          opt.value = current;
          opt.textContent = current;
          opt.selected = true;
          modelSelect.insertBefore(opt, modelSelect.firstChild);
        }
        break;
      }
    }
  });
})();
</script>
</body>
</html>`;
  }
}
