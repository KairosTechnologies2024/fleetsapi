const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Database connection pool
const pool = new Pool({
  host: process.env.DB_TEST_HOST,
  user: process.env.DB_TEST_USER,
  password: process.env.DB_TEST_PASSWORD,
  database: process.env.DB_TEST_NAME,
  port: process.env.DB_TEST_PORT
});

// Check database connection on start
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err.stack);
  } else {
    console.log('Database connected on auth Middleware:', res.rows[0]);
  }
});

// Middleware to protect user routes
const authMiddleware = async (req, res, next) => {
  const authHeader = req.header('Authorization');

  if (!authHeader) {
    return res.status(401).json({ message: 'Access denied. No token provided' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from DB
    const result = await pool.query(
      'SELECT id, email, user_type FROM users WHERE id = $1',
      [decoded.userId]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    // Check if user is admin
    if (user.user_type !== 'admin') {
      return res.status(403).json({ message: 'Access denied. Admins only.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error(error);
    return res.status(401).json({ message: 'Invalid token' });
  }
};


// Export the authentication middleware
module.exports = authMiddleware;
