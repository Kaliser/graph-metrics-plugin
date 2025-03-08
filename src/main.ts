import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { EnhancedGraphService } from './enhanced-graph-service';
import { ConnectionAwareGraphMetricsModal } from './connection-aware-modal';

interface GraphMetricsSettings {
    defaultStartNote: string;
    defaultEndNote: string;
    includeTagsInAnalysis: boolean;
    includeEmbeddedLinks: boolean;
    maxPathsToShow: number;
    maxPathLength: number;
    maxAlternativeNodes: number;
    showLoadingDetails: boolean;
    parallelProcessing: boolean;
    cacheGraphStructure: boolean;
    includeBacklinks: boolean;
    algorithmPreference: 'auto' | 'original' | 'optimized' | 'bidirectional';
    adaptiveAlgorithms: boolean;
    showConnectionTypes: boolean;
    highlightTagConnections: boolean;
}

const DEFAULT_SETTINGS: GraphMetricsSettings = {
    defaultStartNote: '',
    defaultEndNote: '',
    includeTagsInAnalysis: true,
    includeEmbeddedLinks: true,
    maxPathsToShow: 5,
    maxPathLength: 10,
    maxAlternativeNodes: 100,
    showLoadingDetails: true,
    parallelProcessing: true,
    cacheGraphStructure: true,
    includeBacklinks: true,
    algorithmPreference: 'auto',
    adaptiveAlgorithms: true,
    showConnectionTypes: true,
    highlightTagConnections: true
}

export default class GraphMetricsPlugin extends Plugin {
    settings: GraphMetricsSettings;
    cachedGraph: Record<string, string[]> | null = null;
    lastCacheTime: number = 0;
    graphService: EnhancedGraphService;

    async onload() {
        await this.loadSettings();
        this.graphService = new EnhancedGraphService(this.app, this.settings);

        this.addRibbonIcon('network', 'Graph Metrics', () => {
            new ConnectionAwareGraphMetricsModal(this.app, this).open();
        });

        this.addCommand({ // main command
            id: 'analyze-note-paths',
            name: 'Analyze Paths Between Notes',
            callback: () => {
                new ConnectionAwareGraphMetricsModal(this.app, this).open();
            }
        });

        this.addCommand({
            id: 'rebuild-graph-cache',
            name: 'Rebuild Graph Cache',
            callback: async () => {
                new Notice('Rebuilding graph cache...');
                await this.rebuildGraphCache();
                new Notice('Graph cache rebuilt successfully!');
            }
        });

        this.addSettingTab(new GraphMetricsSettingTab(this.app, this));

        this.registerEvent(
            this.app.vault.on('modify', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.updateGraphCache(file, 'modify');
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('create', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.updateGraphCache(file, 'create');
                }
            })
        );

