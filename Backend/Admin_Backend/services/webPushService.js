/**
 * Push notifications when a bus is near a stop (e.g. within 1 km).
 * Wire to FCM / Web Push when keys are available.
 */
async function notifyBusProximity({ busId, userIds, title, body, data }) {
  void busId;
  void userIds;
  void title;
  void body;
  void data;
  return { sent: 0, skipped: true };
}

module.exports = { notifyBusProximity };
