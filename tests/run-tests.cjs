const assert = require('assert');
const utils = require('../js/core-utils.js');

function testTopicMatching() {
  assert.equal(utils.mqttTopicMatches('a/b', 'a/b'), true);
  assert.equal(utils.mqttTopicMatches('a/+/c', 'a/b/c'), true);
  assert.equal(utils.mqttTopicMatches('a/+/c', 'a/b/d'), false);
  assert.equal(utils.mqttTopicMatches('a/#', 'a/b/c/d'), true);
  assert.equal(utils.mqttTopicMatches('a/#', 'a'), true);
  assert.equal(utils.mqttTopicMatches('a/b/#', 'a/b'), true);
  assert.equal(utils.mqttTopicMatches('a/b/#', 'a/b/c'), true);
  assert.equal(utils.mqttTopicMatches('a/+/c', 'a/b/c/d'), false);
  assert.equal(utils.mqttTopicMatches('a/#/c', 'a/x/c'), false); // invalid pattern form should not match
}

function testPayloadParsers() {
  assert.equal(utils.relayIsOnPayload('ON'), true);
  assert.equal(utils.relayIsOnPayload('1'), true);
  assert.equal(utils.relayIsOnPayload('true'), true);
  assert.equal(utils.relayIsOnPayload('off'), false);

  assert.equal(utils.sensorIsActivePayload('active'), true);
  assert.equal(utils.sensorIsActivePayload('ON'), true);
  assert.equal(utils.sensorIsActivePayload('idle'), false);

  assert.equal(utils.relayStateFromPayload('{"on":true}'), true);
  assert.equal(utils.relayStateFromPayload('{"on":0}'), false);
  assert.equal(utils.relayStateFromPayload('{"on":"ON"}'), true);

  assert.equal(utils.sensorStateFromPayload('{"state":true}'), true);
  assert.equal(utils.sensorStateFromPayload('{"state":0}'), false);
  assert.equal(utils.sensorStateFromPayload('{"state":"active"}'), true);
  assert.equal(utils.sensorStateFromPayload('{"s":true,"n":"Door","lc":4}'), true);
}

function testRelayControllerV2State() {
  const state = {
    r: [{ id: 0, on: true }, { id: 1, on: false }],
    s: [{ id: 0, s: true, lc: 10 }, { id: 1, s: false }],
    p: { a: true, s: 0, n: 2, r: -1, ms: 500, m: 1 },
    on: true,
    nr: 2,
    ns: 2,
    mask: 1
  };

  const relays = utils.normalizeRelayList(state);
  assert.equal(relays.length, 2);
  assert.deepEqual(relays.map(r => [r.id, r.on, r.name]), [
    [0, true, 'Relay 0'],
    [1, false, 'Relay 1']
  ]);

  const sensors = utils.normalizeSensorList(state);
  assert.equal(sensors.length, 2);
  assert.equal(sensors[0].id, 0);
  assert.equal(sensors[0].active, true);
  assert.equal(sensors[1].active, false);

  assert.equal(utils.relayTimerFromObject({ tr: 12 }), 12);
  assert.equal(utils.relayTimerFromObject({ timer_remaining: 8 }), 8);
}

function testBackoff() {
  assert.equal(utils.computeBackoffMs(0, 1000, 30000), 1000);
  assert.equal(utils.computeBackoffMs(1, 1000, 30000), 2000);
  assert.equal(utils.computeBackoffMs(2, 1000, 30000), 4000);
  assert.equal(utils.computeBackoffMs(10, 1000, 30000), 30000);
}

function run() {
  testTopicMatching();
  testPayloadParsers();
  testRelayControllerV2State();
  testBackoff();
  console.log('All tests passed.');
}

run();
