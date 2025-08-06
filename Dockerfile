FROM node:18-alpine

#Create app dir
WORKDIR /app

#Install app dependencies
COPY package*.json ./

#Run npm install
RUN npm install

#Bundle app source
COPY . .

# Open Ports
EXPOSE 3001
EXPOSE 3002

# Start the application
CMD ["npm", "run", "start:all"]