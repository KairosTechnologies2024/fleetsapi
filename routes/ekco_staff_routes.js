const express= require('express');
const router= express.Router();
const ekco_staff_controller= require('../controllers/auth controllers/ekco_staff_controller');

const authMiddleWare= require('../config/authMiddleWare');






router.post('/staff/adduser',  ekco_staff_controller.createUser);

router.get('/staff/users', authMiddleWare, ekco_staff_controller.getAllUsers);
router.get('/staff/user/:id', authMiddleWare,  ekco_staff_controller.getUserById);
router.put('/staff/user/:id', authMiddleWare, ekco_staff_controller.updateUser);
router.delete('/staff/user/:id', authMiddleWare, ekco_staff_controller.deleteUser);













module.exports=router;