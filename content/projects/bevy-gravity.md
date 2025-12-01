+++
title = "Bevy Gravity"
date = 2025-11-30
draft = false

[taxonomies]
tags = ["Bevy", "WASM"]
+++


## Project Description

This is an interactive WASM demo of [bevy-gravity](https://github.com/graysonhead/bevy-gravity)

See the [post](../../posts/bevy-gravity/) for more info.

## Demo

<div class="info">
<p style="margin-top: 15px; font-size: 14px; color: #aaa;">
Press F1 in-game to view controls
</p>
</div>

<div id="loading" class="loading">
<h2>Loading gravity simulation...</h2>
<p>Please wait while the WASM module loads.</p>
</div>

<canvas id="bevy"></canvas>

<script type="module">
import init, { run_two_bodies } from '../../wasm/gravity/gravity_wasm.js';

async function run() {
    try {
        await init();
        run_two_bodies();
        document.getElementById('loading').style.display = 'none';
    } catch (e) {
        console.error('Failed to load WASM:', e);
        document.getElementById('loading').innerHTML = '<h2>Error loading simulation</h2><p>Please check the console for details.</p>';
    }
}

run();
</script>