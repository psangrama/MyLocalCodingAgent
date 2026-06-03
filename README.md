# Local Coding Agent

A privacy-first AI coding assistant for Visual Studio Code — powered entirely by your local [Ollama](https://ollama.ai) models. No API keys, no cloud, no data leaving your machine.

Works like GitHub Copilot Chat or Claude Code: sidebar chat, streaming responses, right-click code actions, and a one-click **Insert** button to put generated code straight into your editor.

---

## Features

### Sidebar Chat Panel
Ask any coding question in natural language. Responses stream in token-by-token, with full Markdown rendering — headers, bold text, bullet lists, and syntax-highlighted code blocks.

### Right-Click Code Actions
Select any code in the editor, right-click, and choose an action under the **Local Agent** group:

| Action | What it does |
|--------|-------------|
| **Explain Code** | Detailed explanation of what the code does and how it works |
| **Fix Code** | Finds bugs, explains what was wrong, and returns corrected code |
| **Refactor Code** | Cleans up structure and readability while preserving behaviour |
| **Generate Docs** | Writes inline documentation and docstrings |
| **Generate Tests** | Creates unit tests covering happy paths and edge cases |

Each action automatically includes surrounding context lines from your file so the model has the full picture.

### Code Block Buttons
Every code block in the assistant's response has two buttons:
- **Copy** — copies the code to your clipboard
- **Insert** — inserts the code at your cursor (or replaces your selection) in the active editor

### Model Picker
The chat header shows a dropdown of every model you have pulled in Ollama. Switch models without leaving VS Code.

### Streaming Responses
Output appears token-by-token as the model generates — no waiting for the full response. Click **Stop** at any time to cancel generation mid-stream.

### Configurable Context
Control how many surrounding lines are sent with a code selection (default: 50) so the model understands the code in its full context.

---

## Requirements

**[Ollama](https://ollama.ai)** must be installed and running — either natively or via Docker.

### Option A — Native install

- **Windows / macOS**: Download from [ollama.ai](https://ollama.ai)
- **Linux**: `curl -fsSL https://ollama.ai/install.sh | sh`

Ollama starts automatically as a background service. If you ever need to start it manually:

```bash
ollama serve
```

### Option B — Docker (recommended for isolation)

```bash
# CPU only
docker run -d \
  --name ollama \
  -p 11434:11434 \
  -v ollama:/root/.ollama \
  ollama/ollama

# With NVIDIA GPU
docker run -d \
  --name ollama \
  --gpus all \
  -p 11434:11434 \
  -v ollama:/root/.ollama \
  ollama/ollama
```

The `-p 11434:11434` flag maps the container port to `localhost:11434`, so the extension's default URL works without any changes.

To pull models into the Docker container:

```bash
docker exec -it ollama ollama pull codellama
```

To check Ollama is reachable from your host machine:

```bash
curl http://localhost:11434/api/tags
```

If you use a different host port (e.g. `-p 12345:11434`), update the `localCodingAgent.ollamaUrl` setting to `http://localhost:12345`.

### Pull a Coding Model

Pull at least one model before using the extension. Recommended options:

```bash
# If using native Ollama
ollama pull codellama

# If using Docker
docker exec -it ollama ollama pull codellama
```

| Model | Size | Best for |
|-------|------|----------|
| `codellama` | 4B | Fast, purpose-built coding, low RAM |
| `deepseek-coder:6.7b` | 6.7B | Excellent code quality, good speed |
| `qwen2.5-coder:7b` | 7B | State-of-the-art coding tasks |
| `llama3.2` | 3.2B | Great general model, very fast |
| `llama3.1:8b` | 8B | Strong reasoning + code |

The model name you pull is what you enter in the extension's **Model** setting or pick from the dropdown.

---

## Installation

### From VSIX file

1. Open VS Code
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
3. Type and select **Extensions: Install from VSIX…**
4. Browse to and select `local-coding-agent-0.1.0.vsix`
5. Click **Install**, then **Reload** when prompted

### Verify it works

After reloading, a new icon (the agent icon) appears in the **Activity Bar** on the left. Click it to open the chat panel.

---

## Usage

### Chat

1. Click the agent icon in the Activity Bar to open the sidebar
2. Type your question in the input box at the bottom
3. Press **Enter** to send (use **Shift+Enter** for a new line)
4. Watch the response stream in — click **Stop** to cancel at any time
5. Click **Insert** on any code block to put it directly into your editor
6. Click **+ New** to start a fresh conversation

### Code Actions

1. Open any file in the editor
2. Select the code you want to act on
3. Right-click → choose an action from the **Local Agent** group
4. The chat panel opens automatically and submits the prompt

---

## Extension Settings

Open Settings with `Ctrl+,` and search for **Local Coding Agent**.

| Setting | Default | Description |
|---------|---------|-------------|
| `localCodingAgent.ollamaUrl` | `http://localhost:11434` | URL of your Ollama server. Change this if you run Ollama on a different port or a remote machine. |
| `localCodingAgent.model` | `codellama` | The Ollama model to use. This is also controlled by the dropdown in the chat panel. |
| `localCodingAgent.systemPrompt` | *(see below)* | The system prompt sent to the model before every conversation. Customise to change the assistant's persona, language, or coding style. |
| `localCodingAgent.contextLines` | `50` | Number of lines above and below your selection to include as context when using code actions. Set to `0` to send only the selected code. |

**Default system prompt:**
> You are an expert coding assistant. Help the user write, understand, debug, and improve code. When showing code, always use markdown code blocks with the appropriate language identifier. Be concise and practical.

---

## Commands

All commands are also accessible via the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `Local Agent: Explain Code` | Explain the selected code |
| `Local Agent: Fix Code` | Find and fix bugs in the selected code |
| `Local Agent: Refactor Code` | Refactor the selected code |
| `Local Agent: Generate Docs` | Generate documentation for the selected code |
| `Local Agent: Generate Tests` | Write unit tests for the selected code |
| `Local Agent: New Chat` | Clear the chat history and start fresh |

---

## Rebuilding from Source

If you want to modify the extension:

```bash
cd path/to/local-coding-agent

# Install dependencies (first time only)
npm install

# Compile TypeScript
npm run compile

# Package a new VSIX
npm run package
```

Source files:

```
src/
├── extension.ts                 # Entry point, command registration
├── providers/
│   └── chatViewProvider.ts      # Sidebar webview — UI + streaming logic
└── services/
    └── ollamaService.ts         # Ollama HTTP client
```

---

## Troubleshooting

**"Cannot connect to Ollama"**
Run `ollama serve` in a terminal (native) or `docker start ollama` (Docker) and make sure it's listening on the configured URL (default `http://localhost:11434`).

**Docker: connection refused even though container is running**
Check the container is actually exposing the port to the host:
```bash
docker ps --filter name=ollama
# "PORTS" column should show:  0.0.0.0:11434->11434/tcp
```
If the port is missing, recreate the container with `-p 11434:11434`.

**Docker: model pull not working**
Pull models into the running container, not from the host CLI:
```bash
docker exec -it ollama ollama pull codellama
```

**"Model not found" or empty model list**
Pull a model first: `ollama pull codellama`. The dropdown auto-populates with all pulled models.

**Slow responses**
Response speed depends entirely on your hardware (RAM, GPU) and the model size. Smaller models like `codellama` (4B) or `llama3.2` (3.2B) are fastest on most machines.

**Insert button doesn't work**
Make sure a file is open in the editor and your cursor is placed where you want the code inserted before clicking Insert.

---

## Privacy

All processing happens on your machine. No code, prompts, or responses are sent anywhere except your local Ollama server. The extension makes only two types of HTTP requests — both to the URL you configure:

- `POST /api/chat` — sends your conversation to the model
- `GET /api/tags` — fetches the list of your locally available models

---

## License

MIT — see [LICENSE](LICENSE)
