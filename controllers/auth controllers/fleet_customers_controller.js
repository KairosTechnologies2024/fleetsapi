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

// Check database connection on start
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err.stack);
  } else {
    console.log('Database connected:', res.rows[0]);
  }
});

// JWT generation function
function generateJWT(userId, email) {
  const payload = {
    userId: userId,
    email: email
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '9h' });
  return token;
}

// User Registration for Fleet Customers
const createFleetCustomer = async (req, res) => {
  const {
    email,
    password,
    company,
    company_id,
    name,
    role,
    status,
    phone_number,
    profile_picture,
    is_active = true
  } = req.body;

  if (!email || !password || !name || !company || !company_id || !role || !status) {
    return res.status(400).json({ error: 'Email, name, password, company, company_id, role, and status are required.' });
  }

  try {
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists. Please use a different email.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password, user_type) VALUES ($1, $2, $3) RETURNING id, email',
      [email, hashedPassword, 'fleet_customer']
    );

    const newUser = result.rows[0];
    const userId = newUser.id;

  const fleetResult = await pool.query(
  `INSERT INTO fleet_customers
    (email, company, company_id, name, role, status, phone_number, profile_picture, is_active, user_id)
   VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
   RETURNING fleet_customer_id, company, company_id, email`,
  [
    email,
    company,
    company_id,
    name,
    role,
    status,
    phone_number,
    profile_picture,
    is_active,
    userId
  ]
);

    const fleetCustomerId = fleetResult.rows[0].fleet_customer_id;

    const token = generateJWT(userId, email);

    res.status(201).json({
      message: 'User and fleet customer created successfully',
      user: { user_id: userId, email, name, phone_number },
      fleet_customer_id: fleetCustomerId,
      token
    });
  } catch (err) {
    console.error('Error during registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};



const getFleetCustomer = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM fleet_customers WHERE fleet_customer_id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fleet customer not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching fleet customer:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};



const getAllFleetCustomers = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM fleet_customers');
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching fleet customers:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};



const updateFleetCustomer = async (req, res) => {
  const { id } = req.params;
  const {
    company,
    company_id,
    email,
    name,
    phone_number,
    role,
    status,
    is_active,
    profile_picture
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE fleet_customers SET
        company = $1,
        company_id = $2,
        email = $3,
        name = $4,
        phone_number = $5,
        role = $6,
        status = $7,
        is_active = $8,
        profile_picture = $9
      WHERE fleet_customer_id = $10
      RETURNING *`,
      [
        company,
        company_id,
        email,
        name,
        phone_number,
        role,
        status,
        is_active,
        profile_picture,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fleet customer not found' });
    }

    res.status(200).json({ message: 'Fleet customer updated', data: result.rows[0] });
  } catch (err) {
    console.error('Error updating fleet customer:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};


const deleteFleetCustomer = async (req, res) => {
  const { id } = req.params;

  try {
    // Optionally delete user from `users` table if needed
    await pool.query('DELETE FROM fleet_customers WHERE fleet_customer_id = $1', [id]);

    res.status(200).json({ message: 'Fleet customer deleted successfully' });
  } catch (err) {
    console.error('Error deleting fleet customer:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};


module.exports = {
  createFleetCustomer,
  getFleetCustomer,
  getAllFleetCustomers,
  updateFleetCustomer,
  deleteFleetCustomer
};
