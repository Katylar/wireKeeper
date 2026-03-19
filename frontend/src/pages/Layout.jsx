import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useTelegramEngine } from "../hooks/useTelegramEngine";

export default function Layout() {
    const engineState = useTelegramEngine();

    return (
        <div className="app-layout">
            <nav className="main-nav">
                <div className="nav-brand">
                    <svg
                        width="3rem"
                        height="3rem"
                        viewBox="0 0 1400 1400"
                        version="1.1"
                        className="app-logo">
                        <g transform="matrix(1,0,0,1,-80.291975,-80.291975)">
                            <g transform="matrix(0.707107,-0.707107,0.707107,0.707107,-475.317178,797.616449)">
                                <path
                                    d="M1156.3,1122.1L643.9,1122.1C536.9,1122.1 450.1,1035.3 450.1,928.3L450.1,415.9C450.1,308.9 536.9,222.1 643.9,222.1L1156.3,222.1C1263.3,222.1 1350.1,308.9 1350.1,415.9L1350.1,928.3C1350.1,1035.3 1263.3,1122.1 1156.3,1122.1Z"
                                    style={{
                                        fill: "rgb(201,89,33)",
                                        fillRule: "nonzero",
                                    }}
                                />
                            </g>
                            <g transform="matrix(-0.87855,0.235407,-0.235407,-0.87855,1417.831245,984.486792)">
                                <path
                                    d="M719.888,632.851L961.1,533.5C991,520.5 1092.4,478.9 1092.4,478.9C1092.4,478.9 1139.2,460.7 1135.3,504.9C1134,523.1 1123.6,586.8 1113.2,655.8L1080.7,860C1080.7,860 1078.1,889.9 1056,895.1C1033.9,900.3 997.5,876.9 991,871.7C985.8,867.8 893.5,809.3 859.7,780.7C850.6,772.9 840.2,757.3 861,739.1C907.8,696.2 963.7,642.9 997.5,609.1C1013.1,593.5 1028.7,557.1 963.7,601.3L780.3,724.6C780.3,724.6 776.872,726.742 770.191,728.505C765.443,731.533 759.664,731.735 759.664,731.735C759.664,731.735 757.828,731.376 754.577,730.727C745.509,731.058 648.599,705.092 640.913,700.272C637.771,699.207 636,698.6 636,698.6C636,698.6 631.095,695.534 628.497,690.537C623.592,685.67 621.695,682.102 621.695,682.102L524.517,483.621C490.324,412.843 485.635,452.166 491.345,473.476C503.717,519.647 525.477,593.756 544.557,654.309C553.471,680.47 536.664,688.781 524.883,690.986C481.311,698.855 372.128,703.367 365.674,704.144C357.445,705.398 314.221,707.463 297.682,691.909C281.143,676.356 293.842,649.162 293.842,649.162L367.796,456.069C393.289,391.114 416.132,330.748 424.107,314.336C442.829,274.108 474.259,313.27 474.259,313.27C474.259,313.27 541.274,399.996 560.668,426.204L719.888,632.851"
                                    style={{ fill: "white" }}
                                />
                            </g>
                        </g>
                    </svg>

                    <span className="app-name">WireKeeper</span>
                </div>
                <div className="nav-links">
                    <NavLink
                        to="/"
                        className={({ isActive }) =>
                            isActive ? "active" : ""
                        }>
                        Chatlist
                    </NavLink>
                    <NavLink
                        to="/logs"
                        className={({ isActive }) =>
                            isActive ? "active" : ""
                        }>
                        Logs
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
                    className="nav-status-group"
                    style={{
                        display: "flex",
                        gap: "1.5rem",
                        fontSize: "0.85rem",
                        fontWeight: "bold",
                    }}>
                    <div
                        style={{
                            color: engineState.isConnected
                                ? "#a6e3a1"
                                : "#f38ba8",
                        }}>
                        UI ↔ Engine:{" "}
                        {engineState.isConnected ? "● Connected" : "○ Offline"}
                    </div>

                    <div
                        style={{
                            color: engineState.systemStatus?.client_connected
                                ? "#89b4fa"
                                : "#f9e2af",
                        }}>
                        Engine ↔ Telegram:{" "}
                        {engineState.systemStatus?.client_connected
                            ? "● Authenticated"
                            : "○ Disconnected"}
                    </div>
                </div>
                <div className="controls">
                    <button>Sync Chatlist</button>
                    <button>Restart</button>
                    <button>Shutdown</button>
                </div>
            </nav>

            <main className="page-content">
                <Outlet context={engineState} />
            </main>

            <footer>
                <p>Copyright © 2026 Katylar. All rights reserved.</p>
                <button>Donate</button>
            </footer>
        </div>
    );
}
