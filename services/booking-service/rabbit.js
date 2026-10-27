const amqp = require('amqplib');

const QUEUE = 'booking.created';
let channel = null;

async function connect() {
  while (!channel) {
    try {
      const conn = await amqp.connect(process.env.RABBITMQ_URL);
      conn.on('close', () => { channel = null; setTimeout(connect, 3000); });
      conn.on('error', () => {});
      channel = await conn.createChannel();
      await channel.assertQueue(QUEUE, { durable: true });
      console.log('RabbitMQ connected');
    } catch (err) {
      console.error('RabbitMQ not ready, retrying in 3s:', err.message);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

function publishBookingCreated(payload) {
  if (!channel) throw new Error('RabbitMQ not connected');
  channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(payload)), { persistent: true });
}

module.exports = { connect, publishBookingCreated };