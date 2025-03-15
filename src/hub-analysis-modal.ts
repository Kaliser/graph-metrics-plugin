import { App, Modal, TFile, Notice } from 'obsidian';
import { HubDetectionService, HubMetrics, NoteImportance } from './hub-detection-service';

/**
 * Modal for analyzing and displaying hub notes in the vault
 */
export class HubAnalysisModal extends Modal {
    plugin: any;
    hubService: HubDetectionService;
    resultsDiv: HTMLDivElement;
    loadingDiv: HTMLDivElement;
    statusDiv: HTMLDivElement;
    cancelAnalysisFlag: boolean = false;
    analyzeButton: HTMLButtonElement;
    cancelButton: HTMLButtonElement;
    progressBar: HTMLDivElement;
    topCount: number = 20;
    sortBySelector: HTMLSelectElement;
    metrics: HubMetrics | null = null;
    hubNotes: NoteImportance[] = [];

    constructor(app: App, plugin: any) {
        super(app);
        this.plugin = plugin;
        this.hubService = plugin.hubService;
        this.topCount = plugin.settings.defaultHubCount || 20;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hub-analysis-modal');

        contentEl.createEl('h2', { text: 'Hub Notes Analysis' });
        contentEl.createEl('p', {
            text: 'Identify the most important hub notes in your vault using various graph algorithms.',
            cls: 'hub-description'
        });

        const optionsContainer = contentEl.createDiv({ cls: 'options-container' });

        const limitContainer = optionsContainer.createDiv({ cls: 'option-container' });
        limitContainer.createEl('label', { text: 'Show Top Notes:' });
        const limitInput = limitContainer.createEl('input', {
            type: 'number',
            value: String(this.topCount),
            attr: {
                min: '5',
                max: '100'
            }
        });
        limitInput.addEventListener('change', () => {
            this.topCount = parseInt(limitInput.value);
            if (this.metrics) {
                this.displayResults(this.metrics);
            }
        });

        const sortContainer = optionsContainer.createDiv({ cls: 'option-container' });
        sortContainer.createEl('label', { text: 'Sort By:' });
        this.sortBySelector = sortContainer.createEl('select');

        const sortOptions = [
            { value: 'pageRank', label: 'PageRank (Overall Importance)' },
            { value: 'inDegree', label: 'In-Degree (Incoming Links)' },
            { value: 'outDegree', label: 'Out-Degree (Outgoing Links)' },
            { value: 'totalDegree', label: 'Total Connections' },
            { value: 'eigenvectorCentrality', label: 'Eigenvector Centrality' },
            { value: 'bridgingCoefficient', label: 'Bridging Coefficient' },
        ];

        for (const option of sortOptions) {
            const optionEl = this.sortBySelector.createEl('option', {
                value: option.value,
                text: option.label
            });

            if (option.value === this.plugin.settings.hubAnalysisDefaultMetric) {
                optionEl.selected = true;
            }
        }

        this.sortBySelector.addEventListener('change', () => {
            if (this.metrics) {
                this.displayResults(this.metrics);
            }
        });

        const buttonContainer = contentEl.createDiv({ cls: 'button-container' });
        this.analyzeButton = buttonContainer.createEl('button', {
            text: 'Analyze Hub Notes',
            cls: 'mod-cta'
        });
        this.analyzeButton.addEventListener('click', () => {
            this.topCount = parseInt(limitInput.value);
            this.analyzeHubs();
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
        this.resultsDiv.style.display = 'none';
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

    async analyzeHubs() {
        this.cancelAnalysisFlag = false;

        this.loadingDiv.style.display = 'block';
        this.resultsDiv.style.display = 'none';
        this.analyzeButton.style.display = 'none';
        this.cancelButton.style.display = 'block';

        this.updateStatus('Initializing hub analysis...', 0);

        try {
            const startTime = performance.now();

            this.metrics = await this.hubService.calculateHubMetrics(
                (message, progress) => this.updateStatus(message, progress)
            );

            // check for cancellation
            if (this.cancelAnalysisFlag) {
                this.finishLoading('Analysis cancelled');
                return;
            }

            this.updateStatus('Preparing results...', 95);

            this.displayResults(this.metrics);

            const totalTime = Math.round(performance.now() - startTime);
            this.finishLoading(`Analysis completed in ${totalTime}ms`);

        } catch (error) {
            this.finishLoading('Error during analysis');
            this.resultsDiv.empty();
            this.resultsDiv.style.display = 'block';
            this.resultsDiv.createEl('p', {
                text: `Error: ${error.message}`,
                cls: 'error-message'
            });
        }
    }

    finishLoading(finalMessage: string) {
        this.updateStatus(finalMessage, 100);
        setTimeout(() => {
            this.loadingDiv.style.display = 'none';
            this.resultsDiv.style.display = 'block';
            this.analyzeButton.style.display = 'block';
            this.cancelButton.style.display = 'none';
        }, 500);
    }

    displayResults(metrics: HubMetrics) {
        const resultsDiv = this.resultsDiv;
        resultsDiv.empty();

        const sortBy = this.sortBySelector.value;

        this.hubNotes = this.hubService.getTopHubNotes(metrics, this.hubService.graphService.graphSize);

        this.hubNotes.sort((a, b) => {
            const valA = a[sortBy as keyof NoteImportance];
            const valB = b[sortBy as keyof NoteImportance];
            return typeof valA === 'number' && typeof valB === 'number'
                ? valB - valA
                : String(valB).localeCompare(String(valA));
        });

        // take only top N
        const topNotes = this.hubNotes.slice(0, this.topCount);

        // summary
        resultsDiv.createEl('h3', { text: 'Hub Notes Analysis Results' });

        const summaryEl = resultsDiv.createDiv({ cls: 'summary-container' });
        summaryEl.createEl('p', {
            text: `Found ${this.hubNotes.length} notes in your vault, showing top ${topNotes.length} hub notes sorted by ${this.getSortDescription(sortBy)}`,
            cls: 'summary-text'
        });

        this.addMetricsDescription(resultsDiv);

        const tableContainer = resultsDiv.createDiv({ cls: 'table-container' });
        const table = tableContainer.createEl('table', { cls: 'hub-results-table' });

        const thead = table.createEl('thead');
        const headerRow = thead.createEl('tr');
        headerRow.createEl('th', { text: 'Note' });
        headerRow.createEl('th', { text: 'PageRank', cls: 'numeric-col' });
        headerRow.createEl('th', { text: 'In', cls: 'numeric-col' });
        headerRow.createEl('th', { text: 'Out', cls: 'numeric-col' });
        headerRow.createEl('th', { text: 'Total', cls: 'numeric-col' });
        headerRow.createEl('th', { text: 'Eigenvector', cls: 'numeric-col' });
        headerRow.createEl('th', { text: 'Bridging', cls: 'numeric-col' });

        const tbody = table.createEl('tbody');

        // maximum values for each metric to normalize the bar width
        const maxPageRank = Math.max(...topNotes.map(n => n.pageRank));
        const maxInDegree = Math.max(...topNotes.map(n => n.inDegree));
        const maxOutDegree = Math.max(...topNotes.map(n => n.outDegree));
        const maxTotalDegree = Math.max(...topNotes.map(n => n.totalDegree));
        const maxEigen = Math.max(...topNotes.map(n => n.eigenvectorCentrality));
        const maxBridging = Math.max(...topNotes.map(n => n.bridgingCoefficient));

        for (const note of topNotes) {
            const row = tbody.createEl('tr');

            // note link cells
            const noteCell = row.createEl('td');
            const noteLink = noteCell.createEl('a', {
                text: note.basename,
                cls: 'note-link'
            });

            noteLink.addEventListener('click', () => {
                // open the note in the active leaf
                const file = this.app.vault.getAbstractFileByPath(note.path);
                if (file instanceof TFile) {
                    this.app.workspace.getLeaf().openFile(file);
                }
            });

            this.createMetricCell(row, note.pageRank, maxPageRank);
            this.createMetricCell(row, note.inDegree, maxInDegree, true);
            this.createMetricCell(row, note.outDegree, maxOutDegree, true);
            this.createMetricCell(row, note.totalDegree, maxTotalDegree, true);
            this.createMetricCell(row, note.eigenvectorCentrality, maxEigen);
            this.createMetricCell(row, note.bridgingCoefficient, maxBridging);
        }

        const exportButton = resultsDiv.createEl('button', {
            text: 'Export Results',
            cls: 'export-button'
        });

        exportButton.addEventListener('click', () => {
            this.exportResults(topNotes, sortBy);
        });
    }

    /**
     * Create a table cell with a visual bar representing the metric value.
     * @param row The table row to add the cell to
     * @param value The metric value to display
     * @param maxValue The maximum value for the metric to normalize the bar width
     * @param isInteger Whether the value should be displayed as an integer (rounded) or float (2 decimal places)
     * 
     */
    createMetricCell(row: HTMLTableRowElement, value: number, maxValue: number, isInteger: boolean = false) {
        const cell = row.createEl('td', { cls: 'metric-cell' });

        // const percent = maxValue > 0 ? (value / maxValue) * 100 : 0;

        // const barContainer = cell.createEl('div', { cls: 'bar-container' });

        // TODO: see if we can make this not terribly ugly
        // const bar = barContainer.createEl('div', { cls: 'bar' }); // colored bar
        // bar.style.width = `${percent}%`;

        const valueText = isInteger ? Math.round(value).toString() : value.toFixed(2);
        cell.createEl('span', {
            text: valueText,
            cls: 'value-text'
        });
    }

    /**
     * Add description of metrics to the results
     * @param container The container element to add the description to
     */
    addMetricsDescription(container: HTMLElement) {
        const legendEl = container.createDiv({ cls: 'metrics-legend' });
        legendEl.createEl('h4', { text: 'Understanding the Metrics' });

        const metrics = [
            {
                name: 'PageRank',
                desc: 'Overall importance of a note based on link structure (similar to Google\'s algorithm)'
            },
            {
                name: 'In-Degree',
                desc: 'Number of notes that link to this note'
            },
            {
                name: 'Out-Degree',
                desc: 'Number of notes this note links to'
            },
            {
                name: 'Total',
                desc: 'Total number of connections (in + out)'
            },
            {
                name: 'Eigenvector',
                desc: 'Importance based on being connected to other important notes'
            },
            {
                name: 'Bridging',
                desc: 'How well this note connects otherwise separate parts of your vault'
            }
        ];

        const legendList = legendEl.createEl('div', { cls: 'legend-list' });

        for (const metric of metrics) {
            const metricEl = legendList.createEl('div', { cls: 'legend-item' });
            metricEl.createEl('span', { text: metric.name, cls: 'legend-name' });
            metricEl.createEl('span', { text: metric.desc, cls: 'legend-desc' });
        }
    }

    /**
     * Get a user-friendly description of the sorting metric
     * @param sortBy The metric to describe. One of 'pageRank', 'inDegree', 'outDegree', 'totalDegree', 'eigenvectorCentrality', 'bridgingCoefficient'
     */
    getSortDescription(sortBy: string): string {
        switch (sortBy) {
            case 'pageRank': return 'PageRank (Overall Importance)';
            case 'inDegree': return 'In-Degree (Incoming Links)';
            case 'outDegree': return 'Out-Degree (Outgoing Links)';
            case 'totalDegree': return 'Total Connections';
            case 'eigenvectorCentrality': return 'Eigenvector Centrality';
            case 'bridgingCoefficient': return 'Bridging Coefficient';
            default: return sortBy;
        }
    }

    /**
     * Export results to a new note in the vault
     */
    exportResults(notes: NoteImportance[], sortBy: string) {
        let markdown = `Analysis performed on ${new Date().toLocaleString()}\n\n`;

        markdown += `## Top ${notes.length} Hub Notes by ${this.getSortDescription(sortBy)}\n\n`;

        markdown += `| Note | PageRank | In-Degree | Out-Degree | Total | Eigenvector | Bridging |\n`;
        markdown += `| ---- | -------: | --------: | ---------: | ----: | ----------: | -------: |\n`;

        for (const note of notes) {
            markdown += `| [[${note.basename}]] | ${note.pageRank.toFixed(2)} | ${Math.round(note.inDegree)} | ${Math.round(note.outDegree)} | ${Math.round(note.totalDegree)} | ${note.eigenvectorCentrality.toFixed(2)} | ${note.bridgingCoefficient.toFixed(2)} |\n`;
        }

        markdown += `\n## Understanding the Metrics\n\n`;
        markdown += `- **PageRank**: Overall importance of a note based on link structure (similar to Google's algorithm)\n`;
        markdown += `- **In-Degree**: Number of notes that link to this note\n`;
        markdown += `- **Out-Degree**: Number of notes this note links to\n`;
        markdown += `- **Total**: Total number of connections (in + out)\n`;
        markdown += `- **Eigenvector**: Importance based on being connected to other important notes\n`;
        markdown += `- **Bridging**: How well this note connects otherwise separate parts of your vault\n\n`;

        markdown += `---\n`;
        markdown += `Graph Metrics Plugin v${this.plugin.manifest.version}\n`;
        markdown += `Hub Analysis generated: ${new Date().toLocaleString()}\n`;
        markdown += `---\n`;

        // saving as a new note
        const fileName = `Hub Analysis ${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.md`;

        this.app.vault.create(fileName, markdown)
            .then((file) => {
                this.app.workspace.getLeaf().openFile(file);
                new Notice('Hub analysis exported successfully!');
            })
            .catch((error) => {
                console.error('Error saving export:', error);
                new Notice('Error exporting hub analysis');
            });
    }
}