import * as vscode from 'vscode';
import * as path from 'path';

interface SearchResult {
    uri: vscode.Uri;
    fileName: string;
    relativePath: string;
    workspaceFolderName?: string;
    lineNumber?: number;
    lineText?: string;
    matchIndices?: [number, number][];
}

type SearchScope = 'open' | 'all';
type SearchType = 'names' | 'contents' | 'both';

export class GlobalSearchProvider {
    private searchScope: SearchScope = 'open';
    private searchType: SearchType = 'both';
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        this.outputChannel.appendLine('GlobalSearchProvider initialized');
    }

    private updatePlaceholder(quickPick: vscode.QuickPick<any>) {
        const typeText =
            this.searchType === 'names' ? 'file names' :
            this.searchType === 'contents' ? 'file contents' : 'file names and contents';
        const scopeText = this.searchScope === 'open' ? 'open editors' : 'all files';
        quickPick.placeholder = `Search ${typeText} in ${scopeText} across all workspace folders`;
    }

    async showSearchPanel() {
        this.outputChannel.appendLine('Showing search panel');
        const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { result?: SearchResult }>();
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;

        this.updatePlaceholder(quickPick);

        const scopeButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon('folder'),
            tooltip: 'Toggle search scope (Open Editors ↔ All Files)'
        };

        const typeButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon('filter'),
            tooltip: 'Toggle search type (Names ↔ Contents)'
        };

        quickPick.buttons = [typeButton, scopeButton];

        quickPick.onDidChangeValue(async (value) => {
            this.outputChannel.appendLine(`Search value changed: "${value}"`);
            if (value.trim() === '') {
                quickPick.items = [];
                return;
            }

            quickPick.busy = true;
            const results = await this.search(value);
            this.outputChannel.appendLine(`Found ${results.length} search results`);
            quickPick.items = this.convertToQuickPickItems(results);
            quickPick.busy = false;
        });

        quickPick.onDidAccept(async () => {
            const selection = quickPick.selectedItems[0];
            if (selection && 'result' in selection && selection.result) {
                const result = selection.result;
                this.outputChannel.appendLine(`Opening file: ${result.relativePath}${result.lineNumber !== undefined ? ` at line ${result.lineNumber + 1}` : ''}`);
                const document = await vscode.workspace.openTextDocument(result.uri);
                const editor = await vscode.window.showTextDocument(document);

                if (result.lineNumber !== undefined) {
                    const position = new vscode.Position(result.lineNumber, 0);
                    editor.selection = new vscode.Selection(position, position);
                    editor.revealRange(new vscode.Range(position, position));
                }
            }
            quickPick.hide();
        });


        quickPick.onDidTriggerButton(async (button) => {
            if (button === scopeButton) {
                // Toggle scope: open ↔ all
                this.searchScope = this.searchScope === 'open' ? 'all' : 'open';
                this.outputChannel.appendLine(`Search scope toggled to: ${this.searchScope}`);
            } else if (button === typeButton) {
                // Cycle through types: names → contents → both → names
                this.searchType =
                    this.searchType === 'names' ? 'contents' :
                    this.searchType === 'contents' ? 'both' : 'names';
                this.outputChannel.appendLine(`Search type changed to: ${this.searchType}`);
            }

            // Update placeholder
            this.updatePlaceholder(quickPick);

            // Trigger search if there's a value
            const currentValue = quickPick.value;
            if (currentValue.trim() !== '') {
                quickPick.busy = true;
                const results = await this.search(currentValue);
                this.outputChannel.appendLine(`Found ${results.length} search results after button click`);
                quickPick.items = this.convertToQuickPickItems(results);
                quickPick.busy = false;
            }
        });

        quickPick.show();
    }

    private async search(query: string): Promise<SearchResult[]> {
        this.outputChannel.appendLine(`Starting search for: "${query}" (scope: ${this.searchScope}, type: ${this.searchType})`);
        const results: SearchResult[] = [];
        const lowerQuery = query.toLowerCase();

        if (this.searchScope === 'all') {
            // Search across all workspace folders
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (workspaceFolders && workspaceFolders.length > 0) {
                for (const folder of workspaceFolders) {
                    this.outputChannel.appendLine(`Searching in workspace folder: ${folder.name}`);
                    const files = await vscode.workspace.findFiles(
                        new vscode.RelativePattern(folder, '**/*'),
                        new vscode.RelativePattern(folder, '**/node_modules/**')
                    );
                    this.outputChannel.appendLine(`Found ${files.length} files in ${folder.name}`);

                    for (const file of files) {
                        const fileName = path.basename(file.fsPath);
                        const relativePath = vscode.workspace.asRelativePath(file);

                        // Check file names if needed
                        if ((this.searchType === 'names' || this.searchType === 'both') && fileName.toLowerCase().includes(lowerQuery)) {
                            results.push({
                                uri: file,
                                fileName,
                                relativePath,
                                workspaceFolderName: folder.name
                            });
                        }

                        // Check file contents if needed
                        if (this.searchType === 'contents' || this.searchType === 'both') {
                            try {
                                const document = await vscode.workspace.openTextDocument(file);
                                const text = document.getText();
                                const lines = text.split('\n');

                                for (let i = 0; i < lines.length; i++) {
                                    const line = lines[i];
                                    const lowerLine = line.toLowerCase();
                                    const index = lowerLine.indexOf(lowerQuery);

                                    if (index !== -1) {
                                        results.push({
                                            uri: file,
                                            fileName,
                                            relativePath,
                                            workspaceFolderName: folder.name,
                                            lineNumber: i,
                                            lineText: line.trim(),
                                            matchIndices: [[index, index + query.length]]
                                        });
                                    }
                                }
                            } catch (error) {
                                this.outputChannel.appendLine(`Error reading file ${relativePath}: ${error}`);
                            }
                        }
                    }
                }
            } else {
                // Fallback to old behavior if no workspace folders
                const files = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
                this.outputChannel.appendLine(`Found ${files.length} files in workspace`);

                for (const file of files) {
                    const fileName = path.basename(file.fsPath);
                    const relativePath = vscode.workspace.asRelativePath(file);

                    // Check file names if needed
                    if ((this.searchType === 'names' || this.searchType === 'both') && fileName.toLowerCase().includes(lowerQuery)) {
                        results.push({
                            uri: file,
                            fileName,
                            relativePath
                        });
                    }

                    // Check file contents if needed
                    if (this.searchType === 'contents' || this.searchType === 'both') {
                        try {
                            const document = await vscode.workspace.openTextDocument(file);
                            const text = document.getText();
                            const lines = text.split('\n');

                            for (let i = 0; i < lines.length; i++) {
                                const line = lines[i];
                                const lowerLine = line.toLowerCase();
                                const index = lowerLine.indexOf(lowerQuery);

                                if (index !== -1) {
                                    results.push({
                                        uri: file,
                                        fileName,
                                        relativePath,
                                        lineNumber: i,
                                        lineText: line.trim(),
                                        matchIndices: [[index, index + query.length]]
                                    });
                                }
                            }
                        } catch (error) {
                            this.outputChannel.appendLine(`Error reading file ${relativePath}: ${error}`);
                        }
                    }
                }
            }
        } else {
            // Search only open documents across all workspace folders
            const openDocuments = vscode.workspace.textDocuments.filter(doc => !doc.isUntitled);
            
            // Group documents by workspace folder to show window information
            const documentsByWorkspace = new Map<string, vscode.TextDocument[]>();
            for (const doc of openDocuments) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
                const folderName = workspaceFolder?.name || 'Unknown Workspace';
                if (!documentsByWorkspace.has(folderName)) {
                    documentsByWorkspace.set(folderName, []);
                }
                documentsByWorkspace.get(folderName)!.push(doc);
            }
            
            const windowCount = documentsByWorkspace.size;
            this.outputChannel.appendLine(`Searching ${openDocuments.length} open documents across ${windowCount} open window${windowCount !== 1 ? 's' : ''}`);
            
            // Log each window and its document count
            for (const [windowName, docs] of documentsByWorkspace) {
                this.outputChannel.appendLine(`  - ${windowName}: ${docs.length} document${docs.length !== 1 ? 's' : ''}`);
            }

            for (const document of openDocuments) {
                const fileName = path.basename(document.uri.fsPath);
                const relativePath = vscode.workspace.asRelativePath(document.uri);
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

                // Check file names if needed
                if ((this.searchType === 'names' || this.searchType === 'both') && fileName.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        uri: document.uri,
                        fileName,
                        relativePath,
                        workspaceFolderName: workspaceFolder?.name
                    });
                }

                // Check file contents if needed
                if (this.searchType === 'contents' || this.searchType === 'both') {
                    const text = document.getText();
                    const lines = text.split('\n');

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        const lowerLine = line.toLowerCase();
                        const index = lowerLine.indexOf(lowerQuery);

                        if (index !== -1) {
                            results.push({
                                uri: document.uri,
                                fileName,
                                relativePath,
                                workspaceFolderName: workspaceFolder?.name,
                                lineNumber: i,
                                lineText: line.trim(),
                                matchIndices: [[index, index + query.length]]
                            });
                        }
                    }
                }
            }
        }

        const finalResults = results.slice(0, 100);
        this.outputChannel.appendLine(`Search completed. Returning ${finalResults.length} results (limited to 100)`);
        return finalResults;
    }

    private convertToQuickPickItems(results: SearchResult[]): (vscode.QuickPickItem & { result?: SearchResult })[] {
        const items: (vscode.QuickPickItem & { result?: SearchResult })[] = [];
        
        // Group results by workspace folder
        const groupedResults = new Map<string, SearchResult[]>();
        
        for (const result of results) {
            const folderName = result.workspaceFolderName || 'Unknown Workspace';
            if (!groupedResults.has(folderName)) {
                groupedResults.set(folderName, []);
            }
            groupedResults.get(folderName)!.push(result);
        }
        
        // Sort workspace folders alphabetically
        const sortedFolders = Array.from(groupedResults.keys()).sort();
        
        for (const folderName of sortedFolders) {
            const folderResults = groupedResults.get(folderName)!;
            
            // Add separator for workspace folder (if we have multiple folders)
            if (groupedResults.size > 1) {
                items.push({
                    label: `$(folder) ${folderName}`,
                    description: `${folderResults.length} result${folderResults.length !== 1 ? 's' : ''}`,
                    detail: '',
                    kind: vscode.QuickPickItemKind.Separator
                });
            }
            
            // Add results for this workspace folder
            for (const result of folderResults) {
                const workspacePrefix = result.workspaceFolderName ? `[${result.workspaceFolderName}] ` : '';
                
                if (result.lineText !== undefined) {
                    items.push({
                        label: `$(file-text) ${workspacePrefix}${result.fileName}`,
                        description: `Line ${result.lineNumber! + 1}: ${result.lineText}`,
                        detail: result.relativePath,
                        result
                    });
                } else {
                    items.push({
                        label: `$(file) ${workspacePrefix}${result.fileName}`,
                        description: 'File name match',
                        detail: result.relativePath,
                        result
                    });
                }
            }
        }
        
        return items;
    }
}
