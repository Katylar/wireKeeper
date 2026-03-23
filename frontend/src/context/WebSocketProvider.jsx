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
    // --- Unified State ---
    const [isConnected, setIsConnected] = useState(false);
    const [systemStatus, setSystemStatus] = useState(null);

    // Engine State
    const [logs, setLogs] = useState([]);
    const [activeTasks, setActiveTasks] = useState({});
    const [activeScans, setActiveScans] = useState({});

    // Orchestrator State
    const [currentTask, setCurrentTask] = useState(null);
    const [queue, setQueue] = useState([]);
    const [taskMap, setTaskMap] = useState(new Map());

    const wsRef = useRef(null);

    // Initial Status Check
    useEffect(() => {
        fetch(`${API_BASE}/status`)
            .then((res) => res.json())
            .then((data) => setSystemStatus(data))
            .catch((err) => console.error("Backend offline:", err));
    }, []);

    // WebSocket Connection & Router
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

                // --- Route 1: Orchestrator Events ---
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
                    return; // Stop processing here
                }

                // --- Route 2: Engine Events ---
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
                        break;
                    case "scan_complete":
                    case "chat_complete":
                        setActiveScans((prev) => {
                            const next = { ...prev };
                            delete next[data.chat_id];
                            return next;
                        });
                        break;
                    case "task_start":
                        setActiveTasks((prev) => ({
                            ...prev,
                            [data.file_id]: {
                                filename: data.filename,
                                chat_id: data.chat_id,
                                queue_info: data.queue_info,
                                progress: 0,
                                speed: 0,
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
                            delete newState[data.file_id];
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

    // Helper Actions
    const getTaskForChat = useCallback(
        (chatId) => {
            return taskMap.get(chatId) || null;
        },
        [taskMap],
    );

    const killTask = async (taskId) => {
        await fetch(`${API_BASE}/queue/${taskId}`, { method: "DELETE" });
    };

    return (
        <WebSocketContext.Provider
            value={{
                isConnected,
                systemStatus,
                logs,
                activeTasks,
                activeScans,
                currentTask,
                queue,
                getTaskForChat,
                killTask,
            }}>
            {children}
        </WebSocketContext.Provider>
    );
};

export const useEngine = () => useContext(WebSocketContext);
