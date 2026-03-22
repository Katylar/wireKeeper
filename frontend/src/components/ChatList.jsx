import React, { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import Modal from "./Modal";
import "../styles/layout/chatlist.scss";

export default function ChatList({
    chats,
    activeTasks,
    activeScans,
    onDownload,
    onRefresh,
    setChats,
}) {
    // --- UI STATE ---
    const [searchQuery, setSearchQuery] = useState("");
    const [showHidden, setShowHidden] = useState(false); // Kept in state for future Filter Menu
    const [selectedChats, setSelectedChats] = useState(new Set());

    const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
    const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);

    // --- DATA PIPELINE ---
    const processedChats = useMemo(() => {
        return chats.filter((chat) => {
            if (chat.hidden && !showHidden) return false;

            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const matchName = chat.name?.toLowerCase().includes(q);
                const matchFolderName = chat.folder_name
                    ?.toLowerCase()
                    .includes(q);
                const matchOldName = chat.old_name?.toLowerCase().includes(q);
                const matchId = chat.chat_id.toString().includes(q);
                if (!matchName && !matchFolderName && !matchOldName && !matchId)
                    return false;
            }
            return true;
        });
    }, [chats, showHidden, searchQuery]);

    const totalHiddenCount = chats.filter((c) => c.hidden).length;

    // --- HANDLERS ---
    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedChats(new Set(processedChats.map((c) => c.chat_id)));
        } else {
            setSelectedChats(new Set());
        }
    };

    const handleSelectOne = (chatId) => {
        const newSet = new Set(selectedChats);
        if (newSet.has(chatId)) newSet.delete(chatId);
        else newSet.add(chatId);
        setSelectedChats(newSet);
    };

    const isAllSelected =
        processedChats.length > 0 &&
        selectedChats.size === processedChats.length;

    // --- THE TOGGLE ENGINE ---
    const handleToggle = async (chatIds, field, targetValue) => {
        if (setChats) {
            setChats((prevChats) =>
                prevChats.map((chat) => {
                    if (chatIds.includes(chat.chat_id)) {
                        return { ...chat, [field]: targetValue };
                    }
                    return chat;
                }),
            );
        }

        if (field === "hidden" && targetValue === true) {
            setSelectedChats(new Set());
        }

        try {
            await fetch("http://localhost:39486/api/chats/toggle", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_ids: chatIds,
                    field,
                    value: targetValue,
                }),
            });

            if (field === "hidden" && targetValue === true) {
                setSelectedChats(new Set());
            }

            if (onRefresh) onRefresh();
        } catch (err) {
            console.error(`Failed to toggle ${field}:`, err);

            if (onRefresh) onRefresh();
        }
    };

    const handleBulkToggle = (field) => {
        const selectedArr = Array.from(selectedChats);
        const selectedData = processedChats.filter((c) =>
            selectedArr.includes(c.chat_id),
        );

        // Smart Toggle: If ANY selected item is false, set ALL to true. Else set ALL to false.
        const targetValue = selectedData.some((c) => !c[field]);
        handleToggle(selectedArr, field, targetValue);
    };

    // --- RENDER HELPERS ---
    const getChatActiveStatus = (chatId) => {
        const tasks = Object.values(activeTasks).filter(
            (t) => t.chat_id === chatId,
        );
        const isScanning = Boolean(activeScans && activeScans[chatId]);
        if (tasks.length === 0 && isScanning)
            return { isScanning: true, queueInfo: "Scanning..." };
        if (tasks.length === 0) return null;
        return {
            isScanning: false,
            activeCount: tasks.length,
            queueInfo: tasks[0].queue_info || "Downloading...",
        };
    };

    return (
        <div className="chat-list-container">
            {/* --- TOP CONTROL BAR --- */}
            <div className="chat-controls-bar">
                <div className="controls-row">
                    <div className="search-wrapper">
                        <input
                            type="text"
                            className="search-box"
                            placeholder="Search by name, folder, old name, or ID..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {searchQuery && (
                            <button
                                className="clear-search-btn"
                                onClick={() => setSearchQuery("")}
                                title="Clear search">
                                ✕
                            </button>
                        )}
                    </div>

                    <div className="stats-text">
                        Showing{" "}
                        <span className="highlight">
                            {processedChats.length}
                        </span>{" "}
                        chats (Total Hidden: {totalHiddenCount})
                    </div>
                </div>

                <div className="controls-row">
                    <div className="btn-group">
                        <button
                            className="control-btn"
                            onClick={() =>
                                setSortDropdownOpen(!sortDropdownOpen)
                            }>
                            Sort ▾
                        </button>
                        <button
                            className="control-btn"
                            onClick={() =>
                                setFilterDropdownOpen(!filterDropdownOpen)
                            }>
                            Filter ▾
                        </button>
                    </div>

                    <div className="btn-group">
                        {selectedChats.size > 0 ? (
                            <>
                                <button
                                    className="control-btn"
                                    onClick={() => handleBulkToggle("enabled")}>
                                    Disable/Enable
                                </button>
                                <button
                                    className="control-btn"
                                    onClick={() => handleBulkToggle("hidden")}>
                                    Hide/Unhide
                                </button>
                                <button
                                    className="control-btn"
                                    onClick={() =>
                                        handleBulkToggle("is_batch")
                                    }>
                                    Batch Toggle
                                </button>
                                <button
                                    className="control-btn"
                                    onClick={() => handleBulkToggle("defer")}>
                                    Defer/Undefer
                                </button>
                                <button className="control-btn primary">
                                    Archive Selected
                                </button>
                                <button className="control-btn accent">
                                    Sync Selected ({selectedChats.size})
                                </button>
                            </>
                        ) : (
                            <>
                                <button className="control-btn primary">
                                    Archive All Chats
                                </button>
                                <button
                                    className="control-btn accent"
                                    title="Syncs all Enabled chats in the database">
                                    Sync All Enabled
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* --- GRID HEADER --- */}
            <div className="chat-grid-header">
                <div className="cell checkbox-cell">
                    <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={handleSelectAll}
                        title="Select all visible"
                    />
                </div>
                <div className="cell">Identity & Configuration</div>
                <div className="cell">Statistics</div>
                <div className="cell">Actions</div>
            </div>

            {/* --- GRID BODY --- */}
            <div className="chat-grid-body">
                {processedChats.map((chat) => {
                    const activeStatus = getChatActiveStatus(chat.chat_id);
                    const isBusy = activeStatus !== null;
                    const isSelected = selectedChats.has(chat.chat_id);

                    const isMultiTopic = chat.topics && chat.topics.length > 1;

                    return (
                        <div
                            key={chat.chat_id}
                            className={`chat-grid-row ${chat.hidden ? "is-hidden" : ""} ${!chat.enabled ? "is-disabled" : ""}`}>
                            <div className="cell checkbox-cell">
                                <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() =>
                                        handleSelectOne(chat.chat_id)
                                    }
                                />
                            </div>

                            {/* IDENTITY & CONFIGURATION */}
                            <div className="cell">
                                <Link
                                    to={`/chat/${chat.chat_id}`}
                                    className="chat-name"
                                    style={{ textDecoration: "none" }}>
                                    {chat.name}
                                </Link>
                                {chat.old_name && (
                                    <div className="old-name">
                                        Previously: {chat.old_name}
                                    </div>
                                )}
                                <div className="chat-meta">
                                    {chat.type} • ID: {chat.chat_id}
                                </div>

                                <div className="badge-group">
                                    <span
                                        className={`badge ${chat.enabled ? "active" : "danger"}`}>
                                        {chat.enabled ? "ENABLED" : "DISABLED"}
                                    </span>

                                    <span
                                        className={`badge ${chat.is_batch ? "active" : ""}`}>
                                        BATCH: {chat.is_batch ? "ON" : "OFF"}
                                    </span>

                                    <span
                                        className={`badge ${chat.defer ? "warn" : "active"}`}>
                                        DEFERRED: {chat.defer ? "ON" : "OFF"}
                                    </span>

                                    {chat.hidden && (
                                        <span className="badge warn">
                                            HIDDEN
                                        </span>
                                    )}
                                    {isMultiTopic && (
                                        <span className="badge primary">
                                            MULTI-TOPIC
                                        </span>
                                    )}
                                </div>

                                {isBusy && (
                                    <div
                                        style={{
                                            marginTop: "0.5rem",
                                            fontSize: "0.75rem",
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
                                    Msgs:{" "}
                                    <span style={{ color: "#cdd6f4" }}>
                                        {chat.total_messages?.toLocaleString() ||
                                            0}
                                    </span>
                                </div>
                                <div className="chat-meta">
                                    Saved:{" "}
                                    <span style={{ color: "#cdd6f4" }}>
                                        {chat.total_downloaded?.toLocaleString() ||
                                            0}
                                    </span>
                                </div>
                                <div className="chat-meta">
                                    Size:{" "}
                                    <span style={{ color: "#cdd6f4" }}>
                                        0 GB
                                    </span>
                                </div>
                                <div
                                    className="chat-meta"
                                    style={{
                                        marginTop: "0.25rem",
                                        fontSize: "0.7rem",
                                    }}>
                                    Last Msg: {chat.last_message_id || 0}
                                </div>
                                <div
                                    className="chat-meta"
                                    style={{ fontSize: "0.7rem" }}>
                                    Updated:{" "}
                                    {chat.last_download_scan
                                        ? new Date(
                                              chat.last_download_scan,
                                          ).toLocaleDateString()
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
                                    <button disabled={isBusy || !chat.enabled}>
                                        Scan Only
                                    </button>
                                    <button>Schedule</button>

                                    {/* The New Toggle Buttons */}
                                    <button
                                        onClick={() =>
                                            handleToggle(
                                                [chat.chat_id],
                                                "is_batch",
                                                !chat.is_batch,
                                            )
                                        }>
                                        Toggle Batch
                                    </button>
                                    <button
                                        onClick={() =>
                                            handleToggle(
                                                [chat.chat_id],
                                                "defer",
                                                !chat.defer,
                                            )
                                        }>
                                        Toggle Defer
                                    </button>
                                    <button
                                        onClick={() =>
                                            handleToggle(
                                                [chat.chat_id],
                                                "enabled",
                                                !chat.enabled,
                                            )
                                        }>
                                        Toggle Enable
                                    </button>
                                    <button
                                        onClick={() =>
                                            handleToggle(
                                                [chat.chat_id],
                                                "hidden",
                                                !chat.hidden,
                                            )
                                        }>
                                        Toggle Hide
                                    </button>

                                    <button style={{ color: "#f38ba8" }}>
                                        Purge DB
                                    </button>
                                    <button style={{ color: "#a6e3a1" }}>
                                        Zip Archive
                                    </button>
                                </div>

                                <div className="action-checkboxes">
                                    <label>
                                        <input type="checkbox" /> Validate
                                    </label>
                                    <label>
                                        <input type="checkbox" /> Overwrite
                                    </label>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
