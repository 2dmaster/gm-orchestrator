import { Routes, Route } from "react-router-dom";
import Wizard from "./pages/Wizard";
import Dashboard from "./pages/Dashboard";
import Sprint from "./pages/Sprint";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <div className="min-h-screen bg-bg text-text">
      <Routes>
        <Route path="/" element={<Wizard />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/sprint" element={<Sprint />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </div>
  );
}
