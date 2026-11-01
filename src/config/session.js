const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const env = require('./env');

let store;
function getStore() {
  if (env.isTest) return undefined; // MemoryStore is fine for tests
  if (!store) {
    store = new MySQLStore({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      createDatabaseTable: true,
      clearExpired: true,
      checkExpirationInterval: 15 * 60 * 1000,
      expiration: 30 * 24 * 60 * 60 * 1000,
    });
  }
  return store;
}

// Single instance shared by Express and Socket.io.
let middleware;
function sessionMiddleware() {
  if (middleware) return middleware;
  middleware = session({
    name: 'st.sid',
    secret: env.SESSION_SECRET,
    store: getStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  });
  return middleware;
}

async function closeStore() {
  if (store) await store.close();
}

module.exports = { sessionMiddleware, closeStore };
