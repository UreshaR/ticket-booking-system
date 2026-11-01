const TOKEN_KEY = 'tb_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));

// Read the user's details from the JWT (returns null if missing or expired)
export function parseToken(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && getToken()) headers.Authorization = `Bearer ${getToken()}`;

  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });

  let data = null;
  try { data = await res.json(); } catch { /* the response had no JSON body */ }

  if (!res.ok) {
    if (auth && res.status === 401) {
      setToken(null);
      window.dispatchEvent(new Event('tb-logout')); // token expired: sign the user out
    }
    const message =
      data?.error ||
      data?.errors?.[0]?.msg ||
      (res.status === 429 ? 'Too many requests, please slow down' : `Request failed (${res.status})`);
    throw new Error(message);
  }
  return data;
}

export const api = {
  register: (name, email, password) =>
    request('/api/v1/auth/register', { method: 'POST', body: { name, email, password } }),
  login: async (email, password) => {
    const d = await request('/api/v1/auth/login', { method: 'POST', body: { email, password } });
    setToken(d.token);
    return d;
  },
  events: () => request('/api/v2/events'),
  book: (event_id, quantity) =>
    request('/api/v1/bookings', { method: 'POST', body: { event_id, quantity }, auth: true }),
  myBookings: () => request('/api/v1/bookings/my', { auth: true }),
  reviews: (event_id) => request(`/api/v1/reviews?event_id=${event_id}`),
  addReview: (event_id, rating, comment) =>
    request('/api/v1/reviews', { method: 'POST', body: { event_id, rating, comment }, auth: true })
};