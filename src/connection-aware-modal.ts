import { App, Modal, TFile, Notice } from 'obsidian';
import { EnhancedGraphService, ConnectionType, PathResult, EnhancedGraph } from './enhanced-graph-service';

/**
 * Graph Metrics Modal that shows connection types in path visualization
 */
export class ConnectionAwareGraphMetricsModal extends Modal {
    plugin: any;
    startNoteInput: HTMLInputElement;
    endNoteInput: HTMLInputElement;
    resultsDiv: HTMLDivElement;
    loadingDiv: HTMLDivElement;
    statusDiv: HTMLDivElement;
    cancelAnalysisFlag: boolean = false;
    analyzeButton: HTMLButtonElement;
    cancelButton: HTMLButtonElement;
    progressBar: HTMLDivElement;
    resultsDisplayed: boolean = false;
    graphService: EnhancedGraphService;

    constructor(app: App, plugin: any) {
        super(app);
        this.plugin = plugin;
        this.graphService = new EnhancedGraphService(app, plugin.settings);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Analyze Note Connections' });


        const startNoteContainer = contentEl.createDiv({ cls: 'input-container' });
        startNoteContainer.createEl('label', { text: 'Start Note:' });
        this.startNoteInput = startNoteContainer.createEl('input', {
            type: 'text',
            value: this.plugin.settings.defaultStartNote,
            cls: 'note-input'
        });

        const startDatalist = startNoteContainer.createEl('datalist', { attr: { id: 'note-suggestions-start' } });
        this.startNoteInput.setAttribute('list', 'note-suggestions-start');
        this.populateNoteAutocomplete(startDatalist);

        const endNoteContainer = contentEl.createDiv({ cls: 'input-container' });
        endNoteContainer.createEl('label', { text: 'End Note:' });
        this.endNoteInput = endNoteContainer.createEl('input', {
            type: 'text',
            value: this.plugin.settings.defaultEndNote,
            cls: 'note-input'
        });

        // datalist for autocomplete
        const endDatalist = endNoteContainer.createEl('datalist', { attr: { id: 'note-suggestions-end' } });
        this.endNoteInput.setAttribute('list', 'note-suggestions-end');
        this.populateNoteAutocomplete(endDatalist);

        const swapButton = contentEl.createEl('button', {
            text: 'Swap Notes',
            cls: 'swap-button'
        });
        swapButton.addEventListener('click', () => {
            const temp = this.startNoteInput.value;
            this.startNoteInput.value = this.endNoteInput.value;
            this.endNoteInput.value = temp;
        });

        const optionsContainer = contentEl.createDiv({ cls: 'options-container' });
        optionsContainer.createEl('h3', { text: 'Analysis Options' });

        // TODO: reenable or remove if redundant
        // Option: Include tags in analysis
        // const tagsContainer = optionsContainer.createDiv({ cls: 'option-container' });
        // tagsContainer.createEl('label', { text: 'Include Tags:' });
        // const includeTagsCheckbox = tagsContainer.createEl('input', {
        //     type: 'checkbox',
        //     checked: this.plugin.settings.includeTagsInAnalysis
        // });
        // includeTagsCheckbox.addEventListener('change', (e) => {
        //     this.plugin.settings.includeTagsInAnalysis = (e.target as HTMLInputElement).checked;
        // });

        const maxPathLengthContainer = optionsContainer.createDiv({ cls: 'option-container' });
        maxPathLengthContainer.createEl('label', { text: 'Max Path Length:' });
        const maxPathLengthInput = maxPathLengthContainer.createEl('input', {
            type: 'number',
            value: String(this.plugin.settings.maxPathLength),
            attr: {
                min: '2',
                max: '20'
            }
        });

        const maxPathsContainer = optionsContainer.createDiv({ cls: 'option-container' });
        maxPathsContainer.createEl('label', { text: 'Max Alternative Paths:' });
        const maxPathsInput = maxPathsContainer.createEl('input', {
            type: 'number',
            value: String(this.plugin.settings.maxPathsToShow),
            attr: {
                min: '1',
                max: '20'
            }
        });

        const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
        this.analyzeButton = buttonContainer.createEl('button', {
            text: 'Analyze Connections',
            cls: 'mod-cta'
        });
        this.analyzeButton.addEventListener('click', () => {
            this.plugin.settings.maxPathLength = parseInt(maxPathLengthInput.value);
            this.plugin.settings.maxPathsToShow = parseInt(maxPathsInput.value);
            this.analyzeConnections();
        });

        this.cancelButton = buttonContainer.createEl('button', {
            text: 'Cancel Analysis',
            cls: 'cancel-button'
        });
        this.cancelButton.style.display = 'none';
        this.cancelButton.addEventListener('click', () => {
            this.cancelAnalysisFlag = true;
            this.updateStatus('Cancelling analysis...');
        });

        this.loadingDiv = contentEl.createDiv({ cls: 'loading-container' });
        this.loadingDiv.style.display = 'none';

        this.progressBar = this.loadingDiv.createDiv({ cls: 'progress-bar' });
        this.progressBar.createDiv({ cls: 'progress-indicator' });

        this.statusDiv = this.loadingDiv.createDiv({ cls: 'status-message' });

        this.resultsDiv = contentEl.createDiv({ cls: 'results-container' });
    }

