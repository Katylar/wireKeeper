import React, { useMemo } from "react";
import { useEngine } from "../context/WebSocketProvider";
import ChatUnit from "../components/ChatUnit";
import "../styles/layout/activity.scss";

export default function Activity() {
    const { currentTask, queue, killBatch, taskHistory, killAllSingles } =
        useEngine();

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
                </div>
                <div className="history-terminal">
                    {taskHistory.length === 0 ? (
                        <span className="text-muted">
                            No completed tasks in the current session.
                        </span>
                    ) : (
                        taskHistory.map((hist, i) => (
                            <div key={i} className="history-line">
                                <span className="timestamp">[{hist.time}]</span>
                                <span className="action">
                                    Chat {hist.chat_id} Completed.
                                </span>
                                <span className="stats">
                                    Found: {hist.stats.total_files_found} |
                                    Success:{" "}
                                    <span className="success">
                                        {hist.stats.successful_downloads}
                                    </span>{" "}
                                    | Failed:{" "}
                                    <span className="failed">
                                        {hist.stats.failed_downloads}
                                    </span>
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </section>
        </div>
    );
}
