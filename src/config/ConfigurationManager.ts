import * as vscode from 'vscode';

/**
 * Extension configuration interface
 * 
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
 */
export interface ExtensionConfiguration {
    /** Whether to invert colors in dark mode */
    invertColorsInDarkMode: boolean;

    /** Render timeout in milliseconds */
    renderTimeout: number;

    /** Whether to automatically open preview for Markdown files with TikZ */
    autoPreview: boolean;

    /** Default position for preview panel */
    previewPosition: 'side' | 'below' | 'window';
}

/**
 * Callback type for configuration change notifications
 */
export type ConfigurationChangeCallback = (config: ExtensionConfiguration) => void;

/**
 * Manages extension configuration settings.
 * 
 * The ConfigurationManager reads settings from VS Code's configuration system,
 * watches for changes, and notifies registered components when settings are updated.
 * 
 * **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
 */
export class ConfigurationManager {
    private static readonly CONFIG_SECTION = 'tikzjax';

    private readonly _changeCallbacks: Set<ConfigurationChangeCallback> = new Set();
    private readonly _disposables: vscode.Disposable[] = [];

    /**
     * Creates a new ConfigurationManager instance.
     */
    constructor() {
        // Watch for configuration changes
        const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration(ConfigurationManager.CONFIG_SECTION)) {
                this.notifyConfigurationChange();
            }
        });

        this._disposables.push(configWatcher);
    }

    /**
     * Gets the current extension configuration.
     * 
     * @returns The current configuration values
     * 
     * **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
     */
    getConfiguration(): ExtensionConfiguration {
        const config = vscode.workspace.getConfiguration(ConfigurationManager.CONFIG_SECTION);

        return {
            invertColorsInDarkMode: config.get<boolean>('invertColorsInDarkMode', true),
            renderTimeout: config.get<number>('renderTimeout', 15000),
            autoPreview: config.get<boolean>('autoPreview', false),
            previewPosition: config.get<'side' | 'below' | 'window'>('previewPosition', 'side')
        };
    }

    /**
     * Registers a callback to be notified when configuration changes.
     * 
     * @param callback - Function to call when configuration changes
     * @returns A disposable to unregister the callback
     * 
     * **Validates: Requirement 9.5**
     */
    onConfigurationChange(callback: ConfigurationChangeCallback): vscode.Disposable {
        this._changeCallbacks.add(callback);

        return new vscode.Disposable(() => {
            this._changeCallbacks.delete(callback);
        });
    }

    /**
     * Notifies all registered callbacks of a configuration change.
     * 
     * **Validates: Requirement 9.5**
     */
    private notifyConfigurationChange(): void {
        const config = this.getConfiguration();

        for (const callback of this._changeCallbacks) {
            try {
                callback(config);
            } catch (error) {
                console.error('Error in configuration change callback:', error);
            }
        }
    }

    /**
     * Disposes the configuration manager and cleans up resources.
     */
    dispose(): void {
        for (const disposable of this._disposables) {
            disposable.dispose();
        }
        this._disposables.length = 0;
        this._changeCallbacks.clear();
    }
}
