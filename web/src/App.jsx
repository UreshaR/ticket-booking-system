import { useEffect, useState } from 'react';
import { api, getToken, setToken, parseToken } from './api.js';

const money = (n) =>
  new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', maximumFractionDigits: 0 }).format(n);
const when = (d) => new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

export default function App() {
  const [user, setUser] = useState(() => parseToken(getToken() || ''));
  const [page, setPage] = useState('events');
  const [notice, setNotice] = useState(null); // { type: 'ok' | 'error', text }

  const flash = (type, text) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(null), 4000);
  };
  const logout = () => {
    setToken(null);
    setUser(null);
    setPage('events');
  };

  // The API client fires this event when the token has expired
  useEffect(() => {
    const onLogout = () => {
      setUser(null);
      setPage('login');
      flash('error', 'Your session expired. Please log in again.');
    };
    window.addEventListener('tb-logout', onLogout);
    return () => window.removeEventListener('tb-logout', onLogout);
  }, []);

  return (
    <div className="app">
      <header>
        <h1>🎟 Ticket Booking</h1>
        <nav>
          <button className={page === 'events' ? 'active' : ''} onClick={() => setPage('events')}>Events</button>
          {user && (
            <button className={page === 'bookings' ? 'active' : ''} onClick={() => setPage('bookings')}>
              My bookings
            </button>
          )}
          {user ? (
            <>
              <span className="who">{user.email}</span>
              <button onClick={logout}>Log out</button>
            </>
          ) : (
            <button className={page === 'login' ? 'active' : ''} onClick={() => setPage('login')}>Log in</button>
          )}
        </nav>
      </header>

      {notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}

      <main>
        {page === 'login' && !user && (
          <AuthForm
            flash={flash}
            onLoggedIn={(u) => {
              setUser(u);
              setPage('events');
              flash('ok', 'Logged in');
            }}
          />
        )}
        {page === 'events' && <Events user={user} goLogin={() => setPage('login')} flash={flash} />}
        {page === 'bookings' && user && <Bookings flash={flash} />}
      </main>
    </div>
  );
}

function AuthForm({ onLoggedIn, flash }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'register') await api.register(form.name, form.email, form.password);
      await api.login(form.email, form.password);
      onLoggedIn(parseToken(getToken()));
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card auth" onSubmit={submit}>
      <h2>{mode === 'login' ? 'Log in' : 'Create account'}</h2>
      {mode === 'register' && <input placeholder="Name" value={form.name} onChange={set('name')} required />}
      <input type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
      <input
        type="password"
        placeholder="Password (at least 8 characters)"
        value={form.password}
        onChange={set('password')}
        minLength={8}
        required
      />
      <button disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Register'}</button>
      <p className="muted">
        {mode === 'login' ? 'No account? ' : 'Already registered? '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setMode(mode === 'login' ? 'register' : 'login');
          }}
        >
          {mode === 'login' ? 'Register' : 'Log in'}
        </a>
      </p>
    </form>
  );
}

function Events({ user, goLogin, flash }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    api.events().then((d) => setEvents(d.events)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (error) return <p className="error">Could not load events: {error}</p>;
  if (!events) return <p className="muted">Loading events…</p>;
  return (
    <div className="grid">
      {events.map((ev) => (
        <EventCard key={ev.id} ev={ev} user={user} goLogin={goLogin} flash={flash} reload={load} />
      ))}
    </div>
  );
}

function EventCard({ ev, user, goLogin, flash, reload }) {
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const [summary, setSummary] = useState(null); // { count, average }

  useEffect(() => {
    api.reviews(ev.id).then((r) => setSummary({ count: r.count, average: r.average })).catch(() => {});
  }, [ev.id]);

  async function book() {
    if (!user) return goLogin();
    setBusy(true);
    try {
      const b = await api.book(ev.id, Number(qty));
      flash('ok', `Booked ${b.quantity} ticket(s) for ${b.event_title}. Total ${money(b.total_price)}`);
      reload();
    } catch (err) {
      flash('error', err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3>{ev.title}</h3>
      <p className="muted">{ev.venue} · {when(ev.date)}</p>
      <p className="price">{money(ev.price)} <span className="muted">per ticket</span></p>
      <p>
        {ev.sold_out ? (
          <span className="badge red">Sold out</span>
        ) : (
          <span className="badge green">{ev.seats.available} of {ev.seats.total} seats left</span>
        )}
      </p>
      {summary && summary.count > 0 && (
        <p className="muted">★ {summary.average} ({summary.count} review{summary.count > 1 ? 's' : ''})</p>
      )}
      <div className="row">
        <select value={qty} onChange={(e) => setQty(e.target.value)} disabled={ev.sold_out}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button onClick={book} disabled={busy || ev.sold_out}>
          {user ? (busy ? 'Booking…' : 'Book') : 'Log in to book'}
        </button>
        <button className="link" onClick={() => setShowReviews(!showReviews)}>
          {showReviews ? 'Hide reviews' : 'Reviews'}
        </button>
      </div>
      {showReviews && (
        <Reviews eventId={ev.id} user={user} goLogin={goLogin} flash={flash} onChanged={setSummary} />
      )}
    </div>
  );
}

function Reviews({ eventId, user, goLogin, flash, onChanged }) {
  const [data, setData] = useState(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  const load = () =>
    api.reviews(eventId)
      .then((d) => {
        setData(d);
        onChanged({ count: d.count, average: d.average });
      })
      .catch((e) => flash('error', e.message));
  useEffect(() => { load(); }, [eventId]);

  async function submit(e) {
    e.preventDefault();
    if (!user) return goLogin();
    try {
      await api.addReview(eventId, Number(rating), comment);
      setComment('');
      flash('ok', 'Thanks for your review');
      load();
    } catch (err) {
      flash('error', err.message);
    }
  }

  return (
    <div className="reviews">
      {!data ? (
        <p className="muted">Loading…</p>
      ) : data.count === 0 ? (
        <p className="muted">No reviews yet.</p>
      ) : (
        data.reviews.map((r, i) => (
          <div key={i} className="review">
            <strong>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</strong>
            <span className="muted"> {when(r.created_at)}</span>
            {r.comment && <p>{r.comment}</p>}
          </div>
        ))
      )}
      <form className="row" onSubmit={submit}>
        <select value={rating} onChange={(e) => setRating(e.target.value)}>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}
        </select>
        <input
          placeholder="Write a comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={500}
        />
        <button>{user ? 'Post' : 'Log in to review'}</button>
      </form>
    </div>
  );
}

function Bookings({ flash }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    api.myBookings().then(setRows).catch((e) => flash('error', e.message));
  }, []);

  if (!rows) return <p className="muted">Loading…</p>;
  if (rows.length === 0) return <p className="muted">You have no bookings yet.</p>;
  return (
    <table className="card">
      <thead>
        <tr><th>#</th><th>Event</th><th>Tickets</th><th>Total</th><th>Status</th><th>Booked</th></tr>
      </thead>
      <tbody>
        {rows.map((b) => (
          <tr key={b.id}>
            <td>{b.id}</td>
            <td>{b.event_title}</td>
            <td>{b.quantity}</td>
            <td>{money(b.total_price)}</td>
            <td>{b.status}</td>
            <td>{when(b.created_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}