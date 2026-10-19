CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(150) NOT NULL,
  venue VARCHAR(150) NOT NULL,
  event_date TIMESTAMP NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  total_seats INT NOT NULL,
  available_seats INT NOT NULL CHECK (available_seats >= 0)
);