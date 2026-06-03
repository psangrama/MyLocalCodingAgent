import * as http from 'http';
import * as https from 'https';
import * as vscode from 'vscode';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OllamaChunk {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  error?: string;
}

interface OllamaTagsResponse {
  models: Array<{ name: string; modified_at: string; size: number }>;
}

function getConfig() {
  const cfg = vscode.workspace.getConfiguration('localCodingAgent');
  return {
    ollamaUrl: cfg.get<string>('ollamaUrl', 'http://localhost:11434'),
    model: cfg.get<string>('model', 'codellama'),
    systemPrompt: cfg.get<string>('systemPrompt', 'You are an expert coding assistant.'),
  };
}

function makeRequest(
  urlStr: string,
  method: string,
  body: string,
  onData: (chunk: Buffer) => void,
  onEnd: () => void,
  onError: (err: Error) => void,
  signal?: AbortSignal,
): void {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    onError(new Error(`Invalid Ollama URL: ${urlStr}`));
    return;
  }

  const lib = url.protocol === 'https:' ? https : http;
  const options: http.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  const req = lib.request(options, (res) => {
    res.on('data', onData);
    res.on('end', onEnd);
    res.on('error', onError);
  });

  req.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'ECONNREFUSED') {
      onError(
        new Error(
          `Cannot connect to Ollama at ${urlStr}.\n\nMake sure Ollama is running:\n  ollama serve`,
        ),
      );
    } else if (err.code !== 'ECONNRESET') {
      onError(err);
    }
  });

  if (signal) {
    signal.addEventListener('abort', () => {
      req.destroy();
      onEnd();
    });
  }

  req.write(body);
  req.end();
}

export async function streamChat(
  history: Message[],
  onChunk: (text: string) => void,
  onError: (message: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const { ollamaUrl, model, systemPrompt } = getConfig();

  const messages: Message[] = [{ role: 'system', content: systemPrompt }, ...history];

  const body = JSON.stringify({ model, messages, stream: true });

  return new Promise<void>((resolve) => {
    let buffer = '';
    let resolved = false;

    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    makeRequest(
      `${ollamaUrl}/api/chat`,
      'POST',
      body,
      (chunk) => {
        if (signal?.aborted) return;
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed: OllamaChunk = JSON.parse(line);
            if (parsed.error) {
              onError(parsed.error);
              finish();
              return;
            }
            if (parsed.message?.content) {
              onChunk(parsed.message.content);
            }
          } catch {
            // malformed JSON line — skip
          }
        }
      },
      finish,
      (err) => {
        onError(err.message);
        finish();
      },
      signal,
    );
  });
}

export async function listModels(): Promise<string[]> {
  const { ollamaUrl } = getConfig();

  return new Promise<string[]>((resolve) => {
    let data = '';

    const url = new URL(`${ollamaUrl}/api/tags`);
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.get(`${ollamaUrl}/api/tags`, (res) => {
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () => {
        try {
          const parsed: OllamaTagsResponse = JSON.parse(data);
          resolve((parsed.models ?? []).map((m) => m.name));
        } catch {
          resolve([]);
        }
      });
      res.on('error', () => resolve([]));
    });

    req.on('error', () => resolve([]));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve([]);
    });
  });
}
