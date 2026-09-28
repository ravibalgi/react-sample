import StartMandate from './pages/StartMandate.jsx';
import MandateResponse from './pages/MandateResponse.jsx';

// Two routes are enough for the demo; use react-router in a real app.
export default function App() {
  const route = window.location.pathname;
  return (
    <div className="shell">
      <header>
        <a href="/">Demo Merchant Portal</a>
        <span className="tag">e-Mandate via NPCI ONMAGS</span>
      </header>
      <main>{route.startsWith('/mandate/response') ? <MandateResponse /> : <StartMandate />}</main>
    </div>
  );
}
