import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./pages/Layout";
import Home from "./pages/Home.jsx";
import Settings from "./pages/Settings";
import Logs from "./pages/Logs.jsx";
import Activity from "./pages/Activity.jsx";
import ChatDetails from "./pages/ChatDetails";
import "./styles/main.scss";

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<Layout />}>
                    <Route index element={<Home />} />
                    <Route path="settings" element={<Settings />} />
                    <Route path="activity" element={<Activity />} />
                    <Route path="chat/:id" element={<ChatDetails />} />
                </Route>
            </Routes>
        </BrowserRouter>
    );
}
