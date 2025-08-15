const axios = require('axios');
class Communicator {
    constructor() {
        this.gpsServiceClient = axios.create({ 
            baseURL: 'http://localhost:3001/api',
        });
        this.vehicleServiceClient = axios.create({ 
            baseURL: 'http://localhost:3002/api',
        });
        this.authServiceClient = axios.create({ 
            baseURL: 'http://localhost:3003/api',
        });
    }

    async getGps() {
        try {
            const response = await this.gpsServiceClient.get('/data');
            return response.data;
        } catch (error) {
            console.error('Error fetching GPS data:', error.message);
            return null;
        }
    }
    async getAuth() {
        try {
            const response = await this.authServiceClient.get('/auth');
            return response.data;
        } catch (error) {
            console.error('Error fetching Auth data:', error.message);
            return null;
        }
    }

    async getVehicles() {
        try {
            const response = await this.vehicleServiceClient.get('/vehicles');
            return response.data;
        } catch (error) {
            console.error('Error fetching vehicles:', error.message);
            return null;
        }
    }

    async getAlerts() {
        try {
            const response = await this.alertServiceClient.get('/alerts');
            return response.data;
        } catch (error) {
            console.error('Error fetching alerts:', error.message);
            return null;
        }
    }
}

module.exports = new Communicator();
