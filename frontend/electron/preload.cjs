const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  isMaximized: () => ipcRenderer.invoke("window-is-maximized"),

  // Native File dialogs & I/O
  showOpenProjectDialog: () => ipcRenderer.invoke("dialog-open-project"),
  showSaveProjectDialog: (defaultName) =>
    ipcRenderer.invoke("dialog-save-project", defaultName),
  showOpenMediaDialog: () => ipcRenderer.invoke("dialog-open-media"),
  showOpenSrtDialog: () => ipcRenderer.invoke("dialog-open-srt"),

  saveFile: (filePath, content) =>
    ipcRenderer.invoke("file-save", { filePath, content }),
  readFile: (filePath) => ipcRenderer.invoke("file-read", filePath),

  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  getBackendPort: () => ipcRenderer.invoke("get-backend-port"),
});