    populateNoteAutocomplete(datalist: HTMLDataListElement) {
        // add all markdown files to the autocomplete datalist
        const files = this.app.vault.getMarkdownFiles();
        files.forEach(file => {
            datalist.createEl('option', { value: file.basename });
        });
    }

    updateStatus(message: string, progress: number = -1) {
        this.statusDiv.setText(message);

        if (progress >= 0 && progress <= 100) {
            const progressIndicator = this.progressBar.querySelector('.progress-indicator') as HTMLElement;
            if (progressIndicator) {
                progressIndicator.style.width = `${progress}%`;
            }
        }
    }

    async analyzeConnections() {
        const startNoteName = this.startNoteInput.value.trim();
        const endNoteName = this.endNoteInput.value.trim();

        if (!startNoteName || !endNoteName) {
            new Notice('Please provide both start and end note names');
            return;
        }

        // get the actual note files
        const startNote = this.graphService.findNoteByName(startNoteName);
        const endNote = this.graphService.findNoteByName(endNoteName);

        if (!startNote || !endNote) {
            new Notice('One or both notes not found');
            return;
        }

        this.cancelAnalysisFlag = false;
        this.resultsDisplayed = false;

        this.loadingDiv.style.display = 'block';
        this.resultsDiv.style.display = 'none';
        this.analyzeButton.style.display = 'none';
        this.cancelButton.style.display = 'block';

        this.resultsDiv.empty();
        this.resultsDiv.createEl('h3', { text: 'Analysis Results' });

        try {
            // Update status
            this.updateStatus('Building the note graph...', 10);

            // Build graph with connection types
            const startTime = performance.now();
            const graph = await this.graphService.getGraph(
                (message, progress) => this.updateStatus(message, 10 + progress * 0.3)
            );

            const graphBuildTime = Math.round(performance.now() - startTime);

            if (this.cancelAnalysisFlag) {
                this.finishLoading('Analysis cancelled');
                return;
            }

            this.updateStatus(`Analyzing connections (graph built in ${graphBuildTime}ms)...`, 40);

            // Find shortest path with connection info
            const shortestPath = this.graphService.findShortestPath(
                graph,
                startNote.path,
                endNote.path
            );

            if (this.cancelAnalysisFlag) {
                this.finishLoading('Analysis cancelled');
                return;
            }

            this.updateStatus('Calculating network metrics...', 50);

            const betweennessCentrality = await this.calculateBetweennessCentrality(graph, shortestPath.path);

            if (this.cancelAnalysisFlag) {
                this.finishLoading('Analysis cancelled');
                return;
            }

            const clusteringCoefficient = await this.calculateClusteringCoefficient(graph, shortestPath.path);

            if (this.cancelAnalysisFlag) {
                this.finishLoading('Analysis cancelled');
                return;
            }

            this.updateStatus('Finding alternative paths...', 80);

            // Find alternative paths
            const allPaths = this.graphService.findAllPaths(
                graph,
                startNote.path,
                endNote.path,
                this.plugin.settings.maxPathsToShow
            );

            // Check for cancellation
            if (this.cancelAnalysisFlag) {
                this.finishLoading('Analysis cancelled');
                return;
            }

            // Update status
            this.updateStatus('Generating results visualization...', 90);

            const metrics = {
                betweennessCentrality,
                clusteringCoefficient
            };

            this.displayResults(shortestPath, allPaths, startNote, endNote, metrics);

            const totalTime = Math.round(performance.now() - startTime);
            this.finishLoading(`Analysis completed in ${totalTime}ms`);

            // Save the notes as defaults for next time
            this.plugin.settings.defaultStartNote = startNoteName;
            this.plugin.settings.defaultEndNote = endNoteName;
            await this.plugin.saveSettings();

        } catch (error) {
            this.finishLoading('Error during analysis');
            this.resultsDiv.createEl('p', {
                text: `Error: ${error.message}`,
                cls: 'error-message'
            });
        }
    }

