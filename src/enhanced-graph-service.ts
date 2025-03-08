import { App, TFile } from 'obsidian';

export enum ConnectionType {
    DIRECT = 'direct',
    BACKLINK = 'backlink',
    TAG = 'tag',
    EMBEDDED = 'embedded'
}

// connection metadata interface
export interface ConnectionInfo {
    type: ConnectionType;
    commonTags?: string[];
    metadata?: {
        title?: string;
        tags?: string[];
        excerpt?: string;
    };
}

export type EnhancedGraph = Record<string, Map<string, ConnectionInfo>>;

export interface PathResult {
    distance: number;
    path: string[];
    connectionTypes: ConnectionInfo[];
}

export class EnhancedGraphService {
    private app: App;
    private settings: any;
    private cachedGraph: EnhancedGraph | null = null;
    private lastCacheTime: number = 0;
    
    constructor(app: App, settings: any) {
        this.app = app;
        this.settings = settings;
    }
    
    findNoteByName(name: string): TFile | null {
        const files = this.app.vault.getMarkdownFiles();
        
        // first try exact match
        const exactMatch = files.find(file => file.basename === name);
        if (exactMatch) return exactMatch;
        
        // then try case-insensitive match
        const caseInsensitiveMatch = files.find(
            file => file.basename.toLowerCase() === name.toLowerCase()
        );
        if (caseInsensitiveMatch) return caseInsensitiveMatch;
        
        // finally try partial match
        const partialMatch = files.find(
            file => file.basename.toLowerCase().includes(name.toLowerCase())
        );
        return partialMatch || null;
    }
    
    async getGraph(progressCallback?: (message: string, progress: number) => void): Promise<EnhancedGraph> {
        // using cached graph if available and not too old
        if (
            this.settings.cacheGraphStructure &&
            this.cachedGraph &&
            (Date.now() - this.lastCacheTime) < 60000 // 1 minute cache validity
            // TODO: make cache time configurable. also reconsider time based caches at all
        ) {
            if (progressCallback) {
                progressCallback("Using cached graph...", 100);
            }
            return this.cachedGraph;
        }
        
        const graph = await this.buildGraph(progressCallback);
        
        if (this.settings.cacheGraphStructure) {
            this.cachedGraph = graph;
            this.lastCacheTime = Date.now();
        }
        
        return graph;
    }
    
    async buildGraph(
        progressCallback?: (message: string, progress: number) => void
    ): Promise<EnhancedGraph> {
        const graph: EnhancedGraph = {};
        const files = this.app.vault.getMarkdownFiles();
        const totalFiles = files.length;
        
        // init all nodes in the graph
        for (const file of files) {
            graph[file.path] = new Map();
        }
        
        const BATCH_SIZE = this.settings.parallelProcessing ? 10 : 5; // TODO: appropriate batch sizes?
        let processedFiles = 0;
        
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
            const batch = files.slice(i, i + BATCH_SIZE);
            
            if (this.settings.parallelProcessing) {
                await Promise.all(batch.map(file => this.processFile(file, graph, files)));
            } else {
                for (const file of batch) {
                    await this.processFile(file, graph, files);
                }
            }
            
            processedFiles += batch.length;
            
            if (progressCallback) {
                const progress = Math.round((processedFiles / totalFiles) * 100);
                progressCallback(
                    `Building graph: ${processedFiles}/${totalFiles} notes processed...`, 
                    progress
                );
            }
            
            // small delay to prevent UI freezing
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        
        if (this.settings.includeBacklinks) {
            this.processBacklinks(graph);
        }
        
        return graph;
    }
    
