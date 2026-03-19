import React, { useEffect, useState } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import ChatList from "../components/ChatList";
import "../styles/homepage.scss";

export default function Home() {
    const { systemStatus, activeTasks, activeScans } = useOutletContext();
    const [chats, setChats] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        if (systemStatus.setup_complete === false) {
            navigate("/settings"); // Force them to settings if no API keys exist
            return;
        }

        fetch("http://localhost:39486/api/chats")
            .then((res) => res.json())
            .then((data) => {
                setChats(data);
                setIsLoading(false);
            })
            .catch((err) => console.error(err));
    }, [systemStatus, navigate]);

    const handleStartDownload = async (chatId) => {
        await fetch(`http://localhost:39486/api/download/${chatId}`, {
            method: "POST",
        });
    };

    const handleGlobalSync = async () => {
        await fetch("http://localhost:39486/api/sync", { method: "POST" });
    };

    if (isLoading) return <p>Loading database...</p>;

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: "1rem",
                }}>
                <h2>Dashboard</h2>
                <button
                    onClick={handleGlobalSync}
                    style={{ padding: "0.5rem 1rem", cursor: "pointer" }}>
                    Run Global Sync
                </button>
            </div>

            <ChatList
                chats={chats}
                activeTasks={activeTasks}
                activeScans={activeScans}
                onDownload={handleStartDownload}
            />
        </div>
    );
}
