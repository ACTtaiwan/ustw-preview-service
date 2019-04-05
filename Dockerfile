FROM node:8.10.0

# Create app directory
RUN mkdir /opt/app
WORKDIR /opt/app

# For Puppeteer
RUN apt-get update && \
  apt-get install -yq gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
  libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 \
  libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
  libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
  ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils wget

# Prepare fonts
RUN rm -rf /usr/share/fonts/truetype
COPY ./fonts/Helvetica* /usr/share/fonts/truetype/helvetica/
COPY ./fonts/SF-Pro* /usr/share/fonts/truetype/sf-pro/
RUN fc-cache -f -v

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY ./package*.json ./
COPY ./tsconfig.json ./

# dependency
COPY ./.env ./

RUN npm set strict-ssl false
RUN npm install
# If you are building your code for production
# RUN npm install --only=production

# Bundle app source
COPY ./src ./src
COPY ./assets ./assets

EXPOSE 9487
CMD [ "npm", "start" ]