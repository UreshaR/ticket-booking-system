const client = require('prom-client');

client.collectDefaultMetrics(); // CPU, memory, event loop, and so on

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2]
});

function setupMetrics(app) {
  app.use((req, res, next) => {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      end({
        method: req.method,
        route: req.route ? req.route.path : 'unmatched',
        status: res.statusCode
      });
    });
    next();
  });

  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  });
}

module.exports = { setupMetrics };