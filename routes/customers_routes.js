const express= require('express');
const router= express.Router();
const regular_customers_controller= require('../controllers/auth controllers/regular_customers_controller');
const fleet_customers_controller= require('../controllers/auth controllers/fleet_customers_controller');





//Regular Customer Routes


router.get('/customers', regular_customers_controller.getAllCustomers);
router.get("/customers/customer/:id", regular_customers_controller.getACustomer);
router.put("/customers/customer/:userId/:customerId", regular_customers_controller.updateACustomer);
router.delete("/customers/customer/:userId/:customerId", regular_customers_controller.deleteACustomer);
router.post('/customers/register/', regular_customers_controller.addCustomer);



//Fleet Customers Routes

router.get('/fleetcustomers/fleetcustomer/:id', fleet_customers_controller.getFleetCustomer);
router.get('/fleetcustomers', fleet_customers_controller.getAllFleetCustomers);
router.put('/fleetcustomers/update/:id', fleet_customers_controller.updateFleetCustomer);
router.post('/fleetcustomers/fleetcustomer/register', fleet_customers_controller.createFleetCustomer);
router.delete('/fleetcustomers/fleetcustomer/delete/:id', fleet_customers_controller.deleteFleetCustomer);





module.exports= router;