    private async processFile(
        file: TFile, 
        graph: EnhancedGraph, 
        allFiles: TFile[]
    ): Promise<void> {
        try {
            const content = await this.app.vault.read(file);
            
            const cache = this.app.metadataCache.getFileCache(file);
            const fileTags = (cache?.tags || []).map(tag => tag.tag.substring(1));
            
            const wikiLinkRegex = /\[\[(.*?)(\|.*?)?\]\]/g;
            let match;
            
            while ((match = wikiLinkRegex.exec(content)) !== null) {
                const linkText = match[1].split('#')[0].split('|')[0].trim();
                if (linkText) {
                    const linkedFile = this.findNoteByName(linkText);
                    if (linkedFile) {
                        // store as direct link
                        graph[file.path].set(linkedFile.path, {
                            type: ConnectionType.DIRECT,
                            metadata: this.getFileMetadata(linkedFile)
                        });
                    }
                }
            }
            
            if (this.settings.includeEmbeddedLinks) {
                const embeddedLinkRegex = /!\[\[(.*?)(\|.*?)?\]\]/g;
                let embeddedMatch;
                
                while ((embeddedMatch = embeddedLinkRegex.exec(content)) !== null) {
                    const linkText = embeddedMatch[1].split('#')[0].split('|')[0].trim();
                    if (linkText) {
                        const linkedFile = this.findNoteByName(linkText);
                        if (linkedFile) {
                            // store as embedded link
                            graph[file.path].set(linkedFile.path, {
                                type: ConnectionType.EMBEDDED,
                                metadata: this.getFileMetadata(linkedFile)
                            });
                        }
                    }
                }
            }
            
            if (this.settings.includeTagsInAnalysis && fileTags.length > 0) {
                // find notes with matching tags (limit to MAX_TAG_MATCHES)
                const MAX_TAG_MATCHES = 50; 
                let matchCount = 0;
                
                // prioritize files with multiple tag matches
                const tagMatchCounts: Record<string, { file: TFile, tags: string[] }> = {};
                
                for (const otherFile of allFiles) {
                    if (otherFile.path !== file.path) {
                        const otherCache = this.app.metadataCache.getFileCache(otherFile);
                        const otherTags = (otherCache?.tags || []).map(tag => tag.tag.substring(1));
                        
                        if (otherTags.length > 0) {
                            const commonTags = fileTags.filter(tag => otherTags.includes(tag));
                            
                            if (commonTags.length > 0) {
                                tagMatchCounts[otherFile.path] = {
                                    file: otherFile,
                                    tags: commonTags
                                };
                            }
                        }
                    }
                }
                
                const sortedMatches = Object.entries(tagMatchCounts)
                    .sort((a, b) => b[1].tags.length - a[1].tags.length); // descending order
                
                // add top matches to graph
                for (const [_, { file: otherFile, tags: commonTags }] of sortedMatches) {
                    if (matchCount >= MAX_TAG_MATCHES) break;
                    
                    // store as tag connection with the common tags
                    graph[file.path].set(otherFile.path, { 
                        type: ConnectionType.TAG, 
                        commonTags: commonTags,
                        metadata: this.getFileMetadata(otherFile)
                    });
                    
                    matchCount++;
                }
            }
            
        } catch (error) {
            console.error(`Error processing file ${file.path}:`, error);
        }
    }
    
    private processBacklinks(graph: EnhancedGraph): void {
        for (const [source, targets] of Object.entries(graph)) {
            for (const [target, info] of targets.entries()) {
                // Only add backlink if there's not already a direct connection
                if (!graph[target].has(source)) {
                    const sourceFile = this.app.vault.getAbstractFileByPath(source);
                    if (sourceFile instanceof TFile) {
                        graph[target].set(source, {
                            type: ConnectionType.BACKLINK,
                            metadata: this.getFileMetadata(sourceFile)
                        });
                    }
                }
            }
        }
    }
    
    private getFileMetadata(file: TFile): ConnectionInfo['metadata'] {
        const cache = this.app.metadataCache.getFileCache(file);
        
        return {
            title: file.basename,
            tags: cache?.tags?.map(tag => tag.tag.substring(1)) || []
        };
    }

    findShortestPath(
        graph: EnhancedGraph, 
        start: string, 
        end: string
    ): PathResult {
        // edge cases
        if (start === end) {
            return { distance: 0, path: [start], connectionTypes: [] };
        }
        
        if (!graph[start] || !graph[end]) {
            return { distance: -1, path: [], connectionTypes: [] };
        }
        
        // choose algorithm based on graph size
        const graphSize = Object.keys(graph).length;
        
        if (graphSize < 500 || this.settings.algorithmPreference === 'original') {
            // TODO: check if appropriate threshold
            return this.findShortestPathOriginal(graph, start, end);
        } else {
            return this.findShortestPathBidirectional(graph, start, end);
        }
    }
    
