import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useRef,
} from "react";

const WS_URL = "ws://localhost:39486/ws";
const API_BASE = "http://localhost:39486/api";

const WebSocketContext = createContext(null);

export const WebSocketProvider = ({ children }) => {
    const [isConnected, setIsConnected] = useState(false);
    const [systemStatus, setSystemStatus] = useState(null);

    const [logs, setLogs] = useState([]);
    const [activeTasks, setActiveTasks] = useState({});
    const [activeScans, setActiveScans] = useState({});

    // NEW: Engine Tracking for Activity Page
    const [finishedFiles, setFinishedFiles] = useState({});
    const [taskHistory, setTaskHistory] = useState([]);

    const [currentTask, setCurrentTask] = useState(null);
    const [queue, setQueue] = useState([]);
    const [taskMap, setTaskMap] = useState(new Map());

    const wsRef = useRef(null);

    useEffect(() => {
        fetch(`${API_BASE}/status`)
            .then((res) => res.json())
            .then((data) => setSystemStatus(data))
            .catch((err) => console.error("Backend offline:", err));

        fetch(`${API_BASE}/history`)
            .then((res) => res.json())
            .then((data) => setTaskHistory(data))
            .catch((err) => console.error("Failed to fetch history:", err));
    }, []);

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
                        if (
                            t.params?.chat_id &&
                            !newMap.has(t.params.chat_id)
                        ) {
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
                    case "scan_start":
                        setActiveScans((prev) => ({
                            ...prev,
                            [data.chat_id]: { scanned: 0 },
                        }));
                        // Clear finished files for this new chat run
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
                                    scanned:
                                        data.scanned !== undefined
                                            ? data.scanned
                                            : prev[data.chat_id].scanned,
                                    total_queued: data.queued,
                                },
                            };
                        });
                        break;
                    case "chat_complete":
                        // 1. Save to History
                        setTaskHistory((prev) => [
                            ...prev,
                            {
                                time: new Date().toLocaleTimeString(),
                                chat_id: data.chat_id,
                                stats: data.stats,
                            },
                        ]);
                        // 2. Cleanup active states
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
                                type: data.queue_info.includes("heavy")
                                    ? "heavy"
                                    : "light",
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
                                    progress:
                                        (data.downloaded / data.total) * 100,
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

                            // Move to finished files list instead of deleting into the void
                            if (finishedTask) {
                                setFinishedFiles((prevFinished) => {
                                    const currentList =
                                        prevFinished[finishedTask.chat_id] ||
                                        [];

                                    // FIX: Stop React StrictMode from double-pushing files!
                                    if (
                                        currentList.some(
                                            (f) =>
                                                f.file_id ===
                                                finishedTask.file_id,
                                        )
                                    ) {
                                        return prevFinished;
                                    }

                                    return {
                                        ...prevFinished,
                                        [finishedTask.chat_id]: [
                                            {
                                                ...finishedTask,
                                                final_status:
                                                    data.status || "error",
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

    const getTaskForChat = useCallback(
        (chatId) => taskMap.get(chatId) || null,
        [taskMap],
    );

    const killTask = async (taskId) => {
        await fetch(`${API_BASE}/queue/${taskId}`, { method: "DELETE" });
    };
    const killBatch = async (batchId) => {
        await fetch(`${API_BASE}/queue/batch/${batchId}`, { method: "DELETE" });
    };

    const killAllSingles = async () => {
        await fetch(`${API_BASE}/queue/singles`, { method: "DELETE" });
    };

    return (
        <WebSocketContext.Provider
            value={{
                isConnected,
                systemStatus,
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
            }}>
            {children}
        </WebSocketContext.Provider>
    );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useEngine = () => useContext(WebSocketContext);
