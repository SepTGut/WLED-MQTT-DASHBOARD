/* ═══════════════════════════════════════════════════════
   discovery.js  —  MQTT Device Discovery Module
   ─────────────────────────────────────────────────────
   Features:
   • Home Assistant MQTT Discovery (homeassistant/+/+/config)
   • WLED Status discovery (wled/+/status)
   • Manual topic scanning
   ═══════════════════════════════════════════════════════ */

window.DiscoveryModule = (function () {

  let _discoveredDevices = []; // [{ id, type, name, topic, manufacturer, model }]
  const _scannedTopics = new Set();
  let _isScanning = false;
  let _scanTimer = null;

  const log = (m, lvl='info') => window.AppLog && AppLog[lvl](m);

  function _addDevice(device) {
    const existing = _discoveredDevices.find(d => d.topic === device.topic);
    if (existing) {
      Object.assign(existing, device);
    } else {
      _discoveredDevices.push(device);
      log(`[Discovery] Found ${device.type}: ${device.name}`, 'success');
    }
    _render();
  }

  /* ── Home Assistant Discovery ─────────────────── */
  function _onHADiscovery(payloadStr, topic) {
    try {
      const config = JSON.parse(payloadStr);
      const parts = topic.split('/');
      const component = parts[1]; // e.g. 'light', 'switch', 'sensor'
      const nodeId = parts[2];
      
      const device = {
        id: nodeId,
        type: component,
        name: config.name || nodeId,
        topic: config.state_topic || config.command_topic || topic.replace('/config', ''),
        manufacturer: config.device?.manufacturer || 'Unknown',
        model: config.device?.model || 'MQTT Device',
        source: 'Home Assistant'
      };
      
      _addDevice(device);
    } catch (e) {
      console.error('[Discovery] HA JSON parse error', e);
    }
  }

  /* ── WLED Discovery ───────────────────────────── */
  function _onWLEDStatus(payloadStr, topic) {
    const parts = topic.split('/');
    const deviceName = parts[parts.length - 2];
    const prefix = topic.replace('/status', '');
    
    _addDevice({
      id: deviceName,
      type: 'wled',
      name: deviceName,
      topic: prefix,
      manufacturer: 'WLED',
      model: 'ESP LED Controller',
      source: 'WLED Status'
    });
  }

  /* ── Manual Scan ──────────────────────────────── */
  function _onScanMessage(payloadStr, topic) {
    if (!_isScanning) return;
    
    // Logic: If we see a topic ending in /status, /v, or /config, it's likely a device
    if (topic.endsWith('/status') || topic.endsWith('/v') || topic.endsWith('/config') || topic.endsWith('/presence')) {
        const prefix = topic.substring(0, topic.lastIndexOf('/'));
        if (_scannedTopics.has(prefix)) return;
        _scannedTopics.add(prefix);
        
        const parts = prefix.split('/');
        const name = parts[parts.length - 1];
        
        _addDevice({
            id: name,
            type: topic.includes('wled') ? 'wled' : 'generic',
            name: name,
            topic: prefix,
            manufacturer: 'Discovered',
            model: 'MQTT Device',
            source: 'Traffic Scan'
        });
    }
  }

  function _render() {
    const container = document.getElementById('discovery-list');
    if (!container) return;
    
    if (_discoveredDevices.length === 0) {
      container.innerHTML = '<div class="muted" style="padding:12px; text-align:center;">No devices discovered yet.</div>';
      return;
    }

    container.innerHTML = _discoveredDevices.map(d => `
      <div class="discovery-card">
        <div class="discovery-info">
          <div class="discovery-name">${d.name} <span class="discovery-type">${d.type}</span></div>
          <div class="discovery-topic">${d.topic}</div>
          <div class="discovery-meta">${d.manufacturer} — ${d.model}</div>
        </div>
        <button class="chip-btn btn-accent" onclick="DiscoveryModule.useDevice('${d.topic}', '${d.type}')">Use</button>
      </div>
    `).join('');
  }

  /* ════════════════════════════════════════════════
     PUBLIC API
  ════════════════════════════════════════════════ */
  return {
    init: function () {
      MQTTClient.subscribe('homeassistant/+/+/config', _onHADiscovery);
      MQTTClient.subscribe('wled/+/status', _onWLEDStatus);
      _render();
    },

    startScan: function () {
      if (_isScanning) return;
      _isScanning = true;
      _scannedTopics.clear();
      log('[Discovery] Starting 10s traffic scan...', 'info');
      
      const sub = MQTTClient.subscribe('#', _onScanMessage);
      
      const btn = document.getElementById('btn-discovery-scan');
      if (btn) {
          btn.disabled = true;
          btn.textContent = 'Scanning...';
      }

      _scanTimer = setTimeout(() => {
        sub.unsubscribe();
        _isScanning = false;
        log(`[Discovery] Scan complete. Found ${_scannedTopics.size} potential prefixes.`, 'success');
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Scan Traffic';
        }
      }, 10000);
    },

    useDevice: function (topic, type) {
      if (type === 'wled') {
        const list = window.getWLEDList();
        if (!list.includes(topic)) {
            list.push(topic);
            window.saveWLEDList(list);
            if (MQTTClient.connected) window.WLEDModule.init(topic);
            log(`[Discovery] Added WLED device: ${topic}`, 'success');
        }
        // Switch to WLED tab
        const tabBtn = document.querySelector('.tab-btn[data-tab="wled"]');
        if (tabBtn) tabBtn.click();
      } else {
        const el = document.getElementById('cfg-relay-prefix');
        if (el) {
            el.value = topic;
            el.dispatchEvent(new Event('change'));
            log(`[Discovery] Set Relay prefix to: ${topic}`, 'success');
            // Switch to Relays tab
            const tabBtn = document.querySelector('.tab-btn[data-tab="relays"]');
            if (tabBtn) tabBtn.click();
            // Re-init Relays if connected
            if (MQTTClient.connected) {
                window.RelayModule && window.RelayModule.init(topic);
                window.SensorModule && window.SensorModule.init(topic);
            }
        }
      }
    },

    clear: function() {
        _discoveredDevices = [];
        _render();
    }
  };

})();