    finishLoading(finalMessage: string) {
        // Hide loading indicator and show results
        this.updateStatus(finalMessage, 100);
        setTimeout(() => {
            this.loadingDiv.style.display = 'none';
            this.resultsDiv.style.display = 'block';
            this.analyzeButton.style.display = 'block';
            this.cancelButton.style.display = 'none';
        }, 500); //delay to show 100% progress
    }

    displayResults(
        shortestPath: PathResult,
        allPaths: PathResult[],
        startNote: TFile,
        endNote: TFile,
        metrics: { betweennessCentrality: Record<string, number>, clusteringCoefficient: Record<string, number> } = { betweennessCentrality: {}, clusteringCoefficient: {} }
    ) {
        const resultsDiv = this.resultsDiv;

        const summaryEl = resultsDiv.createEl('div', { cls: 'summary-container' });

        resultsDiv.createEl('h4', { text: 'Degrees of Separation' });
        if (shortestPath.distance >= 0) {
            const degreesText = `${startNote.basename} and ${endNote.basename} are separated by ${shortestPath.distance} degree${shortestPath.distance !== 1 ? 's' : ''}`;

            resultsDiv.createEl('p', { text: degreesText });

            summaryEl.createEl('div', {
                cls: 'summary-box',
                text: degreesText
            });
        } else {
            resultsDiv.createEl('p', { text: `No connection found between these notes` });

            summaryEl.createEl('div', {
                cls: 'summary-box no-connection',
                text: `No connection found between ${startNote.basename} and ${endNote.basename}`
            });

            return;
        }

        this.addConnectionLegend(resultsDiv);

        resultsDiv.createEl('h4', { text: 'Shortest Path' });
        this.displayEnhancedPath(resultsDiv, shortestPath);


        resultsDiv.createEl('h4', { text: 'Key Connector Notes' });
        const centralityEntries = Object.entries(metrics.betweennessCentrality)
            .filter(([_, value]: [string, any]) => value > 0)
            .sort((a, b) => (b[1] as number) - (a[1] as number));

        if (centralityEntries.length > 0) {
            const centralityContainer = resultsDiv.createEl('div', { cls: 'centrality-container' });

            for (const [nodePath, value] of centralityEntries) {
                const file = this.app.vault.getAbstractFileByPath(nodePath);
                if (file instanceof TFile) {
                    centralityContainer.createEl('div', {
                        cls: 'centrality-item',
                        text: `${file.basename}: ${value} (connector strength)`
                    });
                }
            }
        }

        resultsDiv.createEl('h4', { text: 'Note Neighborhood Density' });

        const clusteringEntries = Object.entries(metrics.clusteringCoefficient)
            .filter(([nodePath, _]: [string, any]) => nodePath !== startNote.path && nodePath !== endNote.path)
            .sort((a, b) => (b[1] as number) - (a[1] as number));

        if (clusteringEntries.length > 0) {
            const clusteringContainer = resultsDiv.createEl('div', { cls: 'clustering-container' });

            for (const [nodePath, value] of clusteringEntries) {
                const file = this.app.vault.getAbstractFileByPath(nodePath);
                if (file instanceof TFile) {
                    clusteringContainer.createEl('div', {
                        cls: 'clustering-item',
                        text: `${file.basename}: ${(value as number).toFixed(2)} (density)`
                    });
                }
            }
        }
        // display alternative paths if they exist
        if (allPaths.length > 1) {
            const pathsToShow = Math.min(allPaths.length - 1, this.plugin.settings.maxPathsToShow);
            resultsDiv.createEl('h4', { text: `Alternative Paths (${pathsToShow})` });

            // collapsible container for alternative paths
            const altPathsContainer = resultsDiv.createEl('div', { cls: 'alt-paths-container' });

            // Skip the first one since it's the shortest path we already showed
            for (let i = 1; i < allPaths.length; i++) {
                const altPath = allPaths[i];

                // Create a collapsible section for each path
                const altPathSection = altPathsContainer.createEl('details', { cls: 'alt-path-section' });
                altPathSection.createEl('summary', {
                    text: `Path ${i}: ${altPath.distance} step${altPath.distance !== 1 ? 's' : ''}`,
                    cls: 'alt-path-summary'
                });

                this.displayEnhancedPath(altPathSection, altPath);
            }
        }

        const exportButton = resultsDiv.createEl('button', {
            text: 'Export Results',
            cls: 'export-button'
        });

        exportButton.addEventListener('click', () => {
            this.exportResults(shortestPath, allPaths, startNote, endNote);
        });

        this.resultsDisplayed = true;
    }

