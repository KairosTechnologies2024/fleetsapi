const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// DB setup
const pool = new Pool({
  host: process.env.DB_TEST_HOST,
  user: process.env.DB_TEST_USER,
  password: process.env.DB_TEST_PASSWORD,
  database: process.env.DB_TEST_NAME,
  port: process.env.DB_TEST_PORT
});

// JWT


// CREATE user
const createUser = async (req, res) => {
  const { email, password, user_type } = req.body;

  if (!email || !password ||  !user_type) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password, user_type) VALUES ($1, $2, $3) RETURNING id, email, user_type',
      [email, hashedPassword, user_type]
    );

    res.status(201).json({ message: 'User created', user: result.rows[0] });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// READ all users
const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, email, user_type FROM users');
    res.json(result.rows);
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// READ one user
const getUserById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT id, email, user_type FROM users WHERE id = $1', [id]);
    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    console.error('Get user by ID error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// UPDATE user
const updateUser = async (req, res) => {
  const { id } = req.params;
  const { email, password, user_type } = req.body;

  try {
    let query = 'UPDATE users SET';
    const updates = [];
    const values = [];
    let index = 1;

    if (email) {
      updates.push(` email = $${index++}`);
      values.push(email);
    }

    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      updates.push(` password = $${index++}`);
      values.push(hashed);
    }

    if (user_type) {
      updates.push(` user_type = $${index++}`);
      values.push(user_type);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    query += updates.join(',');
    query += ` WHERE id = $${index} RETURNING id, email, user_type`;
    values.push(id);

    const result = await pool.query(query, values);
    res.json({ message: 'User updated', user: result.rows[0] });

  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// DELETE user
const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted', userId: result.rows[0].id });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// LOGIN


module.exports = {
  createUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,

};
