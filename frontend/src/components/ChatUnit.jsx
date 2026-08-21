import React, { useState, useMemo } from "react";
import { useEngine } from "../context/WebSocketProvider";

const formatSpeed = (bytesPerSec) => {
    if (!bytesPerSec) return "0 B/s";
    const mb = bytesPerSec / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB/s`;
    return `${(bytesPerSec / 1024).toFixed(2)} KB/s`;
};

export default function ChatUnit({ task, isRunning }) {
    const { activeScans, activeTasks, finishedFiles, killTask } = useEngine();
    const [showFinished, setShowFinished] = useState(false);

    const chatId = task.params?.chat_id;
    const scanState = activeScans[chatId];
    const chatFinishedFiles = finishedFiles[chatId] || [];

    const isGlobalSync = task.type === "sync-all";
    const globalSyncState = activeScans["global_sync"];

    const { heavyWorkers, lightWorkers } = useMemo(() => {
        const heavy = [];
        const light = [];
        Object.values(activeTasks).forEach((t) => {
            if (t.chat_id === chatId) {
                if (t.type === "heavy") heavy.push(t);
                else light.push(t);
            }
        });
        return { heavyWorkers: heavy, lightWorkers: light };
    }, [activeTasks, chatId]);

    if (!isRunning) {
        return (
            <div className="chat-unit pending">
                <div className="unit-header">
                    <span className="title">
                        {task.type === "sync-single" ? "Sync" : "Download"}: {task.params?.chat_name || chatId}
                    </span>
                    <button className="btn-skip" onClick={() => killTask(task.id)}>
                        Remove from Queue
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="chat-unit active">
            <div className="unit-header active-bg">
                <div className="title-group">
                    <span className="spinner"></span>
                    <span className="title">
                        {task.params?.batch_id ? `[Batch ${task.params.batch_index}/${task.params.batch_total}] ` : ""}
                        {task.type.includes("sync") ? "Syncing:" : "Downloading:"} {task.params?.chat_name || chatId}
                        {chatId ? ` · ${chatId}` : ""}
                    </span>
                    <div className="tags">
                        {task.params?.overwrite && <span className="tag warn">Overwrite</span>}
                        {task.params?.validate && <span className="tag info">Validate</span>}
                    </div>
                </div>
                <button className="btn-skip" onClick={() => killTask(task.id)}>
                    {task.params?.batch_id ? "SKIP CHAT" : "KILL TASK"}
                </button>
            </div>

            <div className="unit-body">
                {/* --- NEW: Scanner / Global Sync Status --- */}
                <div className="scan-status">
                    {isGlobalSync ? (
                        <div className="sync-status">
                            <strong>Sync Progress:</strong> {globalSyncState ? `Scanned ${globalSyncState.scanned} chats from Telegram...` : "Initializing sync..."}
                            {globalSyncState?.changes && globalSyncState.changes.length > 0 && (
                                <div className="sync-changes" style={{ marginTop: "0.75rem", fontSize: "0.9rem", color: "#f9e2af", background: "#11111b", padding: "0.75rem", borderRadius: "4px", borderLeft: "3px solid #f9e2af" }}>
                                    <strong style={{ display: "block", marginBottom: "0.25rem" }}>Database Updates Detected:</strong>
                                    <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
                                        {globalSyncState.changes.map((change, idx) => (
                                            <li key={idx} style={{ marginBottom: "0.15rem" }}>
                                                {change}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : (
                        !task.type.includes("sync") && (
                            <div className="scan-status">
                                <strong>Scan Status:</strong> {scanState ? `${scanState.status || "Scanning..."} (${scanState.scanned} checked) ${scanState.total_queued ? `-> ${scanState.total_queued} downloads queued.` : ""}` : "Preparing..."}
                            </div>
                        )
                    )}
                </div>

                {/* Heavy Queue (Videos/Zips) */}
                {heavyWorkers.length > 0 && (
                    <div className="worker-queue heavy">
                        <div className="queue-title">HEAVY QUEUE</div>
                        {heavyWorkers.map((w) => (
                            <div key={w.file_id} className="worker-row">
                                <div className="worker-info">
                                    <span className="filename" title={w.filename}>
                                        {w.filename}
                                    </span>
                                    <span className="queue-pos">[{w.queue_info}]</span>
                                </div>
                                <div className="progress-container">
                                    <div
                                        className="progress-bar"
                                        style={{
                                            width: `${w.progress || 0}%`,
                                        }}></div>
                                </div>
                                <div className="speed">{formatSpeed(w.speed)}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Light Queue (Images/Misc) */}
                {lightWorkers.length > 0 && (
                    <div className="worker-queue light">
                        <div className="queue-title">LIGHT QUEUE</div>
                        {lightWorkers.map((w) => (
                            <div key={w.file_id} className="worker-row">
                                <div className="worker-info">
                                    <span className="filename" title={w.filename}>
                                        {w.filename}
                                    </span>
                                    <span className="queue-pos">[{w.queue_info}]</span>
                                </div>
                                <div className="progress-container">
                                    <div
                                        className="progress-bar light-bg"
                                        style={{
                                            width: `${w.progress || 0}%`,
                                        }}></div>
                                </div>
                                <div className="speed">{formatSpeed(w.speed)}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Finished Files Collapsible */}
                {chatFinishedFiles.length > 0 && (
                    <div className="finished-section">
                        <button className="toggle-btn" onClick={() => setShowFinished(!showFinished)}>
                            {showFinished ? "▼ Hide Finished Files" : `▶ Show Finished Files (${chatFinishedFiles.length})`}
                        </button>
                        {showFinished && (
                            <div className="finished-list">
                                {chatFinishedFiles.map((f, i) => (
                                    <div key={i} className={`finished-row ${f.final_status}`}>
                                        <span className="icon">{f.final_status === "success" ? "✔" : "✘"}</span>
                                        <span className="filename">{f.filename}</span>
                                        {f.error_msg && <span className="error-text">({f.error_msg})</span>}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
