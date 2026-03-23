import React, { useState, useMemo, useEffect } from "react";
import { Link } from "react-router-dom";
import { Virtuoso } from "react-virtuoso";
import ChatRow from "./ChatRow";
import Modal from "./Modal";
import { useEngine } from "../context/WebSocketProvider";
import "../styles/layout/chatlist.scss";

export default function ChatList({ chats, onDownload, onRefresh, setChats }) {
    // --- ORCHESTRATOR STATE ---
    const { currentTask, queue, getTaskForChat, killTask } = useEngine();

    // --- UI STATE ---
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedChats, setSelectedChats] = useState(new Set());
    const [activeModal, setActiveModal] = useState(null); // 'sort', 'filter', 'batch', 'listed-download', 'selected-download', or null

    // --- SORTING & FILTERING DEFAULTS ---
    const defaultSort = { key: "chat_id", direction: "asc" };
    const defaultFilter = {
        showHidden: false,
        onlyEnabled: true,
        onlyDisabled: false,
        onlyLive: true,
        onlyDead: false,
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

    // --- DOWNLOAD CONFIG STATE (Shared by Batch, Listed, Selected) ---
    const [dlConfig, setDlConfig] = useState({
        overwrite: false,
        validate: false,
        resume: true,
        sort: "default", // Used specifically for Batch
    });

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
        fetch("http://localhost:39486/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ui_sort_config: JSON.stringify(tempSortConfig),
            }),
        });
        closeModal();
    };

    const applyFilter = () => {
        setFilterConfig(tempFilterConfig);
        fetch("http://localhost:39486/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ui_filter_config: JSON.stringify(tempFilterConfig),
            }),
        });
        closeModal();
    };

    useEffect(() => {
        fetch("http://localhost:39486/api/settings")
            .then((res) => res.json())
            .then((data) => {
                if (data.ui_sort_config) {
                    const parsedSort = JSON.parse(data.ui_sort_config);
                    setSortConfig(parsedSort);
                    setTempSortConfig(parsedSort);
                }
                if (data.ui_filter_config) {
                    const parsedFilter = JSON.parse(data.ui_filter_config);
                    setFilterConfig(parsedFilter);
                    setTempFilterConfig(parsedFilter);
                }
            })
            .catch((err) =>
                console.error("Failed to load UI preferences:", err),
            );
    }, []);

    // --- DATA PIPELINE ---
    const processedChats = useMemo(() => {
        let result = chats.filter((chat) => {
            if (!filterConfig.showHidden && chat.hidden) return false;
            if (filterConfig.onlyEnabled && !chat.enabled) return false;
            if (filterConfig.onlyDisabled && chat.enabled) return false;
            if (filterConfig.onlyLive && !chat.chat_status) return false;
            if (filterConfig.onlyDead && chat.chat_status) return false;
            if (filterConfig.onlyBatchEnabled && !chat.is_batch) return false;
            if (filterConfig.onlyBatchDisabled && chat.is_batch) return false;
            if (filterConfig.onlyDeferred && !chat.defer) return false;
            if (filterConfig.onlyNonDeferred && chat.defer) return false;
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
            if (!filterConfig.showGroups && chat.type === "Group") return false;
            if (!filterConfig.showChannels && chat.type === "Channel")
                return false;
            if (!filterConfig.showPrivate && chat.type === "Private")
                return false;

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

        result.sort((a, b) => {
            let valA = a[sortConfig.key];
            let valB = b[sortConfig.key];
            if (valA === null || valA === undefined)
                valA = typeof valB === "string" ? "" : 0;
            if (valB === null || valB === undefined)
                valB = typeof valA === "string" ? "" : 0;
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

    // DERIVED SELECTIONS (Respecting Shown and Enabled)
    const listedEnabledChats = useMemo(
        () => processedChats.filter((c) => c.enabled),
        [processedChats],
    );
    const selectedEnabledChats = useMemo(
        () =>
            processedChats.filter(
                (c) => selectedChats.has(c.chat_id) && c.enabled,
            ),
        [processedChats, selectedChats],
    );

    // RESTORED: Missing Boolean flags for Button Labels
    const selectedData = useMemo(
        () => processedChats.filter((c) => selectedChats.has(c.chat_id)),
        [processedChats, selectedChats],
    );
    const isAllEnabled =
        selectedData.length > 0 && selectedData.every((chat) => chat.enabled);
    const isAllHidden =
        selectedData.length > 0 && selectedData.every((chat) => chat.hidden);
    const isAllBatch =
        selectedData.length > 0 && selectedData.every((chat) => chat.is_batch);
    const isAllDeferred =
        selectedData.length > 0 && selectedData.every((chat) => chat.defer);

    const totalChats = chats.length;
    const visibleChats = processedChats.length;
    const filteredChats = totalChats - visibleChats;

    const totalHiddenCount = chats.filter((c) => c.hidden).length;
    const totalDisabledCount = chats.filter((c) => !c.enabled).length;
    const totalDeadCount = chats.filter((c) => !c.chat_status).length;
    const totalBatchChats = chats.filter(
        (c) => c.is_batch && c.enabled && c.chat_status,
    ).length;

    // --- QUEUE DETECTION FOR BUTTONS ---
    const isBatchBusy = useMemo(
        () =>
            currentTask?.type === "batch-download" ||
            queue.some((t) => t.type === "batch-download"),
        [currentTask, queue],
    );

    const isSyncBusy = useMemo(
        () =>
            currentTask?.type === "sync-all" ||
            queue.some((t) => t.type === "sync-all"),
        [currentTask, queue],
    );

    // --- HANDLERS ---
    const handleSelectAll = (e) => {
        if (e.target.checked)
            setSelectedChats(new Set(processedChats.map((c) => c.chat_id)));
        else setSelectedChats(new Set());
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
            if (key === "onlyEnabled" && value) updates.onlyDisabled = false;
            if (key === "onlyDisabled" && value) updates.onlyEnabled = false;
            if (key === "onlyLive" && value) updates.onlyDead = false;
            if (key === "onlyDead" && value) updates.onlyLive = false;
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
                    if (chatIds.includes(chat.chat_id))
                        return { ...chat, [field]: targetValue };
                    return chat;
                }),
            );
        }
        if (field === "hidden" && targetValue === true)
            setSelectedChats(new Set());
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
        const targetValue = selectedData.some((c) => !c[field]);
        handleToggle(selectedArr, field, targetValue);
    };

    const handleGlobalSync = async () => {
        try {
            await fetch("http://localhost:39486/api/sync", { method: "POST" });
            if (onRefresh) onRefresh();
        } catch (err) {
            console.error("Global sync failed:", err);
        }
    };

    const handleSyncGroup = async (mode) => {
        const ids =
            mode === "selected"
                ? Array.from(selectedChats)
                : listedEnabledChats.map((c) => c.chat_id);
        try {
            await fetch("http://localhost:39486/api/sync/multiple", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_ids: ids }),
            });
            if (onRefresh) onRefresh();
        } catch (err) {
            console.error("Multi-sync failed:", err);
        }
    };

    const handleStartBatch = async () => {
        try {
            const params = new URLSearchParams({
                overwrite: dlConfig.overwrite,
                validate: dlConfig.validate,
                resume: dlConfig.resume,
                sort: dlConfig.sort,
            });
            await fetch(
                `http://localhost:39486/api/batch/start?${params.toString()}`,
                { method: "POST" },
            );
            closeModal();
            if (onRefresh) onRefresh();
        } catch (err) {
            console.error("Batch trigger failed:", err);
        }
    };

    const handleEnqueueDownloads = async (mode) => {
        const ids =
            mode === "selected"
                ? selectedEnabledChats.map((c) => c.chat_id)
                : listedEnabledChats.map((c) => c.chat_id);
        try {
            await fetch("http://localhost:39486/api/download/multiple", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    chat_ids: ids,
                    overwrite: dlConfig.overwrite,
                    validate_mode: dlConfig.validate,
                    resume: dlConfig.resume,
                }),
            });
            closeModal();
            if (onRefresh) onRefresh();
        } catch (err) {
            console.error("Enqueue failed:", err);
        }
    };

    // --- RENDER HELPERS ---
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
        </div>
    );

    const renderFilterModal = () => (
        <div className="modal-content-wrapper filter-wrapper">
            <div className="modal-section">
                <strong className="section-title">Visibility</strong>
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
            </div>
            <hr className="modal-divider" />
            <div className="modal-section">
                <strong className="section-title">State</strong>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyEnabled}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "onlyEnabled",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show ONLY Enabled Chats
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyDisabled}
                        onChange={(e) =>
                            handleTempFilterChange(
                                "onlyDisabled",
                                e.target.checked,
                            )
                        }
                    />{" "}
                    Show ONLY Disabled Chats
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyLive}
                        onChange={(e) =>
                            handleTempFilterChange("onlyLive", e.target.checked)
                        }
                    />{" "}
                    Show ONLY Live Chats
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={tempFilterConfig.onlyDead}
                        onChange={(e) =>
                            handleTempFilterChange("onlyDead", e.target.checked)
                        }
                    />{" "}
                    Show ONLY Dead Chats
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
        </div>
    );

    const renderBatchModal = () => (
        <div className="modal-content-wrapper batch-wrapper">
            <div className="modal-section">
                <div
                    className="chat-meta"
                    style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>
                    Total Chats in Batch:{" "}
                    <span className="stat-value highlight">
                        {totalBatchChats}
                    </span>
                </div>
                <label
                    className="modal-input-label"
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: "0.5rem",
                    }}>
                    <strong
                        className="section-title"
                        style={{ marginBottom: "0" }}>
                        Sequence
                    </strong>
                    <select
                        className="modal-select"
                        value={dlConfig.sort}
                        onChange={(e) =>
                            setDlConfig({ ...dlConfig, sort: e.target.value })
                        }
                        style={{
                            padding: "0.4rem",
                            borderRadius: "4px",
                            border: "1px solid #45475a",
                            backgroundColor: "#1e1e2e",
                            color: "#cdd6f4",
                            width: "100%",
                        }}>
                        <option value="default">
                            Default (Deferred last, then Message Count)
                        </option>
                        <option value="chat_id_asc">Chat ID (Ascending)</option>
                        <option value="chat_id_desc">
                            Chat ID (Descending)
                        </option>
                        <option value="messages_asc">
                            Message Count (Ascending)
                        </option>
                        <option value="messages_desc">
                            Message Count (Descending)
                        </option>
                        <option value="date_added_asc">
                            Date Added (Ascending)
                        </option>
                        <option value="date_added_desc">
                            Date Added (Descending)
                        </option>
                    </select>
                </label>
                <small
                    style={{
                        display: "block",
                        marginTop: "0.5rem",
                        color: "#a6adc8",
                        fontStyle: "italic",
                    }}>
                    Note: Deferred List still applies.
                </small>
            </div>
            <hr className="modal-divider" />
            <div className="modal-section">
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={dlConfig.overwrite}
                        onChange={(e) =>
                            setDlConfig({
                                ...dlConfig,
                                overwrite: e.target.checked,
                            })
                        }
                    />{" "}
                    Redownload & Overwrite Files in the Vault
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={dlConfig.validate}
                        onChange={(e) =>
                            setDlConfig({
                                ...dlConfig,
                                validate: e.target.checked,
                            })
                        }
                    />{" "}
                    Scan from Start of Chat to find Missed Files
                </label>
                <label className="modal-input-label">
                    <input
                        type="checkbox"
                        checked={dlConfig.resume}
                        onChange={(e) =>
                            setDlConfig({
                                ...dlConfig,
                                resume: e.target.checked,
                            })
                        }
                    />{" "}
                    Automatically Resume Interrupted Downloads
                </label>
            </div>
        </div>
    );

    const renderDownloadModal = (mode) => {
        const isSelected = mode === "selected";
        const count = isSelected
            ? selectedEnabledChats.length
            : listedEnabledChats.length;
        const title = isSelected
            ? "Download all Selected Chats"
            : "Download all Listed Chats";

        return (
            <div className="modal-content-wrapper batch-wrapper">
                <div className="modal-section">
                    <div
                        className="chat-meta"
                        style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>
                        {isSelected
                            ? "Total Chats in Selected: "
                            : "Total Chats in Shown and Enabled: "}
                        <span className="stat-value highlight">{count}</span>
                    </div>
                    <div
                        className="chat-meta"
                        style={{
                            color: "#a6adc8",
                            fontSize: "0.9rem",
                            fontStyle: "italic",
                        }}>
                        Queue Order: Using current Sorting scheme
                    </div>
                </div>
                <hr className="modal-divider" />
                <div className="modal-section">
                    <label className="modal-input-label">
                        <input
                            type="checkbox"
                            checked={dlConfig.overwrite}
                            onChange={(e) =>
                                setDlConfig({
                                    ...dlConfig,
                                    overwrite: e.target.checked,
                                })
                            }
                        />{" "}
                        Redownload & Overwrite Files in the Vault
                    </label>
                    <label className="modal-input-label">
                        <input
                            type="checkbox"
                            checked={dlConfig.validate}
                            onChange={(e) =>
                                setDlConfig({
                                    ...dlConfig,
                                    validate: e.target.checked,
                                })
                            }
                        />{" "}
                        Scan from Start of Chat to find Missed Files
                    </label>
                    <label className="modal-input-label">
                        <input
                            type="checkbox"
                            checked={dlConfig.resume}
                            onChange={(e) =>
                                setDlConfig({
                                    ...dlConfig,
                                    resume: e.target.checked,
                                })
                            }
                        />{" "}
                        Automatically Resume Interrupted Downloads
                    </label>
                </div>
            </div>
        );
    };

    return (
        <div className="chat-list-container">
            {/* --- MODALS --- */}
            <Modal
                isOpen={activeModal === "sort"}
                onClose={closeModal}
                title="Sort Chats"
                footerActions={
                    <>
                        <button
                            className="btn-reset-outline"
                            style={{ marginRight: "auto" }}
                            onClick={() => setTempSortConfig(defaultSort)}>
                            Reset Sorting to Default
                        </button>
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
                        <button
                            className="btn-reset-outline"
                            style={{ marginRight: "auto" }}
                            onClick={() => setTempFilterConfig(defaultFilter)}>
                            Reset Filters to Default
                        </button>
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

            <Modal
                isOpen={activeModal === "batch"}
                onClose={closeModal}
                title="Start Download of Batched Chats"
                footerActions={
                    <>
                        <button className="btn-cancel" onClick={closeModal}>
                            Cancel
                        </button>
                        <button
                            className="btn-apply"
                            onClick={handleStartBatch}>
                            START BATCH DOWNLOAD
                        </button>
                    </>
                }>
                {renderBatchModal()}
            </Modal>

            <Modal
                isOpen={activeModal === "listed-download"}
                onClose={closeModal}
                title="Download all Listed Chats"
                footerActions={
                    <>
                        <button className="btn-cancel" onClick={closeModal}>
                            Cancel
                        </button>
                        <button
                            className="btn-apply"
                            onClick={() => handleEnqueueDownloads("listed")}>
                            ENQUEUE CHATS FOR DOWNLOAD
                        </button>
                    </>
                }>
                {renderDownloadModal("listed")}
            </Modal>

            <Modal
                isOpen={activeModal === "selected-download"}
                onClose={closeModal}
                title="Download all Selected Chats"
                footerActions={
                    <>
                        <button className="btn-cancel" onClick={closeModal}>
                            Cancel
                        </button>
                        <button
                            className="btn-apply"
                            onClick={() => handleEnqueueDownloads("selected")}>
                            ENQUEUE CHATS FOR DOWNLOAD
                        </button>
                    </>
                }>
                {renderDownloadModal("selected")}
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
                            Hidden Chats: {totalHiddenCount} | Disabled Chats:{" "}
                            {totalDisabledCount} | Dead Chats: {totalDeadCount}
                        </small>
                    </div>
                </div>

                <div className="controls-row">
                    <div className="btn-group">
                        <button
                            className={`control-btn primary ${isBatchBusy ? "busy-state" : ""}`}
                            disabled={isBatchBusy}
                            title="Starts downloading all enabled chats that are part of the Batch"
                            onClick={() => openModal("batch")}>
                            {isBatchBusy
                                ? "Batch Active..."
                                : "Start Batch Download"}
                        </button>
                        <button
                            className={`control-btn primary ${isSyncBusy ? "busy-state" : ""}`}
                            disabled={isSyncBusy}
                            title="Syncs with your Telegram account, refreshing metadata"
                            onClick={handleGlobalSync}>
                            {isSyncBusy
                                ? "Syncing..."
                                : "Sync with Telegram Servers"}
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
                                <button
                                    className="control-btn accent"
                                    onClick={() =>
                                        openModal("selected-download")
                                    }>
                                    Download Selected ({selectedChats.size})
                                </button>
                                <button
                                    className="control-btn accent"
                                    onClick={() => handleSyncGroup("selected")}>
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
                                    title="Starts download for all enabled chats in the database"
                                    onClick={() =>
                                        openModal("listed-download")
                                    }>
                                    Download Listed Chats
                                </button>
                                <button
                                    className="control-btn primary"
                                    title="Syncs all enabled chats in the database"
                                    onClick={() => handleSyncGroup("listed")}>
                                    Sync Listed Chats
                                </button>
                                <button
                                    className="control-btn primary"
                                    title="Archive all enabled chats.">
                                    Archive Listed Chats
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
                <Virtuoso
                    useWindowScroll
                    data={processedChats}
                    itemContent={(index, chat) => {
                        const activeStatus = getTaskForChat(chat.chat_id);
                        const isSelected = selectedChats.has(chat.chat_id);
                        return (
                            <ChatRow
                                key={chat.chat_id}
                                chat={chat}
                                activeStatus={activeStatus}
                                isSelected={isSelected}
                                onSelect={handleSelectOne}
                                onToggle={handleToggle}
                                onDownload={onDownload}
                                onKillTask={killTask}
                            />
                        );
                    }}
                />
            </div>
        </div>
    );
}
