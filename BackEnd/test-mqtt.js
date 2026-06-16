const mqtt = require('mqtt');

const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
  console.log('Connected to broker, publishing test message...');
  
  const payload = {
    device: [
      { id: 'N1', d: 1150 }, // Water level should be (1400 - 1150) / 10 = 25 cm
      { id: 'N2', d: 1200 }, // Water level should be (1400 - 1200) / 10 = 20 cm
      { id: 'UNKNOWN_DEVICE', d: 500 } // Should be skipped
    ],
    temperature: 30.5,
    pressure: 1005.12 // Elevation should be ~67.5 meters
  };

  client.publish('sensor/data', JSON.stringify(payload), (err) => {
    if (err) console.error(err);
    else console.log('Test message published successfully!');
    client.end();
  });
});
