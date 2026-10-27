import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '2m', target: 150 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
  },
};

const BASE = __ENV.BASE_URL || 'http://event-service:3002';

export default function () {
  const res = http.get(`${BASE}/api/v1/events`);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(0.05);
}