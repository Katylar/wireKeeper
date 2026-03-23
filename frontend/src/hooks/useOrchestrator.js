import { useState, useEffect, useCallback } from "react";

export const useOrchestrator = (wsUrl) => {
    const [currentTask, setCurrentTask] = useState(null);
    const [queue, setQueue] = useState([]);
    const [isConnected, setIsConnected] = useState(false);

    // NEW: Map for instant O(1) lookups instead of looping arrays on every render
    const [taskMap, setTaskMap] = useState(new Map());

    useEffect(() => {
        const socket = new WebSocket(wsUrl);

        socket.onopen = () => setIsConnected(true);
        socket.onclose = () => setIsConnected(false);

        socket.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.event === "queue_state") {
                setCurrentTask(data.current_task);
                setQueue(data.queue);

                // Build the Hash Map once per WebSocket message
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
            }
        };

        return () => socket.close();
    }, [wsUrl]);

    // This is now an instant lookup, saving thousands of loop iterations per scroll
    const getTaskForChat = useCallback(
        (chatId) => {
            return taskMap.get(chatId) || null;
        },
        [taskMap],
    );

    const killTask = async (taskId) => {
        await fetch(`http://localhost:39486/api/queue/${taskId}`, {
            method: "DELETE",
        });
    };

    return { currentTask, queue, isConnected, getTaskForChat, killTask };
};
