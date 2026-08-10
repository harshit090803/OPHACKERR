import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "sonner";
import "./App.css";
import Landing from "./pages/Landing";
import Dashboard from "./pages/Dashboard";
import Study from "./pages/Study";
import NavBar from "./components/NavBar";

function App() {
  return (
    <div className="App min-h-screen" style={{ background: "var(--sp-bg)", color: "var(--sp-fg)" }}>
      <BrowserRouter>
        <NavBar />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/library" element={<Dashboard />} />
          <Route path="/study/:id" element={<Study />} />
        </Routes>
        <Toaster position="top-right" richColors />
      </BrowserRouter>
    </div>
  );
}

export default App;
