import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTelegramEngine } from "../hooks/useTelegramEngine";

export default function Layout() {
    const engineState = useTelegramEngine();

    return (
        <div className="app-layout">
            <nav className="main-nav">
                <div className="nav-brand">WireKeeper</div>
                <div className="nav-links">
                    <NavLink
                        to="/"
                        className={({ isActive }) =>
                            isActive ? "active" : ""
                        }>
                        Home
                    </NavLink>
                    <NavLink
                        to="/settings"
                        className={({ isActive }) =>
                            isActive ? "active" : ""
                        }>
                        Settings
                    </NavLink>
                </div>
                <div
                    className="nav-status"
                    style={{
                        color: engineState.isConnected ? "#a6e3a1" : "#f38ba8",
                    }}>
                    {engineState.isConnected ? "● Connected" : "○ Offline"}
                </div>
            </nav>

            <main className="page-content">
                <Outlet context={engineState} />
            </main>
        </div>
    );
}
