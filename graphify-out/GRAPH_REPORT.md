# Graph Report - .  (2026-05-15)

## Corpus Check
- Corpus is ~25,508 words - fits in a single context window. You may not need a graph.

## Summary
- 687 nodes · 1701 edges · 44 communities (25 shown, 19 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 80,000 input · 15,000 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 30|Community 30]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 33|Community 33]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 39|Community 39]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 41|Community 41]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 43|Community 43]]

## God Nodes (most connected - your core abstractions)
1. `Js()` - 492 edges
2. `push()` - 42 edges
3. `aE()` - 42 edges
4. `WLEDDevice` - 36 edges
5. `write()` - 31 edges
6. `dE()` - 27 edges
7. `destroy()` - 24 edges
8. `Wr()` - 24 edges
9. `Px()` - 23 edges
10. `e` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Index HTML` --references--> `MQTTClient`  [EXTRACTED]
  index.html → js/mqtt.js
- `initConnectionUI` --calls--> `MQTTClient`  [EXTRACTED]
  js/app.js → js/mqtt.js
- `WLEDDevice` --calls--> `MQTTClient`  [EXTRACTED]
  js/wled.js → js/mqtt.js
- `wireModules` --calls--> `RelayModule`  [EXTRACTED]
  js/app.js → js/relays.js
- `wireModules` --calls--> `WLEDModule`  [EXTRACTED]
  js/app.js → js/wled.js

## Hyperedges (group relationships)
- **MQTT Connection Flow** — app_initConnectionUI, mqtt_MQTTClient, relays_RelayModule, wled_WLEDModule, sensors_SensorModule, discovery_DiscoveryModule [INFERRED 0.95]
- **Device Lifecycle Management** — discovery_DiscoveryModule, wled_WLEDModule, relays_RelayModule, sensors_SensorModule [INFERRED 0.95]
- **State Persistence** — app_initSettings, wled_WLEDDevice [INFERRED 0.95]

## Communities (44 total, 19 thin omitted)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (83): a(), aA(), abort(), ac(), ArrayPrototypeJoin(), ArrayPrototypePop(), ArrayPrototypePush(), B_() (+75 more)

### Community 2 - "Community 2"
Cohesion: 0.09
Nodes (57): addEventListener(), an(), ar(), AT(), bE(), Br(), Bv(), Ce() (+49 more)

### Community 3 - "Community 3"
Cohesion: 0.1
Nodes (5): _devices, init(), removeDevice(), _updateEmpty(), WLEDDevice

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (36): Bb(), constructor(), createStream(), cut(), defaultId(), entries(), eraseElementByIterator(), eraseElementByPos() (+28 more)

### Community 5 - "Community 5"
Cohesion: 0.2
Nodes (32): aE(), consume(), _emitError(), _getBuffer(), _getString(), _newPacket(), _parse4ByteNum(), _parseAuth() (+24 more)

### Community 6 - "Community 6"
Cohesion: 0.11
Nodes (30): ab(), ah(), aI(), Am(), cI(), dl(), e, Eb() (+22 more)

### Community 7 - "Community 7"
Cohesion: 0.16
Nodes (24): _buildCard(), _clearSheet(), _esc(), _fmtSec(), _initPatternUI(), log(), _onFullState(), _onRelayDetail() (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (25): cd(), ch(), Di(), Em(), fd(), fh(), Fs(), ih() (+17 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (23): _applyTopicAlias(), del(), fetch(), forceFetch(), get(), getAliasByTopic(), getLruAlias(), getRemainingTTL() (+15 more)

### Community 11 - "Community 11"
Cohesion: 0.19
Nodes (20): _activeSubscriptions, _dispatch(), _doConnect(), _getRelayPrefix(), _isValidTopic(), _lastPayload, _log(), _nextReconnectMs() (+12 more)

### Community 12 - "Community 12"
Cohesion: 0.16
Nodes (9): add(), apply(), closePanel(), doConnect(), pad(), setState(), ts(), updateUptime() (+1 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (17): e0(), Eh(), km(), L0(), lm(), ms(), N0(), nm() (+9 more)

### Community 14 - "Community 14"
Cohesion: 0.2
Nodes (13): _addDevice(), btn, _discoveredDevices, el, list, log(), _onHADiscovery(), _onScanMessage() (+5 more)

### Community 15 - "Community 15"
Cohesion: 0.26
Nodes (9): _buildCard(), _elapsed(), _esc(), _onFullState(), _onSensorDetail(), _onSensorState(), _render(), _startElapsedTicker() (+1 more)

### Community 16 - "Community 16"
Cohesion: 0.3
Nodes (9): boolFromValue(), normalizeRelayList(), normalizeSensorList(), parseJsonObject(), relayIsOnPayload(), relayStateFromPayload(), relayTimerFromObject(), sensorIsActivePayload() (+1 more)

### Community 17 - "Community 17"
Cohesion: 0.38
Nodes (10): initConnectionUI, wireModules, AppCoreUtils, DiscoveryModule, Index HTML, MQTTClient, RelayModule, SensorModule (+2 more)

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (9): aS(), dS(), ho(), ks(), load(), reverseUpperBound(), rr(), Rs() (+1 more)

### Community 19 - "Community 19"
Cohesion: 0.29
Nodes (8): eo(), first(), Jv(), k_(), md(), td(), Vp(), Ys()

### Community 20 - "Community 20"
Cohesion: 0.25
Nodes (8): bp(), DT(), fb(), gs(), parse(), parser(), _resetState(), Wb()

### Community 21 - "Community 21"
Cohesion: 0.33
Nodes (6): _cleanUp(), _destroyKeepaliveManager(), _flush(), na(), onKeepaliveTimeout(), _setupReconnect()

### Community 22 - "Community 22"
Cohesion: 0.4
Nodes (5): bm(), BT(), gm(), kf(), Qf()

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (3): hw(), qs(), _r()

### Community 25 - "Community 25"
Cohesion: 0.67
Nodes (3): cs(), Rc(), xc()

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (3): MI(), rI(), wl()

## Knowledge Gaps
- **29 isolated node(s):** `ASSETS`, `fetchPromise`, `_discoveredDevices`, `_scannedTopics`, `sub` (+24 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Js()` connect `Community 0` to `Community 1`, `Community 2`, `Community 4`, `Community 5`, `Community 6`, `Community 8`, `Community 10`, `Community 13`, `Community 18`, `Community 19`, `Community 20`, `Community 21`, `Community 22`, `Community 24`, `Community 25`, `Community 26`, `Community 27`, `Community 28`, `Community 29`, `Community 30`, `Community 31`, `Community 32`, `Community 33`, `Community 34`, `Community 35`?**
  _High betweenness centrality (0.493) - this node is a cross-community bridge._
- **Why does `push()` connect `Community 1` to `Community 0`, `Community 2`, `Community 35`, `Community 4`, `Community 5`, `Community 8`, `Community 10`, `Community 21`?**
  _High betweenness centrality (0.002) - this node is a cross-community bridge._
- **What connects `ASSETS`, `fetchPromise`, `_discoveredDevices` to the rest of the system?**
  _29 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.02 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._