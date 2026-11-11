import { useRef, useState } from "react";
import type { AspectRatio } from "../types/project";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (config: {
    name: string;
    preset: AspectRatio;
    audioFile?: File;
    srtFile?: File;
  }) => void;
}

export function NewProjectModal({
  isOpen,
  onClose,
  onCreate,
}: NewProjectModalProps) {
  const [name, setName] = useState(`Project_${new Date().toISOString().slice(0, 10)}`);
  const [preset, setPreset] = useState<AspectRatio>("9:16");
  const [audioFile, setAudioFile] = useState<File | undefined>();
  const [srtFile, setSrtFile] = useState<File | undefined>();

  const audioInputRef = useRef<HTMLInputElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      preset,
      audioFile,
      srtFile,
    });
  };

  return (
    <div className="project-modal-backdrop" onClick={onClose}>
      <div
        className="project-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="project-modal-header">
          <h3>Create New Project</h3>
          <button
            className="recent-del-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="project-modal-body">
            {/* Project Name */}
            <div className="modal-field">
              <label>Project Name</label>
              <input
                type="text"
                className="modal-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My_Reel_Project"
                autoFocus
                required
              />
            </div>

            {/* Aspect Ratio Preset */}
            <div className="modal-field">
              <label>Sequence Preset / Aspect Ratio</label>
              <div className="modal-preset-grid">
                <button
                  type="button"
                  className={`preset-card-btn ${preset === "9:16" ? "active" : ""}`}
                  onClick={() => setPreset("9:16")}
                >
                  <span className="ratio-name">📱 9:16 Vertical</span>
                  <span className="ratio-res">1080 × 1920 (Reels/TikTok)</span>
                </button>
                <button
                  type="button"
                  className={`preset-card-btn ${preset === "16:9" ? "active" : ""}`}
                  onClick={() => setPreset("16:9")}
                >
                  <span className="ratio-name">🖥️ 16:9 Landscape</span>
                  <span className="ratio-res">1920 × 1080 (YouTube)</span>
                </button>
                <button
                  type="button"
                  className={`preset-card-btn ${preset === "1:1" ? "active" : ""}`}
                  onClick={() => setPreset("1:1")}
                >
                  <span className="ratio-name">⏹️ 1:1 Square</span>
                  <span className="ratio-res">1080 × 1080 (Feed Post)</span>
                </button>
              </div>
            </div>

            {/* Initial Media Import */}
            <div className="modal-field">
              <label>Source Media (Optional)</label>
              <div style={{ display: "flex", gap: "10px" }}>
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*,video/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files?.[0]) setAudioFile(e.target.files[0]);
                  }}
                />
                <button
                  type="button"
                  className="welcome-secondary-btn"
                  style={{ flex: 1, padding: "8px 12px", fontSize: "12px" }}
                  onClick={() => audioInputRef.current?.click()}
                >
                  🎵 {audioFile ? audioFile.name : "Choose Audio/Video..."}
                </button>

                <input
                  ref={srtInputRef}
                  type="file"
                  accept=".srt"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files?.[0]) setSrtFile(e.target.files[0]);
                  }}
                />
                <button
                  type="button"
                  className="welcome-secondary-btn"
                  style={{ flex: 1, padding: "8px 12px", fontSize: "12px" }}
                  onClick={() => srtInputRef.current?.click()}
                >
                  📝 {srtFile ? srtFile.name : "Import SRT Subtitles..."}
                </button>
              </div>
            </div>
          </div>

          <div className="project-modal-footer">
            <button
              type="button"
              className="welcome-secondary-btn"
              onClick={onClose}
            >
              Cancel
            </button>
            <button type="submit" className="welcome-primary-btn">
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
