const express= require('express');
const router= express.Router();
const global_login_controller= require('../controllers/auth controllers/global_login_controller');







router.post('/users/login/',  global_login_controller.loginUserWithEmailPassword);









module.exports=router;