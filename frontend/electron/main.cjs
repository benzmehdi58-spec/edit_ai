const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const http = require("http");

const logDir = app.getPath("userData");
try { fs.mkdirSync(logDir, { recursive: true }); } catch (e) {}
const logFile = path.join(logDir, "electron.log");
const logStream = fs.createWriteStream(logFile, { flags: "w" });
logStream.on("error", () => {});
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  logStream.write(line);
  console.log(msg);
}

let mainWindow = null;
let backendProcess = null;
let backendPort = 8000;

function checkBackendHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/api/health`,
      { timeout: 800 },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function findAvailablePort(start = 8000) {
  for (let port = start; port < start + 50; port++) {
    const isRunning = await checkBackendHealth(port);
    if (isRunning) return { port, alreadyRunning: true };
  }
  return { port: start, alreadyRunning: false };
}

async function ensureBackend() {
  const { port, alreadyRunning } = await findAvailablePort(8000);
  backendPort = port;

  if (alreadyRunning) {
    console.log(`Backend already active on port ${backendPort}`);
    return;
  }

  // Find backend executable or python script
  const isDev = !app.isPackaged;
  const projectRoot = path.resolve(__dirname, "..", "..");
  let exePath = "";
  let args = [];

  const standaloneExe = path.join(
    projectRoot,
    "dist",
    "MedSub",
    "MedSub.exe"
  );
  const packagedExe = path.join(
    process.resourcesPath || "",
    "backend",
    "MedSub.exe"
  );
  const venvPython = path.join(
    projectRoot,
    "backend",
    ".venv",
    "Scripts",
    "python.exe"
  );
  const desktopScript = path.join(projectRoot, "backend", "desktop.py");

  const serverScript = path.join(projectRoot, "backend", "server.py");

  if (!isDev && fs.existsSync(packagedExe)) {
    exePath = packagedExe;
    args = ["--server-only"];
  } else if (fs.existsSync(venvPython) && fs.existsSync(serverScript)) {
    exePath = venvPython;
    args = [serverScript];
  } else if (fs.existsSync(standaloneExe)) {
    exePath = standaloneExe;
    args = ["--server-only"];
  }

  if (exePath) {
    log(`Spawning backend headless: ${exePath} ${args.join(" ")}`);
    backendProcess = spawn(exePath, args, {
      cwd: path.dirname(exePath),
      detached: false,
      stdio: "ignore",
      windowsHide: true,
    });

    backendProcess.on("error", (err) => {
      console.error("Backend process error:", err);
    });

    // Wait up to 5s for backend health
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (await checkBackendHealth(backendPort)) {
        console.log(`Backend ready on port ${backendPort}`);
        break;
      }
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1050,
    minHeight: 740,
    frame: false, // Frameless custom dark Premiere titlebar
    backgroundColor: "#0d0e12",
    show: false,
    title: "MedSub Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  const distPath = path.join(__dirname, "..", "dist", "index.html");

  mainWindow.webContents.on("console-message", (event, level, message, line, sourceId) => {
    log(`[Renderer] ${message}`);
  });

  mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
    log(`[Load Error] ${errorDescription} (${errorCode})`);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
    log("Window shown.");
  });

  mainWindow.webContents.on("did-finish-load", () => {
    log("Page finished loading.");
    mainWindow.webContents
      .executeJavaScript('document.getElementById("root")?.innerHTML?.length || 0')
      .then((len) => log(`Root HTML length: ${len}`))
      .catch((err) => log(`Eval error: ${err}`));
  });

  // Load through the local backend (serves UI + API on same origin) so fetch("/api/...") works.
  checkBackendHealth(backendPort).then((up) => {
    if (up) {
      mainWindow.loadURL(`http://127.0.0.1:${backendPort}/`);
    } else if (fs.existsSync(distPath)) {
      mainWindow.loadFile(distPath);
    } else {
      mainWindow.loadURL("http://localhost:5173");
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.on("window-minimize", () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on("window-maximize", () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on("window-close", () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle("window-is-maximized", () => {
  return mainWindow ? mainWindow.isMaximized() : false;
});

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
});

ipcMain.handle("get-backend-port", () => {
  return backendPort;
});

// Native File Dialogs
ipcMain.handle("dialog-open-project", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open MedSub Project",
    filters: [{ name: "MedSub Project (*.medsub)", extensions: ["medsub", "json"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return { filePath, content: JSON.parse(content) };
  } catch (err) {
    dialog.showErrorBox("Failed to Open Project", err.message);
    return null;
  }
});

ipcMain.handle("dialog-save-project", async (event, defaultName = "Untitled.medsub") => {
  if (!mainWindow) return null;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save MedSub Project",
    defaultPath: defaultName.endsWith(".medsub") ? defaultName : `${defaultName}.medsub`,
    filters: [{ name: "MedSub Project (*.medsub)", extensions: ["medsub"] }],
  });
  if (result.canceled || !result.filePath) return null;
  return result.filePath;
});

ipcMain.handle("file-save", async (event, { filePath, content }) => {
  try {
    fs.writeFileSync(filePath, typeof content === "string" ? content : JSON.stringify(content, null, 2), "utf-8");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("file-read", async (event, filePath) => {
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("dialog-open-media", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select Audio or Video File",
    filters: [
      { name: "Media Files", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "mp4", "mov", "mkv", "webm"] },
      { name: "Audio Files", extensions: ["mp3", "wav", "m4a", "aac", "ogg"] },
      { name: "Video Files", extensions: ["mp4", "mov", "mkv", "webm"] },
    ],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("dialog-open-srt", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import SRT Subtitles",
    filters: [{ name: "Subtitles (*.srt)", extensions: ["srt"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return { filePath, content };
  } catch (err) {
    return null;
  }
});

// App Lifecycle
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(async () => {
  await ensureBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch (e) {}
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch (e) {}
  }
});
