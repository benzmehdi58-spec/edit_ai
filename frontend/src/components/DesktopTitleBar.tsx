import { LOGO_URL } from "../logo";
import { useEffect, useRef, useState } from "react";
import type { MedSubProject } from "../types/project";

interface DesktopTitleBarProps {
  currentProject: MedSubProject | null;
  hasUnsavedChanges?: boolean;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onSaveProjectAs: () => void;
  onCloseProject: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSelectAll: () => void;
  onSplitCue: () => void;
  onSetInPoint: () => void;
  onSetOutPoint: () => void;
  onClearInOut: () => void;
  onToggleSnapping: () => void;
  onExportVideo: () => void;
  onExportSrt: () => void;
  onShowShortcuts: () => void;
}

export function DesktopTitleBar({
  currentProject,
  hasUnsavedChanges,
  onNewProject,
  onOpenProject,
  onSaveProject,
  onSaveProjectAs,
  onCloseProject,
  onUndo,
  onRedo,
  onSelectAll,
  onSplitCue,
  onSetInPoint,
  onSetOutPoint,
  onClearInOut,
  onToggleSnapping,
  onExportVideo,
  onExportSrt,
  onShowShortcuts,
}: DesktopTitleBarProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const isElectron = typeof window !== "undefined" && !!window.electronAPI;
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    window.addEventListener("mousedown", handleClickOutside);
    return () => window.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleMinimize = () => {
    if (window.electronAPI) window.electronAPI.minimize();
  };

  const handleMaximize = async () => {
    if (window.electronAPI) {
      window.electronAPI.maximize();
      const max = await window.electronAPI.isMaximized();
      setIsMaximized(max);
    }
  };

  const handleClose = () => {
    if (window.electronAPI) window.electronAPI.close();
  };

  const toggleMenu = (menu: string) => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const runAndClose = (fn: () => void) => {
    setActiveMenu(null);
    fn();
  };

  return (
    <div className="desktop-titlebar" ref={barRef}>
      <div className="desktop-titlebar-left">
        <div className="desktop-app-logo">
          <img src={LOGO_URL} alt="MedSub" />
          <span>MedSub Studio</span>
        </div>

        <nav className="desktop-menubar">
          {/* File Menu */}
          <div className="desktop-menu-item">
            <button
              className={`desktop-menu-btn ${activeMenu === "file" ? "active" : ""}`}
              onClick={() => toggleMenu("file")}
            >
              File
            </button>
            {activeMenu === "file" && (
              <div className="desktop-menu-dropdown">
                <button onClick={() => runAndClose(onNewProject)}>
                  <span>New Project...</span>
                  <span className="shortcut">Ctrl+N</span>
                </button>
                <button onClick={() => runAndClose(onOpenProject)}>
                  <span>Open Project...</span>
                  <span className="shortcut">Ctrl+O</span>
                </button>
                <div className="desktop-menu-divider" />
                <button
                  disabled={!currentProject}
                  onClick={() => runAndClose(onSaveProject)}
                >
                  <span>Save Project</span>
                  <span className="shortcut">Ctrl+S</span>
                </button>
                <button
                  disabled={!currentProject}
                  onClick={() => runAndClose(onSaveProjectAs)}
                >
                  <span>Save Project As...</span>
                  <span className="shortcut">Ctrl+Shift+S</span>
                </button>
                <div className="desktop-menu-divider" />
                <button
                  disabled={!currentProject}
                  onClick={() => runAndClose(onExportVideo)}
                >
                  <span>Export Video...</span>
                  <span className="shortcut">Ctrl+M</span>
                </button>
                <button
                  disabled={!currentProject}
                  onClick={() => runAndClose(onExportSrt)}
                >
                  <span>Export SRT Subtitles...</span>
                  <span className="shortcut">Ctrl+Shift+E</span>
                </button>
                <div className="desktop-menu-divider" />
                <button
                  disabled={!currentProject}
                  onClick={() => runAndClose(onCloseProject)}
                >
                  <span>Close Project (Home)</span>
                </button>
                {isElectron && (
                  <button onClick={handleClose}>
                    <span>Exit</span>
                    <span className="shortcut">Alt+F4</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Edit Menu */}
          <div className="desktop-menu-item">
            <button
              className={`desktop-menu-btn ${activeMenu === "edit" ? "active" : ""}`}
              onClick={() => toggleMenu("edit")}
            >
              Edit
            </button>
            {activeMenu === "edit" && (
              <div className="desktop-menu-dropdown">
                <button onClick={() => runAndClose(onUndo)}>
                  <span>Undo</span>
                  <span className="shortcut">Ctrl+Z</span>
                </button>
                <button onClick={() => runAndClose(onRedo)}>
                  <span>Redo</span>
                  <span className="shortcut">Ctrl+Y</span>
                </button>
                <div className="desktop-menu-divider" />
                <button onClick={() => runAndClose(onSelectAll)}>
                  <span>Select All Cues</span>
                  <span className="shortcut">Ctrl+A</span>
                </button>
                <button onClick={() => runAndClose(onClearInOut)}>
                  <span>Clear In/Out Points</span>
                  <span className="shortcut">X</span>
                </button>
              </div>
            )}
          </div>

          {/* Sequence Menu */}
          <div className="desktop-menu-item">
            <button
              className={`desktop-menu-btn ${activeMenu === "sequence" ? "active" : ""}`}
              onClick={() => toggleMenu("sequence")}
            >
              Sequence
            </button>
            {activeMenu === "sequence" && (
              <div className="desktop-menu-dropdown">
                <button onClick={() => runAndClose(onSplitCue)}>
                  <span>Split / Razor Cue at Playhead</span>
                  <span className="shortcut">Ctrl+K / C</span>
                </button>
                <div className="desktop-menu-divider" />
                <button onClick={() => runAndClose(onSetInPoint)}>
                  <span>Set In Point</span>
                  <span className="shortcut">I</span>
                </button>
                <button onClick={() => runAndClose(onSetOutPoint)}>
                  <span>Set Out Point</span>
                  <span className="shortcut">O</span>
                </button>
                <div className="desktop-menu-divider" />
                <button onClick={() => runAndClose(onToggleSnapping)}>
                  <span>Toggle Snapping</span>
                  <span className="shortcut">S</span>
                </button>
              </div>
            )}
          </div>

          {/* Export Menu */}
          <div className="desktop-menu-item">
            <button
              className={`desktop-menu-btn ${activeMenu === "export" ? "active" : ""}`}
              onClick={() => toggleMenu("export")}
            >
              Export
            </button>
            {activeMenu === "export" && (
              <div className="desktop-menu-dropdown">
                <button onClick={() => runAndClose(onExportVideo)}>
                  <span>Export Video (MP4 / Transparent MOV)...</span>
                  <span className="shortcut">Ctrl+M</span>
                </button>
                <button onClick={() => runAndClose(onExportSrt)}>
                  <span>Export Subtitles (.SRT)...</span>
                  <span className="shortcut">Ctrl+Shift+E</span>
                </button>
              </div>
            )}
          </div>

          {/* Help Menu */}
          <div className="desktop-menu-item">
            <button
              className={`desktop-menu-btn ${activeMenu === "help" ? "active" : ""}`}
              onClick={() => toggleMenu("help")}
            >
              Help
            </button>
            {activeMenu === "help" && (
              <div className="desktop-menu-dropdown">
                <button onClick={() => runAndClose(onShowShortcuts)}>
                  <span>Keyboard Shortcuts...</span>
                  <span className="shortcut">? / F1</span>
                </button>
              </div>
            )}
          </div>
        </nav>
      </div>

      {/* Center Title */}
      <div className="desktop-titlebar-title">
        {currentProject
          ? `${currentProject.name} — [${currentProject.preset}]${hasUnsavedChanges ? " *" : ""}`
          : "MedSub Studio — Welcome"}
      </div>

      {/* Right Window Controls */}
      <div className="desktop-window-controls">
        {isElectron ? (
          <>
            <button
              className="desktop-win-btn"
              title="Minimize"
              onClick={handleMinimize}
            >
              <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
                <rect width="10" height="1" />
              </svg>
            </button>
            <button
              className="desktop-win-btn"
              title={isMaximized ? "Restore" : "Maximize"}
              onClick={handleMaximize}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
                <rect x="0.5" y="0.5" width="9" height="9" strokeWidth="1" />
              </svg>
            </button>
            <button
              className="desktop-win-btn close"
              title="Close"
              onClick={handleClose}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor">
                <path d="M1 1L9 9M9 1L1 9" strokeWidth="1.2" />
              </svg>
            </button>
          </>
        ) : (
          <div style={{ width: 16 }} />
        )}
      </div>
    </div>
  );
}
