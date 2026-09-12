/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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
