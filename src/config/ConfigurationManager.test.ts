// Mock vscode module BEFORE importing ConfigurationManager
jest.mock('vscode', () => {
    const mockConfig = {
        get: jest.fn(),
    };

    const mockOnDidChangeConfiguration = jest.fn(() => ({
        dispose: jest.fn(),
    }));

    return {
        workspace: {
            getConfiguration: jest.fn(() => mockConfig),
            onDidChangeConfiguration: mockOnDidChangeConfiguration,
        },
        Disposable: class {
            constructor(private callback: () => void) { }
            dispose() {
                this.callback();
            }
        },
    };
}, { virtual: true });

import { ConfigurationManager } from './ConfigurationManager';

// Get references to the mocked functions after the mock is set up
const vscode = require('vscode');

describe('ConfigurationManager', () => {
    let configManager: ConfigurationManager;
    let mockConfig: any;
    let mockOnDidChangeConfiguration: jest.Mock;

    beforeEach(() => {
        // Get fresh references to mocks
        mockConfig = vscode.workspace.getConfiguration();
        mockOnDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration;

        jest.clearAllMocks();
        mockConfig.get.mockClear();
        // Don't clear mockOnDidChangeConfiguration here - it needs to be called during constructor
        configManager = new ConfigurationManager();
    });

    afterEach(() => {
        configManager.dispose();
    });

    describe('getConfiguration', () => {
        it('should return default configuration values', () => {
            mockConfig.get.mockImplementation((_key: string, defaultValue: any) => defaultValue);

            const config = configManager.getConfiguration();

            expect(config).toEqual({
                invertColorsInDarkMode: true,
                renderTimeout: 15000,
                autoPreview: false,
                previewPosition: 'side',
            });
        });

        it('should return custom configuration values', () => {
            mockConfig.get.mockImplementation((key: string) => {
                const values: Record<string, any> = {
                    invertColorsInDarkMode: false,
                    renderTimeout: 30000,
                    autoPreview: true,
                    previewPosition: 'below',
                };
                return values[key];
            });

            const config = configManager.getConfiguration();

            expect(config).toEqual({
                invertColorsInDarkMode: false,
                renderTimeout: 30000,
                autoPreview: true,
                previewPosition: 'below',
            });
        });

        it('should call workspace.getConfiguration with correct section', () => {
            configManager.getConfiguration();

            expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('tikzjax');
        });
    });

    describe('onConfigurationChange', () => {
        it('should register configuration change callback', () => {
            const callback = jest.fn();

            const disposable = configManager.onConfigurationChange(callback);

            expect(disposable).toBeDefined();
            expect(typeof disposable.dispose).toBe('function');
        });

        it('should call callback when configuration changes', () => {
            const callback = jest.fn();
            mockConfig.get.mockImplementation((_key: string, defaultValue: any) => defaultValue);

            configManager.onConfigurationChange(callback);

            // Simulate configuration change
            const changeHandler = (mockOnDidChangeConfiguration.mock.calls as any)[0]?.[0];
            if (changeHandler) {
                changeHandler({ affectsConfiguration: (section: string) => section === 'tikzjax' });
            }

            expect(callback).toHaveBeenCalledTimes(1);
            expect(callback).toHaveBeenCalledWith(expect.objectContaining({
                invertColorsInDarkMode: true,
                renderTimeout: 15000,
                autoPreview: false,
                previewPosition: 'side',
            }));
        });

        it('should not call callback for unrelated configuration changes', () => {
            const callback = jest.fn();

            configManager.onConfigurationChange(callback);

            // Simulate unrelated configuration change
            const changeHandler = (mockOnDidChangeConfiguration.mock.calls as any)[0]?.[0];
            if (changeHandler) {
                changeHandler({ affectsConfiguration: (section: string) => section === 'editor' });
            }

            expect(callback).not.toHaveBeenCalled();
        });

        it('should unregister callback when disposable is disposed', () => {
            const callback = jest.fn();
            mockConfig.get.mockImplementation((_key: string, defaultValue: any) => defaultValue);

            const disposable = configManager.onConfigurationChange(callback);
            disposable.dispose();

            // Simulate configuration change after disposal
            const changeHandler = (mockOnDidChangeConfiguration.mock.calls as any)[0]?.[0];
            if (changeHandler) {
                changeHandler({ affectsConfiguration: (section: string) => section === 'tikzjax' });
            }

            expect(callback).not.toHaveBeenCalled();
        });

        it('should handle multiple callbacks', () => {
            const callback1 = jest.fn();
            const callback2 = jest.fn();
            mockConfig.get.mockImplementation((_key: string, defaultValue: any) => defaultValue);

            configManager.onConfigurationChange(callback1);
            configManager.onConfigurationChange(callback2);

            // Simulate configuration change
            const changeHandler = (mockOnDidChangeConfiguration.mock.calls as any)[0]?.[0];
            if (changeHandler) {
                changeHandler({ affectsConfiguration: (section: string) => section === 'tikzjax' });
            }

            expect(callback1).toHaveBeenCalledTimes(1);
            expect(callback2).toHaveBeenCalledTimes(1);
        });

        it('should handle callback errors gracefully', () => {
            const errorCallback = jest.fn(() => {
                throw new Error('Callback error');
            });
            const normalCallback = jest.fn();
            mockConfig.get.mockImplementation((_key: string, defaultValue: any) => defaultValue);

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            configManager.onConfigurationChange(errorCallback);
            configManager.onConfigurationChange(normalCallback);

            // Simulate configuration change
            const changeHandler = (mockOnDidChangeConfiguration.mock.calls as any)[0]?.[0];
            if (changeHandler) {
                changeHandler({ affectsConfiguration: (section: string) => section === 'tikzjax' });
            }

            expect(errorCallback).toHaveBeenCalledTimes(1);
            expect(normalCallback).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });
    });

    describe('dispose', () => {
        it('should dispose all resources', () => {
            const callback = jest.fn();
            configManager.onConfigurationChange(callback);

            configManager.dispose();

            // Verify that configuration watcher is disposed
            const mockDispose = (mockOnDidChangeConfiguration.mock.results as any)[0].value.dispose;
            expect(mockDispose).toHaveBeenCalled();
        });

        it('should clear all callbacks', () => {
            const callback = jest.fn();
            mockConfig.get.mockImplementation((_key: string, defaultValue: any) => defaultValue);

            configManager.onConfigurationChange(callback);
            configManager.dispose();

            // Try to trigger configuration change after disposal
            const changeHandler = (mockOnDidChangeConfiguration.mock.calls as any)[0]?.[0];
            if (changeHandler) {
                changeHandler({ affectsConfiguration: (section: string) => section === 'tikzjax' });
            }

            expect(callback).not.toHaveBeenCalled();
        });
    });
});
