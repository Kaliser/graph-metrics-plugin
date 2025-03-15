import { App, TFile } from 'obsidian';
import { EnhancedGraphService, EnhancedGraph } from './enhanced-graph-service';

export interface HubMetrics {
    pageRank: Record<string, number>;
    inDegree: Record<string, number>;
    outDegree: Record<string, number>;
    totalDegree: Record<string, number>;
    eigenvectorCentrality: Record<string, number>; 
    bridgingCoefficient: Record<string, number>;
}

export interface NoteImportance {
    path: string;
    basename: string;
    pageRank: number;
    inDegree: number;
    outDegree: number;
    totalDegree: number;
    eigenvectorCentrality: number;
    bridgingCoefficient: number;
}

export class HubDetectionService {
    private app: App;
    private settings: any;
    graphService: EnhancedGraphService; // TODO: better OOD? hub analysis needs size of graph
    
    constructor(app: App, settings: any, graphService: EnhancedGraphService) {
        this.app = app;
        this.settings = settings;
        this.graphService = graphService;
    }
    
    /**
     * Calculate various hub metrics for all notes in the vault
     * 
     * @param progressCallback Optional callback for progress updates
     * @returns Object containing various hub metrics
     */
    async calculateHubMetrics(
        progressCallback?: (message: string, progress: number) => void
    ): Promise<HubMetrics> {
        // Get the enhanced graph
        if (progressCallback) {
            progressCallback("Building graph for hub analysis...", 0);
        }
        
        const graph = await this.graphService.getGraph(
            (message, progress) => {
                if (progressCallback) {
                    progressCallback(message, progress * 0.3);
                }
            }
        );
        
        if (progressCallback) {
            progressCallback("Calculating basic connectivity metrics...", 30);
        }
        
        const { inDegree, outDegree, totalDegree } = this.calculateDegreeCentrality(graph);
        
        if (progressCallback) {
            progressCallback("Running PageRank algorithm...", 40);
        }
        
        const pageRank = this.calculatePageRank(graph);
        
        if (progressCallback) {
            progressCallback("Calculating eigenvector centrality...", 60);
        }
        
        const eigenvectorCentrality = this.calculateEigenvectorCentrality(graph);
        
        if (progressCallback) {
            progressCallback("Calculating bridging coefficient...", 80);
        }
        
        const bridgingCoefficient = this.calculateBridgingCoefficient(graph);
        
        if (progressCallback) {
            progressCallback("Hub metrics calculation complete", 100);
        }
        
        return {
            pageRank,
            inDegree,
            outDegree,
            totalDegree,
            eigenvectorCentrality,
            bridgingCoefficient
        };
    }
    
    /**
     * Get the most important notes based on the given metrics
     * 
     * @param metrics The hub metrics
     * @param count Number of top notes to return
     * @returns Array of note importance info
     */
    getTopHubNotes(metrics: HubMetrics, count: number): NoteImportance[] {
        const notes: NoteImportance[] = [];
        
        // Get all unique paths from all metrics
        const allPaths = new Set<string>();
        for (const path of Object.keys(metrics.pageRank)) {
            allPaths.add(path);
        }
        
        // Create importance objects for each note
        for (const path of allPaths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile) {
                notes.push({
                    path,
                    basename: file.basename,
                    pageRank: metrics.pageRank[path] || 0,
                    inDegree: metrics.inDegree[path] || 0,
                    outDegree: metrics.outDegree[path] || 0,
                    totalDegree: metrics.totalDegree[path] || 0,
                    eigenvectorCentrality: metrics.eigenvectorCentrality[path] || 0,
                    bridgingCoefficient: metrics.bridgingCoefficient[path] || 0
                });
            }
        }
        
        // Sort by PageRank (default)
        notes.sort((a, b) => b.pageRank - a.pageRank);
        
