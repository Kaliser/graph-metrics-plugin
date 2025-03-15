# Graph Metrics for Obsidian

A powerful plugin for analyzing and visualizing connections between notes in your Obsidian vault.

Graph Metrics helps you discover relationships between notes and navigate your knowledge network more effectively. It goes beyond Obsidian's built-in graph view by revealing the *types* of connections between notes, finding optimal paths between any two notes in your vault, and identifying hub notes that serve as knowledge centers.

> **Note:** This plugin is not yet complete and can be unreliable in its current state. Its 1.0.0 release will offer increased stability.

## Features

### Path Analysis
- **Path Finding**: Discover the shortest path between any two notes in your vault.
- **Connection Type Awareness**: Distinguish between different types of connections:
  - Direct wiki links (`[[Note]]`)
  - Backlinks
  - Tag-based connections
  - Embedded content links (`![[Note]]`)
- **Multiple Path Discovery**: Find alternative paths and connections between notes.

### Hub Detection (New!)
- **Note Importance Analysis**: Identify the most central and important notes in your entire vault.
- **Multiple Hub Metrics**:
  - PageRank: Measures global importance based on link structure (similar to Google's algorithm)
  - In-Degree: Counts how many notes link to each note
  - Out-Degree: Counts how many notes each note links to
  - Eigenvector Centrality: Identifies notes connected to other important notes
  - Bridging Coefficient: Discovers notes that connect different topic areas

### Analytics
- **Graph Analytics**: Calculate metrics like betweenness centrality to identify key connector notes in your vault.
- **Performance Optimizations**:
  - Adaptive algorithm selection based on vault size
  - Graph caching for faster repeated analyses
  - Incremental updates for file changes

### Export & UI
- **Export Results**: Save analyses as new notes in your vault for future reference.
- **Visual Interface**: Clearly see connection types and hub importance with visual indicators

> **Warning:** Since all notes in the vault are currently included in the metrics computations, extremely large exported analysis files can cause performance issues when attempting to run this plugin. It's planned to add either an automatic or manual mechanism to ignore these files.

## Installation

### Installation via BRAT

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian Community Plugins.
2. Open BRAT settings, and click "Add Beta plugin".
3. Enter the repository URL: `https://github.com/kaliser/graph-metrics-plugin`
4. Enable the "Graph Metrics" plugin in your Obsidian settings under Community plugins.

## Getting Started

### Path Analysis
1. Enable the plugin in your Obsidian settings.
2. Click the "Graph Metrics" network icon in the ribbon or use the command palette to open the path analysis modal.
3. Select your start and end notes, configure analysis options, and click "Analyze Connections".

### Hub Analysis (New!)
1. Click the "Hub Analysis" star icon in the ribbon or use the command palette's "Analyze Hub Notes" command.
2. Click "Analyze Hub Notes" to scan your entire vault.
3. View the most important hub notes in your vault, ranked by various metrics.
4. Use the "Sort By" dropdown to view different aspects of note importance.
5. Click on any note to open it or use "Export Results" to save the analysis.

## Configuration

Access the plugin settings to customize:

- **Connection Types**: Toggle display of different connection types.
- **Analysis Options**: Configure how connections are analyzed.
  - Include/exclude tags, embedded links, and backlinks
  - Set maximum path length and number of paths to show
- **Hub Analysis** (New!): Customize hub analysis behavior.
  - Set default sorting metric
  - Configure number of hub notes to display
- **Performance Options**: Optimize for your vault size.
  - Toggle graph caching
  - Enable/disable parallel processing
  - Select algorithm preference

## Support

If you encounter any issues or have feature suggestions, please [open an issue](https://github.com/kaliser/graph-metrics-plugin/issues) on the GitHub repository.

## License

This project is licensed under the MIT License - see the LICENSE file for details.