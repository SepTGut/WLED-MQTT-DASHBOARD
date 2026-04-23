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
  testBackoff();
  console.log('All tests passed.');
}

run();
