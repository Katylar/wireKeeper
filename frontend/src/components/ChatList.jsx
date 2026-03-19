import React from "react";
import { Link } from "react-router-dom";

export default function ChatList({
    chats,
    activeTasks,
    activeScans,
    onDownload,
}) {
    const getChatActiveStatus = (chatId) => {
        const tasks = Object.values(activeTasks).filter(
            (t) => t.chat_id === chatId,
        );
        const isScanning = Boolean(activeScans && activeScans[chatId]);

        // Scenario A: It's just scanning, no downloads yet
        if (tasks.length === 0 && isScanning) {
            return {
                isScanning: true,
                activeCount: 0,
                speed: 0,
                queueInfo: "Scanning database & Telegram...",
            };
        }

        // Scenario B: Nothing is happening
        if (tasks.length === 0) return null;

        // Scenario C: Downloads are actively happening
        const activeCount = tasks.length;
        const currentSpeedMB =
            tasks.reduce((sum, t) => sum + (t.speed || 0), 0) / 1024 / 1024;
        const queueInfo = tasks[0].queue_info || "Processing...";

        return {
            isScanning: false,
            activeCount,
            speed: currentSpeedMB.toFixed(2),
            queueInfo,
        };
    };

    return (
        <div className="chat-list-container">
            <table className="chat-table">
                <thead>
                    <tr>
                        <th>Chat Details</th>
                        <th>Statistics</th>
                        <th>Batch Status</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    {chats.map((chat) => {
                        const activeStatus = getChatActiveStatus(chat.chat_id);
                        const isBusy = activeStatus !== null;

                        return (
                            <tr key={chat.chat_id}>
                                <td>
                                    <Link
                                        to={`/chat/${chat.chat_id}`}
                                        className="chat-name"
                                        style={{
                                            textDecoration: "none",
                                            display: "block",
                                        }}>
                                        {chat.name}
                                    </Link>
                                    <div className="chat-meta">
                                        {chat.type} • ID: {chat.chat_id}
                                    </div>

                                    {/* The Live Progress/Scan Indicator */}
                                    {isBusy && (
                                        <div className="progress-container">
                                            <div className="progress-text">
                                                <span
                                                    style={{
                                                        color: activeStatus.isScanning
                                                            ? "#f9e2af"
                                                            : "#a6e3a1",
                                                    }}>
                                                    {activeStatus.queueInfo}{" "}
                                                    {activeStatus.activeCount >
                                                    0
                                                        ? `(${activeStatus.activeCount} threads)`
                                                        : ""}
                                                </span>
                                                {activeStatus.activeCount >
                                                    0 && (
                                                    <span>
                                                        {activeStatus.speed}{" "}
                                                        MB/s
                                                    </span>
                                                )}
                                            </div>
                                            <div className="progress-bar-bg">
                                                <div
                                                    className="progress-bar-fill"
                                                    style={{
                                                        width: "100%",
                                                        animation:
                                                            "pulse 1s infinite alternate",
                                                        backgroundColor:
                                                            activeStatus.isScanning
                                                                ? "#f9e2af"
                                                                : "#a6e3a1", // Orange for scan, Green for download
                                                    }}></div>
                                            </div>
                                        </div>
                                    )}
                                </td>
                                <td>
                                    <div className="chat-meta">
                                        Total:{" "}
                                        {chat.total_messages.toLocaleString()}{" "}
                                        msgs
                                    </div>
                                    <div className="chat-meta">
                                        Saved:{" "}
                                        {chat.total_downloaded.toLocaleString()}{" "}
                                        files
                                    </div>
                                </td>
                                <td>
                                    <span
                                        className={`badge ${chat.is_batch ? "batch-active" : ""}`}>
                                        {chat.is_batch
                                            ? "Included"
                                            : "Excluded"}
                                    </span>
                                </td>
                                <td>
                                    <button
                                        className="action-btn"
                                        onClick={() => onDownload(chat.chat_id)}
                                        disabled={isBusy}>
                                        {isBusy ? "Working..." : "Download"}
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