    /**
     * Display path with connection type indicators
     */
    displayEnhancedPath(containerEl: HTMLElement, pathResult: PathResult): void {
        const { path, connectionTypes } = pathResult;

        const pathEl = containerEl.createEl('div', { cls: 'path-container' });

        path.forEach((nodePath, index) => {
            const file = this.app.vault.getAbstractFileByPath(nodePath);

            if (file instanceof TFile) {
                const nodeEl = pathEl.createEl('span', {
                    text: file.basename,
                    cls: 'path-node'
                });

                nodeEl.addEventListener('click', () => {
                    this.app.workspace.getLeaf().openFile(file);
                });

                nodeEl.setAttribute('title', `Click to open: ${file.path}`);

                // Add connection indicator if not the last node
                if (index < path.length - 1) {
                    const connectionInfo = connectionTypes[index];
                    let arrowText = ' → ';
                    let arrowClass = 'path-arrow';

                    // Style based on connection type
                    if (connectionInfo) {
                        switch (connectionInfo.type) {
                            case ConnectionType.DIRECT:
                                arrowClass += ' direct-link';
                                break;
                            case ConnectionType.BACKLINK:
                                arrowClass += ' backlink';
                                arrowText = ' ← '; // Use reverse arrow for backlinks
                                break;
                            case ConnectionType.TAG:
                                arrowClass += ' tag-link';
                                arrowText = ' #→ '; // Add # to indicate tag connection
                                break;
                            case ConnectionType.EMBEDDED:
                                arrowClass += ' embedded-link';
                                arrowText = ' !→ '; // Add ! to indicate embedded connection
                                break;
                        }
                    }

                    const arrowEl = pathEl.createEl('span', {
                        text: arrowText,
                        cls: arrowClass
                    });

                    // Add tooltip with connection details
                    if (connectionInfo?.type === ConnectionType.TAG && connectionInfo.commonTags) {
                        arrowEl.setAttribute('title', `Connected by tags: #${connectionInfo.commonTags.join(', #')}`);
                    } else if (connectionInfo?.type === ConnectionType.BACKLINK) {
                        arrowEl.setAttribute('title', 'Connected by backlink');
                    } else if (connectionInfo?.type === ConnectionType.EMBEDDED) {
                        arrowEl.setAttribute('title', 'Connected by embedded link');
                    } else {
                        arrowEl.setAttribute('title', 'Connected by direct link');
                    }
                }
            }
        });
    }

