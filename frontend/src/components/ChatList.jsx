import React from "react";

export default function ChatList({ chats, activeTasks, onDownload }) {
    // Helper to aggregate live WebSocket data for a specific chat
    const getChatActiveStatus = (chatId) => {
        const tasks = Object.values(activeTasks).filter(
            (t) => t.chat_id === chatId,
        );
        if (tasks.length === 0) return null;

        const activeCount = tasks.length;
        const currentSpeedMB =
            tasks.reduce((sum, t) => sum + (t.speed || 0), 0) / 1024 / 1024;

        // Grab the queue info from the first active task for this chat (e.g., "heavy 1/5")
        const queueInfo = tasks[0].queue_info || "Scanning...";

        return { activeCount, speed: currentSpeedMB.toFixed(2), queueInfo };
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
                        const isDownloading = activeStatus !== null;

                        return (
                            <tr key={chat.chat_id}>
                                <td>
                                    <div className="chat-name">{chat.name}</div>
                                    <div className="chat-meta">
                                        {chat.type} • ID: {chat.chat_id}
                                    </div>
                                    {isDownloading && (
                                        <div className="progress-container">
                                            <div className="progress-text">
                                                <span>
                                                    {activeStatus.queueInfo} (
                                                    {activeStatus.activeCount}{" "}
                                                    threads)
                                                </span>
                                                <span>
                                                    {activeStatus.speed} MB/s
                                                </span>
                                            </div>
                                            <div className="progress-bar-bg">
                                                {/* We use an indeterminate animation here, or tie it to aggregate % if you prefer */}
                                                <div
                                                    className="progress-bar-fill"
                                                    style={{
                                                        width: "100%",
                                                        animation:
                                                            "pulse 1s infinite alternate",
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
                                        disabled={isDownloading}>
                                        {isDownloading
                                            ? "Downloading..."
                                            : "Download"}
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                    {chats.length === 0 && (
                        <tr>
                            <td
                                colSpan="4"
                                style={{
                                    textAlign: "center",
                                    padding: "2rem",
                                }}>
                                No chats synced yet. Run a global sync!
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
}
