import http from 'k6/http';
import { sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const options = {
  stages: [
    { duration: '10s', target: 500 },
    { duration: '10s', target: 1000 },
    { duration: '10s', target: 1500 },
    { duration: '10s', target: 2000 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000'],
    cache_hit_rate: ['rate>=0.9'],
  },
};

export const cacheHitRate = new Rate('cache_hit_rate');

export default function () {
  const isLoggedIn = Math.random() < 0.05;

  const headers = isLoggedIn
    ? { headers: { Cookie: 'session=abc123xyz' } }
    : {};

  const res = http.get('https://securebuild.com/images/postgres/inspect', headers);

  const status = res.headers['cf-cache-status'];

  if (status === 'HIT') {
    cacheHitRate.add(true);
  } else {
    cacheHitRate.add(false);
  }

  sleep(Math.random() * 2);
}
