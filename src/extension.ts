import * as vscode from 'vscode';
import { ChatViewProvider } from './providers/chatViewProvider';

interface CodeAction {
  command: string;
  label: string;
  promptPrefix: string;
}

const CODE_ACTIONS: CodeAction[] = [
  {
    command: 'localCodingAgent.explainCode',
    label: 'Explain Code',
    promptPrefix: 'Explain this code in detail — what it does, how it works, and any important patterns or edge cases:',
  },
  {
    command: 'localCodingAgent.fixCode',
    label: 'Fix Code',
    promptPrefix: 'Find and fix all bugs, errors, or issues in this code. Explain what was wrong and provide the corrected version:',
  },
  {
    command: 'localCodingAgent.refactorCode',
    label: 'Refactor Code',
    promptPrefix: 'Refactor this code to be cleaner, more readable, and more maintainable. Keep the same behaviour:',
  },
  {
    command: 'localCodingAgent.generateDocs',
    label: 'Generate Docs',
    promptPrefix: 'Generate comprehensive documentation and inline comments for this code:',
  },
  {
    command: 'localCodingAgent.generateTests',
    label: 'Generate Tests',
    promptPrefix: 'Write thorough unit tests for this code, covering happy paths and edge cases:',
  },
];

function buildCodePrompt(
  prefix: string,
  selectedCode: string,
  language: string,
  contextCode?: string,
  fileName?: string,
): string {
  let prompt = prefix + '\n\n';

  if (fileName) {
    prompt += `File: ${fileName}\n`;
  }

  if (contextCode && contextCode !== selectedCode) {
    prompt += `Context (surrounding code):\n\`\`\`${language}\n${contextCode}\n\`\`\`\n\nSelected code:\n\`\`\`${language}\n${selectedCode}\n\`\`\``;
  } else {
    prompt += `\`\`\`${language}\n${selectedCode}\n\`\`\``;
  }

  return prompt;
}

export function activate(context: vscode.ExtensionContext): void {
  const chatProvider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Register new-chat command
  context.subscriptions.push(
    vscode.commands.registerCommand('localCodingAgent.newChat', () => {
      chatProvider.clearChat();
    }),
  );

  // Register code-action commands
  for (const action of CODE_ACTIONS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(action.command, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('Open a file in the editor first.');
          return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (!selectedText.trim()) {
          vscode.window.showWarningMessage(`Select some code first to use "${action.label}".`);
          return;
        }

        const language = editor.document.languageId;
        const fileName = vscode.workspace.asRelativePath(editor.document.uri);

        // Optionally include surrounding context lines
        const contextLines = vscode.workspace
          .getConfiguration('localCodingAgent')
          .get<number>('contextLines', 50);

        let contextCode: string | undefined;
        if (contextLines > 0) {
          const startLine = Math.max(0, selection.start.line - contextLines);
          const endLine = Math.min(
            editor.document.lineCount - 1,
            selection.end.line + contextLines,
          );
          const contextRange = new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length);
          const ctx = editor.document.getText(contextRange);
          if (ctx !== selectedText) contextCode = ctx;
        }

        const prompt = buildCodePrompt(action.promptPrefix, selectedText, language, contextCode, fileName);

        // Focus the chat panel, then send the prompt
        await vscode.commands.executeCommand('localCodingAgent.chatView.focus');
        chatProvider.sendPrompt(prompt);
      }),
    );
  }
}

export function deactivate(): void {
  // nothing to clean up
}