        this.registerEvent(
            this.app.vault.on('delete', (file) => {
                if (file instanceof TFile && file.extension === 'md') {
                    this.updateGraphCache(file, 'delete');
                }
            })
        );
    }

    /**
    * Incrementally updates the graph cache based on file changes
    * 
    * @param changedFile - The file that was modified, created, or deleted
    * @param changeType - Type of change: 'modify', 'create', or 'delete'
    */
    async updateGraphCache(changedFile: TFile, changeType: 'modify' | 'create' | 'delete'): Promise<void> {
        // skip if caching is disabled or if no cache exists yet
        if (!this.settings.cacheGraphStructure || !this.cachedGraph) {
            this.lastCacheTime = 0; // force full rebuild\
            return;
        }

        if (changeType === 'delete') {
            delete this.cachedGraph[changedFile.path]; // remove node from graph

            // remove references to this node from other nodes
            for (const [nodePath, links] of Object.entries(this.cachedGraph)) {
                this.cachedGraph[nodePath] = links.filter(link => link !== changedFile.path);
            }

            this.lastCacheTime = Date.now();
            return;
        }

        // empty node for new files
        if (changeType === 'create') {
            this.cachedGraph[changedFile.path] = [];
        }

        try {
            const content = await this.app.vault.read(changedFile);
            const links: string[] = [];

            const wikiLinkRegex = /\[\[(.*?)(\|.*?)?\]\]/g;
            let match;
            while ((match = wikiLinkRegex.exec(content)) !== null) {
                const linkText = match[1].split('#')[0].split('|')[0].trim();
                if (linkText) {
                    const linkedFile = this.graphService.findNoteByName(linkText);
                    if (linkedFile) {
                        links.push(linkedFile.path);
                    }
                }
            }

            // extract embedded links
            if (this.settings.includeEmbeddedLinks) {
                const embeddedLinkRegex = /!\[\[(.*?)(\|.*?)?\]\]/g;
                let embeddedMatch;
                while ((embeddedMatch = embeddedLinkRegex.exec(content)) !== null) {
                    const linkText = embeddedMatch[1].split('#')[0].split('|')[0].trim();
                    if (linkText) {
                        const linkedFile = this.graphService.findNoteByName(linkText);
                        if (linkedFile) {
                            links.push(linkedFile.path);
                        }
                    }
                }
            }

            if (this.settings.includeTagsInAnalysis) {
                const cache = this.app.metadataCache.getFileCache(changedFile);
                const tags = cache?.tags || [];

                if (tags.length > 0) {
                    const tagValues = tags.map(tag => tag.tag.substring(1));

                    // find notes with matching tags
                    const files = this.app.vault.getMarkdownFiles();
                    const MAX_TAG_MATCHES = 50; // capped to prevent performance issues
                    // TODO: could be a setting?
                    let matchCount = 0;

                    for (const otherFile of files) {
                        if (matchCount >= MAX_TAG_MATCHES) break;
                        if (otherFile.path !== changedFile.path) {
                            const otherCache = this.app.metadataCache.getFileCache(otherFile);
                            const otherTags = otherCache?.tags || [];
                            const otherTagValues = otherTags.map(tag => tag.tag.substring(1));

                            if (tagValues.some(tag => otherTagValues.includes(tag))) {
                                links.push(otherFile.path);
                                matchCount++;
                            }
                        }
                    }
                }
            }

            this.cachedGraph[changedFile.path] = [...new Set(links)]; // update node with new links

            if (this.settings.includeBacklinks) {
                for (const [nodePath, nodeLinks] of Object.entries(this.cachedGraph)) {
                    if (nodePath !== changedFile.path) {
                        // remove backlinks that might no longer be valid
                        const linkIndex = nodeLinks.indexOf(changedFile.path);
                        if (linkIndex >= 0 && !links.includes(nodePath)) {
                            this.cachedGraph[nodePath] = nodeLinks.filter(link => link !== changedFile.path);
                        }

                        // add new backlinks
                        if (links.includes(nodePath) && !nodeLinks.includes(changedFile.path)) {
                            this.cachedGraph[nodePath].push(changedFile.path);
                        }
                    }
                }
            }

            this.lastCacheTime = Date.now();

        } catch (error) {
            console.error(`Error updating graph cache for ${changedFile.path}:`, error);
            this.lastCacheTime = 0; // invalidate cache to force rebuild next time
        }
    }

    async getGraphStructure() {
        return await this.graphService.getGraph();
    }

    async rebuildGraphCache() {
        this.cachedGraph = null;
        this.lastCacheTime = 0;
        await this.getGraphStructure();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class GraphMetricsSettingTab extends PluginSettingTab {
    plugin: GraphMetricsPlugin;

    constructor(app: App, plugin: GraphMetricsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h3', { text: 'Connection Types' });

        new Setting(containerEl)
            .setName('Show Connection Types')
            .setDesc('Visually distinguish between different types of connections')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showConnectionTypes)
                .onChange(async (value) => {
                    this.plugin.settings.showConnectionTypes = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Highlight Tag Connections')
            .setDesc('Use distinct styling for connections based on shared tags')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.highlightTagConnections)
                .onChange(async (value) => {
                    this.plugin.settings.highlightTagConnections = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h2', { text: 'Graph Metrics Settings' });

        containerEl.createEl('h3', { text: 'Default Notes' });

        new Setting(containerEl)
            .setName('Default Start Note')
            .setDesc('Default note to use as starting point')
            .addText(text => text
                .setValue(this.plugin.settings.defaultStartNote)
                .onChange(async (value) => {
                    this.plugin.settings.defaultStartNote = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default End Note')
            .setDesc('Default note to use as ending point')
            .addText(text => text
                .setValue(this.plugin.settings.defaultEndNote)
                .onChange(async (value) => {
                    this.plugin.settings.defaultEndNote = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Analysis Options' });

        new Setting(containerEl)
            .setName('Include Tags in Analysis')
            .setDesc('Consider notes with the same tags as connected')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeTagsInAnalysis)
                .onChange(async (value) => {
                    this.plugin.settings.includeTagsInAnalysis = value;
                    // invalidate the cache to force a rebuild
                    this.plugin.cachedGraph = null;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Include Embedded Links')
            .setDesc('Consider embedded links like ![[Note]] as connections')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeEmbeddedLinks)
                .onChange(async (value) => {
                    this.plugin.settings.includeEmbeddedLinks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Include Backlinks')
            .setDesc('Consider backlinks as connections (improves path finding)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.includeBacklinks)
                .onChange(async (value) => {
                    this.plugin.settings.includeBacklinks = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Maximum Path Length')
            .setDesc('Maximum number of steps to search between notes')
            .addSlider(slider => slider
                .setLimits(2, 20, 1)
                .setValue(this.plugin.settings.maxPathLength)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxPathLength = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Maximum Paths to Show')
            .setDesc('Maximum number of alternative paths to display')
            .addSlider(slider => slider
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.maxPathsToShow)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxPathsToShow = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Maximum Alternative Nodes')
            .setDesc('Maximum number of nodes to explore when finding alternative paths (higher values may be slower)')
            .addSlider(slider => slider
                .setLimits(50, 500, 10)
                .setValue(this.plugin.settings.maxAlternativeNodes)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxAlternativeNodes = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Performance Options' });

        new Setting(containerEl)
            .setName('Cache Graph Structure')
            .setDesc('Store the graph structure in memory to speed up repeated analyses (updates when your vault changes)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.cacheGraphStructure)
                .onChange(async (value) => {
                    this.plugin.settings.cacheGraphStructure = value;
                    if (!value) {
                        this.plugin.cachedGraph = null;
                        this.plugin.lastCacheTime = 0;
                    }
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Parallel Processing')
            .setDesc('Process multiple notes simultaneously for faster analysis (may increase memory usage)')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.parallelProcessing)
                .onChange(async (value) => {
                    this.plugin.settings.parallelProcessing = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'UI Options' });

        new Setting(containerEl)
            .setName('Show Loading Details')
            .setDesc('Show detailed progress information during analysis')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showLoadingDetails)
                .onChange(async (value) => {
                    this.plugin.settings.showLoadingDetails = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Performance Options' });

        new Setting(containerEl)
            .setName('Path Finding Algorithm')
            .setDesc('Choose which algorithm to use for path finding')
            .addDropdown(dropdown => dropdown
                .addOption('auto', 'Auto (Choose based on vault size)')
                .addOption('original', 'Original (Best for small vaults)')
                .addOption('optimized', 'Optimized (Best for medium vaults)')
                .addOption('bidirectional', 'Bidirectional (Best for large vaults)')
                .setValue(this.plugin.settings.algorithmPreference)
                .onChange(async (value) => {
                    this.plugin.settings.algorithmPreference = value as 'auto' | 'original' | 'optimized' | 'bidirectional';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Adaptive Algorithms')
            .setDesc('Automatically switch algorithms based on graph size and structure')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.adaptiveAlgorithms)
                .onChange(async (value) => {
                    this.plugin.settings.adaptiveAlgorithms = value;
                    await this.plugin.saveSettings();
                }));

        const footerEl = containerEl.createEl('div', { cls: 'settings-footer' });
        const rebuildButton = footerEl.createEl('button', {
            text: 'Rebuild Graph Cache',
            cls: 'mod-cta'
        });

        rebuildButton.addEventListener('click', async () => {
            rebuildButton.disabled = true;
            rebuildButton.setText('Rebuilding...');

            try {
                await this.plugin.rebuildGraphCache();
                new Notice('Graph cache rebuilt successfully!');
            } catch (error) {
                console.error('Error rebuilding cache:', error);
                new Notice('Error rebuilding graph cache');
            } finally {
                rebuildButton.disabled = false;
                rebuildButton.setText('Rebuild Graph Cache');
            }
        });
    }
}