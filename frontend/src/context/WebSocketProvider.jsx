import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from "react";

const WS_URL = "ws://localhost:39486/ws";
const API_BASE = "http://localhost:39486/api";

const WebSocketContext = createContext(null);

export const WebSocketProvider = ({ children }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [systemStatus, setSystemStatus] = useState(null);

    const [logs, setLogs] = useState([]);
    const [activeTasks, setActiveTasks] = useState({});
    const [activeScans, setActiveScans] = useState({});

    const [finishedFiles, setFinishedFiles] = useState({});
    const [taskHistory, setTaskHistory] = useState([]);

    const [currentTask, setCurrentTask] = useState(null);
    const [queue, setQueue] = useState([]);
    const [taskMap, setTaskMap] = useState(new Map());

    const wsRef = useRef(null);

    const refreshSystemStatus = useCallback(async () => {
        try {
            const res = await fetch(`${API_BASE}/status`);
            const data = await res.json();
            setSystemStatus(data);

            const histRes = await fetch(`${API_BASE}/history`);
            const histData = await histRes.json();
            setTaskHistory(histData);
        } catch (err) {
            console.error("Backend offline:", err);
        }
    }, []);

    useEffect(() => {
        refreshSystemStatus();
    }, [refreshSystemStatus]);

    useEffect(() => {
        let isMounted = true;
        let reconnectTimeout;

        const connect = () => {
            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;
            ws.onopen = () => {
                if (isMounted) setIsConnected(true);
            };
            ws.onclose = () => {
                if (isMounted) {
                    setIsConnected(false);
                    reconnectTimeout = setTimeout(connect, 3000);
                }
            };

            ws.onmessage = (event) => {
                if (!isMounted) return;
                const data = JSON.parse(event.data);

                if (data.event === "queue_state") {
                    setCurrentTask(data.current_task);
                    setQueue(data.queue);
                    const newMap = new Map();
                    if (data.current_task?.params?.chat_id) {
                        newMap.set(data.current_task.params.chat_id, {
                            ...data.current_task,
                            status: "running",
                        });
                    }
                    data.queue.forEach((t, index) => {
                        if (t.params?.chat_id && !newMap.has(t.params.chat_id)) {
                            newMap.set(t.params.chat_id, {
                                ...t,
                                status: "pending",
                                position: index + 1,
                            });
                        }
                    });
                    setTaskMap(newMap);
                    return;
                }

                switch (data.event) {
                    case "global_sync_complete":
                        refreshSystemStatus();
                        break;
                    case "log":
                    case "error":
                        setLogs((prev) => [
                            ...prev.slice(-9999),
                            {
                                time: new Date().toLocaleTimeString(),
                                text: data.message,
                                type: data.event,
                            },
                        ]);
                        break;
                    case "sync_start":
                        setActiveScans((prev) => ({
                            ...prev,
                            global_sync: { scanned: 0, changes: [] },
                        }));
                        break;
                    case "sync_progress":
                        setActiveScans((prev) => ({
                            ...prev,
                            global_sync: { scanned: data.scanned, changes: data.changes },
                        }));
                        break;
                    case "scan_start":
                        setActiveScans((prev) => ({
                            ...prev,
                            [data.chat_id]: { scanned: 0 },
                        }));
                        setFinishedFiles((prev) => ({
                            ...prev,
                            [data.chat_id]: [],
                        }));
                        break;
                    case "scan_progress":
                        setActiveScans((prev) => {
                            if (!prev[data.chat_id]) return prev;
                            return {
                                ...prev,
                                [data.chat_id]: { scanned: data.scanned },
                            };
                        });
                        break;
                    case "scan_complete":
                        setActiveScans((prev) => {
                            if (!prev[data.chat_id]) return prev;
                            return {
                                ...prev,
                                [data.chat_id]: {
                                    ...prev[data.chat_id],
                                    status: "Scan Done!",
                                    scanned: data.scanned !== undefined ? data.scanned : prev[data.chat_id].scanned,
                                    total_queued: data.queued,
                                },
                            };
                        });
                        break;
                    case "chat_complete":
                        setTaskHistory((prev) => [
                            ...prev,
                            {
                                time: new Date().toLocaleTimeString(),
                                chat_id: data.chat_id,
                                stats: data.stats,
                            },
                        ]);
                        setActiveScans((prev) => {
                            const n = { ...prev };
                            delete n[data.chat_id];
                            return n;
                        });
                        setFinishedFiles((prev) => {
                            const n = { ...prev };
                            delete n[data.chat_id];
                            return n;
                        });
                        break;
                    case "task_start":
                        setActiveTasks((prev) => ({
                            ...prev,
                            [data.file_id]: {
                                file_id: data.file_id,
                                filename: data.filename,
                                chat_id: data.chat_id,
                                queue_info: data.queue_info,
                                progress: 0,
                                speed: 0,
                                type: data.queue_info.includes("heavy") ? "heavy" : "light",
                            },
                        }));
                        break;
                    case "progress":
                        setActiveTasks((prev) => {
                            if (!prev[data.file_id]) return prev;
                            return {
                                ...prev,
                                [data.file_id]: {
                                    ...prev[data.file_id],
                                    progress: (data.downloaded / data.total) * 100,
                                    speed: data.speed,
                                    downloaded: data.downloaded,
                                    total: data.total,
                                },
                            };
                        });
                        break;
                    case "task_complete":
                    case "task_error":
                        setActiveTasks((prev) => {
                            const newState = { ...prev };
                            const finishedTask = newState[data.file_id];
                            delete newState[data.file_id];

                            if (finishedTask) {
                                setFinishedFiles((prevFinished) => {
                                    const currentList = prevFinished[finishedTask.chat_id] || [];

                                    if (currentList.some((f) => f.file_id === finishedTask.file_id)) {
                                        return prevFinished;
                                    }

                                    return {
                                        ...prevFinished,
                                        [finishedTask.chat_id]: [
                                            {
                                                ...finishedTask,
                                                final_status: data.status || "error",
                                                error_msg: data.error,
                                            },
                                            ...currentList,
                                        ],
                                    };
                                });
                            }
                            return newState;
                        });
                        break;
                    default:
                        break;
                }
            };
        };

        connect();
        return () => {
            isMounted = false;
            clearTimeout(reconnectTimeout);
            if (wsRef.current) {
                wsRef.current.onclose = null;
                wsRef.current.close();
            }
        };
    }, []);

    const getTaskForChat = useCallback((chatId) => taskMap.get(chatId) || null, [taskMap]);

    // --- FIXED: Wrap all context functions in useCallback ---
    const killTask = useCallback(async (taskId) => {
        await fetch(`${API_BASE}/queue/${taskId}`, { method: "DELETE" });
    }, []);

    const killBatch = useCallback(async (batchId) => {
        await fetch(`${API_BASE}/queue/batch/${batchId}`, { method: "DELETE" });
    }, []);

    const killAllSingles = useCallback(async () => {
        await fetch(`${API_BASE}/queue/singles`, { method: "DELETE" });
    }, []);

    const clearHistory = useCallback(async () => {
        await fetch(`${API_BASE}/history`, { method: "DELETE" });
        setTaskHistory([]);
    }, []);

    // --- FIXED: Cache the entire context value dictionary ---
    const contextValue = useMemo(
        () => ({
            isConnected,
            systemStatus,
            refreshSystemStatus,
            logs,
            activeTasks,
            activeScans,
            finishedFiles,
            taskHistory,
            currentTask,
            queue,
            getTaskForChat,
            killTask,
            killBatch,
            killAllSingles,
            clearHistory,
        }),
        [isConnected, systemStatus, refreshSystemStatus, logs, activeTasks, activeScans, finishedFiles, taskHistory, currentTask, queue, getTaskForChat, killTask, killBatch, killAllSingles, clearHistory],
    );

    return <WebSocketContext.Provider value={contextValue}>{children}</WebSocketContext.Provider>;
};

export const useEngine = () => useContext(WebSocketContext);
