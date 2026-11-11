/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    isElectron: boolean;
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    isMaximized: () => Promise<boolean>;
    showOpenProjectDialog: () => Promise<{ filePath: string; content: any } | null>;
    showSaveProjectDialog: (defaultName?: string) => Promise<string | null>;
    showOpenMediaDialog: () => Promise<string | null>;
    showOpenSrtDialog: () => Promise<{ filePath: string; content: string } | null>;
    saveFile: (filePath: string, content: any) => Promise<{ success: boolean; error?: string }>;
    readFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
    getAppVersion: () => Promise<string>;
    getBackendPort: () => Promise<number>;
  };
}