    /**
     * Add connection type legend
     */
    addConnectionLegend(containerEl: HTMLElement): void {
        const legendEl = containerEl.createEl('div', { cls: 'connection-legend' });
        legendEl.createEl('h4', { text: 'Connection Types' });

        const types = [
            { name: 'Direct Link', symbol: '→', cls: 'direct-link', desc: 'Notes connected by direct wiki links' },
            { name: 'Backlink', symbol: '←', cls: 'backlink', desc: 'Notes connected by backlinks' },
            { name: 'Tag Connection', symbol: '#→', cls: 'tag-link', desc: 'Notes sharing common tags' },
            { name: 'Embedded Link', symbol: '!→', cls: 'embedded-link', desc: 'Notes connected by embedded content' }
        ];

        const legendList = legendEl.createEl('div', { cls: 'legend-list' });

        for (const type of types) {
            const typeEl = legendList.createEl('div', { cls: 'legend-item' });
            typeEl.createEl('span', { text: type.symbol, cls: `path-arrow ${type.cls}` });
            typeEl.createEl('span', { text: type.name, cls: 'legend-name' });
            typeEl.createEl('span', { text: type.desc, cls: 'legend-desc' });
        }
    }

    /**
     * Export the results to a new note
     */
    exportResults(
        shortestPath: PathResult,
        allPaths: PathResult[],
        startNote: TFile,
        endNote: TFile,
        metrics: { betweennessCentrality: Record<string, number>, clusteringCoefficient: Record<string, number> } = { betweennessCentrality: {}, clusteringCoefficient: {} }
    ): void {
        let markdown = `# Connection Analysis: ${startNote.basename} to ${endNote.basename}\n\n`;

        // egrees of separation
        markdown += `## Degrees of Separation\n\n`;
        if (shortestPath.distance >= 0) {
            markdown += `${startNote.basename} and ${endNote.basename} are separated by ${shortestPath.distance} degree${shortestPath.distance !== 1 ? 's' : ''}\n\n`;
        } else {
            markdown += `No connection found between these notes\n\n`;
            return this.saveExport(markdown);
        }

        // connection type legend
        markdown += `## Connection Types\n\n`;
        markdown += `- **→** Direct Link: Notes connected by direct wiki links\n`;
        markdown += `- **←** Backlink: Notes connected by backlinks\n`;
        markdown += `- **#→** Tag Connection: Notes sharing common tags\n`;
        markdown += `- **!→** Embedded Link: Notes connected by embedded content\n\n`;

        markdown += `## Shortest Path\n\n`;
        markdown += this.pathToMarkdown(shortestPath) + '\n\n';

        if (allPaths.length > 1) {
            markdown += `## Alternative Paths\n\n`;

            for (let i = 1; i < allPaths.length; i++) {
                const altPath = allPaths[i];
                markdown += `### Path ${i}\n\n`;
                markdown += this.pathToMarkdown(altPath) + '\n\n';
            }
        }

        markdown += `## Key Connector Notes\n\n`;
        const centralityEntries = Object.entries(metrics.betweennessCentrality)
            .filter(([_, value]: [string, any]) => value > 0)
            .sort((a, b) => (b[1] as number) - (a[1] as number));

        if (centralityEntries.length > 0) {
            for (const [nodePath, value] of centralityEntries) {
                const file = this.app.vault.getAbstractFileByPath(nodePath);
                if (file instanceof TFile) {
                    markdown += `- [[${file.basename}]]: ${value} (connector strength)\n`;
                }
            }
            markdown += '\n';
        } else {
            markdown += 'No key connector notes found in the path\n\n';
        }

        //  clustering coefficient
        markdown += `## Note Neighborhood Density\n\n`;

        for (const [nodePath, value] of Object.entries(metrics.clusteringCoefficient)) {
            if (nodePath !== startNote.path && nodePath !== endNote.path) {
                const file = this.app.vault.getAbstractFileByPath(nodePath);
                if (file instanceof TFile) {
                    markdown += `- [[${file.basename}]]: ${(value as number).toFixed(2)} (density)\n`;
                }
            }
        }
        markdown += '\n';


        // metadata
        markdown += `---\n`;
        markdown += `Analysis generated: ${new Date().toLocaleString()}\n`;
        markdown += `Graph Metrics Plugin v${this.plugin.manifest.version}\n`;
        markdown += `---\n`;

        this.saveExport(markdown);
    }

