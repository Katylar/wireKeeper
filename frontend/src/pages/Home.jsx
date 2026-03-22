import React, { useState, useEffect, useCallback } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import ChatList from "../components/ChatList";
import "../styles/homepage.scss";

export default function Home() {
    const { systemStatus, activeTasks, activeScans } = useOutletContext();
    const [chats, setChats] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();

    const fetchChats = useCallback(async () => {
        try {
            const response = await fetch("http://localhost:39486/api/chats");
            const data = await response.json();
            setChats(data);
        } catch (err) {
            console.error("Failed to fetch chats:", err);
        }
    }, []);

    // Single effect handles setup check + initial fetch
    useEffect(() => {
        if (systemStatus === null) return;

        if (systemStatus.setup_complete === false) {
            navigate("/settings");
            return;
        }

        fetchChats().then(() => setIsLoading(false));
    }, [systemStatus, navigate, fetchChats]);

    const handleStartDownload = async (chatId) => {
        await fetch(`http://localhost:39486/api/download/${chatId}`, {
            method: "POST",
        });
    };

    // const handleGlobalSync = async () => {
    //     await fetch("http://localhost:39486/api/sync", { method: "POST" });
    // };

    if (isLoading) return <p>Loading database...</p>;

    return (
        <div>
            <ChatList
                chats={chats}
                activeTasks={activeTasks}
                activeScans={activeScans}
                onDownload={handleStartDownload}
                onRefresh={fetchChats}
                setChats={setChats}
            />
        </div>
    );
}