        // Return top N notes
        return notes.slice(0, count);
    }
    
    /**
     * Calculate PageRank for all nodes in the graph
     * 
     * PageRank values range from 0 to 1, with higher values indicating more important nodes
     * @param graph The graph to analyze
     * @param dampingFactor Damping factor for the PageRank algorithm (default 0.85)
     * @param iterations Maximum number of iterations to run (default 50)
     * @param tolerance Convergence tolerance for the algorithm (default 0.0001)
     * @returns Object containing PageRank values for each node
     */
    private calculatePageRank(
        graph: EnhancedGraph, 
        dampingFactor: number = 0.85, 
        iterations: number = 50,
        tolerance: number = 0.0001
    ): Record<string, number> {
        const nodes = Object.keys(graph);
        const nodeCount = nodes.length;
        
        let pageRank: Record<string, number> = {};
        let prevPageRank: Record<string, number> = {};
        
        // start with uniform values
        const initialValue = 1.0 / nodeCount;
        for (const node of nodes) {
            pageRank[node] = initialValue;
            prevPageRank[node] = initialValue;
        }
        
        for (let iter = 0; iter < iterations; iter++) {
            // save previous values for convergence check
            for (const node of nodes) {
                prevPageRank[node] = pageRank[node];
                pageRank[node] = 0;
            }
            
            // update values based on neighbors
            for (const [node, edges] of Object.entries(graph)) {
                const outDegree = edges.size;
                
                if (outDegree > 0) {
                    // dist to neighbors
                    const contributionPerNeighbor = prevPageRank[node] / outDegree;
                    
                    for (const neighbor of edges.keys()) {
                        pageRank[neighbor] += dampingFactor * contributionPerNeighbor;
                    }
                } else {
                    // dangling nodes, distribute to all nodes
                    const contribution = prevPageRank[node] / nodeCount;
                    for (const otherNode of nodes) {
                        pageRank[otherNode] += dampingFactor * contribution;
                    }
                }
            }
            
            // damping factor for teleportation
            const baseValue = (1 - dampingFactor) / nodeCount;
            for (const node of nodes) {
                pageRank[node] += baseValue;
            }
            
            // convergence check
            let diff = 0;
            for (const node of nodes) {
                diff += Math.abs(pageRank[node] - prevPageRank[node]);
            }
            
            if (diff < tolerance) {
                break;
            }
        }
        
        // normalize to keep values between 0 and 1
        const maxRank = Math.max(...Object.values(pageRank));
        if (maxRank > 0) {
            for (const node of nodes) {
                pageRank[node] /= maxRank;
            }
        }
        
        return pageRank;
    }
    
    /**
     * Calculate degree centrality measures (in-degree, out-degree, total degree)
     */
    private calculateDegreeCentrality(graph: EnhancedGraph): {
        inDegree: Record<string, number>,
        outDegree: Record<string, number>,
        totalDegree: Record<string, number>
    } {
        const inDegree: Record<string, number> = {};
        const outDegree: Record<string, number> = {};
        const totalDegree: Record<string, number> = {};
        
        // Initialize
        for (const node of Object.keys(graph)) {
            inDegree[node] = 0;
            outDegree[node] = 0;
        }
        
        // Calculate out-degree directly from the graph
        for (const [node, edges] of Object.entries(graph)) {
            outDegree[node] = edges.size;
            
            // Count incoming edges for neighbors
            for (const neighbor of edges.keys()) {
                inDegree[neighbor] = (inDegree[neighbor] || 0) + 1;
            }
        }
        
        // Calculate total degree
        for (const node of Object.keys(graph)) {
            totalDegree[node] = (inDegree[node] || 0) + (outDegree[node] || 0);
        }
        
        return { inDegree, outDegree, totalDegree };
    }
    
    /**
     * Calculate eigenvector centrality for the graph
     * 
     * Eigenvector centrality measures node importance based on connection to other important nodes
     * @param graph The graph to analyze
     * @param iterations Maximum number of iterations to run (default 50)
     * @param tolerance Convergence tolerance for the algorithm (default 0.0001)
     * @returns Object containing eigenvector centrality values for each node
     * @see https://en.wikipedia.org/wiki/Eigenvector_centrality
     */
    private calculateEigenvectorCentrality(
        graph: EnhancedGraph,
        iterations: number = 50,
        tolerance: number = 0.0001
    ): Record<string, number> {
        const nodes = Object.keys(graph);
        const nodeCount = nodes.length;
        
        let centrality: Record<string, number> = {};
        let nextCentrality: Record<string, number> = {};
        
        for (const node of nodes) {
            centrality[node] = 1.0 / nodeCount;
        }
        
        // power iteration method
        for (let iter = 0; iter < iterations; iter++) {
            for (const node of nodes) {
                nextCentrality[node] = 0;
            }
            
            // Update based on neighbors
            for (const [node, edges] of Object.entries(graph)) {
                for (const neighbor of edges.keys()) {
                    nextCentrality[neighbor] = (nextCentrality[neighbor] || 0) + centrality[node];
                }
            }
            
            let norm = 0;
            for (const value of Object.values(nextCentrality)) {
                norm += value * value;
            }
            norm = Math.sqrt(norm); // L2 norm
            
            //norm is too small, all values are close to zero
            if (norm < 1e-10) {
                break;
            }
            
            for (const node of nodes) {
                nextCentrality[node] /= norm;
            }
            
            // Check convergence
            let diff = 0;
            for (const node of nodes) {
                diff += Math.abs(nextCentrality[node] - centrality[node]);
            }
            
            // swap for next iteration
            [centrality, nextCentrality] = [nextCentrality, centrality];
            
            if (diff < tolerance) {
                break;
            }
        }
        
        return centrality;
    }
    
    /**
     * Calculate bridging coefficient for the graph
     * 
     * Bridging coefficient identifies nodes that connect different communities
     * @param graph The graph to analyze
     * @returns Object containing bridging coefficient values for each node
     */
    private calculateBridgingCoefficient(graph: EnhancedGraph): Record<string, number> {
        const bridgingCoef: Record<string, number> = {};
        const nodes = Object.keys(graph);
        
        // Calculate for each node
        for (const node of nodes) {
            const neighbors = this.getNeighbors(graph, node);
            
            if (neighbors.length <= 1) {
                bridgingCoef[node] = 0;
                continue;
            }
            
            // connections ct between neighbors
            let neighborConnections = 0;
            const possibleConnections = neighbors.length * (neighbors.length - 1) / 2;
            
            for (let i = 0; i < neighbors.length; i++) {
                for (let j = i + 1; j < neighbors.length; j++) {
                    if (this.hasConnection(graph, neighbors[i], neighbors[j])) {
                        neighborConnections++;
                    }
                }
            }
            
            //  clustering coeff
            const clustering = possibleConnections > 0 ? 
                neighborConnections / possibleConnections : 0;
            
            // inversely related to clustering
            bridgingCoef[node] = neighbors.length * (1 - clustering);
        }
        
        // normalize values
        const maxValue = Math.max(...Object.values(bridgingCoef));
        if (maxValue > 0) {
            for (const node of nodes) {
                bridgingCoef[node] = bridgingCoef[node] / maxValue;
            }
        }
        
        return bridgingCoef;
    }
    
    /**
     * Helper method to get all neighbors of a node (both incoming and outgoing)
     * @param graph The graph to analyze
     * @param node The node to get neighbors for
     * @returns Array of neighbor nodes
     */
    private getNeighbors(graph: EnhancedGraph, node: string): string[] {
        const outgoing = Array.from((graph[node] || new Map()).keys());
        
        const incoming: string[] = [];
        for (const [source, targets] of Object.entries(graph)) {
            if (source !== node && targets.has(node)) {
                incoming.push(source);
            }
        }
        
        // Combine and deduplicate
        return [...new Set([...outgoing, ...incoming])];
    }
    
    /**
     * Helper method to check if two nodes are connected in either direction
     * @param graph The graph to analyze
     * @param node1 First node
     * @param node2 Second node
     * @returns True if the nodes are connected, false otherwise
     */
    private hasConnection(graph: EnhancedGraph, node1: string, node2: string): boolean {
        return (graph[node1]?.has(node2) || graph[node2]?.has(node1));
    }
}