    /**
     * Convert a path result to markdown
     */
    pathToMarkdown(pathResult: PathResult): string {
        const { path, connectionTypes } = pathResult;
        let markdown = '';

        // Convert the path to markdown with connection symbols
        for (let i = 0; i < path.length; i++) {
            const nodePath = path[i];
            const file = this.app.vault.getAbstractFileByPath(nodePath);

            if (file instanceof TFile) {
                markdown += `[[${file.basename}]]`;

                // Add connection indicator if not the last node
                if (i < path.length - 1) {
                    const connectionInfo = connectionTypes[i];
                    let connectionSymbol = ' → ';

                    // use appropriate symbol based on connection type
                    if (connectionInfo) {
                        switch (connectionInfo.type) {
                            case ConnectionType.DIRECT:
                                connectionSymbol = ' → ';
                                break;
                            case ConnectionType.BACKLINK:
                                connectionSymbol = ' ← ';
                                break;
                            case ConnectionType.TAG:
                                // Include tag information
                                if (connectionInfo.commonTags && connectionInfo.commonTags.length > 0) {
                                    connectionSymbol = ` #${connectionInfo.commonTags.join(', #')} → `;
                                } else {
                                    connectionSymbol = ' #→ ';
                                }
                                break;
                            case ConnectionType.EMBEDDED:
                                connectionSymbol = ' !→ ';
                                break;
                        }
                    }

                    markdown += connectionSymbol;
                }
            } else {
                markdown += nodePath;

                if (i < path.length - 1) {
                    markdown += ' → ';
                }
            }
        }

        return markdown;
    }

