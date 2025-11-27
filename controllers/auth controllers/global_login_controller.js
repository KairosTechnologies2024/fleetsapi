

require('dotenv').config();
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Database connection pool
const pool = new Pool({
  host: process.env.DB_TEST_HOST,
  user: process.env.DB_TEST_USER,
  password: process.env.DB_TEST_PASSWORD,
  database: process.env.DB_TEST_NAME,
  port: process.env.DB_TEST_PORT
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err.stack);
  } else {
    console.log('Database connected:', res.rows[0]);
  }
});

// JWT generation
function generateJWT(userId, email, userRole) {
  const payload = { userId, email, userRole };
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '9h' });
}





const loginUserWithEmailPassword = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query('SELECT id, email, user_type, password FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateJWT(user.id, user.email, user.user_role);
    res.json({ message: 'Login successful', user, token });

  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};


module.exports={loginUserWithEmailPassword};