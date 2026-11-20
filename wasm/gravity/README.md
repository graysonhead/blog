# Gravity WASM - Orbital Simulations

WebAssembly versions of the gravity library examples, featuring interactive orbital mechanics simulations in your browser.

## Examples

### Two Bodies
A classic two-body orbital simulation featuring an Earth-Moon system with comprehensive interactive controls.

**Features:**
- Real-time gravity simulation using Bevy engine
- Interactive velocity controls with real-time physics response
- Visual orbital path prediction for both bodies
- Pinned Earth for stable reference frame
- Real-time energy display (kinetic, potential, and total)
- Time scale controls (pause, speed up, slow down)
- In-game UI with toggleable controls panel

### Three Bodies
A three-body orbital simulation showing the Sun-Earth-Moon system with complex gravitational interactions.

**Features:**
- Hierarchical three-body orbital dynamics
- Sun (pinned), Earth (orbiting Sun), and Moon (orbiting Earth)
- Interactive moon velocity controls
- Visual orbital path prediction for all bodies
- Time scale controls
- Complex gravitational interactions between all three bodies
- In-game UI with toggleable controls panel

## Interactive Controls

### Two Bodies Controls
- **Up Arrow / W**: Increase orbiter velocity
- **Down Arrow / S**: Decrease orbiter velocity
- **R**: Set orbiter to circular orbital velocity
- **O**: Reset orbiter to initial position
- **P**: Pin/Unpin central body
- **T**: Reset central body to origin

### Three Bodies Controls
- **Up Arrow / W**: Increase moon velocity
- **Down Arrow / S**: Decrease moon velocity

### Time Controls (Both Examples)
- **Space**: Pause/Resume simulation
- **+ / Page Up**: Increase time speed
- **- / Page Down**: Decrease time speed
- **1**: Reset to normal speed
- **0**: Precision mode (0.1x speed)

### UI Controls
- **F1**: Toggle in-game controls panel

## Building

### Prerequisites

- Nix with flakes enabled
- Direnv (optional but recommended)

### Build Steps

1. **Enter development environment:**
   ```bash
   nix develop
   ```

2. **Build WASM package:**
   ```bash
   wasm-pack build --target web --out-dir pkg
   ```

3. **Serve locally:**
   ```bash
   # Any HTTP server will work, for example:
   python3 -m http.server 8000
   # or
   npx serve .
   ```

4. **Open in browser:**
   Navigate to `http://localhost:8000` and you'll see a landing page with links to both examples.

## File Structure

```
gravity-wasm/
├── src/
│   ├── lib.rs                    # Main library with WASM exports
│   └── examples/
│       ├── two_bodies.rs         # Two-body simulation
│       └── three_bodies.rs       # Three-body simulation
├── pkg/                          # Generated WASM package (after build)
│   ├── gravity_wasm.js          # JavaScript bindings
│   └── *.wasm                   # WebAssembly binary
├── index.html                    # Landing page with example selection
├── two_bodies.html              # Two-body example page
├── three_bodies.html            # Three-body example page
├── Cargo.toml                   # Rust configuration
├── flake.nix                    # Nix development environment
└── README.md                    # This file
```

## Adding New Examples

To add a new example:

1. Create a new module in `src/examples/` (e.g., `my_example.rs`)
2. Implement a `pub fn run()` function that creates and runs the Bevy app
3. Add the module to `src/lib.rs`:
   ```rust
   pub mod examples {
       pub mod two_bodies;
       pub mod three_bodies;
       pub mod my_example;  // Add this line
   }
   ```
4. Export a WASM entry point in `src/lib.rs`:
   ```rust
   #[wasm_bindgen]
   pub fn run_my_example() {
       examples::my_example::run();
   }
   ```
5. Create an HTML file (e.g., `my_example.html`) that calls your example:
   ```javascript
   import init, { run_my_example } from './pkg/gravity_wasm.js';
   await init();
   run_my_example();
   ```
6. Add a link to your example in `index.html`

## Usage in Blog

To integrate this into your blog:

1. Build the WASM package as described above
2. Copy the `pkg/` directory to your blog's static assets
3. Copy the HTML files or integrate the JavaScript code into your pages
4. Ensure canvas elements have `id="bevy"`
5. The simulations will automatically start when the WASM loads

## Browser Compatibility

Requires a modern browser with WebAssembly support:
- Chrome 57+
- Firefox 52+
- Safari 11+
- Edge 16+

## Physics Details

### Two Bodies Simulation
- **Scale:** 1 Bevy unit = 1000 km
- **Central body:** Earth mass (5.972×10²⁴ kg)
- **Orbiting body:** 10¹⁵ kg (scaled for visualization)
- **Orbital distance:** 1000 km (closer than real Moon for better visualization)

### Three Bodies Simulation
- **Scale:** Planetary scale (GravityConfig::planetary())
- **Sun:** 10²⁸ kg (pinned at origin)
- **Earth:** 5×10²⁵ kg (orbiting Sun)
- **Moon:** 10²³ kg (orbiting Earth)
- All bodies display orbital path predictions

## Development

This project uses the [gravity](../gravity) library for orbital mechanics calculations. The examples demonstrate how to create interactive physics simulations with Bevy and compile them to WebAssembly for browser deployment.

## License

See the main gravity project for license information.