    /**
     *  low overhead BFS implementation for small graphs
     */
    private findShortestPathOriginal(
        graph: EnhancedGraph, 
        start: string, 
        end: string
    ): PathResult {
        // BFS implementation
        const queue: { 
            node: string; 
            distance: number; 
            path: string[];
            connectionTypes: ConnectionInfo[];
        }[] = [
            { node: start, distance: 0, path: [start], connectionTypes: [] }
        ];
        
        const visited = new Set<string>([start]);
        
        while (queue.length > 0) {
            const { node, distance, path, connectionTypes } = queue.shift()!;
            
            if (distance >= this.settings.maxPathLength) {
                continue;
            }
            
            if (node === end) {
                return { distance, path, connectionTypes };
            }
            
            const neighbors = graph[node] || new Map();
            
            for (const [neighbor, connectionInfo] of neighbors.entries()) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push({
                        node: neighbor,
                        distance: distance + 1,
                        path: [...path, neighbor],
                        connectionTypes: [...connectionTypes, connectionInfo]
                    });
                }
            }
        }
        
        // no path found
        return { distance: -1, path: [], connectionTypes: [] };
    }
    
    /**
     * Bidirectional BFS implementation with connection tracking for large graphs
     */
    private findShortestPathBidirectional(
        graph: EnhancedGraph, 
        start: string, 
        end: string
    ): PathResult {
        // Forward search state
        const forwardVisited = new Map<string, { 
            prev: string, 
            distance: number,
            connectionInfo: ConnectionInfo | null 
        }>();
        forwardVisited.set(start, { prev: "", distance: 0, connectionInfo: null });
        const forwardQueue: string[] = [start];
        
        // backward search state
        const backwardVisited = new Map<string, { 
            prev: string, 
            distance: number,
            connectionInfo: ConnectionInfo | null 
        }>();
        backwardVisited.set(end, { prev: "", distance: 0, connectionInfo: null });
        const backwardQueue: string[] = [end];
        
        // meeting point tracking
        let meetingNode: string | null = null;
        let shortestDistance = Infinity;
        
        // BFS until queues are empty or we find a meeting point
        while (forwardQueue.length > 0 && backwardQueue.length > 0) {
            // process one level of forward search
            if (forwardQueue.length <= backwardQueue.length) {
                const levelSize = forwardQueue.length;
                
                for (let i = 0; i < levelSize; i++) {
                    const node = forwardQueue.shift()!;
                    const nodeInfo = forwardVisited.get(node)!;
                    
                    // skip if we've reached max distance or found a shorter path
                    if (nodeInfo.distance >= this.settings.maxPathLength ||
                        nodeInfo.distance >= shortestDistance) {
                        continue;
                    }
                    
                    const neighbors = graph[node] || new Map();
                    
                    for (const [neighbor, connectionInfo] of neighbors.entries()) {
                        if (!forwardVisited.has(neighbor)) {
                            forwardVisited.set(neighbor, {
                                prev: node,
                                distance: nodeInfo.distance + 1,
                                connectionInfo: connectionInfo
                            });
                            forwardQueue.push(neighbor);
                            
                            // check if we've found a meeting point
                            if (backwardVisited.has(neighbor)) {
                                const totalDistance = nodeInfo.distance + 1 + 
                                                    backwardVisited.get(neighbor)!.distance;
                                
                                if (totalDistance < shortestDistance) {
                                    shortestDistance = totalDistance;
                                    meetingNode = neighbor;
                                }
                            }
                        }
                    }
                }
            } else {
                // process one level of backward search
                const levelSize = backwardQueue.length;
                
                for (let i = 0; i < levelSize; i++) {
                    const node = backwardQueue.shift()!;
                    const nodeInfo = backwardVisited.get(node)!;
                    
                    if (nodeInfo.distance >= this.settings.maxPathLength ||
                        nodeInfo.distance >= shortestDistance) {
                        continue;
                    }
                    
                    // check neighbors (incoming connections)
                    const neighbors = new Map<string, ConnectionInfo>();
                    
                    for (const [source, targets] of Object.entries(graph)) {
                        if (targets.has(node)) {
                            const origInfo = targets.get(node)!;
                            const reverseInfo: ConnectionInfo = { 
                                ...origInfo,
                                // flip direct/backlink types for correct path reconstruction
                                type: origInfo.type === ConnectionType.DIRECT 
                                    ? ConnectionType.BACKLINK
                                    : origInfo.type === ConnectionType.BACKLINK
                                        ? ConnectionType.DIRECT
                                        : origInfo.type
                            };
                            neighbors.set(source, reverseInfo);
                        }
                    }
                    
                    for (const [neighbor, connectionInfo] of neighbors.entries()) {
                        if (!backwardVisited.has(neighbor)) {
                            backwardVisited.set(neighbor, {
                                prev: node,
                                distance: nodeInfo.distance + 1,
                                connectionInfo: connectionInfo
                            });
                            backwardQueue.push(neighbor);
                            
                            // Check if we've found a meeting point
                            if (forwardVisited.has(neighbor)) {
                                const totalDistance = nodeInfo.distance + 1 + 
                                                    forwardVisited.get(neighbor)!.distance;
                                
                                if (totalDistance < shortestDistance) {
                                    shortestDistance = totalDistance;
                                    meetingNode = neighbor;
                                }
                            }
                        }
                    }
                }
            }
            
            if (meetingNode !== null &&
                shortestDistance <= Math.min(
                    forwardVisited.get(forwardQueue[0] || "")?.distance || Infinity,
                    backwardVisited.get(backwardQueue[0] || "")?.distance || Infinity
                )) {
                break;
            }
        }
        
        if (meetingNode !== null) {
            // Construct forward half of the path
            const forwardPath: string[] = [];
            const forwardConnectionTypes: ConnectionInfo[] = [];
            let current = meetingNode;
            
            while (current !== start && forwardVisited.has(current)) {
                forwardPath.unshift(current);
                
                const currentInfo = forwardVisited.get(current)!;
                if (currentInfo.connectionInfo) {
                    forwardConnectionTypes.unshift(currentInfo.connectionInfo);
                }
                
                current = currentInfo.prev;
            }
            
            // start node
            forwardPath.unshift(start);
            
            // Construct backward half of the path
            const backwardPath: string[] = [];
            const backwardConnectionTypes: ConnectionInfo[] = [];
            current = meetingNode;
            
            while (current !== end && backwardVisited.has(current)) {
                const currentInfo = backwardVisited.get(current)!;
                current = currentInfo.prev;
                
                if (current !== end) {
                    backwardPath.push(current);
                    
                    if (currentInfo.connectionInfo) {
                        const fixedConnectionInfo = { ...currentInfo.connectionInfo };
                        if (fixedConnectionInfo.type === ConnectionType.BACKLINK) {
                            fixedConnectionInfo.type = ConnectionType.DIRECT;
                        } else if (fixedConnectionInfo.type === ConnectionType.DIRECT) {
                            fixedConnectionInfo.type = ConnectionType.BACKLINK;
                        }
                        
                        backwardConnectionTypes.push(fixedConnectionInfo);
                    }
                }
            }
            
            // end node
            backwardPath.push(end);
            
            // combine paths avoiding duplicating the meeting node
            const path = [...forwardPath];
            if (backwardPath.length > 0) {
                // skip first element of backward path if it's the meeting node
                if (backwardPath[0] === meetingNode) {
                    path.push(...backwardPath.slice(1));
                } else {
                    path.push(...backwardPath);
                }
            }
            
            // Combine connection types
            const connectionTypes = [...forwardConnectionTypes, ...backwardConnectionTypes];
            
            return {
                distance: shortestDistance,
                path,
                connectionTypes
            };
        }
        
        return { distance: -1, path: [], connectionTypes: [] };
    }
    
    /**
     * Find all paths between two nodes with connection info
     */
    findAllPaths(
        graph: EnhancedGraph,
        start: string,
        end: string,
        maxPaths: number = 5
    ): PathResult[] {
        const shortestResult = this.findShortestPath(graph, start, end);
        
        if (shortestResult.distance === -1) {
            return []; // No path exists
        }
        
        const paths: PathResult[] = [shortestResult];
        
        // If we just need one path, return the shortest
        if (maxPaths <= 1) {
            return paths;
        }
        
        // for additional paths, use a modified DFS with path exclusion
        const visited = new Set<string>([start]);
        const currentPath: string[] = [start];
        const currentConnectionTypes: ConnectionInfo[] = [];
        
        const modifiedGraph = this.createAltPathGraph(graph, shortestResult.path);
        
        // Find alternative paths using DFS
        this.findAlternativePaths(
            modifiedGraph,
            start,
            end,
            currentPath,
            currentConnectionTypes,
            visited,
            paths,
            maxPaths,
            this.settings.maxPathLength
        );
        
        return paths.sort((a, b) => a.path.length - b.path.length);
    }
    
    /**
     * Create a modified graph for finding alternative paths
     */
    private createAltPathGraph(
        graph: EnhancedGraph,
        shortestPath: string[]
    ): EnhancedGraph {
        const modifiedGraph: EnhancedGraph = {};
        
        for (const [node, edges] of Object.entries(graph)) {
            modifiedGraph[node] = new Map(edges);
        }
        
        if (shortestPath.length > 3) {
            // For each interior node in the shortest path
            for (let i = 1; i < shortestPath.length - 1; i++) {
                const node = shortestPath[i];
                
                // For odd-indexed internal nodes, remove some connections
                // This forces the search to find alternative routes
                if (i % 2 === 1 && i < shortestPath.length - 2) {
                    const nextNode = shortestPath[i + 1];
                    if (modifiedGraph[node]?.has(nextNode)) {
                        modifiedGraph[node].delete(nextNode);
                    }
                }
            }
        }
        
        return modifiedGraph;
    }
    
    /**
     * Recursively find alternative paths using DFS
     */
    private findAlternativePaths(
        graph: EnhancedGraph,
        currentNode: string,
        endNode: string,
        currentPath: string[],
        currentConnectionTypes: ConnectionInfo[],
        visited: Set<string>,
        paths: PathResult[],
        maxPaths: number,
        maxPathLength: number
    ): void {
        // found enough paths or the path is too long
        if (paths.length >= maxPaths || currentPath.length > maxPathLength) {
            return;
        }
        
        if (currentNode === endNode) {
            // Found a path - verify it's not a duplicate
            if (!this.isDuplicatePath(paths, currentPath)) {
                paths.push({
                    distance: currentPath.length - 1,
                    path: [...currentPath],
                    connectionTypes: [...currentConnectionTypes]
                });
            }
            return;
        }
        
        visited.add(currentNode);
        
        const neighbors = graph[currentNode] || new Map();
        
        // Convert to array and randomize to find diverse path
        // TODO: are random paths useful?
        const neighborEntries = [...neighbors.entries()];
        this.shuffleArray(neighborEntries);
        
        for (const [neighbor, connectionInfo] of neighborEntries) {
            if (!visited.has(neighbor)) {
                currentPath.push(neighbor);
                currentConnectionTypes.push(connectionInfo);
                
                // rcursively explore
                this.findAlternativePaths(
                    graph,
                    neighbor,
                    endNode,
                    currentPath,
                    currentConnectionTypes,
                    visited,
                    paths,
                    maxPaths,
                    maxPathLength
                );
                
                // Backtrack
                currentPath.pop();
                currentConnectionTypes.pop();
            }
        }
        
        // Unmark on backtrack
        visited.delete(currentNode);
    }
    
    /**
     * Check if a path is a duplicate of any existing path
     */
    private isDuplicatePath(paths: PathResult[], newPath: string[]): boolean {
        for (const existingPath of paths) {
            if (existingPath.path.length !== newPath.length) {
                continue;
            }
            
            let identical = true;
            for (let i = 0; i < existingPath.path.length; i++) {
                if (existingPath.path[i] !== newPath[i]) {
                    identical = false;
                    break;
                }
            }
            
            if (identical) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Shuffle an array in place using Fisher-Yates algorithm. Used for random paths. May be removed if random paths are not useful.
     */
    private shuffleArray<T>(array: T[]): void {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
    
    /**
     * Update the enhanced graph cache for a modified file - used for incremental updates
     */
    async updateGraphCache(
        changedFile: TFile, 
        changeType: 'modify' | 'create' | 'delete'
    ): Promise<void> {
        if (!this.settings.cacheGraphStructure || !this.cachedGraph) {
            this.lastCacheTime = 0;
            return;
        }
        
        if (changeType === 'delete') {
            delete this.cachedGraph[changedFile.path];
            
            // Remove references to this node from other nodes
            for (const edges of Object.values(this.cachedGraph)) {
                if (edges.has(changedFile.path)) {
                    edges.delete(changedFile.path);
                }
            }
            
            this.lastCacheTime = Date.now();
            return;
        }
        
        if (changeType === 'create') {
            this.cachedGraph[changedFile.path] = new Map();
        }
        
        try {
            // Process the single file to update its connections
            const files = this.app.vault.getMarkdownFiles();
            await this.processFile(changedFile, this.cachedGraph, files);
            
            this.lastCacheTime = Date.now();
        } catch (error) {
            console.error(`Error updating graph cache for ${changedFile.path}:`, error);
            this.lastCacheTime = 0;
        }
    }
}