# Review — `SepTGut/WLED-MQTT-DASHBOARD`

Repository: https://github.com/SepTGut/WLED-MQTT-DASHBOARD

## Summary

This is a strong browser-based MQTT dashboard with a polished UI and a good modular architecture. The project already includes separate modules for MQTT, relays, WLED control, sensors, visuals, and app orchestration, which is a good foundation for long-term maintenance. The dashboard also includes PWA support and a reconnect strategy, which makes it feel much closer to a real product than a typical hobby project. fileciteturn5file0 fileciteturn6file0

## What is good

### 1. Modular structure
The code is split into focused files such as `mqtt.js`, `relays.js`, `wled.js`, `sensors.js`, `visuals.js`, and `app.js`. That makes the project easier to extend and debug. fileciteturn5file0

### 2. Clean MQTT abstraction
The MQTT wrapper exposes a simple API:

```js
MQTTClient.connect(cfg)
MQTTClient.disconnect()
MQTTClient.publish(topic, payload, retained?)
MQTTClient.subscribe(topic, callback)
```

That is a good design choice because it keeps MQTT details out of the UI logic. The use of `mqtt.js` over Paho also looks like a practical improvement. fileciteturn6file0

### 3. Reconnect handling
The reconnect flow uses exponential backoff with jitter, which is the right direction for unstable broker connections. That is a strong reliability feature. fileciteturn6file0

### 4. Modern UI
The interface is visually polished and already includes:
- desktop tab navigation
- mobile bottom navigation
- theme switching
- connection status badge
- activity log
- WLED controls
- sensor panel
- relay controls

The structure in `index.html` shows a thoughtful dashboard layout rather than a rough proof of concept. fileciteturn5file0

### 5. PWA support
The page includes a manifest and service worker registration, which is good for offline behavior and app-like mobile use. fileciteturn5file0

## Problems and risks

### 1. Duplicate payload filtering can block valid updates
In `mqtt.js`, repeated messages on the same topic are ignored when the payload string is unchanged:

```js
if (_lastPayload[topic] === payloadStr) return;
```

That can be a problem for topics that intentionally publish the same value many times, such as heartbeat, sensor refresh, or watchdog data. It may make the UI look stale even though messages are still arriving. fileciteturn6file0

### 2. Reconnect can run forever
The reconnect limit is set to infinity:

```js
const _maxRetries = Infinity;
```

That means a wrong broker host, bad port, or invalid credentials can cause endless reconnect attempts. A finite retry cap or a user-controlled stop button would be safer. fileciteturn6file0

### 3. Password storage is a security concern
The settings UI includes an option to remember the password locally. That is convenient, but browser storage is always something to treat carefully because it can be exposed by injected scripts or shared devices. fileciteturn5file0

### 4. WLED effects are hardcoded
The WLED effect list is embedded directly in the HTML. That works, but it is harder to maintain and may drift from the real WLED feature set over time. Dynamic loading from WLED’s API would be more future-proof. fileciteturn5file0

### 5. CDN dependency
The project loads `mqtt.js` from a public CDN:

```html
<script src="https://unpkg.com/mqtt/dist/mqtt.min.js"></script>
```

If the CDN fails or is blocked, the app may not load correctly. Bundling or self-hosting the library would make the app more resilient. fileciteturn5file0

### 6. No clear offline command queue
The current publish flow skips messages when disconnected. That is acceptable for simple use, but it means button presses may be lost if the broker drops briefly. A local queue would improve reliability.

### 7. No QoS choice
The current MQTT usage is fixed to QoS 0. That is fine for non-critical lighting, but some relay or device commands may benefit from configurable QoS.

## Technical score

| Category | Score |
|---|---:|
| UI/UX | 9/10 |
| MQTT design | 8.5/10 |
| Maintainability | 8.5/10 |
| Reliability | 7.5/10 |
| Security | 6.5/10 |
| Mobile experience | 9/10 |
| Scalability | 8/10 |

## Best next improvements

### High priority
- Replace the duplicate-payload filter with timestamp-based throttling.
- Add a finite reconnect policy or a manual stop option.
- Improve failure visibility for broker/auth/topic errors.
- Avoid depending only on the CDN version of `mqtt.js`.

### Medium priority
- Load WLED effects dynamically from the WLED API.
- Add QoS selection.
- Add a local command queue for offline actions.
- Add more explicit retained-message controls.

### Lower priority
- Improve accessibility and keyboard navigation.
- Add a topic/debug inspector.
- Reduce memory growth for long-running sessions.

## Final verdict

This is already a well-designed and visually polished MQTT dashboard. The strongest parts are the modular architecture, reconnect handling, and modern interface. The main weaknesses are around edge-case reliability, security, and long-term maintainability.

With a few targeted fixes, this could become a very solid reusable IoT dashboard rather than just a custom control panel.

## References observed in the repo

- `index.html` with PWA support, tabs, theme system, relay/WLED/sensor sections, and CDN-loaded `mqtt.js`. fileciteturn5file0
- `js/mqtt.js` with the MQTT wrapper, reconnect logic, and subscription handling. fileciteturn6file0
