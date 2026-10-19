require('dotenv').config();
const amqp = require('amqplib');
const http = require('http');

const QUEUE = 'booking.created';
const DEAD_QUEUE = 'booking.failed';
const MAX_ATTEMPTS = 3;

let consuming = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Simulated email (swap for Nodemailer later if you want a real one)
async function sendEmail(data) {
  if (data.email.includes('fail')) throw new Error('Simulated email failure');
  console.log(
    `EMAIL to ${data.email}: Booking #${data.booking_id} confirmed - ` +
    `${data.quantity} x ${data.event_title}, total ${data.total_price}`
  );
}

async function start() {
  // Keep trying until RabbitMQ is reachable
  let conn;
  while (!conn) {
    try {
      conn = await amqp.connect(process.env.RABBITMQ_URL);
    } catch (err) {
      console.error('RabbitMQ not ready, retrying in 3s:', err.message);
      await sleep(3000);
    }
  }

  conn.on('error', () => {});
  conn.on('close', () => {
    consuming = false;
    console.error('RabbitMQ connection closed, reconnecting...');
    setTimeout(start, 3000);
  });

  const channel = await conn.createChannel();
  await channel.assertQueue(QUEUE, { durable: true });
  await channel.assertQueue(DEAD_QUEUE, { durable: true });
  channel.prefetch(1); // take one message at a time
  consuming = true;
  console.log('Notification service waiting for messages...');

  channel.consume(QUEUE, async (msg) => {
    if (!msg) return;
    const attempt = msg.properties.headers?.['x-retries'] || 0;
    let data;

    try {
      data = JSON.parse(msg.content.toString());
      await sendEmail(data);
      channel.ack(msg); // success: remove from the queue
    } catch (err) {
      const id = data?.booking_id ?? 'unknown';
      console.error(`Attempt ${attempt + 1}/${MAX_ATTEMPTS} failed for booking ${id}: ${err.message}`);

      if (attempt + 1 >= MAX_ATTEMPTS) {
        channel.sendToQueue(DEAD_QUEUE, msg.content, {
          persistent: true,
          headers: { error: err.message }
        });
        console.error(`Booking ${id} moved to ${DEAD_QUEUE}`);
      } else {
        await sleep(2000 * (attempt + 1)); // wait a bit longer each time
        channel.sendToQueue(QUEUE, msg.content, {
          persistent: true,
          headers: { 'x-retries': attempt + 1 }
        });
      }
      channel.ack(msg); // the original is handled (retried or moved)
    }
  });
}

// Tiny health endpoint for Docker/Kubernetes
http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(consuming ? 200 : 503, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: consuming ? 'ok' : 'not ready' }));
  }
  res.writeHead(404);
  res.end();
}).listen(process.env.PORT || 3004);

start();