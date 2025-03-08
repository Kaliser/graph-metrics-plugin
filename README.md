# Graph Metrics for Obsidian

A powerful plugin for analyzing and visualizing connections between notes in your Obsidian vault.

Graph Metrics helps you discover relationships between notes and navigate your knowledge network more effectively. It goes beyond Obsidian's built-in graph view by revealing the *types* of connections between notes and finding optimal paths between any two notes in your vault.

> **Note:** This plugin is not yet complete and can be unreliable in its current state. Its 1.0.0 release will offer increased stability.

## Features

- **Path Finding**: Discover the shortest path between any two notes in your vault.
- **Connection Type Awareness**: Distinguish between different types of connections:
  - Direct wiki links (`[[Note]]`)
  - Backlinks
  - Tag-based connections
  - Embedded content links (`![[Note]]`)
- **Multiple Path Discovery**: Find alternative paths and connections between notes.
- **Graph Analytics**: Calculate metrics like betweenness centrality to identify key connector notes in your vault.
- **Performance Optimizations**:
  - Adaptive algorithm selection based on vault size
  - Graph caching for faster repeated analyses
  - Incremental updates for file changes
- **Export Results**: Save analyses as new notes in your vault for future reference.
> **Warning:** Since all notes in the vault are currently included in the metrics computations, extremely large exported analysis files can cause performance issues when attempting to run this plugin. It's planned to add either an automatic or manual mechanism to ignore these files.

## Installation

### Installation via BRAT

1. Install the [BRAT plugin](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian Community Plugins.
2. Open BRAT settings, and click "Add Beta plugin".
3. Enter the repository URL: `https://github.com/kaliser/graph-metrics-plugin`
4. Enable the "Graph Metrics" plugin in your Obsidian settings under Community plugins.

## Getting Started

1. Enable the plugin in your Obsidian settings.
2. Click the "Graph Metrics" icon in the ribbon or use the command palette to open the analysis modal.
3. Select your start and end notes, configure analysis options, and click "Analyze Connections".

## Configuration

Access the plugin settings to customize:

- **Connection Types**: Toggle display of different connection types.
- **Analysis Options**: Configure how connections are analyzed.
  - Include/exclude tags, embedded links, and backlinks
  - Set maximum path length and number of paths to show
- **Performance Options**: Optimize for your vault size.
  - Toggle graph caching
  - Enable/disable parallel processing
  - Select algorithm preference


## Support

If you encounter any issues or have feature suggestions, please [open an issue](https://github.com/kaliser/graph-metrics-plugin/issues) on the GitHub repository.

## License

This project is licensed under the MIT License - see the LICENSE file for details.