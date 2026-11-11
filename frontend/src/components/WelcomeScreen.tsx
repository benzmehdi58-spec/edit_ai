import type { RecentProjectItem } from "../types/project";

interface WelcomeScreenProps {
  recentProjects: RecentProjectItem[];
  backendOnline: boolean;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSelectRecent: (project: RecentProjectItem) => void;
  onDeleteRecent: (id: string) => void;
  onOpenSample: () => void;
}

export function WelcomeScreen({
  recentProjects,
  backendOnline,
  onNewProject,
  onOpenProject,
  onSelectRecent,
  onDeleteRecent,
  onOpenSample,
}: WelcomeScreenProps) {
  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      if (isToday) {
        return `Today at ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      }
      return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch {
      return isoString;
    }
  };

  return (
    <div className="welcome-screen">
      {/* Left Sidebar */}
      <aside className="welcome-sidebar">
        <div>
          <div className="welcome-brand">
            <img src="/medsub-logo.png" alt="MedSub Logo" />
            <div>
              <h1>MedSub Studio</h1>
              <p>Arabic & Mixed Caption Editor</p>
            </div>
          </div>

          <div className="welcome-actions-group">
            <button className="welcome-primary-btn" onClick={onNewProject}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Project
            </button>

            <button className="welcome-secondary-btn" onClick={onOpenProject}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M3 6h7l2 3h9v12H3z" />
              </svg>
              Open Project...
            </button>
          </div>
        </div>

        <div className="welcome-footer-info">
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: backendOnline ? "#22c55e" : "#ef4444",
                boxShadow: backendOnline ? "0 0 8px #22c55e" : "none",
              }}
            />
            <span style={{ color: backendOnline ? "#86efac" : "#fca5a5", fontSize: 11 }}>
              {backendOnline ? "Rendering Engine Online" : "Backend Offline"}
            </span>
          </div>
          <div>Adobe Premiere Pro Workflow</div>
          <div>Version 1.0.0 Desktop</div>
        </div>
      </aside>

      {/* Main Recents Area */}
      <main className="welcome-main-content">
        <div className="welcome-heading-row">
          <h2>Recent Projects</h2>
          {recentProjects.length > 0 && (
            <button
              className="welcome-secondary-btn"
              style={{ padding: "6px 12px", fontSize: "11px" }}
              onClick={onOpenSample}
            >
              Load Demo Template
            </button>
          )}
        </div>

        {recentProjects.length > 0 ? (
          <div className="welcome-recents-grid">
            {recentProjects.map((item) => (
              <div
                key={item.id}
                className="recent-project-card"
                onClick={() => onSelectRecent(item)}
              >
                <div className="recent-card-top">
                  <div>
                    <div className="recent-card-title">{item.name}</div>
                    <div className="recent-card-meta">{formatDate(item.updatedAt)}</div>
                  </div>
                  <span className="recent-card-ratio">{item.preset}</span>
                </div>

                {item.previewText && (
                  <div className="recent-card-preview" title={item.previewText}>
                    "{item.previewText}"
                  </div>
                )}

                <div className="recent-card-bottom">
                  <span>{item.cueCount} subtitle cues</span>
                  <button
                    className="recent-del-btn"
                    title="Remove from recents"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteRecent(item.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="welcome-empty-state">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#40465a"
              strokeWidth="1.5"
              style={{ margin: "0 auto 12px" }}
            >
              <path d="M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h5" />
            </svg>
            <h3 style={{ color: "#d1d5e2", fontSize: 16, fontWeight: 600 }}>No Projects Yet</h3>
            <p>Start by creating a new project or explore the built-in Arabic demo template.</p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 20 }}>
              <button className="welcome-primary-btn" onClick={onNewProject}>
                + Create New Project
              </button>
              <button className="welcome-secondary-btn" onClick={onOpenSample}>
                Open Demo Project
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
