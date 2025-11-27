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

// Check for duplicate emails
async function isEmailTaken(email) {
  const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  return result.rows.length > 0;
}

// Create new user and customer
const addCustomer = async (req, res) => {
  const {
    email, password, client_password, first_name, last_name, phone_number, id_number,
    address_line_1, address_line_2, city, postal_code, province,
    initiator_name, next_of_kin, next_of_kin_number,
    passport_number, policy_number, profile_picture
  } = req.body;

  if (!email || !password || !first_name || !last_name || !client_password) {
    return res.status(400).json({ error: 'Email, password, first name, last name, and client password are required.' });
  }

  if (await isEmailTaken(email)) {
    return res.status(400).json({ error: 'Email is already taken.' });
  }

  try {
    // Hash the authentication password (this is the password used for login)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user into users table
    const userResult = await pool.query(
      `INSERT INTO users 
        (email, password, user_type) 
       VALUES 
        ($1, $2, $3) 
       RETURNING id, email, password, user_type`,
      [
        email,
        hashedPassword,
        'regular_customer'
      ]
    );

    const newUser = userResult.rows[0];
    const userId = newUser.id;

    // Insert into customers table, do not hash client_password, store it as-is
    const customerResult = await pool.query(
      `INSERT INTO customers (
        user_id, first_name, last_name, email, phone_number, id_number,
        address_line_1, address_line_2, city, postal_code, province,
        client_password, initiator_name, next_of_kin, next_of_kin_number,
        passport_number, policy_number, profile_picture, is_active
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18, $19
      )
      RETURNING *`,
      [
        userId, first_name, last_name, email, phone_number || null, id_number || null,
        address_line_1 || null, address_line_2 || null, city || null, postal_code || null, province || null,
        client_password, initiator_name || null, next_of_kin || null, next_of_kin_number || null,
        passport_number || null, policy_number || null, profile_picture || null, true
      ]
    );

    const token = generateJWT(userId, email);

    res.status(201).json({
      message: 'Regular customer created successfully',
      user: newUser,
      customer: customerResult.rows[0],
      token
    });

  } catch (err) {
    console.error('Error during registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
// User login


// Get all customers with customer info
const getAllCustomers = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id as user_id, u.email, u.user_type,
        c.*
      FROM users u
      LEFT JOIN customers c ON u.id = c.user_id
    `);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No users found.' });
    }

    res.json({ users: result.rows });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Get a single user by ID
const getACustomer = async (req, res) => {
  const { userId } = req.params;

  try {
    const result = await pool.query(`
      SELECT 
        u.id as user_id, u.email, u.user_type,
        c.*
      FROM users u
      LEFT JOIN customers c ON u.id = c.user_id
      WHERE u.id = $1
    `, [userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Update user and customer
const updateACustomer = async (req, res) => {
  const { userId, customerId } = req.params;  // Get both userId and customerId from params
  const fields = req.body;

  let client;  // Declare client here so it can be used later
  try {
    // Get a database client
    client = await pool.connect(); 
    await client.query('BEGIN');  // Start transaction

    // Update users table
    const userFields = ['email', 'password'];
    const userSet = [];
    const userValues = [];

    for (let key of userFields) {
      if (fields[key] !== undefined) {
        if (key === 'password') {
          const hashed = await bcrypt.hash(fields[key], 10);
          userSet.push(`${key} = $${userValues.length + 1}`);
          userValues.push(hashed);
        } else {
          userSet.push(`${key} = $${userValues.length + 1}`);
          userValues.push(fields[key]);
        }
      }
    }

    if (userSet.length > 0) {
      await client.query(
        `UPDATE users SET ${userSet.join(', ')} WHERE id = $${userValues.length + 1}`,
        [...userValues, userId]
      );
    }

    // Update customers table based on customerId
    const customerFields = [
      'first_name', 'email', 'last_name', 'phone_number', 'id_number',
      'address_line_1', 'address_line_2', 'city', 'postal_code', 'province',
      'initiator_name', 'next_of_kin', 'next_of_kin_number',
      'passport_number', 'policy_number', 'profile_picture', 'is_active'
    ];

    const customerSet = [];
    const customerValues = [];

    for (let key of customerFields) {
      if (fields[key] !== undefined) {
        customerSet.push(`${key} = $${customerValues.length + 1}`);
        customerValues.push(fields[key]);
      }
    }

    // Don't hash the client_password, update it as-is
    if (fields.client_password !== undefined) {
      customerSet.push(`client_password = $${customerValues.length + 1}`);
      customerValues.push(fields.client_password);
    }

    if (customerSet.length > 0) {
      await client.query(
        `UPDATE customers SET ${customerSet.join(', ')} WHERE customer_id = $${customerValues.length + 1}`,
        [...customerValues, customerId]  // Use customerId for customers table
      );
    }

    await client.query('COMMIT');  // Commit the transaction

    res.json({ message: 'User and customer updated successfully.' });

  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');  // Rollback if error
    }
    console.error('Error updating user or customer:', err);
    res.status(500).json({ error: 'Internal server error.' });
  } finally {
    if (client) {
      client.release();  // Release client back to pool only if client is defined
    }
  }
};

// Delete user and customer
const deleteACustomer = async (req, res) => {
  const { userId, customerId } = req.params;  // Now receiving both userId and customerId

  // Log to check both userId and customerId
  console.log('User ID to delete:', userId);
  console.log('Customer ID to delete:', customerId);

  try {
    // Check if user exists in the users table first
    const userCheck = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if customer exists in the customers table with the given customerId
    const customerCheck = await pool.query('SELECT * FROM customers WHERE customer_id = $1 AND user_id = $2', [customerId, userId]);
    if (customerCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found for this user' });
    }

    // If both exist, proceed with deletion
    await pool.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ message: 'User and customer deleted successfully.' });

  } catch (err) {
    console.error('Error deleting user or customer:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
};

// Export all
module.exports = {
  addCustomer,

  updateACustomer,
  getAllCustomers,
  getACustomer,
  deleteACustomer
};
