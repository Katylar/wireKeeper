import React from "react";
import { Link } from "react-router-dom";

const ChatRow = React.memo(
    ({ chat, isSelected, activeStatus, onSelect, onToggle, onDownload }) => {
        const isBusy = activeStatus !== null;
        const isMultiTopic = chat.topics && chat.topics.length > 1;

        const chatTypeMap = {
            Private: "Private Conversation",
            Group: "Group Chat",
            Channel: "Channel",
        };

        return (
            <div
                className={`chat-grid-row ${chat.hidden ? "is-hidden" : ""} ${!chat.enabled ? "is-disabled" : ""}`}>
                <div className="cell checkbox-cell">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onSelect(chat.chat_id)}
                    />
                </div>

                {/* IDENTITY & CONFIGURATION */}
                <div className="cell">
                    <Link to={`/chat/${chat.chat_id}`} className="chat-name">
                        {chat.name}
                    </Link>
                    {chat.old_name && (
                        <div className="old-name">
                            Previously: {chat.old_name}
                        </div>
                    )}
                    <div className="chat-meta">
                        {chatTypeMap[chat.type] || chat.type} • ID:{" "}
                        {chat.chat_id}
                    </div>

                    <div className="badge-group">
                        <span
                            className={`badge ${chat.is_batch ? "active" : ""}`}>
                            BATCH: {chat.is_batch ? "INCLUDED" : "EXCLUDED"}
                        </span>

                        <span
                            className={`badge ${chat.defer ? "warn" : "active"}`}>
                            DEFERRED LIST:{" "}
                            {chat.defer ? "INCLUDED" : "EXCLUDED"}
                        </span>

                        {!chat.enabled && (
                            <span className="badge warn">DISABLED</span>
                        )}
                        {chat.hidden && (
                            <span className="badge warn">HIDDEN</span>
                        )}
                        {!chat.chat_status && (
                            <span className="badge warn">DEAD</span>
                        )}
                        {isMultiTopic && (
                            <span className="badge primary">MULTI-TOPIC</span>
                        )}
                    </div>

                    {isBusy && (
                        <div
                            className="scan-status-text"
                            style={{
                                color: activeStatus.isScanning
                                    ? "#f9e2af"
                                    : "#a6e3a1",
                            }}>
                            ↻ {activeStatus.queueInfo}
                        </div>
                    )}
                </div>

                {/* STATISTICS */}
                <div className="cell">
                    <div className="chat-meta">
                        Total Messages:{" "}
                        <span className="stat-value">
                            {chat.total_messages?.toLocaleString() || 0}
                        </span>
                    </div>
                    <div className="chat-meta">
                        Latest Message:{" "}
                        <span className="stat-value">{chat.last_message}</span>
                    </div>
                    <div className="chat-meta">
                        Vault Volume:{" "}
                        <span className="stat-value">
                            {chat.total_downloaded?.toLocaleString() || 0}
                        </span>
                    </div>
                    <div className="chat-meta">
                        Vault Size:{" "}
                        <span className="stat-value">
                            {chat.total_size
                                ? (
                                      chat.total_size /
                                      (1024 * 1024 * 1024)
                                  ).toFixed(2)
                                : "0.00"}{" "}
                            GB
                        </span>
                    </div>
                    <div className="chat-meta">
                        Last Synced:{" "}
                        {chat.date_updated
                            ? new Date(chat.date_updated).toLocaleDateString()
                            : "Never"}
                    </div>
                    <div className="chat-meta">
                        Last Downloaded:{" "}
                        {chat.last_download
                            ? new Date(chat.last_download).toLocaleDateString()
                            : "Never"}
                    </div>
                    <div className="chat-meta">
                        Last Archived:{" "}
                        {chat.last_archived
                            ? new Date(chat.last_archived).toLocaleDateString()
                            : "Never"}
                    </div>
                </div>

                {/* ACTIONS */}
                <div className="cell">
                    <button
                        className="main-action-btn"
                        onClick={() => onDownload(chat.chat_id)}
                        disabled={isBusy || !chat.enabled}>
                        {isBusy ? "WORKING..." : "DOWNLOAD"}
                    </button>

                    <div className="action-grid">
                        <button disabled={isBusy || !chat.enabled}>Sync</button>
                        <button>Schedule</button>

                        <button
                            onClick={() =>
                                onToggle(
                                    [chat.chat_id],
                                    "is_batch",
                                    !chat.is_batch,
                                )
                            }>
                            {chat.is_batch
                                ? "Remove from Batch"
                                : "Add to Batch"}
                        </button>
                        <button
                            onClick={() =>
                                onToggle([chat.chat_id], "defer", !chat.defer)
                            }>
                            {chat.defer
                                ? "Remove from Deferred List"
                                : "Add to Defer List"}
                        </button>

                        <button
                            onClick={() =>
                                onToggle(
                                    [chat.chat_id],
                                    "enabled",
                                    !chat.enabled,
                                )
                            }>
                            {chat.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                            onClick={() =>
                                onToggle([chat.chat_id], "hidden", !chat.hidden)
                            }>
                            {chat.hidden ? "Unhide" : "Hide"}
                        </button>

                        <button className="btn-purge">Archive</button>
                        <button className="btn-zip">Render</button>
                    </div>
                </div>
            </div>
        );
    },
);

export default ChatRow;
