import { Canvas } from './components/Canvas';

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>CNC Toolpath Visualizer</h1>
      </header>
      <main className="app-main">
        <Canvas />
      </main>
    </div>
  );
}

export default App;
