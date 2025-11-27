const express= require('express');
const dotenv=require('dotenv');
const app = express();
const PORT = process.env.PORT || 3003;
const cors = require("cors");
const { Pool } = require("pg");

const usersRoutes= require('./routes/customers_routes');
const userLoginRoutes= require('./routes/global_auth_route');
const ekcoStaffRoutes= require('./routes/ekco_staff_routes');
const authMiddleWare= require('./config/authMiddleWare');

dotenv.config();

app.use(express.json());




app.use('/api', ekcoStaffRoutes );
app.use('/api', userLoginRoutes);

app.use('/api', usersRoutes);



app.listen(PORT, ()=>{
    console.log(`Authentication server started on port: ${PORT}`);
})