    /**
     * Save the exported markdown to a new note
     */
    saveExport(markdown: string) {
        // Create a new note with the results
        // time format YYYY-MM-DD HH-MM-SS
        const fileName = `Connection Analysis ${new Date().toISOString().replace(/:/g, '-')}.md`;

        this.app.vault.create(fileName, markdown)
            .then((file) => {
                this.app.workspace.getLeaf().openFile(file);
                new Notice('Analysis exported successfully!');
            })
            .catch((error) => {
                console.error('Error saving export:', error);
                new Notice('Error exporting analysis');
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();

        // Remove added styles
        const styleEl = document.head.querySelector('#graph-metrics-path-styles');
        if (styleEl) styleEl.remove();
    }
    /**
     * Calculate betweenness centrality for nodes in a path
     * 
     * Betweenness centrality measures how often a node appears on shortest paths between other nodes.
     * Nodes with high betweenness centrality are important connectors or bridges in the network.
     */
    async calculateBetweennessCentrality(graph: EnhancedGraph, path: string[]): Promise<Record<string, number>> {
        // A more efficient betweenness centrality calculation
        const result: Record<string, number> = {};

        for (const node of path) {
            result[node] = 0;
        }

        // Skip if path is too short
        if (path.length <= 2) {
            return result;
        }

        const intermediateNodes = path.slice(1, -1);

        const files = this.app.vault.getMarkdownFiles();

        // Take a larger sample if the path is important
        const sampleSize = Math.min(30, Math.max(15, path.length * 3));
        const samplePairs = this.getSamplePairs(files, sampleSize);

        const BATCH_SIZE = 5; // TODO: have a variable/setting for this to match with other batch sizes
        for (let i = 0; i < samplePairs.length; i += BATCH_SIZE) {
            // Check for cancellation
            if (this.cancelAnalysisFlag) {
                return result;
            }

            const batch = samplePairs.slice(i, i + BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async ([source, target]) => {
                if (source.path === target.path) return [];

                const shortestPath = this.graphService.findShortestPath(
                    graph,
                    source.path,
                    target.path
                );
                return shortestPath.distance > 0 ? shortestPath.path : [];
            }));

            // Count node occurrences in paths
            for (const p of batchResults.filter(p => p.length > 0)) {
                for (const node of intermediateNodes) {
                    if (p.includes(node)) {
                        result[node] = (result[node] || 0) + 1;
                    }
                }
            }

            if (this.plugin.settings.showLoadingDetails && i % (BATCH_SIZE * 2) === 0) {
                const progress = Math.round(65 + (i / samplePairs.length) * 5);
                this.updateStatus(`Calculating centrality: ${Math.round((i / samplePairs.length) * 100)}%...`, progress);
            }

            await new Promise(resolve => setTimeout(resolve, 0));
        }

        // normalzie values
        const maxValue = Math.max(...Object.values(result));
        if (maxValue > 0) {
            for (const node in result) {
                // Scale values to a 0-10 range
                result[node] = Math.round((result[node] / maxValue) * 10);
            }
        }

        return result;
    }

    /**
     * Calculate the clustering coefficient for nodes in the path
     * 
     * Clustering coefficient measures how interconnected a node's neighbors are.
     * It helps identify tightly knit groups or clusters in the network.
     */
    async calculateClusteringCoefficient(graph: EnhancedGraph, path: string[]): Promise<Record<string, number>> {
        const result: Record<string, number> = {};

        if (path.length === 0) {
            return result;
        }

        const BATCH_SIZE = 3;
        for (let i = 0; i < path.length; i += BATCH_SIZE) {
            if (this.cancelAnalysisFlag) {
                return result;
            }

            const batch = path.slice(i, i + BATCH_SIZE);

            await Promise.all(batch.map(async (node) => {
                const neighbors = this.getNeighbors(graph, node);

                if (neighbors.length < 2) {
                    // Need at least 2 neighbors to form a triangle
                    result[node] = 0;
                    return;
                }

                let connections = 0;
                const possibleConnections = neighbors.length * (neighbors.length - 1) / 2;

                const MAX_NEIGHBORS_TO_CHECK = 15;
                const neighborsToCheck = neighbors.length > MAX_NEIGHBORS_TO_CHECK ?
                    neighbors.slice(0, MAX_NEIGHBORS_TO_CHECK) : neighbors;

                // Count connections between neighbors
                for (let i = 0; i < neighborsToCheck.length; i++) {
                    for (let j = i + 1; j < neighborsToCheck.length; j++) {
                        const neighbor1 = neighborsToCheck[i];
                        const neighbor2 = neighborsToCheck[j];

                        if (this.hasConnection(graph, neighbor1, neighbor2)) {
                            connections++;
                        }
                    }
                }

                // adjust result based on sampling
                if (neighbors.length > MAX_NEIGHBORS_TO_CHECK) {
                    // Scale the connections based on the sampling ratio
                    const samplingRatio = neighborsToCheck.length / neighbors.length;
                    connections = Math.round(connections / (samplingRatio * samplingRatio));
                }

                // calc clustering coefficient
                result[node] = possibleConnections > 0 ? connections / possibleConnections : 0;
            }));

            if (this.plugin.settings.showLoadingDetails && i % BATCH_SIZE === 0) {
                const progress = Math.round(75 + (i / path.length) * 5);
                this.updateStatus(`Analyzing density: ${Math.round((i / path.length) * 100)}%...`, progress);
            }

            // Small delay to prevent UI freezing
            await new Promise(resolve => setTimeout(resolve, 0));
        }

        return result;
    }

    /**
     * Helper method to get all neighbors of a node
     */
    private getNeighbors(graph: EnhancedGraph, node: string): string[] {
        const outgoing = Array.from((graph[node] || new Map()).keys());

        const incoming: string[] = [];
        for (const [source, targets] of Object.entries(graph)) {
            if (source !== node && targets.has(node)) {
                incoming.push(source);
            }
        }

        // combine and deduplicate
        return [...new Set([...outgoing, ...incoming])];
    }

    /**
     * Helper method to check if two nodes are connected
     */
    private hasConnection(graph: EnhancedGraph, node1: string, node2: string): boolean {
        // Check connection in both directions
        return (graph[node1]?.has(node2) || graph[node2]?.has(node1));
    }

    /**
     * Generate random pairs of files for sampling
     */
    private getSamplePairs(files: TFile[], count: number): [TFile, TFile][] {
        const pairs: [TFile, TFile][] = [];
        const length = files.length;

        // If we have very few files, test all possible pairs
        if (length < 10) {
            for (let i = 0; i < length; i++) {
                for (let j = i + 1; j < length; j++) {
                    pairs.push([files[i], files[j]]);
                    if (pairs.length >= count) return pairs;
                }
            }
            return pairs;
        }

        // Otherwise, sample random pairs
        for (let i = 0; i < count && i < length * (length - 1) / 2; i++) {
            let idx1 = Math.floor(Math.random() * length);
            let idx2 = Math.floor(Math.random() * length);

            // don't sample the same file twice
            while (idx1 === idx2) {
                idx2 = Math.floor(Math.random() * length);
            }

            pairs.push([files[idx1], files[idx2]]);
        }

        return pairs;
    }
};