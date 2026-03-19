import React, { useState, useEffect, useRef, useMemo } from "react";
import "../styles/layout/filelist.scss";

// Refined numerical formatter
const formatBytes = (bytes) => {
    const numBytes = Number(bytes);
    if (isNaN(numBytes) || numBytes <= 0) return "0 B";
    if (numBytes < 1024) return `${numBytes} B`;

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(numBytes) / Math.log(k));
    return parseFloat((numBytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const formatDate = (dateString) => {
    if (!dateString) return "-";
    const date = new Date(dateString);
    return date.toLocaleString("en-GB", {
        year: "2-digit",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
};

const categoryNames = {
    videos: "Video",
    images: "Image",
    archives: "Archive",
    misc: "Misc",
};

const SortIndicator = ({ columnKey, sortConfig }) => {
    if (sortConfig.key !== columnKey) return null;
    return (
        <span style={{ fontSize: "1.1em" }}>
            {sortConfig.direction === "asc" ? "↑" : "↓"}
        </span>
    );
};

export default function FileList({ categorizedFiles }) {
    const [filters, setFilters] = useState({
        videos: true,
        images: true,
        archives: true,
        misc: true,
    });

    const [sortConfig, setSortConfig] = useState({
        key: "message_id",
        direction: "desc",
    });
    const [scrollTop, setScrollTop] = useState(0);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const wrapperRef = useRef(null);

    useEffect(() => {
        if (!wrapperRef.current) return;
        const observer = new ResizeObserver((entries) => {
            if (entries.length > 0) {
                const { width, height } = entries[0].contentRect;
                if (width > 0 && height > 0) setDimensions({ width, height });
            }
        });
        observer.observe(wrapperRef.current);
        return () => observer.disconnect();
    }, []);

    const allFiles = useMemo(() => {
        if (!categorizedFiles) return [];
        return [
            ...(categorizedFiles.videos || []),
            ...(categorizedFiles.images || []),
            ...(categorizedFiles.archives || []),
            ...(categorizedFiles.misc || []),
        ];
    }, [categorizedFiles]);

    const categoryCounts = useMemo(
        () => ({
            videos: categorizedFiles?.videos?.length || 0,
            images: categorizedFiles?.images?.length || 0,
            archives: categorizedFiles?.archives?.length || 0,
            misc: categorizedFiles?.misc?.length || 0,
        }),
        [categorizedFiles],
    );

    const processedFiles = useMemo(() => {
        let result = allFiles.filter((file) => {
            if (file.category === "videos" && !filters.videos) return false;
            if (file.category === "images" && !filters.images) return false;
            if (file.category === "archives" && !filters.archives) return false;
            if (file.category === "misc" && !filters.misc) return false;
            return true;
        });

        result.sort((a, b) => {
            let aVal = a[sortConfig.key];
            let bVal = b[sortConfig.key];

            if (aVal === null || aVal === undefined) aVal = "";
            if (bVal === null || bVal === undefined) bVal = "";

            if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
            return 0;
        });

        return result;
    }, [allFiles, filters, sortConfig]);

    const resetScrollPosition = () => {
        setScrollTop(0);
        if (wrapperRef.current) {
            wrapperRef.current.scrollTop = 0;
        }
    };

    const handleSort = (key) => {
        let direction = "desc";
        if (sortConfig.key === key && sortConfig.direction === "desc") {
            direction = "asc";
        }
        setSortConfig({ key, direction });
        resetScrollPosition();
    };

    const toggleFilter = (cat) => {
        if (categoryCounts[cat] === 0) return;
        setFilters((prev) => ({ ...prev, [cat]: !prev[cat] }));
        resetScrollPosition();
    };

    const copyToClipboard = (text) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
    };

    if (!categorizedFiles) return null;

    const itemHeight = 40;
    const totalHeight = processedFiles.length * itemHeight;
    const overscan = 15;

    const startIndex = Math.max(
        0,
        Math.floor(scrollTop / itemHeight) - overscan,
    );
    const visibleCount =
        dimensions.height > 0 ? Math.ceil(dimensions.height / itemHeight) : 20;
    const endIndex = Math.min(
        processedFiles.length - 1,
        startIndex + visibleCount + overscan * 2,
    );

    const visibleItems = [];
    for (let i = startIndex; i <= endIndex; i++) {
        const file = processedFiles[i];
        if (!file) continue;

        visibleItems.push(
            <div
                key={file.message_id || i}
                className="file-row"
                style={{
                    position: "absolute",
                    top: `${i * itemHeight}px`,
                    width: "100%",
                    height: `${itemHeight}px`,
                }}>
                <div className="cell meta">{file.message_id}</div>
                <div className="cell filename" title={file.filename}>
                    {file.filename}
                </div>

                <div className="cell category">
                    {categoryNames[file.category] || file.category}
                </div>
                <div
                    className="cell meta"
                    title={file.original_filename || "N/A"}>
                    {file.original_filename ? (
                        file.original_filename
                    ) : (
                        <span className="null-text">None</span>
                    )}
                </div>
                <div className="cell meta">{formatBytes(file.size_bytes)}</div>
                <div className="cell meta">
                    {formatDate(file.date_downloaded)}
                </div>
                <div
                    className="cell clickable-path"
                    title="Click to copy path to clipboard"
                    onClick={() => copyToClipboard(file.file_path)}>
                    {file.file_path}
                </div>
            </div>,
        );
    }

    return (
        <div className="file-list-container">
            <div className="file-filters-bar">
                <div className="filters">
                    {["videos", "images", "archives", "misc"].map((cat) => (
                        <label
                            key={cat}
                            className={
                                categoryCounts[cat] === 0 ? "disabled" : ""
                            }>
                            <input
                                type="checkbox"
                                checked={filters[cat]}
                                onChange={() => toggleFilter(cat)}
                                disabled={categoryCounts[cat] === 0}
                            />
                            Show {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </label>
                    ))}
                </div>
                <div className="file-count">
                    Showing {processedFiles.length.toLocaleString()} Files
                </div>
            </div>

            <div className="file-table-header">
                <div
                    className={`sortable ${sortConfig.key === "message_id" ? "active" : ""}`}
                    onClick={() => handleSort("message_id")}>
                    MSG-ID{" "}
                    <SortIndicator
                        columnKey="message_id"
                        sortConfig={sortConfig}
                    />
                </div>
                <div
                    className={`sortable ${sortConfig.key === "filename" ? "active" : ""}`}
                    onClick={() => handleSort("filename")}>
                    Filename{" "}
                    <SortIndicator
                        columnKey="filename"
                        sortConfig={sortConfig}
                    />
                </div>
                <div
                    className={`sortable ${sortConfig.key === "category" ? "active" : ""}`}
                    onClick={() => handleSort("category")}>
                    Type{" "}
                    <SortIndicator
                        columnKey="category"
                        sortConfig={sortConfig}
                    />
                </div>
                <div
                    className={`sortable ${sortConfig.key === "original_filename" ? "active" : ""}`}
                    onClick={() => handleSort("original_filename")}>
                    Original Name{" "}
                    <SortIndicator
                        columnKey="original_filename"
                        sortConfig={sortConfig}
                    />
                </div>
                <div
                    className={`sortable ${sortConfig.key === "size_bytes" ? "active" : ""}`}
                    onClick={() => handleSort("size_bytes")}>
                    Size{" "}
                    <SortIndicator
                        columnKey="size_bytes"
                        sortConfig={sortConfig}
                    />
                </div>
                <div
                    className={`sortable ${sortConfig.key === "date_downloaded" ? "active" : ""}`}
                    onClick={() => handleSort("date_downloaded")}>
                    Downloaded{" "}
                    <SortIndicator
                        columnKey="date_downloaded"
                        sortConfig={sortConfig}
                    />
                </div>
                <div
                    className={`sortable ${sortConfig.key === "file_path" ? "active" : ""}`}
                    onClick={() => handleSort("file_path")}>
                    Path{" "}
                    <SortIndicator
                        columnKey="file_path"
                        sortConfig={sortConfig}
                    />
                </div>
            </div>

            <div
                className="virtual-list-wrapper"
                ref={wrapperRef}
                onScroll={(e) => setScrollTop(e.target.scrollTop)}
                style={{
                    flexGrow: 1,
                    overflowY: "auto",
                    position: "relative",
                }}>
                {processedFiles.length === 0 ? (
                    <div className="empty-state">
                        No files match the current filters.
                    </div>
                ) : (
                    <div
                        style={{
                            height: `${totalHeight}px`,
                            width: "100%",
                            position: "relative",
                        }}>
                        {visibleItems}
                    </div>
                )}
            </div>
        </div>
    );
}
