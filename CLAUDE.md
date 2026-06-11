# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Tasks

### Running Tests
- Utility tests: `node tests/run-tests.cjs`
- Browser smoke tests (requires Playwright): `node tests/smoke-playwright.mjs`

## Architecture & Structure

The project is a PWA-based MQTT Dashboard for controlling WLED devices and relays. It is built with a modular vanilla JavaScript architecture.

### Key Components
- **`index.html`**: Single-page entry point containing the UI layout and PWA configuration.
- **`js/app.js`**: Main application entry point. Handles tab routing, theme switching, settings persistence (via `localStorage`), and coordinates module wiring.
- **`js/mqtt.js`**: Core MQTT connection manager (`window.MQTTClient`). Handles connection logic, automatic retries with exponential back-off, subscription management, and a basic offline command queue.
- **`js/relays.js`**, **`js/wled.js`**, **`js/sensors.js`**: Domain-specific modules that handle the logic for interacting with their respective MQTT topics.
- **`js/discovery.js`**: Implements device discovery by scanning MQTT traffic.
- **`js/visuals.js`**: Manages background animations (particle canvas) and UI visual effects.
- **`js/core-utils.js`**: Shared utility functions (e.g., topic matching, back-off computation).

### Data Flow
1. **Connection**: `app.js` captures settings $\to$ `MQTTClient.connect()` $\to$ sets connection state.
2. **Subscriptions**: Modules (`RelayModule`, `WLEDModule`, etc.) subscribe to topics via `MQTTClient.subscribe()`.
3. **Message Loop**: MQTT Broker $\to$ `MQTTClient._onMessage()` $\to$ `_dispatch()` $\to$ Module callback $\to$ UI update.
4. **Control**: UI Event $\to$ Module method $\to$ `MQTTClient.publish()` $\to$ MQTT Broker.

### State Management
- Settings are persisted in `localStorage` under `mqttctrl_settings`.
- WLED device lists are stored in `mqttctrl_wled_list`.
- UI state (active tab, theme) is stored in `mqttctrl_active_tab` and `mqttctrl_theme`.
