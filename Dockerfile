FROM node:18-bookworm

# Set working directory for the entire app structure
WORKDIR /app

# Copy package definitions first to leverage Docker layer caching
COPY backend/package*.json ./backend/

# Move into backend directory and install Node modules
WORKDIR /app/backend
RUN npm install

# Critically important: Install Playwright's specific browser binary AND its Linux system dependencies (fonts, libgbm, libnss3, etc.)
# We only install Chromium to save build time and storage space.
RUN npx playwright install --with-deps chromium

# Move back up to copy the rest of the application files
WORKDIR /app
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Set working directory to backend where server.js lives for execution
WORKDIR /app/backend

# Expose the API and Dashboard port
EXPOSE 3000

# Start the application
CMD ["npm", "start"]
