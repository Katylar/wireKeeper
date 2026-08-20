import React, { useMemo } from "react";
import { useEngine } from "../context/WebSocketProvider";
import ChatUnit from "../components/ChatUnit";

import "../styles/layout/activity.scss";

export default function Activity() {
    const {
        currentTask,
        queue,
        killBatch,
        taskHistory,
        killAllSingles,
        clearHistory,
    } = useEngine();

    // Separate Batch tasks from Single tasks
    const { batchTasks, singleTasks, currentBatchId } = useMemo(() => {
        const batches = [];
        const singles = [];
        let currBatchId = null;

        const allTasks = currentTask ? [currentTask, ...queue] : queue;

        allTasks.forEach((task) => {
            if (task.params?.batch_id) {
                batches.push(task);
                if (task.id === currentTask?.id)
                    currBatchId = task.params.batch_id;
            } else {
                singles.push(task);
            }
        });

        // If there's a batch pending but not running, grab its ID for the kill button
        if (!currBatchId && batches.length > 0)
            currBatchId = batches[0].params.batch_id;

        return {
            batchTasks: batches,
            singleTasks: singles,
            currentBatchId: currBatchId,
        };
    }, [currentTask, queue]);

    const handleKillBatch = () => {
        if (currentBatchId) killBatch(currentBatchId);
    };

    return (
        <div className="activity-page">
            <header className="page-header">
                <h1>Engine Activity</h1>
                <p>
                    Live view of the Orchestrator queues and historical session
                    data.
                </p>
            </header>

            {/* SECTION A: BATCH */}
            {batchTasks.length > 0 && (
                <section className="activity-section batch-section">
                    <div className="section-header">
                        <h2>Batch Download</h2>
                        <div className="batch-controls">
                            <span className="batch-stats">
                                Processing {batchTasks.length} queued chats
                            </span>
                            <button
                                className="btn-kill-danger"
                                onClick={handleKillBatch}>
                                KILL BATCH DOWNLOAD
                            </button>
                        </div>
                    </div>
                    <div className="task-list">
                        {batchTasks.slice(0, 5).map((task) => (
                            <ChatUnit
                                key={task.id}
                                task={task}
                                isRunning={currentTask?.id === task.id}
                            />
                        ))}
                        {batchTasks.length > 5 && (
                            <div className="queue-overflow">
                                ...and {batchTasks.length - 5} more chats
                                pending.
                            </div>
                        )}
                    </div>
                </section>
            )}

            {/* SECTION B: TASKS */}
            {singleTasks.length > 0 && (
                <section className="activity-section tasks-section">
                    <div className="section-header">
                        <h2>Individual Tasks</h2>
                        {/* Wrapper added here so it looks like the Batch Controls! */}
                        <div className="batch-controls">
                            <span className="batch-stats">
                                {singleTasks.length} standalone tasks
                            </span>
                            <button
                                className="btn-kill-danger"
                                onClick={killAllSingles}>
                                Cancel All
                            </button>
                        </div>
                    </div>
                    <div className="task-list">
                        {singleTasks.map((task) => (
                            <ChatUnit
                                key={task.id}
                                task={task}
                                isRunning={currentTask?.id === task.id}
                            />
                        ))}
                    </div>
                </section>
            )}

            {/* SECTION C: HISTORY */}
            <section className="activity-section history-section">
                <div className="section-header">
                    <h2>Session History</h2>
                    {taskHistory.length > 0 && (
                        <button
                            className="btn-kill-danger"
                            onClick={clearHistory}>
                            CLEAR HISTORY
                        </button>
                    )}
                </div>
                <div className="history-terminal">
                    {taskHistory.length === 0 ? (
                        <span className="text-muted">
                            No completed tasks in the current session.
                        </span>
                    ) : (
                        taskHistory.map((hist, i) => (
                            <div
                                key={i}
                                className={`history-card ${hist.stats?.status || "unknown"}`}>
                                <div className="history-card-header">
                                    <div className="chat-title">
                                        <span
                                            className={`status-indicator ${hist.stats?.status || "unknown"}`}></span>
                                        Chat {hist.chat_id} -{" "}
                                        {(
                                            hist.stats?.status || "UNKNOWN"
                                        ).toUpperCase()}
                                    </div>
                                    <div className="time-info">
                                        {hist.stats?.start_time ||
                                            "Unknown Start"}{" "}
                                        to{" "}
                                        {hist.stats?.end_time || "Unknown End"}
                                        {hist.stats?.elapsed_seconds &&
                                            ` (${hist.stats.elapsed_seconds}s)`}
                                    </div>
                                </div>

                                <div className="history-card-body">
                                    <div className="stat-row">
                                        <span>
                                            <strong>Total Msgs:</strong>{" "}
                                            {hist.stats?.total_messages || 0}
                                        </span>
                                        <span>
                                            <strong>Last Msg ID:</strong>{" "}
                                            {hist.stats?.last_message_id || 0}
                                        </span>
                                        <span>
                                            <strong>Total Enqueued:</strong>{" "}
                                            {hist.stats?.total_enqueued ||
                                                hist.stats?.total_files_found ||
                                                0}
                                        </span>
                                    </div>

                                    <div className="category-breakdown">
                                        {/* Optional Chaining here prevents crashes on old DB rows! */}
                                        {hist.stats?.breakdown?.categories &&
                                            Object.entries(
                                                hist.stats.breakdown.categories,
                                            ).map(([cat, counts]) => {
                                                if (
                                                    counts.enqueued === 0 &&
                                                    counts.skipped === 0
                                                )
                                                    return null;

                                                const aborted =
                                                    counts.enqueued -
                                                    counts.success -
                                                    counts.failed;

                                                return (
                                                    <div
                                                        key={cat}
                                                        className="cat-pill">
                                                        <span className="cat-name">
                                                            {cat.toUpperCase()}
                                                        </span>
                                                        <span className="cat-stats">
                                                            <span
                                                                className="success"
                                                                title="Success">
                                                                {counts.success}
                                                            </span>{" "}
                                                            /
                                                            <span
                                                                className="failed"
                                                                title="Failed">
                                                                {counts.failed}
                                                            </span>{" "}
                                                            /
                                                            <span
                                                                className="aborted"
                                                                title="Killed/Unfinished">
                                                                {aborted}
                                                            </span>{" "}
                                                            /
                                                            <span
                                                                className="skipped"
                                                                title="Skipped (Already on Disk)">
                                                                {counts.skipped}
                                                            </span>
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </section>
        </div>
    );
}
