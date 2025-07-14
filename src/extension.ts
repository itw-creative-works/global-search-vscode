import * as vscode from 'vscode';
import { GlobalSearchProvider } from './globalSearchProvider';

const outputChannel = vscode.window.createOutputChannel('Global Search');

export function activate(context: vscode.ExtensionContext) {
    outputChannel.appendLine('Global Search extension activated');
    
    const provider = new GlobalSearchProvider(outputChannel);

    const disposable = vscode.commands.registerCommand('global-search.openSearch', async () => {
        outputChannel.appendLine('Global Search command triggered');
        await provider.showSearchPanel();
    });

    context.subscriptions.push(disposable);
    outputChannel.appendLine('Global Search extension fully initialized');
}

export function deactivate() {}