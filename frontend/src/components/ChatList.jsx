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
    const [selectedChats, setSelectedChats] = useState(new Set());
    const [activeModal, setActiveModal] = useState(null); // 'sort', 'filter', or null

    console.log("Rendering ChatList with chats:", chats);

    // --- SORTING & FILTERING DEFAULTS ---
    const defaultSort = { key: "chat_id", direction: "asc" };
    const defaultFilter = {
        showHidden: false,
        hideDisabled: false,
        onlyBatchEnabled: false,
        onlyBatchDisabled: false,
        onlyDeferred: false,
        onlyNonDeferred: false,
        onlyMultiTopic: false,
        onlyEmptyVaults: false,
        onlyEmptyChats: false,
        onlyUnarchived: false,
        showGroups: true,
        showChannels: true,
        showPrivate: true,
    };

    // --- LIVE ENGINE STATE ---
    const [sortConfig, setSortConfig] = useState(defaultSort);
    const [filterConfig, setFilterConfig] = useState(defaultFilter);

    // --- DRAFT STATE (For Modals) ---
    const [tempSortConfig, setTempSortConfig] = useState(defaultSort);
    const [tempFilterConfig, setTempFilterConfig] = useState(defaultFilter);

    // --- MODAL CONTROLS ---
    const openModal = (type) => {
        if (type === "sort") setTempSortConfig(sortConfig);
        if (type === "filter") setTempFilterConfig(filterConfig);
        setActiveModal(type);
    };

    const closeModal = () => {
        setActiveModal(null);
    };

    const applySort = () => {
        setSortConfig(tempSortConfig);
        closeModal();
    };

    const applyFilter = () => {
        setFilterConfig(tempFilterConfig);
        closeModal();
    };

    // --- DATA PIPELINE ---
    const processedChats = useMemo(() => {
        let result = chats.filter((chat) => {
            // 1. Visibility & State Filters
            if (!filterConfig.showHidden && chat.hidden) return false;
            if (filterConfig.hideDisabled && !chat.enabled) return false;

            // 2. Batch Engine Filters
            if (filterConfig.onlyBatchEnabled && !chat.is_batch) return false;
            if (filterConfig.onlyBatchDisabled && chat.is_batch) return false;

            // 3. Queue Management Filters
            if (filterConfig.onlyDeferred && !chat.defer) return false;
            if (filterConfig.onlyNonDeferred && chat.defer) return false;

            // 4. Chat Attribute Filters
            if (
                filterConfig.onlyMultiTopic &&
                (!chat.topics || chat.topics.length <= 1)
            )
                return false;
            if (filterConfig.onlyEmptyVaults && chat.total_downloaded !== 0)
                return false;
            if (filterConfig.onlyEmptyChats && chat.total_messages !== 0)
                return false;
            if (filterConfig.onlyUnarchived && chat.last_archived) return false;

            // 5. Type Filters
            if (!filterConfig.showGroups && chat.type === "Group") return false;
            if (!filterConfig.showChannels && chat.type === "Channel")
                return false;
            if (!filterConfig.showPrivate && chat.type === "Private")
                return false;

            // 6. Search Check
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

        // 7. Sort Pass
        result.sort((a, b) => {
            let valA = a[sortConfig.key];
            let valB = b[sortConfig.key];

            // Null safety
            if (valA === null || valA === undefined)
                valA = typeof valB === "string" ? "" : 0;
            if (valB === null || valB === undefined)
                valB = typeof valA === "string" ? "" : 0;

            // Case-insensitive alphabetical sort
            if (typeof valA === "string" && typeof valB === "string") {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }

            if (valA < valB) return sortConfig.direction === "asc" ? -1 : 1;
            if (valA > valB) return sortConfig.direction === "asc" ? 1 : -1;
            return 0;
        });

        return result;
    }, [chats, filterConfig, sortConfig, searchQuery]);

    const totalChats = chats.length;
    const visibleChats = processedChats.length;
    const filteredChats = totalChats - visibleChats;
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

    const handleTempFilterChange = (key, value) => {
        setTempFilterConfig((prev) => {
            let updates = { [key]: value };
            // Mutually Exclusive toggles logic
            if (key === "onlyBatchEnabled" && value)
                updates.onlyBatchDisabled = false;
            if (key === "onlyBatchDisabled" && value)
                updates.onlyBatchEnabled = false;
            if (key === "onlyDeferred" && value)
                updates.onlyNonDeferred = false;
            if (key === "onlyNonDeferred" && value)
                updates.onlyDeferred = false;
            return { ...prev, ...updates };
        });
    };

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

        // If ANY selected item is false, set ALL to true. Else set ALL to false.
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

    const selectedData = processedChats.filter((c) =>
        selectedChats.has(c.chat_id),
    );
    const isAllEnabled =
        selectedData.length > 0 && selectedData.every((chat) => chat.enabled);
    const isAllHidden =
        selectedData.length > 0 && selectedData.every((chat) => chat.hidden);
    const isAllBatch =
        selectedData.length > 0 && selectedData.every((chat) => chat.is_batch);
    const isAllDeferred =
        selectedData.length > 0 && selectedData.every((chat) => chat.defer);

    // --- MODAL CONTENTS ---
    const renderSortModal = () => (
        <div className="modal-content-wrapper">
            <div className="modal-section">
                <strong className="section-title">Identity Sorting</strong>
                <label className="modal-input-label">
                    <input
                        type="radio"
                        name="sortKey"
                        checked={tempSortConfig.key === "chat_id"}
                        onChange={() =>
                            setTempSortConfig({
                                ...tempSortConfig,
                                key: "chat_id",
                            })
                        }
                    />
                    Chat ID (Default / Discovery Order)
                </label>
                <label className="modal-input-label">
                    <input
                        type="radio"
                        name="sortKey"
                        checked={tempSortConfig.key === "name"}
                        onChange={() =>
                            setTempSortConfig({
                                ...tempSortConfig,
                                key: "name",
                            })
                        }
                    />
                    Alphabetical (Chat Name)
                </label>
            </div>

            <hr className="modal-divider" />

            <div className="modal-section">
                <strong className="section-title">Volume & Size Sorting</strong>
                <label className="modal-input-label">
                    <input
                        type="radio"
                        name="sortKey"
                        checked={tempSortConfig.key === "total_downloaded"}
                        onChange={() =>
                            setTempSortConfig({
                                ...tempSortConfig,
                                key: "total_downloaded",
                            })
                        }
                    />
                    Vault Volume (Total Downloaded Files)
                </label>
                <label className="modal-input-label">
                    <input
                        type="radio"
                        name="sortKey"
                        checked={tempSortConfig.key === "total_size"}
                        onChange={() =>
                            setTempSortConfig({
                                ...tempSortConfig,
                                key: "total_size",
                            })
                        }
                    />
                    Vault Size (Total GB on Disk)
                </label>
                <label className="modal-input-label">
                    <input
                        type="radio"
                        name="sortKey"
                        checked={tempSortConfig.key === "total_messages"}
                        onChange={() =>
                            setTempSortConfig({
                                ...tempSortConfig,
                                key: "total_messages",
                            })
                        }
                    />
                    Message Count (Total Messages)
                </label>
            </div>

            <hr className="modal-divider" />

            <div className="modal-section">
                <strong className="section-title">Timeline Sorting</strong>
                <label className="modal-input-label">
                    <input
                        type="radio"
                        name="sortKey"
                        checked={tempSortConfig.key === "date_updated"}
                        onChange={() =>
                            setTempSortConfig({
                                ...tempSortConfig,
                                key: "date_updated",
                            })
                        }
                    />
                    Last Synced (Metadata Checked)
                </label>
                <label className="modal-input-label">
                    <input
                        type="radio"
                        name="sortKey"
                        checked={tempSortConfig.key === "last_download"}
                        onChange={() =>
                            setTempSortConfig({
                                ...tempSortConfig,
                                key: "last_download",
                            })
                        }
                    />
                    Last Downloaded (File Written to Disk)
                </label>
            </div>

            <hr className="modal-divider" />

            <div className="modal-highlight-box">
                <strong className="highlight-title">Sort Direction</strong>
                <div className="modal-radio-group">
                    <label className="modal-input-label sm-gap">
                        <input
                            type="radio"
                            name="sortDir"
                            value="asc"
                            checked={tempSortConfig.direction === "asc"}
                            onChange={() =>
                                setTempSortConfig({
                                    ...tempSortConfig,
                                    direction: "asc",
                                })
                            }
                        />
                        Ascending (A-Z, 0-9)
                    </label>
                    <label className="modal-input-label sm-gap">
                        <input
                            type="radio"
                            name="sortDir"
                            value="desc"
                            checked={tempSortConfig.direction === "desc"}
                            onChange={() =>
                                setTempSortConfig({
                                    ...tempSortConfig,
                                    direction: "desc",
                                })
                            }
                        />
                        Descending (Z-A, 9-0)
                    </label>
                </div>
            </div>

            <button
                className="btn-reset-outline"
                onClick={() => setTempSortConfig(defaultSort)}>
                Reset Sorting to Default
            </button>
        </div>
    );

    const renderFilterModal = () => (
        <div className="modal-content-wrapper filter-wrapper">
            <div className="modal-section">
                <strong className="section-title">Visibility & State</strong>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.showHidden}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "showHidden",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show Hidden Chats
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.hideDisabled}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "hideDisabled",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Hide Disabled Chats
                </label>
            </div>

            <hr className="modal-divider" />

            <div className="modal-section">
                <strong className="section-title">Batch Engine</strong>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyBatchEnabled}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "onlyBatchEnabled",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show ONLY Batch-Enabled
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyBatchDisabled}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "onlyBatchDisabled",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show ONLY Batch-Disabled
                </label>
            </div>

            <hr className="modal-divider" />

            <div className="modal-section">
                <strong className="section-title">Queue Management</strong>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyDeferred}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "onlyDeferred",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show ONLY Deferred
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyNonDeferred}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "onlyNonDeferred",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show ONLY Non-Deferred
                </label>
            </div>

            <hr className="modal-divider" />

            <div className="modal-section">
                <strong className="section-title">Chat Attributes</strong>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyMultiTopic}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "onlyMultiTopic",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show ONLY Multi-Topic
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyEmptyVaults}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "onlyEmptyVaults",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show ONLY Empty Vaults
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyEmptyChats}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "onlyEmptyChats",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show ONLY Empty Chats
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyUnarchived}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "onlyUnarchived",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show ONLY Unarchived
                </label>
            </div>

            <hr className="modal-divider" />

            <div className="modal-section">
                <strong className="section-title">Type Filters</strong>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.showGroups}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "showGroups",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show Groups
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.showChannels}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "showChannels",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show Channels
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.showPrivate}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "showPrivate",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show Private Conversations
                </label>
            </div>

            <button
                className="btn-reset-outline"
                onClick={() => setTempFilterConfig(defaultFilter)}>
                Reset Filters to Default
            </button>
        </div>
    );

    return (
        <div className="chat-list-container">
            {/* --- MODALS --- */}
            <Modal
                isOpen={activeModal === "sort"}
                onClose={closeModal}
                title="Sort Chats"
                footerActions={
                    <>
                        <button className="btn-cancel" onClick={closeModal}>
                            Cancel
                        </button>
                        <button className="btn-apply" onClick={applySort}>
                            Apply
                        </button>
                    </>
                }>
                {renderSortModal()}
            </Modal>

            <Modal
                isOpen={activeModal === "filter"}
                onClose={closeModal}
                title="Filter Chats"
                footerActions={
                    <>
                        <button className="btn-cancel" onClick={closeModal}>
                            Cancel
                        </button>
                        <button className="btn-apply" onClick={applyFilter}>
                            Apply
                        </button>
                    </>
                }>
                {renderFilterModal()}
            </Modal>

            {/* --- TOP CONTROL BAR --- */}
            <div className="chat-controls-bar">
                <div className="controls-row">
                    <div className="controls-row-left">
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
                        <div className="btn-group">
                            <button
                                className="control-btn"
                                onClick={() => openModal("sort")}>
                                Sort
                            </button>
                            <button
                                className="control-btn"
                                onClick={() => openModal("filter")}>
                                Filter
                            </button>
                        </div>
                    </div>
                    <div className="stats-text">
                        <span>
                            Showing{" "}
                            <span className="highlight">{visibleChats}</span> of{" "}
                            {totalChats} Chats (Filtered:{" "}
                            {filteredChats === 0 ? "None" : filteredChats})
                        </span>
                        <small>
                            Hidden Chats
                            {filterConfig.showHidden
                                ? " (Currently Visible)"
                                : ""}
                            : {totalHiddenCount}
                        </small>
                    </div>
                </div>

                <div className="controls-row">
                    <div className="btn-group">
                        <button
                            className="control-btn primary"
                            title="Starts downloading all enabled chats that are part of the Batch">
                            Download Batch
                        </button>
                        <button
                            className="control-btn primary"
                            title="Syncs with your Telegram account, grabbing all newly added chats and refreshing the metadata of existing">
                            Sync to Telegram
                        </button>
                    </div>
                    <div className="btn-group">
                        {selectedChats.size > 0 ? (
                            <>
                                <button
                                    className="control-btn"
                                    onClick={() => handleBulkToggle("enabled")}>
                                    {isAllEnabled
                                        ? "Disable Selected"
                                        : "Enable Selected"}
                                </button>
                                <button
                                    className="control-btn"
                                    onClick={() => handleBulkToggle("hidden")}>
                                    {isAllHidden
                                        ? "Unhide Selected"
                                        : "Hide Selected"}
                                </button>
                                <button
                                    className="control-btn"
                                    onClick={() =>
                                        handleBulkToggle("is_batch")
                                    }>
                                    {isAllBatch
                                        ? "Remove Selected from Batch"
                                        : "Add Selected to Batch"}
                                </button>
                                <button
                                    className="control-btn"
                                    onClick={() => handleBulkToggle("defer")}>
                                    {isAllDeferred
                                        ? "Remove Selected from Deferred List"
                                        : "Add Selected to Deferred List"}
                                </button>
                                <button className="control-btn accent">
                                    Download Selected ({selectedChats.size})
                                </button>
                                <button className="control-btn accent">
                                    Sync Selected ({selectedChats.size})
                                </button>
                                <button className="control-btn primary">
                                    Archive Selected ({selectedChats.size})
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    className="control-btn primary"
                                    title="Starts download for all enabled chats in the database">
                                    Download All
                                </button>
                                <button
                                    className="control-btn primary"
                                    title="Syncs all enabled chats in the database for changes and updates metadata and message counts">
                                    Sync All
                                </button>
                                <button
                                    className="control-btn primary"
                                    title="Adds all enabled chats to the final vault and for permanent storage.">
                                    Archive All
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
                                    className="chat-name">
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
                                        className={`badge ${chat.is_batch ? "active" : ""}`}>
                                        BATCH:{" "}
                                        {chat.is_batch
                                            ? "INCLUDED"
                                            : "EXCLUDED"}
                                    </span>

                                    <span
                                        className={`badge ${chat.defer ? "warn" : "active"}`}>
                                        DEFERRED LIST:{" "}
                                        {chat.defer ? "INCLUDED" : "EXCLUDED"}
                                    </span>

                                    {!chat.enabled && (
                                        <span className="badge warn">
                                            DISABLED
                                        </span>
                                    )}
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
                                        {chat.total_messages?.toLocaleString() ||
                                            0}
                                    </span>
                                </div>
                                <div className="chat-meta">
                                    Latest Message:{" "}
                                    <span className="stat-value">
                                        {chat.last_message}
                                    </span>
                                </div>
                                <div className="chat-meta">
                                    Vault Volume:{" "}
                                    <span className="stat-value">
                                        {chat.total_downloaded?.toLocaleString() ||
                                            0}
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
                                        ? new Date(
                                              chat.date_updated,
                                          ).toLocaleDateString()
                                        : "Never"}
                                </div>
                                <div className="chat-meta">
                                    Last Downloaded:{" "}
                                    {chat.last_download
                                        ? new Date(
                                              chat.last_download,
                                          ).toLocaleDateString()
                                        : "Never"}
                                </div>
                                <div className="chat-meta">
                                    Last Archived:{" "}
                                    {chat.last_archived
                                        ? new Date(
                                              chat.last_archived,
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
                                        Sync
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
                                        {chat.isBatch
                                            ? "Remove from Batch"
                                            : "Add to Batch"}
                                    </button>
                                    <button
                                        onClick={() =>
                                            handleToggle(
                                                [chat.chat_id],
                                                "defer",
                                                !chat.defer,
                                            )
                                        }>
                                        {chat.defer
                                            ? "Remove from Deferred List"
                                            : "Add to Defer List"}
                                    </button>

                                    <button
                                        onClick={() =>
                                            handleToggle(
                                                [chat.chat_id],
                                                "enabled",
                                                !chat.enabled,
                                            )
                                        }>
                                        {chat.enabled ? "Disable" : "Enable"}
                                    </button>
                                    <button
                                        onClick={() =>
                                            handleToggle(
                                                [chat.chat_id],
                                                "hidden",
                                                !chat.hidden,
                                            )
                                        }>
                                        {chat.hidden ? "Unhide" : "Hide"}
                                    </button>

                                    <button className="btn-purge">
                                        Archive
                                    </button>
                                    <button className="btn-zip">Render</button>
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
