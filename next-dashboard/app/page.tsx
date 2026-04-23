"use client";

import { useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    Paho?: {
      MQTT: {
        Client: new (host: string, port: number, path: string, clientId: string) => PahoClient;
        Message: new (payload: string) => PahoMessage;
      };
    };
  }
}

type TabName = "relays" | "wled" | "sensors" | "settings";
type ConnStatus = "offline" | "connecting" | "online" | "error";

type PahoMessage = {
  destinationName: string;
  payloadString: string;
};

type PahoClient = {
  onConnectionLost?: (res: { errorCode: number; errorMessage?: string }) => void;
  onMessageArrived?: (message: PahoMessage) => void;
  connect: (opts: {
    useSSL: boolean;
    timeout: number;
    userName?: string;
    password?: string;
    onSuccess: () => void;
    onFailure: (err: { errorMessage?: string }) => void;
  }) => void;
  disconnect: () => void;
  subscribe: (topic: string, opts?: { qos: number }) => void;
  send: (msg: { destinationName: string }) => void;
};

function buttonClass(active: boolean) {
  return active
    ? "w-full text-left px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-200"
    : "w-full text-left px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800";
}

export default function Page() {
  const [tab, setTab] = useState<TabName>("relays");
  const [status, setStatus] = useState<ConnStatus>("offline");
  const [host, setHost] = useState("broker.hivemq.com");
  const [port, setPort] = useState("8884");
  const [tls, setTls] = useState(true);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [prefix, setPrefix] = useState("home/relay");
  const [log, setLog] = useState<string[]>([]);
  const [client, setClient] = useState<PahoClient | null>(null);

  useEffect(() => {
    const id = "paho-mqtt-cdn";
    if (document.getElementById(id)) return;
    const s = document.createElement("script");
    s.id = id;
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/paho-mqtt/1.0.1/mqttws31.min.js";
    s.async = true;
    document.head.appendChild(s);
  }, []);

  const canControl = status === "online";

  const badgeClass = useMemo(() => {
    if (status === "online") return "bg-emerald-500/20 text-emerald-300 border-emerald-600/40";
    if (status === "connecting") return "bg-amber-500/20 text-amber-200 border-amber-600/40";
    if (status === "error") return "bg-rose-500/20 text-rose-200 border-rose-600/40";
    return "bg-slate-500/20 text-slate-200 border-slate-600/40";
  }, [status]);

  function addLog(msg: string) {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-149), `[${ts}] ${msg}`]);
  }

  function connect() {
    if (!window.Paho?.MQTT?.Client || !window.Paho?.MQTT?.Message) {
      addLog("MQTT library not loaded yet.");
      return;
    }
    if (!host.trim()) {
      addLog("Host is required.");
      return;
    }
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      addLog("Invalid port.");
      return;
    }

    setStatus("connecting");
    addLog(`Connecting to ${tls ? "wss" : "ws"}://${host}:${p} ...`);

    const id = "nextdash_" + Math.random().toString(16).slice(2, 10);
    const c = new window.Paho.MQTT.Client(host.trim(), p, "/mqtt", id);

    c.onConnectionLost = (res) => {
      setStatus(res.errorCode === 0 ? "offline" : "error");
      addLog(`Disconnected: ${res.errorMessage || "unknown"}`);
    };

    c.onMessageArrived = (m) => {
      addLog(`RX ${m.destinationName}: ${m.payloadString}`);
    };

    c.connect({
      useSSL: tls,
      timeout: 10,
      userName: user || undefined,
      password: pass || undefined,
      onSuccess: () => {
        setClient(c);
        setStatus("online");
        addLog("Connected.");
        c.subscribe(prefix + "/#", { qos: 0 });
        addLog(`Subscribed: ${prefix}/#`);
      },
      onFailure: (err) => {
        setStatus("error");
        addLog(`Connection failed: ${err.errorMessage || "unknown"}`);
      }
    });
  }

  function disconnect() {
    try {
      client?.disconnect();
    } catch {
      // ignore
    }
    setClient(null);
    setStatus("offline");
    addLog("Disconnected.");
  }

  function publish(topic: string, payload: string) {
    if (!client || status !== "online" || !window.Paho?.MQTT?.Message) {
      addLog("Not connected.");
      return;
    }
    const msg = new window.Paho.MQTT.Message(payload);
    msg.destinationName = topic;
    client.send(msg);
    addLog(`TX ${topic}: ${payload}`);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">MQTT Controller</h1>
        <span className={`px-3 py-1 rounded-full text-sm border ${badgeClass}`}>{status.toUpperCase()}</span>
      </header>

      <div className="grid md:grid-cols-[240px,1fr] gap-4">
        <aside className="panel p-2">
          <button onClick={() => setTab("relays")} className={buttonClass(tab === "relays")}>Relays</button>
          <button onClick={() => setTab("wled")} className={buttonClass(tab === "wled")}>WLED</button>
          <button onClick={() => setTab("sensors")} className={buttonClass(tab === "sensors")}>Sensors</button>
          <button onClick={() => setTab("settings")} className={buttonClass(tab === "settings")}>Settings</button>
        </aside>

        <main className="space-y-4">
          {tab === "relays" && (
            <section className="panel p-4">
              <h2 className="text-lg font-medium mb-3">Relays</h2>
              <div className="flex flex-wrap gap-2">
                <button disabled={!canControl} onClick={() => publish(prefix, "ON")} className="px-3 py-2 rounded-lg bg-emerald-600 disabled:opacity-40">All ON</button>
                <button disabled={!canControl} onClick={() => publish(prefix, "OFF")} className="px-3 py-2 rounded-lg bg-rose-600 disabled:opacity-40">All OFF</button>
                <button disabled={!canControl} onClick={() => publish(prefix + "/ping", "1")} className="px-3 py-2 rounded-lg bg-cyan-700 disabled:opacity-40">Ping</button>
              </div>
              <p className="text-slate-400 text-sm mt-3">Layout preserved from your previous dashboard, now on Next.js.</p>
            </section>
          )}

          {tab === "wled" && (
            <section className="panel p-4">
              <h2 className="text-lg font-medium mb-2">WLED</h2>
              <p className="text-slate-400 text-sm">Simple placeholder card. You can migrate existing WLED controls here.</p>
            </section>
          )}

          {tab === "sensors" && (
            <section className="panel p-4">
              <h2 className="text-lg font-medium mb-2">Sensors</h2>
              <p className="text-slate-400 text-sm">Simple placeholder card. You can migrate existing sensor cards here.</p>
            </section>
          )}

          {tab === "settings" && (
            <section className="panel p-4">
              <h2 className="text-lg font-medium mb-3">Broker Settings</h2>
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="text-sm">Host
                  <input value={host} onChange={(e) => setHost(e.target.value)} className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2" />
                </label>
                <label className="text-sm">Port
                  <input value={port} onChange={(e) => setPort(e.target.value)} className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2" />
                </label>
                <label className="text-sm">Username
                  <input value={user} onChange={(e) => setUser(e.target.value)} className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2" />
                </label>
                <label className="text-sm">Password
                  <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2" />
                </label>
                <label className="text-sm sm:col-span-2">Relay Prefix
                  <input value={prefix} onChange={(e) => setPrefix(e.target.value)} className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2" />
                </label>
              </div>
              <label className="inline-flex items-center gap-2 mt-3 text-sm">
                <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
                WSS / TLS
              </label>
              <div className="flex gap-2 mt-4">
                <button onClick={connect} disabled={status === "connecting" || status === "online"} className="px-3 py-2 rounded-lg bg-cyan-600 disabled:opacity-40">Connect</button>
                <button onClick={disconnect} disabled={status !== "online"} className="px-3 py-2 rounded-lg bg-slate-700 disabled:opacity-40">Disconnect</button>
              </div>
            </section>
          )}

          <section className="panel p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium">Activity Log</h3>
              <button onClick={() => setLog([])} className="text-sm text-slate-300 hover:text-white">Clear</button>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 h-56 overflow-auto text-xs font-mono space-y-1">
              {log.length === 0 ? <div className="text-slate-500">No log yet.</div> : log.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
